---
description: Inspect the acknowledged lifecycle of an isolated or inherited headless session.
args:
  evidence: SessionRelease
returns: SessionReview
---
Cite evidence.receipt. Persisted cleanup errors give revise and close-errors. If phase is not complete or completedAt is null, a detached caller gives waiting and detached-cleanup-pending, otherwise waiting and cleanup-pending. At the acknowledged complete phase, require exactly two terminals in order. Both start with unsubscribe. An isolated session then destroys its owned context and an inherited context then retires its agent. Wrong ownership or terminal order gives revise and cleanup-owner-order. An exact match gives confirmed and session-released.
