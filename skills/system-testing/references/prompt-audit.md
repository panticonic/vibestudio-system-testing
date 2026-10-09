# Agentic prompt audit — 2026-09-29

## Coverage and review scope

A Luna source sweep covered 209 static prompt properties in 48 scenario modules,
51 non-test scenario modules, 38 scenario assertion files, 40 follow-up send
sites, generated scaffold variants, dynamic provenance phases, and shared
instruction injection. These are source counts, not the number of agentic tests
executed. Orchestration labels that are never sent are metadata; the phase
messages actually delivered are the task instructions.

The parent agent reviewed each prompt change against its validator. Tasks keep
genuine inputs, authority restrictions, fixture paths, independent
collaborators, and publication constraints. Tool names, API recipes, runtime
knobs, and redundant verification steps were removed wherever the observed
outcome stayed the same. The shared policy no longer requires stopping at the
first recoverable failure, and individual task prompts no longer need special
fallback authorization. Execution and authority mechanics belong in product
skills.

## Recovery must not hide defects

Every unexpected failed invocation in the retained record fails the test, even
if the final task outcome passes. A completed `verify` invocation may return a
failed source-check report; keep that report as evidence and have the validator
require a later clean receipt. Classifying a failure as an argument, domain, or
guest-code error does not excuse it. The task outcome and the fault evidence
are judged separately. A declared intentional fault names its tool and error
code (or a precise discriminator for an untyped error) and covers one
deduplicated invocation. Extra or repeated failures fail the test.

Do not add expected faults to turn a failure into a pass after hitting an
incidental error. Explicit negative cases must prove both the induced fault and
the requested recovery or refusal. Product recovery instructions still help the
agent finish the task and gather evidence, but they never suppress the verdict.

This gate only sees terminal invocations recorded in the test execution. It
cannot detect an exception caught inside a successful eval, or a child
execution that was never collected, from a final success report. Closing those
gaps requires effect/fault telemetry and retained child evidence, not a regex
over error prose or another prompt instruction. Track them as infrastructure
findings; the absence of observed faults does not prove the absence of bugs.

## Product guidance updated

- Base `skills/sandbox/EVAL.md`: normal approval routing, and what authority
  attenuation and pregranted-only execution mean.
- Base `skills/workspace-dev/WORKFLOW.md`: derive acceptance criteria, exercise
  the requested behavior, wait for loaded state across persistence boundaries,
  verify the delivered result, and keep the record of repaired failures.
- Base `skills/workspace-dev/PANEL_DEBUG_LOOP.md`: reuse the actual project and
  inspect its rendered state after changes, without manufacturing defects or
  repeating a scenario-specific screenshot recipe.

## Remaining validator and protocol couplings

These are findings to redesign, not instructions to copy into product skills.
Where removing a requirement would make the task impossible to infer or weaken
coverage, the constraint or protocol probe stays explicit until independent
evidence exists. Replay and live-kernel probe messages keep their original
protocol instructions, and the permission-reuse child keeps its explicit
receipt until it is replaced. Normal human-style tasks must not require the
agent to memorize these receipts.

Each entry lists the product guidance that should own the reusable behavior.
Those files are not a place to store evaluator tokens.

### `onboarding-desktop-mobile-install-android`

Source: `skills/system-testing/tests/mobile.ts`.

The prompts now ask in plain terms to onboard, pair, install, and verify a
running app. The validators still call `requireCodeOperations` and require
package-specific mobile operation names.

The evaluator constrains which API is used rather than the observable
onboarding/install outcome, so generic prompts can fail even when the agent uses
a supported equivalent flow.

Guidance owner: Base `skills/phone-setup/SKILL.md`, System Testing
`skills/mobile-system-testing/SKILL.md`.

### `eval-timeout-error-visible`

Source: `skills/system-testing/tests/harness-resilience.ts`.

The prompt now asks what happens when a sandbox task takes too long and
confirms the sandbox is usable afterward. The validator still requires a
timed-out eval. The previous prompt hard-coded a never-resolving Promise and
`timeoutMs: 250`.

The validator defines the fault mechanism instead of the user outcome. Keep
fault injection in the harness and assert the visible timeout and recovery
without prescribing a specific snippet.

Guidance owner: Base `skills/sandbox/EVAL.md`.

### `eval-agent-replay`

Source: `skills/system-testing/tests/eval-lifecycle.ts`.

The probe keeps the `EVAL_AGENT_REPLAY_OK` marker and `completionCount`,
because the scenario tests exactly-once replay and the validator checks both
fields. This is a test-specific evaluator receipt; removing it needs a harness
redesign first.

The evaluator receipt leaks into the task. Assert a single completion from
structured run evidence instead of a marker the task writes.

Guidance owner: Base `skills/agents/SKILL.md`, Base `skills/sandbox/EVAL.md`.

### `eval-live-kernel-continuity`

Source: `skills/system-testing/tests/eval-lifecycle.ts`.

Both phases name `scope.__kernelContinuityProbe`, its `LIVE_KERNEL_OK` ping,
and the no-recreate follow-up, matching the scope property and continuity
assertion in the validator.

Keep the continuity scenario; remove the evaluator marker.

