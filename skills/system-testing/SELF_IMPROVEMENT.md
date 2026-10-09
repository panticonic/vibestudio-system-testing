# Self-Improvement Workflow

Use this workflow to fix Vibestudio bugs that system tests reveal.

For unattended live runs, launch a disposable server with
`vibestudio remote serve --dev`. Each system test carries a host-attested,
per-run test policy for gated invocations. Credential and standing requests
always go to a human. When a scenario tests the approval flow itself, it may
predeclare an exact or deliberately bounded userland subject scope. Any
userland or critical request outside that scope is denied immediately instead
of leaving a real approval card waiting. These decisions are separate from chat
tool approval levels.

## Priority: Fix Infrastructure First

**Do not work around broken infrastructure in skills or prompts.** If an RPC
method returns unintuitive results, has a confusing signature, swallows errors,
or is missing, fix the service, not the caller. Agents should be able to learn
how to use an API from its skill documentation alone, without implementation
tricks.

- **RPC method doesn't work as expected** → fix the service in
  `src/server/services/`, not the eval code calling it
- **API requires unintuitive parameters** → fix the API signature, add sensible
  defaults, improve error messages
- **Error is swallowed or unclear** → surface it with a descriptive message
- **Capability missing** → add it to the service layer; don't hack a workaround
  in eval
- **Skill docs are misleading** → fix the docs AFTER fixing the underlying API

Don't add comments that explain a confusing API, try/catch wrappers that
translate an unhelpful error, or chains of calls that work around a missing
method.

Adjust skills or test prompts only once the infrastructure works. The test
agent should be able to complete any task with minimal hints; if it can't, the
platform has a bug. Keep system-test prompts as vague as possible: state only
the user-visible goal and real constraints. Leave out markers, API mechanics,
object shapes, evidence fields, and workaround steps that the docs are supposed
to teach.

## Phase 1: Run Tests

An external CLI orchestrator runs an exact test or a category with
`vibestudio system-test run`, then uses `inspect`, `trajectory`, and `rerun` as
documented in `skills/vibestudio-agent/SYSTEM_TESTING.md`. The feedback UI and
stage cards below apply only to an interactive workspace chat agent that has
those UI tools.

Start by showing the user a feedback UI to choose which stages to run. By
default a stage is one category, so it can contain more than three tests. Use
one eval call per stage, run as many tests concurrently inside the stage as is
feasible, publish a short user-visible report after each stage, then move on to
the next selected stage.

Keep the run state in `scope.systemTestingRun` and return only the control
data needed to render the feedback form:

```
eval({
  code: `
    import { createSystemTestingRun } from "@workspace-skills/system-testing/stages";
    const { run, controls } = createSystemTestingRun();
    await scopes.push();
    scope.systemTestingRun = run;
    return controls;
  `,
})
```

Before running any tests, show a feedback form built from the returned
`stageOptions` and `defaultStages`, then store the selected stage indexes in
`scope.systemTestingRun.selectedStageIndexes`. Do not hard-code stage names or
counts; take them from the current system-testing skill exports. If the user
cancels, stop and report that no tests were run.

Then run the next selected stage with the eval below. Call it once per stage; it
must not loop over stages with `for`, `while`, or recursion.
`runNextSelectedStage` runs one stage, folds its results into the run state, and
returns compact counts plus a short markdown `report`. After it returns, report
the stage findings in a normal assistant turn. If `remainingStages` is greater
than `0`, issue the same eval again as a new tool call; once every selected
stage has run it returns `done: true`.

Run this short snippet directly in eval. If eval cannot be called, report the
failed eval attempt and its error verbatim.

```
eval({
  code: `
    import { HeadlessRunner } from "@workspace-skills/system-testing/runner";
    import { runNextSelectedStage } from "@workspace-skills/system-testing/stages";
    const stage = await runNextSelectedStage(
      scope.systemTestingRun,
      new HeadlessRunner(ctx.contextId),
    );
    if (stage.report) await chat.publish("message", { content: stage.report });
    return stage;
  `,
})
```

## Phase 2: Analyze Failures

The full test state is in `scope.systemTestingRun.results.results`, and short
per-stage summaries are in `scope.systemTestingRun.stageSummaries`. Eval return values
only report progress; do not use them as the diagnostic record.

### Tool failures

