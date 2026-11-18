---
description: Inspect the installed workspace boundary and choose one ready Android target.
args:
  request: MobileAssignment
returns: TargetSelection
---
Call readInventory(). Assess workspace, tooling, foreground and provider in that order. A different workspace requires wrong-workspace. Absent tooling requires missing-tooling. An execute assignment without foreground ownership requires foreground-required. A pairing scenario without an available provider requires no-provider. Call selectTarget on the observed devices and request.deviceId only once the prerequisites hold.
