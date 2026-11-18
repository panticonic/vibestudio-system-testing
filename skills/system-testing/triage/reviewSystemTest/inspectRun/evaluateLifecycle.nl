---
description: Separate infrastructure readiness, a still-running test, and a terminal test whose resources need cleanup.
args:
  request: TestPacketInput
returns: "resolve-infrastructure"|"wait-owned-run"|"join-cleanup"|"ready"
---
If readiness failed, return resolve-infrastructure. If readiness or terminal state is pending, wait-owned-run. Otherwise if cleanup is outstanding or unknown return join-cleanup. A terminal result does not prove all owned resources were joined. Return ready otherwise.
