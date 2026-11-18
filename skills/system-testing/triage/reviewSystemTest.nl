---
description: Diagnose an owned system-test run, review scenario design, or assess a mobile setup from its actual receipts.
uses: [triageFailure]
args:
  request: TestReviewRequest
returns: TestReviewReport
---
Use request.kind to select the work. Call triageFailure for a provided failure. For an assigned retained read, call inspectRun.readAssignedRun and retain the exact run ID. For a captured run decision call inspectRun. For scenario authoring call reviewScenario. For mobile readiness call reviewMobile. Preserve all exact evidence or blockers from the chosen stage. This review does not start an agent, initiate an external device operation, or claim an effect from a dispatch.
