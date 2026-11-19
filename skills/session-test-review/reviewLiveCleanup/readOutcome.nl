---
description: Read the terminal test outcome independently of deferred cleanup.
args:
  evidence: LiveCleanupEvidence
returns: TestkitOutcome
---
Return the recorded outcome. A cleanup error or leftover resource is separate from whether the test body passed, failed an assertion, errored or timed out.