A failed tool invocation that the scenario did not declare fails the test, even
when the agent recovers and the outcome validator passes. A completed `verify`
invocation can return a failed source-check report (`failed` or
`compilation-failed`). That is the result of the requested check, not a failed
invocation: keep its diagnostics and receipt, and have the validator require
the later clean check or other requested outcome. Real request, runtime, and
infrastructure failures still count as failed invocations and keep their
original evidence.

Declare a failure in `expectedToolFailures` only when the scenario induces it on
purpose. Each declaration covers one de-duplicated invocation; any additional or
repeated fault still fails the test. Never add expected faults to excuse an
incidental error found during a run. Do not trim messages or snapshots after
recovery.

### Inspecting a failed test

For each failed test, inspect everything: the conversation, every tool call and
its result, the harness lifecycle, and participant state. Never hand off only
file names or artifact paths. A useful report says what the test agent did,
where it diverged from the expected marker or behavior, which tool calls
completed or errored, and whether the failure looks like a runtime, docs,
harness, or test-validation problem.

Start with the bounded summary from `summarizeFailures(scope.systemTestingRun.results)` before
reading the retained session evidence:

```typescript
import { summarizeFailures } from "@workspace-skills/system-testing/diagnostics";
return summarizeFailures(scope.systemTestingRun.results);
```

Then drill into any failure that the summary does not explain:

```typescript
for (const r of scope.systemTestingRun.results.results.filter(
  (r) => !r.result.passed,
)) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`FAIL: ${r.test.name} (${r.test.category})`);
  console.log(`Prompt: ${r.test.prompt}`);
  console.log(`Validation: ${r.result.reason}`);
  console.log(`Duration: ${r.execution.duration}ms`);
  if (r.execution.error) console.log(`Session error: ${r.execution.error}`);

  // 1. Full conversation — every message exchanged
  console.log(
    `\n--- Conversation (${r.execution.messages.length} messages) ---`,
  );
  const selfId = r.execution.messages[0]?.senderId;
  for (const m of r.execution.messages) {
    const who = m.senderId === selfId ? "USER" : "AGENT";
    const type = m.contentType ?? m.kind ?? "text";
    console.log(
      `  [${who}] (${type}) ${m.content?.slice(0, 500) ?? "(empty)"}`,
    );
    if (m.error) console.log(`    ERROR: ${m.error}`);
  }

  // 2. Invocation cards — every tool call, args, return value, errors
  const snap = r.execution.snapshot;
  if (snap?.invocations.length) {
    console.log(`\n--- Invocations (${snap.invocations.length} calls) ---`);
    for (const inv of snap.invocations) {
      console.log(`  [${inv.status}] ${inv.name}`);
      if (inv.error) console.log(`    Error: ${inv.error}`);
    }
  }

  // 3. Debug events — harness lifecycle (spawn, start, stop, crash)
  if (snap?.debugEvents.length) {
    console.log(`\n--- Debug Events (${snap.debugEvents.length}) ---`);
    for (const ev of snap.debugEvents) {
      console.log(`  ${JSON.stringify(ev).slice(0, 300)}`);
    }
  }

  // 4. Participants — who joined, who disconnected
  if (snap?.participants) {
    console.log(`\n--- Participants ---`);
    for (const [id, p] of Object.entries(snap.participants)) {
      console.log(
        `  ${p.name} (${p.type}/${p.handle}): ${p.connected ? "connected" : "DISCONNECTED"}`,
      );
    }
  }
}
```

For a specific terminal tool call, run
`gad.diagnoseInvocation({ trajectoryId, branchId, invocationId })` before
walking the full trajectory. Check that the stored `agent-tool-failure.v1`
envelope reports the operation failure as primary and any cleanup or rollback
as secondary, and that it records the safe retry policy. If authority depends on
a lineage-set, page through its verified members with
`contextIntegrity.explain`. Never decode the digest or infer members from a
count.

### Stalled native turns

If an admitted native input produces no answer or tool progress, compare its
submission settlement and stored GAD health with the activation-local agent
view. Native production does not emit `turn.closed`; a finished generation task
can hand work to a successor while its original input stays live:

```typescript
const health = await gad.inspectAgentHealth({ channelId: chat.channelId });
const debug = await gad.inspectAgent({
  channelId: chat.channelId,
  method: "getDebugState",
});
console.log(JSON.stringify(debug.result, null, 2).slice(0, 4000));
```

The local snapshot observes an already admitted native Session; inspecting it
does not start execution. In `debug.result.conversations[channelId]`,
`loaded: false` only means the conversation is not loaded in this activation;
use `health` for terminal state and provenance. Pass another `channelId` (and
`participantId` when it has several agents) for a cross-channel probe.

