---
name: system-testing
description: Run, author, diagnose, or repair headless agentic system tests with deterministic validators, retained trajectories, and managed instances.
agentVisible: false
---

# Vibestudio system testing

System tests drive real headless agents and keep their conversations, tool
invocations, runtime events, cleanup, provenance, and diagnostics. When a
command fails, investigate it; do not stop at reporting the failure.

## Read by task

| Task                               | Reference                                                            |
| ---------------------------------- | -------------------------------------------------------------------- |
| Diagnose a run or artifact         | [diagnostics and artifacts](references/diagnostics-and-artifacts.md) |
| Author or revise a scenario        | [scenario authoring](references/scenario-authoring.md)               |
| Review technical task instructions | [prompt audit](references/prompt-audit.md)                           |
| Select coverage                    | [scenario catalog](references/scenario-catalog.md)                   |
| Repair a discovered defect         | [self-improvement](SELF_IMPROVEMENT.md)                              |
| Exercise managed source            | [Vibestudio VCS](../vibestudio-vcs/SKILL.md)                         |

Implementation entry points: `runner.ts`, `test-runner.ts`, `types.ts`,
`stages.ts`, `diagnostics.ts`, and `tests/`. Import suite collections from
`stages.ts`, not from individual test files.

## Explicit live-data tests

Cases marked `explicitOnly` run only when named exactly; category, all, and
staged runs skip them. Before opting into the Firefox/Trello workflow, read
[live Trello migration](references/live-trello-migration.md): it uses real
personal browser data and live credentials.

## CLI repair loop

Use one stable, unique instance ID for the whole investigation.

1. Provision the instance and check infrastructure:

   ```bash
   pnpm system-test --instance <id> doctor
   ```

   Doctor creates an isolated ephemeral instance, waits for it to become ready,
   and pairs it, so a missing or unpaired server is not a blocker. If doctor
   reports failed infrastructure, read the printed supervisor log and fix it
   before interpreting scenario behavior. Never borrow or stop an unrelated
   instance.

2. List tests only when you don't know the exact name:

   ```bash
   pnpm system-test --instance <id> list --json
   ```

3. Run the smallest relevant test:

   ```bash
   pnpm system-test --instance <id> run <test-name>
   ```

   For long runs, pass `--detach` and follow the run with
   `status <run-id> [--wait]` or `wait <run-id>`. Cancellations and timeouts
   are terminal records; inspect their cleanup evidence. Do not add sleeps or
   extend deadlines to hide liveness bugs. Pass an explicit model only when the
   model is what you are testing; the default route and quota fallback are in
   `config.ts`.

4. On a non-zero exit, inspect the retained run. When a failed run completes,
   its inspection packet and the full trajectory of every failed test are
   saved locally, so `inspect` and `trajectory --full` still work after its
   instance has been recycled:

   ```bash
   pnpm system-test --instance <id> inspect <run-id> --json
   ```

   If the bounded packet is not enough:

   ```bash
   pnpm system-test --instance <id> trajectory <run-id> <test-name> --full --json
   ```

5. Classify the root cause as infrastructure, documentation, harness, or
   validator, and fix it in that layer. Do not over-specify the test prompt to
   work around a platform or documentation defect.

6. Run focused conventional checks. Host-code-only changes can be tested on the
   source server you own. Changes under `workspace/` need a freshly provisioned
   workspace copy: stop the managed instance, then rerun doctor.

7. Rerun only the affected tests. When several failures from one run relate to
   the same fix, use that run's `rerun` command. Expand to a category or smoke
   set only when the captured evidence justifies it.

8. Stop the managed instance:

   ```bash
   pnpm system-test --instance <id> stop
   ```

Do not report completion while an instance, panel, page, or inspector you
started is still live. The only valid reasons to stop investigating are missing
credentials, a need for new authority, unavailable external infrastructure, or
a server restart the user has not authorized. An artifact path or validator
message is not a stopping point.

## Probe the system directly before running an agent

