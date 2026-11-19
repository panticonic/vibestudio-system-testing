# Review deterministic session tests

The program reads scoped observations of existing test activity. Keep setup,
test execution, and teardown in their respective Vibestudio owners. This
module neither creates a session nor starts a suite and owns no cleanup effects.

| Natlang behavior                  | Source and exact boundary                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review headless creation and seed | HeadlessSession requires the runtime participant identity for connectionless callers. Agent behavior is persisted at creation; presentation belongs to the channel subscription. Channel and agent context must match the fixture.                 |
| Review continuation               | The existing durable channel replays its transcript. A send can carry an idempotency key and returns a message ID. Assess a claimed retry using its exact channel, key and durable message identity.                                               |
| Review verify dispatch            | Base test runner accepts a declared native suite selected through `verify`; browser and workerd suites stay with their own adapters even when verification fails.                                                                                  |
| Read a focused receipt            | Verify operation, target, suite, runtime and context state before interpreting an outcome.                                                                                                                                                         |
| Review session teardown           | The remote terminal comes from HeadlessSession close. Inherited context retains its context and retires its agent after subscription close; isolated context has a single context-tree owner. The client can detach while remote cleanup proceeds. |
| Review testkit release            | Testkit runs deferred cleanup in reverse order even on failure. Inspect each owned panel, page client, worker, supervisor, and scratch path by matching its runtime identity.                                                                      |

The fixture bank owns hard expectations and exact scoring in TypeScript.

## Live continuation

The caller creates disposable channels and reconnects through the product's
HeadlessSession client. It reads the durable message window independently of
the reconnecting projection. `reviewLiveReplay` asks the bound reader for
each assigned checkpoint and dispatches it through channel routing, replay
integrity, and retry identity checks. The retry stage distinguishes the
first accepted payload from later text sent with the same idempotency key.
Only the caller owns channel creation, sending and cleanup.