### Publication and build failures

VCS publication consists of semantic ancestry and integration validation, the
build/typecheck gate for the candidate, approval, and an atomic protected-ref
update. For fast feedback, run an explicit build against the test context
before publishing. If the push returns `BuildGateFailed`, read its full
structured diagnostic list, repair the cited source, recommit, and retry from a
fresh status. If a failure appears in the build that runs after publication,
inspect the build event buffer before repairing source:

```typescript
// Eval uses the same portable `rpc.call(target, method, args)` shape as panels/workers.
// Raw server services target "main".
return {
  recent: await rpc.call("main", "build.listRecentBuildEvents", []),
  forUnit: await rpc.call("main", "build.listRecentBuildEvents", [
    "panels/example",
  ]),
  unit: await rpc.call("main", "build.inspectBuildProvenance", [
    "panels/example",
  ]),
};
```

`build.listRecentBuildEvents` accepts a unit name or workspace-relative path as
a filter. Events triggered by state changes identify the build revision and the
changed workspace view. Correlate the explicit check or derived artifact with
the semantic event and the test trajectory. A build never authorizes
publication. For activation failures, verify that the new artifact was rejected
and the previous runnable artifact stayed selected.

For fixture-backed tests, the fixture's ownership authorizes both publication
and teardown:

- Advancing main authorizes the immutable atomic
  `workspace-source-change:publication:<id>` transaction.
- Fixture reconciliation enforces repository ownership. It rejects and reverts
  every published repository outside the declared fixture.
- Deletion stays scoped as `workspace-repo-delete:<repoPath>`: exact for a
  seeded repository, or a section prefix when the task owns one created or
  derived repository that has no name yet.
- The cleanup context carries the same resident test policy and uses the normal
  protected VCS path.

Do not restate either rule in a scenario prompt or case policy.

The abort signal of the originating VCS call also controls the wait for
protected-ref authority. When an eval deadline fires, authority acquisition,
semantic publication, and the held EvalDO request must unwind together. If the
tool reports a timeout while the EvalDO keeps running, inspect this signal chain
instead of raising either deadline.

Unit and config review has no separate decision path. The protected-main gate
passes its typed unit rows and config summary through the same authority
acquisition, with the same repository-qualified capability, test policy, grant,
abort signal, and terminal result. An unattended test waiting on a
unit-install-review card means the host bypassed this path; more prompt text
will not fix it.

## Phase 3: Classify the Root Cause

Classify each failure and act accordingly.

### Infrastructure bugs (fix the platform)

- **RPC method returns wrong data** → fix the service handler
- **RPC method missing** → add it to the service definition
- **Error swallowed silently** → propagate the error properly
- **API signature unintuitive** → redesign the API, add defaults, improve types
- **Missing capability** → implement it in the service layer
- **Service not registered** → add it to the server or Electron
  `ServiceContainer`

### Documentation bugs (fix the docs)

- **Skill docs describe a different API** → update the skill docs to match
- **Skill docs missing a capability** → document the feature
- **System prompt misleads the agent** → fix the headless system prompt

### Test bugs (fix the test, as a last resort)

- **Validation too strict** → loosen the validator, but only after confirming
  the agent's response is correct
- **Prompt truly underspecified** → clarify only the user-visible goal or the
  required output marker; never add implementation details that hide a docs or
  runtime bug
- **Long-running task** → find where progress stopped and fix the blocked
  operation
