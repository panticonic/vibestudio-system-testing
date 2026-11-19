---
name: mobile-system-testing
description: Android provisioning and mobile-extension system-test scenarios for workspaces containing mobile tooling.
---

# Mobile system testing

When this package is part of the workspace source, it adds Android
provisioning and mobile-extension scenarios. Templates that include mobile
tooling open as separate workspaces; they are not installed into the current
workspace, so run these scenarios in the workspace that contains the tooling.
Core system testing does not assume a mobile client, debugging extension, or
attached device.

The shared Natlang program mounts `domains.mobileSystem.runMobileScenario`.
Use it with the assigned workspace, operation, optional exact device, and
inspection or execution authority. The installed binding delegates to phone
provisioning and mobile-debug with the same device throughout. Pairing waits for the paired device ID to reach a terminal workspace state.
The managed pairing cases use a connected desktop and one disposable emulator
with a compatible app. Device inventory is read from that desktop. Development install checks
the installed package, running bundle, and rendering on the selected Android
device. When reviewing an opening observation, keep tracking the existing pairing.
