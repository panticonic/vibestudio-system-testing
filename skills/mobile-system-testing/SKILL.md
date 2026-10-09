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
