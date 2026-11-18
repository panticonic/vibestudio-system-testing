---
description: Give the recovery step for the observed Android blocker without repeating setup.
args:
  blocker: MobileBlocker
  deviceId: string | null
  observed?: string
returns: MobileReport
---
Return a blocked report with the same blocker and device id. In next, give the single recovery action supported by the blocker. Workspace and tooling blockers need the matching workspace or installed mobile unit. Foreground and target blockers ask for foreground ownership or one ready Android device. Opening needs another readiness read of the same pairing, failed needs the paired workspace issue reviewed, and app-unverified needs the original app verification issue investigated. Invalid evidence needs a fresh receipt from the assigned operation. Use observed when it adds specific evidence. Do not request a repeat install for an opening workspace or readback failure.
