---
description: Install and launch the approved development build, then check the launched app.
args:
  deviceId: string
returns: MobileReport
---
1. Call installApp(deviceId). If the receipt is absent, return invalid-receipt with the selected id.
2. Call readInstalledApp with the receipt's exact device and package. Return development-ready with both receipts only when the matching readback reports installed, active bundle, rendering, a nonempty screenshot and no issues. A null readback is invalid-receipt. An incomplete readback is app-unverified. Retain an observed issue in next when present. End this attempt without asking the installer again.
