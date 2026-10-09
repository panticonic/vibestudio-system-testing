# Scenario catalog

The live catalog is the source of truth:

```bash
pnpm system-test --instance INSTANCE list --json
```

Use one stable, unique `INSTANCE` for parallel work, and use test names exactly
as returned. If the isolated server does not exist, the launcher provisions and
pairs it. Counts and categories change with the product; do not copy them into
prompts or keep them as constants in prose.

## Coverage families

- `smoke`: eval, filesystem, package import, and basic tool health.
- `filesystem`: managed and unmanaged file behavior, directories, metadata,
  handles, and boundary rules.
- `vcs` / `vcs-advanced`: events and local applications, complete-chain commit,
  incremental integration, single-event publication, move/copy identity,
  counteractions, causal and blame walks, honest import boundaries (including
  mixed spans of natively edited and untouched imported content), freshness,
  and idempotency.
- `provenance-questions`: question-shaped features. Cases cover recovering an
  originating request, the cohort of one request, checking for negative
  evidence before repeating a request, entry by recorded prose, set-shaped
  questions, the visibility boundary, and the flagship case: recovering a
  constraint nobody ever wrote down. This is the only coverage that exercises
  walks, `prov_*` queries, and search on the deployed SQLite engine and across
  the host↔authority dispatch seam. The unit suites run on the sql.js fallback
  and cannot catch failures in either. Each case also asserts that a feature
  refused rather than crashed, because a feature that always fails closed looks
  exactly like a healthy one.

  Two fixture rules keep these cases honest. The evidence exists only in the
  record (intents, commit messages, undone changes, trajectory messages) and
  never in file content, so an agent cannot grep its way to a pass. The
  flagship's constraint is never stated anywhere, so recovering it requires
  inference, not retrieval. A provenance fixture that writes the answer into a
  comment tests reading, not recovery.

  Known gap: no scenario yet produces a merge coordinate resolved as `ours`,
  which the redesign treats as negative evidence on par with counteractions
  and reverts.

- `git-interop`: fresh external status, credential selection, imports and
  commit mappings that require managed edit → semantic commit → protected
  publication → Git export/push. This is separate from workspace VCS.
- `panels`, `interaction-surfaces`, `cdp-gad-diagnostics`: panel lifecycle,
  visual and DOM behavior, interaction affordances, onboarding handoffs to the
  responsible skill (including gated phone-provider discovery), and browser
  diagnostics.
- `workers`, `rpc-communication`, `agentic-runtime`: worker/DO lifecycle,
  services, RPC, state, and agent runtime behavior.
- `build`, `extensions-surface`, `project-lifecycle`: build provenance,
  extension invocation, scaffolding, fork/lifecycle work, and real unit launch.
- `approvals-permissions`, `credentials`, `oauth`, `webhooks`: authority and
  external-integration lifecycles, using synthetic or revoked fixtures.
- `workspace`, `multi-user`, `notifications`: workspace state, identity,
  participants, presence, and notifications.
- `messaging`: addressing another participant, listing who is addressable, and
  steering a running child. Fail-closed addressing is the most important case:
  an addressee that cannot be resolved must never turn into a broadcast.
  Escalation to a person is deliberately not covered here. A headless test
  channel has no human participant for `owner` to resolve to, so a scenario
  could only assert the attempt; focused conventional tests cover it instead.
- `unit-diagnostics`, `server-logs`, `harness-tools`: bounded operational and
  provenance inspection.
- `local-models`: persistent model installation, readiness, and real delegated
  inference through the normal agent runtime.
- `eval-lifecycle`, `harness-resilience`, `edge-cases`: cancellation,
  persistence, cleanup, transport errors, large results, and recovery.
- `self-development`: semantic builds of dirty state, current and isolated
  launches, native checkpoints, attached child eval/approval, recovery, and
  cleanup of the resources the test created.
- `skills`, `docs-discovery`, `docs-probes`: skill discovery and realistic,
  goal-driven use of documentation.
- `blobstore`: immutable blobs, ranges, search, and file-tree behavior.
- `deterministic`: `@workspace/testkit` suites wrapped into staged runs.

## Escalation order

Run the specific scenario first. After a fix, expand only to the smallest set
whose behavior could have changed and that focused conventional tests don't
already cover. Category, smoke, and full-suite runs are escalations you choose
based on evidence, not mandatory stages. Run the host pairing smokes
(`pnpm test:iroh-desktop-e2e`, `pnpm test:iroh-mobile-e2e`) only when the fix
affects real remote/mobile pairing or packaged-client coverage.

## Choosing the right layer

Use agentic scenarios for discoverability, skill application, tool selection,
multi-step recovery, and agent-facing ergonomics. Use deterministic tests for
exact state transitions, schema invariants, rendering, protocol contracts, and
low-level failure injection. Combine them when a user workflow involves both an
agent decision and a precise persisted outcome.

The live exported test arrays are the only scenario registry. Do not maintain a
second JSON protocol matrix or generate prompt variants from one. Add a small
user-goal `TestCase`, validate its actual invocations and persisted effect, and
keep the VCS skill, service schema, and test trajectory consistent with each
other.
