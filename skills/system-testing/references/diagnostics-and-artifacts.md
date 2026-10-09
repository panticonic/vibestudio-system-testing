# Diagnostics and artifacts

## Start from the run, not the symptom

The run record is the primary diagnostic source. A validator reason is one
observation, not the root cause. Correlate it with:

- the original prompt and the agent's final message;
- each invocation's arguments, status, result, error, and terminal outcome;
- lifecycle and debug events around turn dispatch, suspension, recovery, and
  close;
- participant and channel identity, and test-context provenance;
- cleanup errors and fixture setup/teardown evidence;
- automatic runtime health, build provenance, GAD inspection, and server logs.

Start with the bounded packet from `inspect`. Use `trajectory --full --json`
only for the specific test whose bounded packet is not enough.

While a test is running, `inspect` returns the latest periodic checkpoint; it
does not re-execute anything. Phase updates keep the latest checkpoint until the
next refresh, and cleanup can still be running after the agent's turn ends.
Compare the progress phase with the checkpoint timestamps before calling
something a stall. Full trajectories are available only after the test and its
cleanup finish. Native eval operation journals keep completed work even if a
later error occurs; require evidence of the actual outcome, and honor their
`truncated` flag.

## Mismatch template

For each failure, state:

1. the user-visible goal and the expected invariant;
2. the action the agent attempted;
3. the observed result or effect and its typed status;
4. the first point where actual behavior diverged;
5. why the evidence classifies the defect as infrastructure, documentation,
   harness, or validator;
6. the fix, and the smallest evidence-directed verification that proves it.

Do not infer a cause from the final answer when the trajectory shows a tool
failure, stale documentation, a cleanup fault, or a successful recovery that the
marker hides.

## Interpreting invocations

An incomplete invocation is a transport or lifecycle defect unless the evidence
shows explicit cancellation. A failed invocation may be expected negative-test
evidence, an agent mistake, stale docs, or platform behavior. Check its
arguments and terminal outcome before classifying it.

For a single failed call, start with
`gad.diagnoseInvocation({ trajectoryId, branchId, invocationId })`. Its bounded
packet links the invocation and its turn to terminal events, semantic command
journal rows, effect intents, and receipts. Inspect
`invocation.failed.payload.failure`: `causes[0]` must stay the primary cause,
and cleanup or rollback faults must stay secondary. Honor `summary.truncated`;
request a larger bounded section or the full trajectory only when necessary.

An undeclared failed invocation fails the test even if the final outcome is
successful. A completed `verify` call whose structured report says `failed` or
`compilation-failed` is a successful check that reports a source problem: keep
that report and receipt, and separately require a clean receipt wherever the
task needs one. Answer both questions: did the requested outcome eventually
work, and what went wrong along the way? Recovery must not remove real tool
faults from reports or from rerun selection.

Classification separates infrastructure failures, guest-code exceptions,
argument corrections, and typed no-effect guards. It assigns a diagnostic owner;
it does not change the verdict. For example, an ambiguous subagent reference or
a stale VCS request can show that a fail-closed mechanism works while still
exposing an agent or documentation problem. Keep the invocation and its typed
reason. A fault counts as expected only if the scenario explicitly induced and
independently validated it, and that declaration covers one matching
invocation, not every failure of the tool. An `invalid-input` envelope with a
`correct-input` retry policy and the matching tool operation marks an argument
correction for any tool, including edit/write. That attribution does not exempt
the failed invocation from the verdict.

For VCS mutations, inspect the working state, `commandId`, target context,
work-unit/application/change identities, resulting event, and publication
receipt. For causal questions, follow command adjacency back to the trajectory
invocation and use content-coordinate blame edges. A rendered file result or a
final marker does not prove semantic correctness.

## Runtime diagnostics

When the bounded test record points to a runtime problem, inspect the narrowest
source that answers it:

- explicit build/typecheck diagnostics for compile or type failures in a
  context;
- the publication result for the affected-unit build/typecheck gate, and for
  ancestry, integration, authorization, approval, or atomic-ref failures;
- post-publication build events for derived projection failures;
- `build.listUnits()` for declared source/build readiness, then
  `runtime.supervision.health(identity)` and `logs(identity)` using the live
  entity identity returned by `runtime.supervision.list()`;
- the agent debug port and the actual native input settlement when an admitted
  input gets no answer or tool progress (a generation task's terminal handover
  does not mean the input completed);
- joined suspension diagnostics for tool projection/effect mismatches;
- GAD health/integrity inspection for publication, branch, invocation, and
  semantic graph failures;
- `contextIntegrity.explain({ key, cursor, limit })` for verified, paged leaf
  membership when a lineage-set coordinate is involved in an authority refusal;
- server logs for host dispatch, workerd supervision, reconnect, or startup
  behavior.

A successful publication certifies only the affected candidate build/typecheck
closure that the protected gate evaluated. Match the gate's structured
diagnostics, and every later explicit or post-publication build, to its
semantic event or application state. When activation fails, verify that the
failed artifact stayed inactive and the previous runnable artifact stayed
selected.

