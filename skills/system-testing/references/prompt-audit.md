# Agentic prompt audit — 2026-09-29

## Coverage and review boundary

A Luna source sweep covered 209 static prompt properties in 48 scenario modules,
51 non-test scenario modules, 38 scenario assertion files, 40 follow-up send
sites, generated scaffold variants, dynamic provenance phases, and shared
instruction injection. These are source counts, not the number of executed
agentic tests. Unsent orchestration labels are metadata; the delivered phase
messages are the actual task instructions.

The parent reviewed prompt changes against their validators. Genuine inputs,
authority restrictions, fixture paths, independent collaborators, and publication
constraints stay in tasks. Tool names, API recipes, runtime knobs, and redundant
verification choreography were removed where the observed outcome remained the
same. Shared policy no longer requires stopping at the first recoverable failure
or special fallback authorization in an individual task prompt. Execution and
authority mechanics belong in product skills.

## Recovery must not hide defects

Every unexpected retained failed invocation fails the canonical test verdict,
even if the final task outcome passes. Diagnostic classification of argument,
domain, and guest-code failures does not excuse them. The original task outcome
and fault evidence remain distinct. A declared intentional fault names its tool
and canonical code (or a precise discriminator for an untyped error), and covers
one deduplicated invocation. Extra or repeated failures fail the test.

Do not add expected faults to regain a pass after encountering an incidental
error. Explicit negative cases must independently prove both the induced fault
and the requested recovery or refusal. Product recovery instructions remain useful
for completing the task and gathering evidence; they never suppress the verdict.

This gate consumes recorded terminal invocations in the test execution. It cannot
infer an unrecorded exception caught inside a successful eval, or an uncollected
child execution, from a final success report. Closing those observation gaps
requires canonical effect/fault telemetry and retained child evidence, not a
prose-error regex or another prompt instruction. Keep these as infrastructure
findings rather than assuming absence of observed faults proves absence of bugs.

## Product guidance updated

- Base `skills/sandbox/EVAL.md`: ordinary approval routing and the meaning of
  authority attenuation and pregranted-only execution.
- Base `skills/workspace-dev/WORKFLOW.md`: derive acceptance criteria, exercise
  the requested behavior, wait for loaded state across persistence boundaries,
  verify the delivered result, and retain repaired failures.
- Base `skills/workspace-dev/PANEL_DEBUG_LOOP.md`: reuse the actual project and
  inspect its rendered state after changes, without manufacturing defects or
  repeating a scenario-specific screenshot recipe.

## Remaining validator and protocol couplings

These are findings to redesign, not instructions to copy into product skills.
Where removing a requirement would make the task unknowable or weaken coverage,
the constraint or protocol probe remains explicit until independent evidence is
available. Replay and live-kernel probe messages retain their original protocol
instructions; the permission-reuse child still has its explicit receipt pending
replacement. Ordinary human tasks must not be made to memorize these receipts.

### `mobile-onboarding-and-installation`

Source: `skills/system-testing/tests/mobile.ts`.

The human prompts now ask to onboard/pair/install and verify a running app. Validators still call requireCodeOperations and require package-specific mobile operation names.

The evaluator constrains API selection rather than observable onboarding/install outcome; generic prompts can fail despite a supported equivalent flow.

Owning product guidance: `Base/skills/phone-setup/SKILL.md`, `System/skills/mobile-system-testing/SKILL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `eval-timeout-error-visible`

Source: `skills/system-testing/tests/harness-resilience.ts`.

Prompt now asks what happens when a sandbox task takes too long and confirms later usability. Validator still requires a timed-out eval; previous prompt hard-coded a never-resolving Promise and timeoutMs:250.

Validator defines the deliberate fault mechanism, not the user outcome. Keep fault injection in harness and assert recovery/visible timeout without instructing a magic snippet.

Owning product guidance: `Base/skills/sandbox/EVAL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `eval-agent-replay`

Source: `skills/system-testing/tests/eval-lifecycle.ts`.

The probe retains the marker EVAL_AGENT_REPLAY_OK and completionCount because the scenario explicitly tests exactly-once replay and validator checks both fields. This is a test-specific evaluator receipt; a principled harness redesign is needed before removing it.

Evaluator receipt leaks into task. Assert one completion via structured run evidence rather than task-authored marker.

Owning product guidance: `Base/skills/agents/SKILL.md`, `Base/skills/sandbox/EVAL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `eval-live-kernel-continuity`

Source: `skills/system-testing/tests/eval-lifecycle.ts`.

Both phases name scope.__kernelContinuityProbe, its LIVE_KERNEL_OK ping and the no-recreate follow-up, matching the validator’s scope property and continuity assertion.

Keep continuity scenario, remove evaluator marker.

Owning product guidance: `Base/skills/sandbox/EVAL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `eval-db-persistence`

