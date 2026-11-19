---
description: Verify the previously accepted message and the preserved prefix.
args:
  evidence: ReplayCheckpoint
returns: boolean
---
The prior replay must contain the original accepted id exactly once with its original text. The post-retry replay must begin with exactly the same rows, including ids, content, sender and order, and no message id may appear twice. Return true when all those checks hold.
