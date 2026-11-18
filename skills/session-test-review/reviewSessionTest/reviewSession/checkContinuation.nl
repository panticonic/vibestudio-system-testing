---
description: Evaluate an exact durable channel replay and idempotent retry.
args:
  evidence: Continuation
returns: SessionReview
---
Cite evidence.receipt. A different replayChannel gives unobserved and replay-channel-mismatch. When the original message is absent from the replay, return unobserved and original-message-unobserved. If retryKey differs from originalKey, return revise and retry-key-changed. Absent retryMessage leaves waiting and retry-terminal-unobserved. A different retryMessage or repeated original message in the transcript gives revise and duplicate-message. Otherwise return confirmed and continuation-stable.
