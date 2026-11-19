# Android system-test workflow

The original onboarding and mobile-debug scenarios exercise different effects.
Onboarding joins a desktop provider and an attached device to a pairing receipt
and then checks the paired phone's actual workspace. Development install uses a single assigned Android target and optionally resets
the app when authorized. It verifies installation, process and device image
evidence against the exact installation receipt. A separate pairing scenario
owns workspace connection and shell readiness.

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


The managed development cases use a single disposable emulator. They preserve
the original extension-install test's native install and launch path. The
independent harness reads the app before and after the attempt. A missing
assigned target and a caller without foreground ownership have separate cases.


The managed pairing cases use the original onboarding provisioning authority
and public phone client against a desktop attached to the disposable account.
The binder retains the native pairing receipt and joins readiness through its
paired identity. The harness reads readiness independently before admission.
