---
description: Review the actual headless client reconnect and retry receipts in order.
args:
  request: LiveReplayRequest
returns: LiveReplayReport
budget: { maxTurns: 30 }
---
For every requested checkpoint, call readCheckpoint with the requested receipt ID, then call inspectCheckpoint with the returned checkpoint. Return their findings in the original requested order.