Source: `skills/system-testing/tests/eval-lifecycle.ts`.

Task supplies system_test_eval_db, probe and DB_PERSISTENCE_OK; validator is coupled to those identifiers.

Real data can remain an evaluator fixture, but shouldn’t be exposed as a recipe.

Owning product guidance: `Base/skills/sandbox/EVAL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `extensionless-screenshot-resource-read`

Source: `skills/system-testing/tests/developer-ergonomics.ts`.

The user request now explicitly requires saving under a filename with no extension and reading it back as an image, preserving the scenario’s extensionless-resource goal.

Resource classification should follow image content/MIME; extensionless path is implementation detail.

Owning product guidance: `Base/skills/sandbox/BROWSER_AUTOMATION.md`, `Base/skills/workspace-dev/PANEL_DEBUG_LOOP.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `failed-build-bounded-diagnostics`

Source: `skills/system-testing/tests/developer-ergonomics.ts`.

The request now specifies more than 50 separate type errors, matching the validator’s actual stress threshold, while retaining fix/build/unpublished constraints.

Stress intent is retained; numeric flood threshold remains a private evaluator bound. Decide if that bound is a meaningful product requirement or use a bounded fixture.

Owning product guidance: `Base/skills/workspace-dev/SKILL.md`, `Base/skills/workspace-dev/WORKFLOW.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `panel-todo-debug-polish`

Source: `skills/system-testing/tests/project-lifecycle.ts`.

Current prompt retains staged seeded defects, screenshots and refresh/recheck sequence; validator expects that exact debug trajectory.

The lifecycle validators now require a completed agent reply and judge delivery
through joined native source, build, rendered image, interaction, console, and
publication evidence. They do not require words such as `UX`, `usability`, or
`task` in the final report. A real report explaining placeholder contrast and
mobile layout was incorrectly rejected by that vocabulary gate. Unexpected
compiler faults still fail the overall verdict, independently of task delivery.

This is an over-specified task journey. Preserve intended To-Do outcome and live verification, remove staged defects/screenshot choreography; redesign validator around finished behavior.

Owning product guidance: `Base/skills/workspace-dev/SKILL.md`, `Base/skills/workspace-dev/PANEL_DEBUG_LOOP.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `automation-native-launch`

Source: `skills/system-testing/tests/unit-diagnostics.ts`.

Prompt retains schedule/timezone/end cap/offline/concision/start details, but not implementation method or completion protocol. Validator requires eval action, automation-completion.v1, fresh conversation.

Validator encodes launch internals and a completion receipt. The task’s continuing daily automation also has no natural finite completion condition.

Owning product guidance: `Base/skills/automations/SKILL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `subagent-task-permission-reuse`

Source: `skills/system-testing/tests/approvals-permissions.ts`.

Task asks a collaborator to check recent server logs; validator still accepts only child response matching ^yes[.!]?$ and one completed child text block.

Do not add literal yes receipt to prompt. Validate child’s actual access/result and permission reuse.

Owning product guidance: `Base/skills/agents/SKILL.md`, `Base/skills/capabilities/SKILL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

### `recoverable-infrastructure-failure-continues-turn`

Source: `skills/system-testing/tests/developer-ergonomics.ts`.

Scenario injects typed recoverable_infrastructure_probe, and validator requires RECOVERED_IN_SAME_TURN. Prompt currently tells agent not to retry / to report an exact receipt.

The recoverable fault is harness-owned; generic request should permit safe recovery. Do not require task wording to authorize the retry or emit evaluator token.

Owning product guidance: `Base/skills/sandbox/EVAL.md`, `Base/skills/capabilities/SKILL.md`. These paths identify the reusable guidance owner, not a place to store evaluator tokens.

## Authority probe review

`eval-exact-authority`, `eval-pregranted-only`, and `eval-preauthorization` retain
user-visible confinement, no-existing-grants, and approval-scope constraints.
Their validators additionally require particular authority argument shapes.
Keep exact wire assertions in deterministic harness coverage; test ordinary
agent decisions through actual granted scope and observed effects. Base
`skills/capabilities/SKILL.md` and `skills/sandbox/EVAL.md` own authority mechanics.

## Follow-up work

Move deliberate fault construction into harness-owned fixtures before removing
protocol recipes from those tasks. Replace agent-authored magic receipts with
joined execution identities, retained state, real UI behavior, and fault records.
For mobile, observe device pairing, boot readiness, installation and rendering
through supported evidence instead of grading one extension call sequence. For
permission reuse, prove the child's protected read and reused grant independently
of its final wording. Keep diagnostic-output limits under a deterministic stress
fixture. Verify these redesigns with positive and negative evidence before
replacing the existing validators; generic wording alone is not a repair.
