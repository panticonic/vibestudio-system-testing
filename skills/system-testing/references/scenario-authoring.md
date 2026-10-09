# Scenario authoring

## Test a user goal

Write prompts the way a user would: state the desired outcome and the
constraints the user would know about. Do not prescribe evidence fields, a
method sequence, a response schema, an error branch, or a workaround. The agent
must find the relevant skill itself, which shows whether the documented system
is usable.

Prompts written at the user's level expose documentation and ergonomics
defects. Prompts that contain the answer hide them.

Review every delivered turn, including orchestration follow-ups and child-task
messages. A generic catalog prompt does not excuse a later message that contains
API snippets, internal method names, exact deadline values, or evaluator
receipts. Keep real user constraints, such as the input project, the desired
data, an independent collaborator, and whether to integrate or publish work.
Technical instructions belong in the product skill for that feature; fixture
construction and fault injection belong in the harness. Never copy a validator's
magic receipt into a product skill just to make a generic request pass.

## Judge the agent; diagnose the trajectory

A normal agentic case requires a completed turn and the outcome its validator
observes. Every validator you supply gates success; none are diagnostic-only.
Do not duplicate implementation details in a validator, and do not require
status-marker syntax, ceremonial fields, specific object layouts, or one
preferred sequence of steps.

Where the goal provides them, check objective facts that don't depend on the
agent's prose: saved workspace state, a successful build, the model identity
that ran a child task, or the absence of leaked resources. Accept any product
path that produces the outcome. Product guidance teaches the behavior;
independent evidence proves it happened.

For browser workflows, native eval `operationJournal` entries are compact
evidence that does not depend on what the agent returns. Interaction receipts
record the action, target identity, and effect. DOM ancestors, attributes, and
geometry belong in rich inspection, not the journal. A dispatch
(`not-asserted`) is not an observed application outcome; a click's `expect`
records the semantic condition, and a later standalone `waitFor()` does not
rewrite that receipt. Never assume full coverage when `truncated: true`, and do
not require agents to echo journal fields under arbitrary summary keys. Inspect
the captured trajectory before blaming the agent for missing evidence or
relaxing the validator.

Session acquisition and automatic rebind write `cdp.session` receipts to the
journal with `status`, `generation`, and, for replacement or reconnection,
`previousGeneration`. Use these lifecycle facts even if a later action in the
eval throws. A replacement receipt proves the new generation was reached; before
passing the workflow, require a separately observed interaction after rebind.

The harness records tool failures separately from task completion and flags
every normal agent trajectory for review. An undeclared failed invocation fails
the test even if the agent later delivers the requested outcome. A completed
`verify` call may report a failed source check: validate that structured report
as evidence, and require a later clean receipt when the task needs one.
Argument corrections, fail-closed domain refusals, and runtime and
infrastructure failures all remain failed calls; recovering from them does not
exempt them from the verdict.

Even when the agent succeeds, review failed calls (including caught eval
failures), retries, unusually long trajectories, cleanup errors, and runtime
diagnostics. Also look for needless searching, repeated rediscovery, and work
abandoned after taking time. These are ergonomics findings: read the full
trajectory and fix the platform, documentation, or tool that made the sensible
path hard.

Keep schema and effect assertions in `@workspace/testkit`. Use
`validation: "harness"` only for an explicit deterministic or wire-protocol
probe, not for a task that needs model judgment.

## Grade the capability in two halves

A validator that reads only the final message merges two separate questions:
did the mechanism deliver what the task needs, and did the agent use it? A red
result then answers neither. Such validators also tend to demand specific
phrasing, which grades the sentence instead of the behavior. Real examples: an
agent that reported "it was increased once, then reverted" failed a check that
required `already|previously` within eighty characters of `reverted`. An
inventory that named two of three coordinates plus their count failed a check
that required all three filenames, and one of those filenames existed only
because a _setup_ agent happened to follow a naming instruction.

