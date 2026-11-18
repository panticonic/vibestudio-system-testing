---
description: Review an authored scenario's prompt, fixture isolation and observed outcome checks.
args:
  request: TestAuthorInput
returns: TestReviewReport
---
Call checkIsolation and checkOutcome. Assemble their blockers in that order and return kind scenario and ready only if both lists are empty. A case requiring model judgment must preserve a user-level goal and a verifier of actual effects.
