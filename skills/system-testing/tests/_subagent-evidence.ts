import type { RpcClient } from "@vibestudio/rpc";
import type { ChannelReplayEnvelope, ServerLogEvent } from "@workspace/pubsub";

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
    const page = await rpc.call<ChannelReplayEnvelope>(
      `do:workers/pubsub-channel:PubSubChannel:${channelId}`,
      "getReplayAfter",
      [{ after, limit: 500, ...(throughSeq === undefined ? {} : { throughSeq }) }],
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
    ? value as Record<string, unknown>
    : null;
}

/** Ordinary replies finish an assignment without retiring its collaborator.
 * Join the exact sender, message, executed model attempt and closing turn;
 * launch settings and a task card alone prove none of those facts. */
export function closedChildModelReports(
  events: readonly ServerLogEvent[],
  childParticipantId: string,
  modelExecutionEvidence: unknown,
): Array<{ text: string; model: string; messageId: string; turnId: string }> {
  const evidence = record(modelExecutionEvidence);
  const calls = Array.isArray(evidence?.["calls"])
    ? evidence["calls"].map(record).filter((call) => call !== null)
    : [];
  const childEvents = events.filter((event) => event.senderId === childParticipantId);
  return childEvents.flatMap((event) => {
    const agentic = record(event.payload);
    const payload = record(agentic?.["payload"]);
    const causality = record(agentic?.["causality"]);
    const messageId = causality?.["messageId"];
    const turnId = agentic?.["turnId"];
    if (agentic?.["kind"] !== "message.completed" ||
        payload?.["outcome"] !== "completed" ||
        typeof messageId !== "string" || typeof turnId !== "string") return [];
    const attempt = calls.find((call) => call["messageId"] === messageId &&
      call["outcome"] === "completed" && typeof call["ref"] === "string");
    if (!attempt) return [];
    const closed = childEvents.some((candidate) => {
      const close = record(candidate.payload);
      const closePayload = record(close?.["payload"]);
      return candidate.id > event.id && close?.["kind"] === "turn.closed" &&
        close["turnId"] === turnId &&
        closePayload !== null && closePayload["reason"] === undefined;
    });
    if (!closed || !Array.isArray(payload["blocks"])) return [];
    const text = payload["blocks"].flatMap((block) => {
      const value = record(block);
      return value?.["type"] === "text" && typeof value["content"] === "string"
        ? [value["content"]] : [];
    }).join("\n");
    return text ? [{ text, model: attempt["ref"] as string, messageId, turnId }] : [];
  });
}