Write each case in two halves:

- **Surface half, strict.** Assert against the tool result: the walk kind that
  ran, the evidence its rendered block carried, the number of coordinates a
  cohort produced, the hit count a search returned, the absence of a typed
  failure. This half is machine-checkable; if it fails, the mechanism broke.
- **Agent half, deliberately loose.** Check for one discriminating token that
  only an agent that used the evidence could produce. Not a conjunction of
  three, and never a required sentence shape.

Order the checks so the most specific diagnosis is reported first: transport
failure, then missing evidence, then the agent's use of the evidence. A failing
case should say which half broke. "The mechanism is broken" and "the mechanism
worked but the agent ignored it" are different findings with different owners,
and the second is often more valuable.

Avoid two anti-patterns:

- Do not let the answer be reachable without the feature under test. If the
  reason is written into a file comment, an agent can grep its way to a pass,
  and the case grades reading instead of recovery.
- Do not assert a boundary the system does not have. A case built on a premise
  the product deliberately rejects measures nothing, whether it passes or fails.

## Isolate tests

Normal tests use fresh headless contexts. Tests that create or publish
workspace source must select a typed repository fixture:

- `CONTENT_WORKSPACE_REPO_FIXTURE` provides an empty `projects/...` content
  repo.
- `BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE` provides a `packages/...` repo
  seeded with the standard minimal manifest and source entry.
- `BUILDABLE_EXTENSION_WORKSPACE_REPO_FIXTURE` provides an `extensions/...`
  repo with a trusted extension manifest, source, icon, and a focused failing
  test.
- `BUILDABLE_APP_WORKSPACE_REPO_FIXTURE` provides an `apps/...` repo with a
  terminal app manifest, source, icon, and a focused failing test.
- `OPTIMIZABLE_PANEL_WORKSPACE_REPO_FIXTURE` provides a minimal `panels/...`
  repo with a deliberately wasteful but behaviorally trivial bundle.

The harness imports the repository as a single snapshot into a fresh task
context. Setup does not publish it, so a fixture that never reached main
disappears with its context. If task events did reach main, teardown finds the
newest one by intersecting the task's first-parent line with paged current-main
history. In a fresh context, it counteracts only that published work, newest
first, then commits and pushes once. The same causal walk removes any extra
repository identities the task created and reports them as scope failures.
Newer unpublished work is cleaned up when the task context is destroyed.

Refer to the fixture the harness provides. Do not put cleanup commands, fixed
shared names, or seed instructions in prompts. The fixture also supplies the
two protected-effect rules: main publication and repository deletion (an exact
path for a seeded repo, or a section prefix for a repo the task creates or
derives). Teardown must apply those rules through normal VCS. Never add a
cleanup-only transport or ignore an approval failure.

Multi-actor behavior belongs in `TestCase.orchestrate`. The first
(base-author) role runs in the fixture task context and publishes the shared
base through the normal product workflow. Later roles get independent contexts
rooted at the main of that moment. Give each session a normal user goal. The
orchestrator may sequence phases, but agents must not spoof another context or
write private state directly.

## Exercise approvals without bypassing them

`TestCase.authorityPolicy` is a host-attested fixture that runs through the
production authority path. List each gated or critical capability and each
userland subject the scenario expects:

- Capability names use an explicit `{ kind: "exact", key }` scope by default.
  Use `{ kind: "prefix", prefix }` only when the capability suffix is generated
  by production code at runtime, and pair it with a resource scope that
  separately confines it to the fixture source/class or another stable
  production boundary.
- Resource and userland rules use `ResourceScope`. Prefer
  `{ kind: "exact", key }`. Use `{ kind: "prefix", prefix }` only when the
  production subject is intentionally dynamic, such as the digest-bearing
  `user.exec.*` namespace, or a Durable Object key the agent chooses beneath one
  randomized fixture source and class.

