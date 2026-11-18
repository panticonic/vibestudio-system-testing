---
description: Require the requested device driver to be attached in foreground and verify its observed application effect.
args:
  request: TestMobileInput
returns: "attach-driver"|"foreground-only"|"exercise-postcondition"|"verified"
---
If the device is requested and its driver is absent or stale, return attach-driver. If the attached-device run is not foreground, return foreground-only. Otherwise return verified only when an independent postcondition observation exists, or exercise-postcondition when it remains to be checked.
