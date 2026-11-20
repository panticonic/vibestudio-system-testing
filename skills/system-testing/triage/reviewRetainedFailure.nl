---
description: Triage one test from its owned retained failure record.
uses: [reviewSystemTest]
args:
  request: RetainedFailureRequest
returns: RetainedFailureReview
---
1. Call readRetainedFailure with the assigned operationId. Call matchesAssignment with request and its returned packet.
2. If the packet is absent or its identity does not match, return unavailable with the requested runId and testName and triage null.
3. Call reviewSystemTest with kind triage, the original goal, and the exact failure in the packet. Return triaged with the requested identifiers and the class and evidence from that review. Preserve its evidence without paraphrasing.