Keep the prefix at the narrowest stable boundary. Dynamic identity below that
boundary is production behavior; it is not a reason to dictate a key in the
prompt.

The receiver still builds the real approval request and resolves it through the
normal approval service. The policy supplies the unattended user's answer; it is
not an alternate API or a blanket auto-approve switch. An unmatched request must
still fail with `EUNEXPECTEDTESTPROMPT`. Never compute a test-only subject,
patch the extension to skip approval, or weaken the production gate for the
harness's convenience.

The runner owns the execution policy, not individual scenarios. The chosen
model, `approvalLevel: 2`, and disabled fallback are mandatory for every case.
They travel with the host-attested context through trusted infrastructure and
apply to every downstream agent created there. `TestCase.authorityPolicy` only
describes the expected capability decisions and cannot override the execution
model.

The standard workspace test runner exposes the provider capability
`native.tests.execute`. A scenario that intentionally runs focused workspace
verification must declare the exact provider capability prefix (including the
provider path and definition-digest separator) and the test-runner receiver
resource. Do not broaden either namespace or replace it with blanket
auto-approval.

For corrective workflows, inspect the whole trajectory instead of reducing it
to a custom response schema. An earlier `needs-decision`, failed build report,
or guarded close is still useful ergonomics evidence when a later integration,
verification, or close succeeds.

## Semantic VCS scenarios

VCS scenarios are user tasks that exercise protocol behavior; they do not ask
the agent to recite APIs. Before writing one, read
`../../vibestudio-vcs/SKILL.md` and the relevant references.

Cover these separate invariants:

- every mutation names the working state it observed;
- commit consumes the complete local application chain;
- incoming changes are incorporated through small local decisions until the
  source event is accounted for, then committed with that source as parent;
- push publishes one clean event against one observed main event;
- a protected push rechecks the affected build/typecheck closure. A deliberate
  `BuildGateFailed` case must inspect every returned diagnostic, prove that no
  ref advanced, fix the cited source, recommit, and retry;
- move keeps file identity, while copy creates a new identity and records
  ancestry;
- revert creates counteracting changes instead of erasing history;
- provenance links content, changes, work, commands, events, and the
  trajectory invocation that caused a command;
- blame follows immediate coordinate mappings, not a flattened author field;
- `RevisionChanged` triggers re-observation and a new command ID, while an
  identical request with an uncertain outcome is retried with the same command
  ID.

Keep status, whole-chain commit, push, incremental integration, move/copy,
causality/blame, revert, freshness, and idempotency separately diagnosable. Do
not build a separate release-scenario registry alongside the live `TestCase`
catalog.

## Expected failures

Negative tests should name the expected typed refusal and verify that no state
changed. Mark deliberately induced failures as expected in diagnostics, so they
remain evidence without counting as product defects.

Each `expectedToolFailures` entry declares one deliberately induced invocation
by tool name and its typed `failureCode`. For an untyped external failure, use a
specific, nonempty `errorIncludes` discriminator. A match consumes the entry
once, so repeated or additional failures remain unexpected. The validator must
independently prove the intended fault, that it was observable, and the
required recovery or unchanged state. Never declare incidental errors as
expected just to restore a pass, and never exempt every failure of a tool by
name. A failed source-check report from a completed verification call is report
evidence, not an `expectedToolFailures` entry.

Never branch a validator on human-readable error text when a discriminant or
terminal outcome is available.

New tool-failure scenarios must also check the persisted `agent-tool-failure.v1`
object on the terminal invocation: stable code and kind, operation and stage,
causal IDs when available, retry policy, and primary-versus-cleanup ordering.
When the scenario creates a scaffold or fork, require `preflight.ok === true`
before accepting publication evidence. A recovery scenario must follow normal
typed VCS recovery from the recorded failure. Preparation never publishes: link
its application to the committed chain, and the committed event to the
protected push. Prove that recovery did not recreate the repositories; a source
fix deliberately requires a new edit and commit.
