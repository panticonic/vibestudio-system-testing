---
description: Choose the next mobile setup step from the actual template workspace and installed unit.
args:
  request: TestMobileInput
returns: "open-tooling-workspace"|"build-unit"|"ready"
---
Return open-tooling-workspace if the current workspace differs from the mobile tooling workspace or the latter is missing. Return build-unit if the installed unit is not ready. Otherwise return ready.
