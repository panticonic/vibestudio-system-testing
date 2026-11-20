import { AGENTIC_EVENT_PAYLOAD_KIND, type AgenticEvent } from "@workspace/agentic-protocol";
import type { ChannelReplayEnvelope } from "@vibestudio/service-schemas/channel";
import type { Receipt } from "@workspace-skills/open-owned-scheduled-recovery/types";

/** Verify one bounded forward page requested from sequence zero. */
export function readScheduledLaneReceipts(
  { mode, ready, logEvents }: ChannelReplayEnvelope,
  contextId: string,
  lane: string,
  senderId: string,
): Receipt[] {
  if (mode !== "after" || ready.contextId !== contextId)
    throw new Error("Scheduled replay is outside the retained local lane");
  const first = logEvents[0]?.id;
  const last = logEvents.at(-1)?.id;
  // The canonical ledger omits its frontier when the owner log has no rows.
  // A populated page must end at that frontier to attest the entire history.
  if (ready.hasMoreBefore !== false || ready.hasMoreAfter !== false ||
      ready.totalCount !== logEvents.length || ready.envelopeCount !== logEvents.length ||
      ready.firstEnvelopeSeq !== first || ready.replayFromId !== first ||
      ready.replayToId !== last || ready.snapshotLastSeq !== last)
    throw new Error("Could not attest the complete retained local lane");
  return logEvents.flatMap(entry => {
    if (entry.type !== AGENTIC_EVENT_PAYLOAD_KIND) return [];
    const event = entry.payload as AgenticEvent<"message.completed"> | undefined;
    if (event?.kind !== "message.completed" || !("role" in event.payload) || event.payload.role !== "user") return [];
    const messageId = event.causality?.messageId;
    if (!messageId || entry.senderId !== senderId)
      throw new Error("Unexpected retained message author or missing message identity");
    const text = (event.payload.blocks ?? []).flatMap(block => block.type === "text" ? [block.content] : []).join("");
    return [{ messageId, text, lane, sender: entry.senderId, sequence: entry.id }];
  });
}
