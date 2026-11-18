---
description: Check the headless fixture's authorized participant, creation state and channel.
args:
  evidence: Seed
returns: SessionReview
---
Cite evidence.receipt. Compare participant to runtimeSelf and return revise with finding participant-scope on a mismatch. Then compare agentContext with requestedContext; a mismatch gives revise and seed-context. Behavior stored in the subscription alone gives revise and behavior-not-seeded. A missing durableChannel gives unobserved and channel-unobserved. Otherwise return confirmed and headless-seed-verified.
