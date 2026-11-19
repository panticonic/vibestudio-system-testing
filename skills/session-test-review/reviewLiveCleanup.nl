---
description: Review the actual Testkit result, deferred cleanup and independently measured post-test inventory.
args:
  request: LiveCleanupRequest
returns: LiveCleanupReport
uses: [reviewSessionTest/reviewRelease/checkTestkitRelease]
---
1. Call readCleanup with request.receipt. Call readOutcome with the evidence to determine the test outcome.
2. Call checkTestkitRelease with evidence.release to review deferred cleanup. Keep its decision, finding and evidenceIds.
3. Call inspectInventory to classify resources still present after cleanup. Keep the exact remaining ids in acquired order. Return the receipt, testOutcome, release, inventory and remainingIds.
