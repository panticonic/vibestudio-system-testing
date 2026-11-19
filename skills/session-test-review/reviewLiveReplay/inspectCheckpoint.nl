---
description: Check channel identity, replay integrity and the observed retry.
args:
  evidence: ReplayCheckpoint
returns: LiveReplayFinding
---
1. Call matchesChannel. If it returns false, use wrong-channel. Otherwise call preservesReplay. If it returns false, use inconsistent-replay. Otherwise call classifyRetry for the disposition.
2. Set receipt, originalId and retryId from the receipt. Set retainedIds to the ids from evidence.after in their observed order.
