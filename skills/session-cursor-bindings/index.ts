import { doTargetId } from "@vibestudio/shared/workspaceServiceRpc";
import { AGENTIC_EVENT_PAYLOAD_KIND, storedAgenticEventSchema } from "@workspace/agentic-protocol";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { contextId, rpc } from "@workspace/runtime";
import type {
  TranscriptCursor,
  TranscriptPage,
  TranscriptRow,
  TranscriptStart,
} from "../session-test-review/types.js";

type Assignment = {
  goal: string;
  channelId: string;
  targetId: string;
  saved: TranscriptCursor;
  pageSize: number;
  maxPages: number;
};

export function bindTranscriptCursor(input: Assignment) {
  const { goal, saved, channelId, targetId, pageSize, maxPages } = structuredClone(input);
  if (!contextId || !goal.trim() || !channelId || !saved.channelId ||
    targetId !== doTargetId({ source: "workers/pubsub-channel", className: "PubSubChannel", objectKey: channelId }) ||
    !Number.isSafeInteger(saved.seq) || saved.seq < 0 ||
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 16 ||
    !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 6)
    throw new Error("Assign a bounded replay for one owned channel and saved cursor");
  const request = { goal, operationId: crypto.randomUUID() };
  let page: TranscriptPage | null = null;
  let readCount = 0;
  let reading = false;
  let opening: Promise<TranscriptStart> | undefined;

  async function read(after: number, throughSeq?: number): Promise<TranscriptPage> {
    const response = await rpc.call(targetId, channelClientRpcMethods.getReplayAfter, [{
      after, limit: pageSize, ...(throughSeq === undefined ? {} : { throughSeq }),
    }]);
    const { ready, logEvents } = response;
    const through = ready.snapshotLastSeq;
    const nextAfter = logEvents.at(-1)?.id ?? after;
    const hasMore = ready.hasMoreAfter === true;
    if (response.mode !== "after" || ready.contextId !== contextId ||
      through === undefined || !Number.isSafeInteger(through) || through < 0 ||
      (throughSeq !== undefined && through !== throughSeq) || logEvents.length > pageSize ||
      (hasMore && (nextAfter <= after || nextAfter >= through)) ||
      (logEvents.length > 0 && nextAfter !== ready.replayToId) ||
      logEvents.some(({ id }, index) =>
        !Number.isSafeInteger(id) || id <= (logEvents[index - 1]?.id ?? after) || id > through))
      throw new Error("The native transcript page disagrees with the assigned replay window");
    const messages = logEvents.flatMap((entry): TranscriptRow[] => {
      if (entry.type !== AGENTIC_EVENT_PAYLOAD_KIND ||
        (entry.payload as { kind?: string } | null)?.kind !== "message.completed")
        return [];
      const event = storedAgenticEventSchema.parse(entry.payload);
      const payload = event.payload as {
        role?: string;
        blocks?: { type?: string; content?: string }[];
      };
      if (payload.role !== "user" && payload.role !== "assistant") return [];
      const messageId = event.causality?.messageId;
      if (!messageId) throw new Error("A visible transcript row has no durable message identity");
      return [{
        envelopeId: entry.messageId, seq: entry.id, messageId, role: payload.role,
        preview: (payload.blocks ?? []).filter(({ type }) => type === "text")
          .map(({ content }) => content ?? "").join("").slice(0, 240),
      }];
    });
    return { after, through, nextAfter, envelopeCount: logEvents.length, hasMore, messages };
  }

  function verifyId(id: string) {
    if (id !== request.operationId) throw new Error("Read only the caller's assigned transcript");
  }

  return {
    request,
    services: {
      transcriptCursor: {
        async open(id: string): Promise<TranscriptStart> {
          verifyId(id);
          opening ??= (async () => {
            if (saved.channelId === channelId) {
              page = await read(saved.seq);
              readCount = 1;
            }
            return { channelId, saved, maxPages, first: page };
          })();
          return structuredClone(await opening);
        },
        async next(id: string, after: number, through: number): Promise<TranscriptPage> {
          verifyId(id);
          if (!page || !page.hasMore || reading || readCount >= maxPages ||
            after !== page.nextAfter || through !== page.through)
            throw new Error("Continue only at the previous page cursor and original snapshot");
          reading = true;
          try {
            page = await read(after, through);
            readCount++;
            return structuredClone(page);
          } finally {
            reading = false;
          }
        },
      },
    },
  };
}
