---
description: Review the actual Testkit result, deferred cleanup and independently measured post-test inventory.
args:
  request: LiveCleanupRequest
returns: LiveCleanupReport
uses: [reviewSessionTest]
---
1. Call readCleanup with request.receipt. Call readOutcome with the evidence to determine the test outcome.
2. Call reviewSessionTest with { kind: "release", goal: request.goal, evidence: evidence.release }. Keep its decision, finding and evidenceIds.
3. Call inspectInventory to classify resources still present after cleanup. Keep the exact remaining ids in acquired order. Return the receipt, testOutcome, release, inventory and remainingIds.