System-test orchestration uses a start/status/result protocol, not one RPC that
spans the whole suite. If the outer run reports a closed runner socket while
test agents keep working, classify it as control-plane infrastructure breakage:
inspect the inner eval status and the persisted heartbeat, recover the terminal
record, and fix the runner lifecycle. Do not raise an HTTP/RPC deadline or
accept orphaned test activity as a completed run.

For channel and subagent latency, separate the underlying fact from its derived
delivery and presentation state. Inspect three coordinates separately: the
task-channel terminal append, the parent mailbox commit/claim/admission, and the
parent run projection. Child tool activity must stay on the task channel. If
normal activity creates supervisor mailbox rows or parent `task.progress`
messages, that is an infrastructure defect. The `message.received` and
`message.read` entries shown by replay are receipt snapshots, not channel log
events, and must not create mailbox work.

Channel state diagnostics report persisted relationship counts separately from
activation-local external transports, along with derivation cursor lag and
mailbox state. An idle agent relationship must have no streamed response. A
connected external panel may hold a bounded live stream; a terminal subagent
card must release its observation unless the transcript is open.

When diagnosing recipient latency, check the mailbox's versioned at-sequence
decision context as one unit: relationships and application config, channel
conversation config and decision state, and reply-to sender identity. The
recipient claim must not call back into the channel for policy state, config,
participants, or message sender lookup. A read receipt is a monotone projection
update. Its optional external-session signal is presentation only and must not
append to GAD or create a mailbox row for a durable entity.

## Performance investigations

Use the performance skill's deterministic profilers to measure the operation,
and the system-test record to attribute agentic phases. A system-test duration
measures the harness end to end; on its own it is not a model-latency metric.

- For build behavior, return the bounded `profileBuild` record: source and ref,
  evidence-labeled first run, verified-cache timing and key equality,
  artifact/module bytes, and bundle attribution. Never inline bundle or sealed
  module contents into the trajectory.
- For visible chat latency, pair a real-panel interaction profile with the
  matching system-test trajectory. The panel profile covers browser, network,
  and rendering; the trajectory covers model turns, tools, suspensions,
  persisted delivery, and cleanup.
- For host and resource activity, wrap the operation with `profileHost`. An
  empty event-loop sample set means no monitor interval closed; it does not
  prove zero event-loop delay.
- For recipient and subagent latency, keep the task-channel append, mailbox
  commit/claim/admission, and parent projection as distinct persisted phases.
  Compare durations or shared persisted coordinates; do not subtract timestamps
  taken from unrelated monotonic clocks.

Performance system tests should check that the agent used the documented
bounded tools and returned structured measurements. They should not demand a
specific number from variable CI hardware, accept confident prose without the
record, or grant shell, process, or filesystem escape hatches.

## Cleanup failures fail the run

Session close failures, fixture leaks, stale participants, and repository
identities published outside the test's own fixture fail the run. They are
infrastructure defects even when the capability marker is present.

`workspaceRepoFixture.creationScopeError` evaluates the repository delivery
contract separately from teardown. It fails an otherwise successful completed
case. An interrupted or already-failed case can leave delivery unfinished and
still clean up successfully. Read this assessment alongside the original
verdict; it is not a resource leak, and it must not hide real cleanup errors.

Capture session state before close, then inspect the normalized
execution-level cleanup errors. The snapshot keeps the raw session cleanup
events as evidence; diagnostic summaries do not count them twice.
`snapshot.cleanup` is the live or terminal teardown state and names the last
acknowledged phase: `unsubscribing-agent`, `capturing-model-evidence`,
`disconnecting-client`, `destroying-agent-context`, `retiring-agent`, or
`complete`. Its `phaseStartedAt` tells a slow active phase apart from an old
transcript; `completedAt` exists only once cleanup is terminal. If a later test
runs into leaked state, that is secondary evidence; fix the original lifecycle
leak.

Repository fixture cleanup reports its live phases under
`workspace-fixture-cleanup:*`: `task-status`, `task-first-parent-events`,
`task-creation-scope`, `published-boundary`, `cleanup-context-create`,
`cleanup-context-status`, `published-work`, `published-changes`,
`counteract-published-work`, `counteract-revert`, `counteract-commit`,
`counteract-push`, `destroy-cleanup-context`, and `destroy-task-context`. If a
run stops progressing, inspect the operation for the current phase. Do not
assume the model is still running, and do not add a teardown timeout to hide the
blocked operation.

For `counteract-push`, the cleanup context carries a host-attested case policy.
Its critical deletion rules are exact paths derived from the task's
repository-creation changes; it does not bypass protections the way a
disposable workspace would. A missing, broader, or unrelated policy is an
authority defect and must fail closed instead of turning into an interactive
cleanup prompt.

## Artifact handling

Artifacts are written by default to:

```text
${XDG_CONFIG_HOME:-~/.config}/vibestudio/system-test-runs/<run-id>/
```

Their permissions are restricted on purpose. Full trajectories can contain
credentials, user data, source, or tool payloads. Keep the permissions intact.
Share bounded, redacted evidence by default, never the raw trajectory.
