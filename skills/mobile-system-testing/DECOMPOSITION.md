# Android system-test workflow

The original onboarding and mobile-debug scenarios exercise different effects.
Onboarding joins a desktop provider and an attached device to a pairing receipt
and then checks the paired phone's actual workspace. Development install uses a
single assigned Android target, optionally resets the app only when authorized,
and independently verifies installation, the running bundle and rendering.

| Part | Implementation |
| --- | --- |
| Route the assigned test and preserve the result | `runMobileScenario` |
| Review the exact workspace, foreground ownership, installed tool and target | `reviewSetup`, `selectTarget` |
| Dispatch the assigned pairing and independently read the paired workspace | `exercisePairing`, `pairDevice`, `readWorkspace` |
| Dispatch the assigned install and independently read the Android app | `exerciseDevelopment`, `installApp`, `readInstalledApp` |
| Issue diagnosis from the failed step and its observed state | `explainBlocker` |
| Bind discovery, operation cardinality, device identity and verification lineage | TypeScript adapter around the existing phone setup and mobile-debug contracts |
| Test the physical or emulator paths | Requires a caller-owned tooling workspace and an explicitly assigned foreground device |

Read-only assignments stop after target selection. A headless worker may
read a supplied receipt. This workflow leaves an attached operation pending
when foreground ownership is missing.
