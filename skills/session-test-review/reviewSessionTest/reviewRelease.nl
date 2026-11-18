---
description: Verify teardown owned by a headless session or a deterministic testkit case.
args:
  evidence: SessionRelease | TestkitRelease
returns: SessionReview
---
Call checkSessionClose for session-close or checkTestkitRelease for testkit. Return its review.
