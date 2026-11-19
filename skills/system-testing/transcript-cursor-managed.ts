import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { bindTranscriptCursor } from "@workspace-skills/session-cursor-bindings";
import type { TranscriptPage, TranscriptReport, TranscriptStart } from "../session-test-review/types.js";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { transcriptCursorWorlds } from "./transcript-cursor-worlds.js";

type Input = { contextId: string; caseId: string };

export async function prepareTranscriptCase(input: Input) {
  const assigned = transcriptCursorWorlds.find(({ id }) => id === input.caseId);
  if (!assigned || contextId !== input.contextId) throw new Error("Unknown assigned transcript");
  const world = assigned;
  const lane = await createOwnedHeadlessChannel(contextId, "Owned transcript handoff");
  const send = (notes: readonly string[]) => withOwnedChannelClient(lane, input.contextId, async (client) => {
    const messages = new Map<string, string>();
    for (const text of notes)
      messages.set(await client.send(text, { idempotencyKey: crypto.randomUUID() }), text);
    return messages;
  });
  const seeded = await send(world.messages);
  const nativeHistory = () => rpc.call(lane.target, channelClientRpcMethods.getReplayAfter, [{ after: 0, limit: 100 }]);
  const baseline = await nativeHistory();
  const frontier = baseline.ready.snapshotLastSeq;
  if (frontier === undefined || baseline.ready.hasMoreAfter)
    throw new Error("The seeded transcript exceeded its qualification window");
  const saved = {
    channelId: world.cursor === "foreign" ? lane.key + "-other" : lane.key,
    seq: world.cursor === "head" ? frontier : 0,
  };
  const bound = bindTranscriptCursor({
    goal: world.goal, channelId: lane.key, targetId: lane.target, saved,
    maxPages: world.maxPages, pageSize: world.pageSize,
  });
  let observation: TranscriptStart | undefined;
  let appended = new Map<string, string>();
  const pages: TranscriptPage[] = [];
  const operations: string[] = [];
  const services: typeof bound.services = {
    transcriptCursor: {
      async open(id) {
        const result = await bound.services.transcriptCursor.open(id);
        observation = structuredClone(result);
        operations.push("open");
        if (result.first?.envelopeCount) pages.push(structuredClone(result.first));
        if ("late" in world) appended = await send([world.late]);
        return result;
      },
      async next(id, after, through) {
        const result = await bound.services.transcriptCursor.next(id, after, through);
        pages.push(structuredClone(result));
        operations.push("next");
        return result;
      },
    },
  };
  const { operationId } = bound.request;
  const expectedMessages = baseline.logEvents.flatMap((envelope) => {
    const event = envelope.payload as AgenticEvent<"message.completed"> | undefined;
    const id = event?.causality?.messageId;
    const preview = id ? seeded.get(id) : undefined;
    if (event?.kind !== "message.completed" || !id || preview === undefined) return [];
    return [{ envelopeId: envelope.messageId, seq: envelope.id, messageId: id, role: "user" as const, preview }];
  });
  if (expectedMessages.length !== seeded.size)
    throw new Error("The native baseline did not retain each sent note");

  async function verify(report: TranscriptReport | null) {
    const latest = await nativeHistory();
    const lateRecord = latest.logEvents.find((row) => {
      const event = row.payload as AgenticEvent<"message.completed"> | undefined;
      const id = event?.causality?.messageId;
      return event?.kind === "message.completed" && !!id && appended.has(id);
    });
    const late = lateRecord ? { envelopeId: lateRecord.messageId, seq: lateRecord.id } : null;
    const last = pages.at(-1);
    const requiredPages = world.cursor === "start"
      ? Math.min(world.maxPages, Math.ceil(baseline.logEvents.length / world.pageSize)) : 0;
    const next = world.outcome === "foreign-channel" ? null
      : { channelId: lane.key, seq: last?.nextAfter ?? saved.seq };
    const checks = {
      scope: !!observation && observation.channelId === lane.key &&
        isDeepStrictEqual(observation.saved, saved) && isDeepStrictEqual(report?.start, observation) &&
        (world.cursor === "foreign" ? observation.first === null : observation.first?.through === frontier),
      pages: pages.length === requiredPages && isDeepStrictEqual(report?.pages, pages) &&
        isDeepStrictEqual(operations, ["open", ...Array(Math.max(0, requiredPages - 1)).fill("next")]) &&
        pages.every((page, i) => {
          const lower = pages[i - 1]?.nextAfter ?? saved.seq;
          const rows = baseline.logEvents.filter(({ id }) => id > lower).slice(0, world.pageSize);
          return page.after === lower && page.through === frontier &&
            page.nextAfter === rows.at(-1)?.id && page.envelopeCount === rows.length &&
            page.hasMore === ((page.nextAfter < frontier)) &&
            isDeepStrictEqual(page.messages, expectedMessages.filter(({ seq }) => seq > lower && seq <= page.nextAfter));
        }),
      checkpoint: report?.outcome === world.outcome && isDeepStrictEqual(report.next, next) &&
        isDeepStrictEqual(report.messages, pages.flatMap((page) => page.messages)),
      isolatedTail: "late" in world
        ? appended.size === 1 && !!late && late.seq > frontier
        : latest.ready.snapshotLastSeq === frontier,
    };
    return { ...input, request: bound.request, channelId: lane.key, saved, frontier,
      expectedMessages, late, observation, pages, operations, checks, passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    const start = await services.transcriptCursor.open(operationId);
    let page = start.first;
    while (page?.hasMore && pages.length < start.maxPages)
      page = await services.transcriptCursor.next(operationId, page.nextAfter, page.through);
    const next = world.outcome === "foreign-channel" ? null
      : { channelId: lane.key, seq: pages.at(-1)?.nextAfter ?? saved.seq };
    return verify({ start, pages, next, messages: pages.flatMap((page) => page.messages), outcome: world.outcome });
  }
  return { request: bound.request, services, qualify, verify };
}

type Prepared = Awaited<ReturnType<typeof prepareTranscriptCase>>;
export interface TranscriptCursorReceiver {
  runTranscriptCursorTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyTranscriptCursor(input: Input): ReturnType<Prepared["qualify"]>;
}
export const transcriptCursorMethods = createReceiverRpcMethods<TranscriptCursorReceiver>([
  "runTranscriptCursorTeacher", "qualifyTranscriptCursor",
]);