`vibestudio vcs <method> --session <name> --input '<json>'` calls any semantic
method on a provisioned instance, including `walk`, `query`, and `search`. It
takes about two seconds and involves no model. Attach a probe session once
(`vibestudio agent attach probe`) and use it to check whether a feature works at
all before writing or rerunning a scenario. Agentic runs test _whether an agent
can find and use_ a capability; they are a slow, nondeterministic way to learn
_whether the capability works_.

## Orchestrator and test subject

Use `HeadlessRunner` or `TestRunner` only to orchestrate tests. If a prompt asks
you to exercise a capability and return evidence, you are the test subject: use
that capability's normal skill and API. Never spawn a system-test agent from
inside a test.

Each test gets an isolated context. Multi-actor behavior needs a declared
orchestration with independent sessions. Cases that change source must declare
the repository fixture type they need. Fixture setup and cleanup use public
semantic VCS and stay out of the user-like prompt. The authoring reference
documents the fixture and authority contracts.

## Agentic and deterministic layers

System testing is the agentic layer: a model chooses skills and tools, and
semantic validators judge the result. `@workspace/testkit` is the deterministic
layer for exact assertions, panel automation, viewport checks, and runtime
supervision.

Use deterministic tests alone when no model judgment is needed. Use both layers
when an agent must discover and carry out a workflow whose effects can be
asserted exactly.

A completed turn says nothing about quality. Even when validators pass, read
trajectories for confusion, unnecessary source searches, repeated failures, and
poor recovery. Treat tool failures the agent recovered from as evidence of
product or documentation defects.

Prompts describe realistic user goals and observable outcomes. They never name
internal tools, API expressions, configuration objects, validator markers, or
required call sequences. Put exact wire checks in deterministic probes.

## Programmatic orchestration

Use `HeadlessRunner` from `runner.ts`, `TestRunner` from `test-runner.ts`, and
suite exports from `stages.ts`. Keep full results in eval scope and return only
bounded summaries. The public types document callbacks, concurrency,
cancellation, and retained results.

Headless runs have no panel-only tools. Identity, model route, approval mode,
fallback, and test authority come from the sealed runner policy; userland test
subjects must not inject or widen it. In unattended tests, waiting for
credential setup is an infrastructure failure; fix it through the standard
connection flow.

Use separate instances for parallel workspace experiments and separate agent
sessions for concurrent eval work. Before blaming a slow model for a closed
orchestration socket, mailbox delay, or still-running eval, check the retained
lifecycle and transport evidence.

## Authoring and validation rules

- Drive control flow from typed lifecycle phases and structured errors, never
  from parsed explanatory prose.
- Record the primary operation's failure separately from cleanup, rollback, and
  transport evidence. Any unexpected failed invocation fails the test, even if
  the agent recovers and delivers the result. Fault probes must declare one
  specific, single-use fault; recovery never clears the original evidence.
- Test panel slot commitment separately from boot readiness and rendered
  correctness. Wait on lifecycle events, not sleeps.
- Let repository fixtures claim the scheduler resources they declare. Never add
  undeclared parallel publication against protected main.
- Keep normal authority and cancellation in force through publication and
  cleanup. A test policy authorizes only the resources its case declares.
- Keep fixture mechanics, cleanup coordinates, and validator knowledge out of
  the subject prompt.
- For semantic VCS cases, validate the public workflow and the recorded
  identities, decisions, moves/copies, counteractions, provenance, and typed
  recovery, not an implementation-specific call sequence.
- Workers and DOs follow the test context by default; panels need an explicit
  context ref when testing unpublished code.

## Artifact security

Run artifacts are written to the profile's
`vibestudio/system-test-runs/<run-id>` with restrictive permissions unless you
supply an output directory. Full trajectories can contain sensitive data. Never
publish them, paste them wholesale, or weaken their permissions. Extract only
the evidence needed to explain the mismatch.

The orchestrator can run from eval, workers, Durable Objects, or panels. Use the
authorized runtime participant identity; never invent a synthetic participant.
For trusted app failures, read the `skills/appdev/SKILL.md` skill in the System
workspace. For host source repair, use [SELF_IMPROVEMENT.md](SELF_IMPROVEMENT.md).
