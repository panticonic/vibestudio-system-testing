---
name: mobile-system-testing
description: Android provisioning and mobile-extension system-test scenarios for workspaces containing mobile tooling.
---

# Mobile system testing

This package contributes Android provisioning and mobile extension scenarios
when it is included in the workspace source. Templates that include mobile
tooling open as separate workspaces; they are not installed into the current
workspace. Run scenarios in the workspace that owns the required tooling.
Core system testing does not assume a mobile client, debugging extension, or
attached device exists.
