---
description: Distinguish a durable retry, a separate accepted message, and an unattempted retry.
args:
  evidence: ReplayCheckpoint
returns: ReplayDisposition
---
If retry is null, return retry-pending only when no new rows appeared, otherwise inconsistent-replay. For an attempted retry call matchAcceptedIdentity. Return its disposition.