- **Published test work survives into a later run** → select
  `CONTENT_WORKSPACE_REPO_FIXTURE` on the mutating `TestCase`, or
  `BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE` when the behavior needs a real
  buildable package. Do not add a fixed repository basename, seed recipe, or
  cleanup steps to the user prompt. See
  [Repository fixtures](#repository-fixtures) for how cleanup works.

**Assume the infrastructure is wrong, not the test.** Classify a failure as a
test bug only after reading the service code and confirming the API works.

### Repository fixtures

The harness imports one `system-test-*` repository on a fresh task line without
publishing it. The baseline is local; a normal `vcs.push` is what shares it. If
a task event reaches main, cleanup intersects the task line's first-parent
history with current main. It finds the newest published task event from event
ancestry and reverts only the published task work, newest first, in one commit
and push. It does not infer ownership from paths or a workspace inventory.
Cleanup also removes any extra repositories the task created and reports them as
a scope failure. Newer local work, and a fixture that never reached main, are
discarded with the task context.

The harness never inventories or prefix-deletes unrelated sibling work, never
adds a fixture-only deletion path, and never serializes fixture tests behind a
global lock.

## Phase 4: Identify Files to Change

Workspace paths are relative to your file root. Application paths are relative
to the Vibestudio checkout (`projects/vibestudio/`).

| Symptom                       | Workspace source                                                                    | Application source                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| fs operation failed           | `packages/runtime/src/shared/rpcFs.ts`                                              | `src/server/services/fsService.ts`                                         |
| DO storage operation failed   | `packages/runtime/src/worker/durable-base.ts`                                       | `src/server/internalDOs/*`                                                 |
| Semantic VCS operation failed | `workers/workspace-source/semanticVcs*`, `packages/runtime/src/shared/vcsClient.ts` | `packages/service-schemas/src/vcs.ts`, `src/server/services/vcsService.ts` |
| External Git operation failed | `extensions/git-bridge/upstream.ts`                                                 | `packages/git/src/client.ts`                                               |
| Build failed                  |                                                                                     | `src/server/buildV2/`, `build.mjs`                                         |
| Worker/DO issue               | `packages/runtime/src/worker/`                                                      | `src/server/services/workerService.ts`                                     |
| Panel lifecycle               |                                                                                     | `src/main/panelOrchestrator.ts`                                            |
| Credential/OAuth error        | `packages/runtime/src/shared/credentials.ts`                                        | `src/server/services/credentialService.ts`                                 |
| Harness crash                 | `packages/harness/src/`                                                             |                                                                            |
| PubSub issue                  | `packages/pubsub/src/`, `workers/pubsub-channel/`                                   |                                                                            |
| Skill import                  | `package.json` exports                                                              | `src/server/buildV2/`                                                      |
| Agent behavior                | `workers/agent-worker/ai-chat-worker.ts`, harness config                            |                                                                            |
| RPC routing                   |                                                                                     | `packages/shared/src/serviceDispatcher.ts`, `packages/rpc/src/`            |

For a swallowed error, search for `.catch(` and empty catch blocks near the
failure site.

## Phase 5: Prepare an Editable Checkout

Pick the checkout type based on what failed.

### Workspace Runtime Source

If the bug is in workspace runtime source (`apps/`, `extensions/`, `packages/`,
`panels/`, `workers/`, or `skills/` under your file root), edit the files
directly in your context with the `edit`/`write` tools. Then follow the
[Vibestudio VCS protocol](../vibestudio-vcs/SKILL.md): keep the working state,
merge current main through bounded coordinate pages when needed, commit the
complete local chain, and publish that committed event. These trees are live
build inputs.

For `apps/` bugs, read `skills/appdev/SKILL.md` before editing. App fixes may
need target-specific validation: Electron host chrome, mobile native bootstrap
and principal grants, or terminal process supervision.

### Vibestudio Application Source

If the bug is in the Vibestudio application itself, such as `src/server/`,
`src/main/`, or root `packages/*`, use a plain project checkout under
`projects/vibestudio`.

#### Self-Development Instances

The operator creates a self-development instance with
`pnpm system-test --self-development` from a host checkout. This mirrors that
checkout (and its linked Base, Personal, and System checkouts), imports the
monorepo as `projects/vibestudio` through the normal import, and publishes it to
protected `main` before the first test context forks. There is no separate
dogfood mode, launcher variable, or marker file: an adopted
`projects/vibestudio` is simply present in the workspace.

`projects/vibestudio` is a plain project, not a Build V2 runtime unit:

- Changes in `projects/vibestudio` prepare a Git branch or patch; they do not
  hot-patch the running Vibestudio server.
- To verify them, restart Vibestudio from that checkout, apply the patch in the
  host checkout, or hand the branch to a developer.
- Restarting from a patched host checkout does not import that checkout's
  template subtrees into an existing semantic workspace. Publish workspace
  runtime changes through semantic VCS, or use a newly created instance whose
  `systemEpoch` matches the host. Never clear only the build cache to force a
  mixed host/userland generation.

#### Importing The Application Source

Use the existing `projects/vibestudio` workspace repo if there is one. If not,
import it with `git.importProject()`. The import:

- asks for one workspace config approval showing the destination path, remote
  URL, and branch;
- records the shared remote and matching upstream with `autoPush: false` in
  `meta/vibestudio.yml`;
- clones one Git snapshot into server state under `state/git-checkouts/`;
- returns a committed semantic candidate context and event. It does not
  publish the candidate to protected `main`.

Compare and merge the candidate incrementally, check it, commit the complete
chain, and push it through the normal VCS protocol before treating the repo as
shared source available to other contexts. Build V2 reads semantic/CAS state,
never the Git checkout. Before reporting the import as proven, require
`candidate.semanticEvidence` and inspect its application, work unit, source
URI, revision, digest, and target repository IDs. The same semantic transaction
returns these fields; they are not reconstructed after the commit.

The same API imports panels, packages, skills, workers, templates, about pages,
and plain projects; the destination path (such as `panels/name`,
`skills/name`, `workers/name`, or `projects/name`) chooses the category.

```
eval({
  code: `
    // In eval, fs is injected and the git client maps to the gitInterop service.
    const dir = "projects/vibestudio";
    try {
      await fs.stat(dir);
      console.log(dir + " already exists");
    } catch {
      const imported = await git.importProject({
        path: dir,
        remote: {
          name: "origin",
          url: "https://github.com/YOUR_ORG/vibestudio.git",
          branch: "main",
        },
      });
      console.log("Import candidate:", imported.candidate);
      console.log("Atomic import evidence:", imported.candidate.semanticEvidence);
    }

    scope.checkoutDir = dir;
    return dir;
  `,
})
```

Work in the test's semantic context. `projects/vibestudio` is a source projection;
its history and branch isolation belong to VCS. Choose a name for an eventual
external handoff, then edit and commit through normal VCS:

```typescript
const branchName = `fix/system-test-${failedTestName}`;
```

When a remote handoff is requested, publish the exact committed event through
the declared Git remote:

```typescript
await git.createBranch({
  repoPath: scope.checkoutDir,
  branch: branchName,
  from: committed.eventId,
});
```

This refuses an existing remote branch and preserves protected main and upstream
tracking. It does not publish uncommitted filesystem edits.

## Phase 6: Edit and Fix

Edit source files in the checkout with fs operations. For a Vibestudio
application checkout, paths are relative to `projects/vibestudio/`:

```typescript
const content = await fs.readFile(
  "projects/vibestudio/src/server/services/fsService.ts",
  "utf-8",
);
// ... modify content ...
await fs.writeFile(
  "projects/vibestudio/src/server/services/fsService.ts",
  fixedContent,
);
```

**Fix checklist:**

- [ ] Service method has clear parameter types and returns useful data
- [ ] Errors propagate with descriptive messages (no empty catch blocks)
- [ ] The fix is in the service/infrastructure layer, not a workaround in caller
      code
- [ ] Skill documentation matches the actual API after the fix

## Phase 7: Publish, then Verify

### Workspace source

Publishing workspace source follows the semantic VCS protocol:

1. Observe the context's working state, committed event, and current main.
2. Confirm the repair is recorded as work units and changes, not only as
   projected file bytes.
3. If main moved, compare against its event and incorporate the incoming
   changes through truthful coordinate merge decisions; review the composed
   intents.
4. Commit the complete local application chain, adding the integrated source
   event as a parent when applicable.
5. When the repair needs build or type confidence, run explicit checks against
   the context. They give fast feedback and move no ref. The protected push
   repeats the affected-unit gate, and that gate decides publication.
6. Push the clean committed event against the main event you observed.
7. A build-gate, ancestry, integration, authorization, approval, or atomic-ref
   failure is a typed result that wrote nothing. Repair the cause and continue
   from freshly observed state.
8. Inspect the post-publication build and activation separately. The push gate
   has already certified the affected candidate units; if a later build or
   activation fails, the previous runnable artifact must stay selected while
   the published source remains on `main`.

Scaffolding and forking prepare candidates local to the context from explicit
authority decisions. Require `preflight.ok === true`, review the full authority
and source, verify, then commit and push through normal VCS. Link the
preparation's application identity to the committed application chain, and
that commit's event to the protected push. If publication fails, recover from
the typed VCS receipts and status; do not prepare the repositories again.

Every semantic mutation has a stable `commandId`. Reuse an ID only to retry an
identical request whose response may have been lost. After a freshness failure
or any change to the request, re-observe the basis and use a new ID. See
[typed recovery](../vibestudio-vcs/references/typed-recovery.md).

### External projects and restarts

Adopted project repositories use semantic VCS, including plain projects. Use
`git.createBranch` for a requested external handoff of an exact committed event.
External publication does not hot-patch the running server; restart from the
reviewed host checkout before retesting host changes.

Restart according to what changed:

- **Host-only changes:** restart the current source server. Host modules load
  from the checkout on each process start.
- **Template checkout changes** (including this skill, agents, workers, and
  userland packages): stop the current server and start
  `pnpm server:live --ephemeral --instance INSTANCE`. The supervisor creates an
  isolated disposable hub and copies its workspace fresh from the template
  checkouts. Use `pnpm cli --instance INSTANCE ...` for every command in that
  investigation. A named `--bootstrap-workspace` is persistent product state:
  restarting it preserves its semantic source and build projections, so it is
  not a way to sync from the checkout.

### Host contract failures

The headless host and the desktop/mobile shells share one complete
workspace-state/runtime adapter contract. If panel hosting reports a missing
adapter method, repair that shared contract and its host typecheck; do not
special-case panel loading or weaken the readiness validator. A panel tree slot
may be created before the renderer is ready; `openPanel` is still the public
call that waits for boot readiness.

The headless host only renders; it does not attach as an interactive workspace.
It reads the existing panel tree without reconciling `initPanels`. Otherwise,
starting an inspection would silently create a chat panel and run an unrelated
workspace-default agent outside the test's pinned model policy. Interactive
shells attach through the explicit initial-panel step.

Desktop and headless inspecting hosts must both implement the
`panelObservation` host command. Both use the shared bounded browser probe and
parser for the URL, document readiness, and bootstrap identity. A registered
CDP target, a successful navigation event, an existing view, or an empty
snapshot does not count as readiness evidence. If a host reports the command as
unknown, classify it as a host-contract infrastructure failure and fix the host
before changing the agent prompt or validator.

### Before concluding a repair failed

Verify that:

- the test's context and active build ref match the returned event;
- the intended work unit, changes, and application are present;
- the publication receipt points at the committed event, and any build artifact
  separately names that same semantic state;
- a moved file kept its `fileId`, or a copied file has the expected new ID plus
  its `authored-copy-source` relation and `copies-content` mappings;
- the source server was restarted when host code changed, and workspace-source
  changes ran on a fresh ephemeral instance;
- external project changes were actually applied to the server under test;
- every worker/DO runtime image selects the intended context/main state, and
  its build metadata derives from that semantic state;
- the manifest's `systemEpoch` matches the host before any runtime starts.

Then rerun the failed test through the CLI. Run more only when the change's
plausible blast radius points to another specific scenario or conventional test
whose result is not already known. Inspect the trajectory of any new failure
instead of adding prompt instructions or timing delays.

## Phase 8: Iterate or Finalize

```typescript
if (retest.result.passed) {
  console.log(`Fix verified on branch: ${branchName}`);
} else {
  console.log("Fix didn't work. Iterating...");
  // Go back to Phase 6 — edit, publish, rebuild, re-test
}
```

## Tips

- **Start with the smallest relevant test.** Run `doctor` and look up the
  test's current name first. Expand only when the changed behavior gives a
  concrete reason.
- **Keep each repair focused.** Don't bundle unrelated fixes.
- **Use the isolated semantic task context for workspace source.** Create a Git
  branch only when editing a plain external project repository.
- **Check type errors before committing.** Use the
  `@workspace-extensions/typecheck-service` extension.
- **Don't rerun broadly without a reason.** Do not rerun category, smoke, or
  full-suite coverage just because a single test passed.
- **Declare repository fixtures.** Any agentic case that may create or fork
  workspace source must select the `projects/...` content fixture or the seeded
  `packages/...` buildable-package fixture. See
  [Repository fixtures](#repository-fixtures).
- **Shared remotes only declare transport.** `git.setSharedRemote()` records and
  propagates remotes for a workspace repo that exists now or will exist later.
- **Treat Git imports as candidates.** Startup acquires only the configured
  seeds, before the first protected-main publication, and publishes the
  complete initialization chain once. In an existing workspace, import each
  repository with its own `git.importProject()` call and publish the candidate
  as described in Phase 5.
- **Preview Git pulls without disturbing the test.**
  `git.pullUpstream(repo, { dryRun: true })` exports and fetches in an isolated
  temporary checkout and changes no managed Git, bridge, semantic, or remote
  state. After a successful fetch, `remoteBranchExists: false` means the
  configured branch does not exist; it does not mean in sync or auth failed.
