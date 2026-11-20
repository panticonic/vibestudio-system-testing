---
description: Read one retained diagnostic from the assigned system-test runner.
args:
  operationId: string
returns: RetainedFailurePacket | null
---
Call retainedTestFailure.inspect once with operationId and return its actual result.
