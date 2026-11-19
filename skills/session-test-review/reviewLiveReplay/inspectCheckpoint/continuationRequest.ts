import type { ReplayCheckpoint, SessionReviewRequest } from "../../types.js";

export default function continuationRequest(
  evidence: ReplayCheckpoint,
): Extract<SessionReviewRequest, { kind: "session" }> {
  const { receipt, originalChannel, replayChannel, original, retry, before } = evidence;
  return {
    kind: "session",
    goal: "Check the accepted message identity across this reconnect.",
    evidence: {
      kind: "continuation",
      receipt,
      originalChannel,
      replayChannel,
      originalKey: original.key,
      retryKey: retry?.key ?? original.key,
      originalMessage: original.messageId,
      replayedMessages: before.map(({ id }) => id),
      retryMessage: retry?.messageId ?? null,
    },
  };
}
