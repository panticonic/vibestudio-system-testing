---
description: Check that a mobile scenario runs in its own tooling workspace with its required device.
args:
  request: TestMobileInput
returns: TestReviewReport
---
Call installedTarget before driveReceipt. A nonready target takes precedence. Use the selected toolingWorkspace as basis and return kind mobile. If both stages are ready, the readback establishes verification.