Guidance owner: Base `skills/sandbox/EVAL.md`.

### `eval-db-persistence`

Source: `skills/system-testing/tests/eval-lifecycle.ts`.

The task supplies `system_test_eval_db`, `probe`, and `DB_PERSISTENCE_OK`, and
the validator depends on those identifiers.

The data can stay as an evaluator fixture, but the task should not expose it as
a recipe.

Guidance owner: Base `skills/sandbox/EVAL.md`.

### `extensionless-screenshot-resource-read`

Source: `skills/system-testing/tests/developer-ergonomics.ts`.

The request now explicitly asks to save under a filename with no extension and
read it back as an image, which preserves the scenario's goal of testing
extensionless resources.

Resource classification should follow the image content/MIME type; the
extensionless path is an implementation detail.

Guidance owner: Base `skills/workspace-dev/BROWSER.md`, Base
`skills/workspace-dev/PANEL_DEBUG_LOOP.md`.

### `failed-build-bounded-diagnostics`

Source: `skills/system-testing/tests/developer-ergonomics.ts`.

The request now asks for more than 50 separate type errors, matching the
validator's stress threshold, and keeps the fix, build, and unpublished
constraints.

The stress intent is kept, but the numeric threshold is still a private
evaluator bound. Decide whether that bound is a real product requirement, or
use a bounded fixture.

Guidance owner: Base `skills/workspace-dev/SKILL.md`, Base
`skills/workspace-dev/WORKFLOW.md`.

### `panel-todo-debug-polish`

Source: `skills/system-testing/tests/project-lifecycle.ts`.

The current prompt keeps the staged seeded defects, screenshots, and the
refresh/recheck sequence, and the validator expects that debug trajectory step
by step.

The lifecycle validators now require a completed agent reply and judge delivery
from joined native source, build, rendered image, interaction, console, and
publication evidence. They no longer require words such as `UX`, `usability`,
or `task` in the final report; that vocabulary check had wrongly rejected a real
report explaining placeholder contrast and mobile layout. A failed compiler
report counts as source-check evidence, and the validator still requires the
later clean build before accepting delivery.

The task journey is over-specified. Keep the intended To-Do outcome and live
verification, remove the staged defects and screenshot steps, and redesign the
validator around the finished behavior.

Guidance owner: Base `skills/workspace-dev/SKILL.md`, Base
`skills/workspace-dev/PANEL_DEBUG_LOOP.md`.

### `automation-native-launch`

Source: `skills/system-testing/tests/unit-diagnostics.ts`.

The prompt keeps the requested schedule, timezone, end condition, offline
scope, short update, and immediate start. The validator requires one successful
native launch whose retained active definition matches the requested schedule
and end cap, plus a final response that identifies its active, inspectable
pill. It accepts either prompt or eval actions and either supported
conversation mode. It does not require a completion receipt from a future run.

Do not put the native launch implementation or a future run's completion in the
prompt. Keep the schedule and end condition user-visible, and validate the
retained launch against them.

Guidance owner: Base `skills/automations/SKILL.md`.

### `subagent-task-permission-reuse`

Source: `skills/system-testing/tests/approvals-permissions.ts`.

The task asks a collaborator to check recent server logs. The validator still
accepts only a child response matching `^yes[.!]?$` and one completed child
text block.

Do not add a literal "yes" receipt to the prompt. Validate the child's actual
access and result, and the permission reuse.

Guidance owner: Base `skills/agents/SKILL.md`, Base
`skills/capabilities/SKILL.md`.

### `recoverable-infrastructure-failure-continues-turn`

Source: `skills/system-testing/tests/developer-ergonomics.ts`.

The scenario injects a typed `recoverable_infrastructure_probe`, and the
validator requires `RECOVERED_IN_SAME_TURN`. The prompt currently tells the
agent not to retry and to report a specific receipt.

The recoverable fault belongs to the harness, so a generic request should allow
safe recovery. Do not require the task wording to authorize the retry or to emit
an evaluator token.

Guidance owner: Base `skills/sandbox/EVAL.md`, Base
`skills/capabilities/SKILL.md`.

## Authority probe review

`eval-exact-authority`, `eval-pregranted-only`, and `eval-preauthorization`
keep their user-visible constraints: confinement, no existing grants, and
approval scope. Their validators also require particular authority argument
shapes. Keep those wire-format assertions in deterministic harness coverage,
and test the agent's normal decisions through the scope it was actually granted
and the effects observed. Base `skills/capabilities/SKILL.md` and
`skills/sandbox/EVAL.md` document authority mechanics.

## Follow-up work

- Move deliberate fault construction into harness-owned fixtures before
  removing protocol recipes from those tasks.
- Replace magic receipts written by the agent with joined execution
  identities, retained state, real UI behavior, and fault records.
- For mobile, observe device pairing, boot readiness, installation, and
  rendering through supported evidence instead of grading one extension call
  sequence.
- For permission reuse, prove the child's protected read and the reused grant
  independently of its final wording.
- Keep diagnostic-output limits under a deterministic stress fixture.
- Verify each redesign with positive and negative evidence before replacing the
  existing validators. Changing the wording alone is not a fix.
