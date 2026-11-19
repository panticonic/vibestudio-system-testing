---
description: Check channel identity, replay integrity and the observed retry.
args:
  evidence: ReplayCheckpoint
returns: LiveReplayFinding
uses: [reviewSessionTest]
---
1. Call continuationRequest with evidence, then call reviewSessionTest with the returned request.
2. For replay-channel-mismatch use wrong-channel. For original-message-unobserved use inconsistent-replay. Otherwise call preservesReplay. If it returns false use inconsistent-replay. If it returns true call classifyRetry to distinguish the retry, a separate send, or an unattempted retry.
3. Set receipt, originalId and retryId from the receipt. Set retainedIds to the ids from evidence.after in their observed order.
