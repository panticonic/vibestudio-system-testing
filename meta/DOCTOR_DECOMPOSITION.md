# Native doctor data flow

Mechanism inventory: `skills/system-testing/cli.ts` owns the public CLI wrapper and execution catalog mapping; `stages.ts` owns the authoritative registry; `workers/system-test-runner/index.ts` owns the native RPC and finite child Eval; `package.json` exports imported subpaths; `doctor.ts` owns native health observations and the model-availability remedy. Tests cover public CLI compatibility, lean helper graph and native owner-to-child catalog forwarding.

The old child imported `/cli`, bundling test execution and fixture controllers simply to inspect readiness. Original retained Eval evidence records its `build.getBuild` wait; the full library artifact was published after cancellation. This does not prove a native channel or model execution failure. Isolated immutable-state replay built that 9.5 MB library in 6.8 seconds after caches warmed.

The worker now obtains names from its actual `allTests()` registry and passes them as typed data to `/doctor`. The public CLI obtains them from `listSystemTests()`. No generated catalog, guessed count, dropped readiness check, task outcome or teacher operation is introduced. Worker implementation code belongs to its existing prebuilt executable; the child health helper imports no fixture registry.
