---
description: Check whether the real infrastructure, terminal outcome and owned cleanup support diagnosis.
args:
  request: TestPacketInput
returns: RunReview
---
Call evaluateLifecycle with the actual packet. If it returns ready, call evaluateOutcome. Return kind run, the stage's exact next action, and the original attemptId. Missing or outdated data cannot prove a terminal verdict.
