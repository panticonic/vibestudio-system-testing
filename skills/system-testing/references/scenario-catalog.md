# Scenario catalog

The live catalog is the authority:

```bash
pnpm system-test --instance INSTANCE list --json
```

Use one stable unique `INSTANCE` for parallel work and exact returned names.
The launcher provisions and pairs the isolated server when it is absent. Counts
and categories evolve with the product and should not be copied into prompts or
maintained as parallel prose constants.

## Coverage families

- `smoke`: eval, filesystem, package import, and basic tool health.
- `filesystem`: managed and unmanaged file behavior, directories, metadata,
  handles, and boundary rules.
- `vcs` / `vcs-advanced`: exact events and local applications, complete-chain
  commit, incremental integration, exact-event publication, move/copy identity,
  counteractions, causal/blame walks, honest import boundaries (including mixed
  native-edited and untouched imported spans), freshness, and idempotency.
- `provenance-questions`: the question-shaped surfaces — recovering an
  originating request, the cohort of one request, negative evidence before
  repeating it, entry by recorded prose, set-shaped questions, the visibility
  boundary, and the flagship: recovering a constraint nobody ever wrote down.
  These are the only coverage that observes walks, `prov_*` queries, and search
  under the deployed SQLite engine and across the host↔authority dispatch seam;
  the unit suites run on the sql.js fallback and cannot fail on either. Each
  case also asserts that a surface refused rather than died, because a surface
  that always fails closed reads exactly like a healthy one.

  Two fixture rules make these cases mean what they claim. The evidence exists
  only in the record — intents, commit messages, undone changes, trajectory
  messages — and never in file content, so an agent cannot grep its way to a
  pass; and the flagship's constraint is never stated anywhere, so recovering
  it is abduction rather than retrieval. A provenance fixture that writes the
  answer into a comment grades reading, not recovery.

  Known gap: no scenario yet produces a merge coordinate resolved `ours`, which
  the redesign counts as first-class negative evidence alongside counteractions
  and reverts.
- `git-interop`: fresh external status, credential selection, canonical
  imports and commit mappings that require
  managed edit → semantic commit → protected publication → Git export/push;
  this is separate from workspace VCS.
- `panels`, `interaction-surfaces`, `cdp-gad-diagnostics`: panel lifecycle,
  visual/DOM behavior, interaction affordances, onboarding owner-skill
  handoffs (including gated phone-provider discovery), and browser diagnostics.
- `workers`, `rpc-communication`, `agentic-runtime`: worker/DO lifecycle,
  services, RPC, state, and agent runtime behavior.
- `build`, `extensions-surface`, `project-lifecycle`: build provenance,
  extension invocation, scaffolding, fork/lifecycle work, and real unit launch.
- `approvals-permissions`, `credentials`, `oauth`, `webhooks`: authority and
  external-integration lifecycles, with synthetic/revoked fixtures.
- `workspace`, `multi-user`, `notifications`: workspace state, identity,
  participants, presence, and notifications.
- `messaging`: addressing another participant, enumerating who is addressable,
  and steering a running child. Fail-closed addressing is the sharpest case: an
  addressee that cannot be resolved must never degrade into a broadcast.
  Escalation to a person is deliberately absent — a headless test channel has no
  human participant for `owner` to resolve to, so that rung is covered by
  focused conventional tests instead of a scenario that could only ever assert
  the attempt.
- `unit-diagnostics`, `server-logs`, `harness-tools`: bounded operational and
  provenance inspection.
- `local-models`: persistent model installation, readiness, and real delegated
  inference through the ordinary agent runtime.
- `eval-lifecycle`, `harness-resilience`, `edge-cases`: cancellation,
  persistence, cleanup, transport errors, large results, and recovery.
- `self-development`: exact dirty semantic builds, current/isolated launches,
  native checkpoints, attached child eval/approval, recovery, and owned cleanup.
- `skills`, `docs-discovery`, `docs-probes`: skill discovery and realistic
  goal-driven application of documentation.
- `blobstore`: immutable blobs, ranges, search, and file-tree behavior.
- `deterministic`: exact `@workspace/testkit` suites wrapped into staged runs.

## Escalation order

Run the exact scenario first. After repair, expand only to the smallest set
whose behavior could have changed and is not already covered by focused
conventional tests. Category, smoke, and full-suite runs are evidence-directed
escalations, not mandatory stages. Use `pnpm smoke:full` only when real
remote/mobile pairing or packaged-client coverage is relevant to the repair.

## Choosing the right layer

Choose agentic scenarios for discoverability, skill application, tool
selection, multi-step recovery, and agent-facing ergonomics. Choose
deterministic tests for exact state transitions, schema invariants, rendering,
protocol contracts, and low-level failure injection. Pair them when a user
workflow has both an agentic decision boundary and a precise durable outcome.

The live exported test arrays are the only scenario registry. Do not maintain a
second JSON protocol matrix or generate prompt variants from one. Add a small
user-goal `TestCase`, validate its actual invocations and durable effect, and
keep the VCS skill, service schema, and test trajectory in agreement.
