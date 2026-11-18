---
description: Provision the selected phone once and check readiness using the paired device identity.
args:
  deviceId: string
returns: MobileReport
---
1. Call pairDevice(deviceId). If it returns null, report invalid-receipt. Otherwise use its pairedDevice to call readWorkspace.
2. Preserve the pairing receipt and return paired-ready only if the matching workspace readback reports ready. A null readback is invalid-receipt. Opening gives workspace-opening and failed gives workspace-failed. Preserve the original readback message in next when present. Hand that state to the parent without trying another installation or pairing.
