import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import type { RpcClient } from "@vibestudio/rpc";
import type { ServerLogEvent } from "@workspace/pubsub";

/** Read one immutable channel frontier; a growing live transcript cannot make
 * collection chase new events forever or mix observations from two heads. */
export async function readRetainedChannelReplay(
  rpc: Pick<RpcClient, "call">,
  channelId: string,
): Promise<ServerLogEvent[]> {
  const events: ServerLogEvent[] = [];
  let after = 0;
  let throughSeq: number | undefined;
  for (;;) {
    const page = await rpc.call(
      `do:workers/pubsub-channel:PubSubChannel:${channelId}`,
      channelRpcMethods["getReplayAfter"],
      [
        {
          after,
          limit: 500,
          ...(throughSeq === undefined ? {} : { throughSeq }),
        },
      ],
    );
    throughSeq ??= page.ready.snapshotLastSeq;
    events.push(...page.logEvents);
    if (!page.ready.hasMoreAfter) return events;
    const next = page.ready.replayToId;
    if (next === undefined || next <= after)
      throw new Error("Retained channel replay cursor did not advance");
    after = next;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Join published native response coordinates to the actual original input settlement. */
export function completedChildModelReports(
  events: readonly ServerLogEvent[],
  childParticipantId: string,
  modelExecutionEvidence: unknown,
): Array<{
  text: string;
  model: string;
  messageId: string;
  nativeTaskId: number;
  nativeEntryId: number;
}> {
  const evidence = record(modelExecutionEvidence);
  const calls = Array.isArray(evidence?.["calls"])
    ? evidence["calls"].map(record).filter((call) => call !== null)
    : [];
  return events
    .filter((event) => event.senderId === childParticipantId)
    .flatMap((event) => {
      const agentic = record(event.payload);
      const payload = record(agentic?.["payload"]);
      const causality = record(agentic?.["causality"]);
      const metadata = record(payload?.["metadata"]);
      const messageId = causality?.["messageId"];
      const taskId = metadata?.["nativeTaskId"];
      const entryId = metadata?.["nativeEntryId"];
      const conversationId = metadata?.["nativeConversationId"];
      if (
        agentic?.["kind"] !== "message.completed" ||
        payload?.["outcome"] !== "completed" ||
        typeof messageId !== "string" ||
        typeof taskId !== "number" ||
        typeof entryId !== "number" ||
        typeof conversationId !== "number"
      )
        return [];
      const attempt = calls.find((call) => {
        const native = record(call["native"]);
        if (
          native?.["taskId"] !== taskId ||
          native["conversationId"] !== conversationId ||
          call["entryId"] !== entryId ||
          call["outcome"] !== "completed" ||
          typeof call["ref"] !== "string" ||
          !Array.isArray(call["inputs"]) ||
          call["inputs"].length === 0
        )
          return false;
        return call["inputs"].every((input) => {
          const original = record(input);
          return (
            original?.["conversationId"] === conversationId &&
            original["type"] === "input" &&
            original["status"] === "done" &&
            original["answer"] === entryId
          );
        });
      });
      if (!attempt || !Array.isArray(payload["blocks"])) return [];
      const text = payload["blocks"]
        .flatMap((block) => {
          const value = record(block);
          return value?.["type"] === "text" &&
            typeof value["content"] === "string"
            ? [value["content"]]
            : [];
        })
        .join("\n");
      return text
        ? [
            {
              text,
              model: attempt["ref"] as string,
              messageId,
              nativeTaskId: taskId,
              nativeEntryId: entryId,
            },
          ]
        : [];
    });
}


/** Join native tool admission and completion from one child's retained channel. */
export function completedChildToolResults(
  events: readonly ServerLogEvent[],
  child: { childParticipantId: string; childEntityId: string },
  name: string,
): unknown[] {
  const admitted = new Set<string>();
  const results: unknown[] = [];
  for (const event of events) {
    if (event.senderId !== child.childParticipantId || event.type !== "agentic.trajectory.v1/event") continue;
    const agentic = record(event.payload);
    const payload = record(agentic?.["payload"]);
    const causality = record(agentic?.["causality"]);
    const id = causality?.["invocationId"];
    if (typeof id !== "string") continue;
    if (agentic?.["kind"] === "invocation.started") {
      const source = record(payload?.["nativeSource"]);
      const owner = record(source?.["owner"]);
      const operation = record(source?.["operation"]);
      if (payload?.["name"] === name && owner?.["runtimeId"] === child.childEntityId &&
          operation?.["kind"] === "tool" && operation["name"] === name) admitted.add(id);
    } else if (agentic?.["kind"] === "invocation.completed" && admitted.delete(id) &&
               payload?.["terminalOutcome"] === "success") results.push(payload["result"]);
  }
  return results;
}
