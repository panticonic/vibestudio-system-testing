# Fixture-owned panel concurrency

Inventory before edits (SSTdd1e4a0, Host7f3e426, Base5695a68):

- `TestRunner.runSuite` (`test-runner.ts125–220`) already admits the configured
  number of independent cases, awaits every execution/retention callback, and
  releases resource ownership in `finally`. `HeadlessRunner.forTest` (runner.ts621)
  provides a concurrency-safe view with per-test sessions, policy and fixture
  worker owner. The existing capability was unused for eight Spectrolite roots:
  all held the same exclusive panel resource throughout model execution.
- `runOpenGoal` (runner.ts2370–2462) creates a fresh context, worker and
  focus:false panel for spectrolite/vaultWork/pdfVault. Seeding and edits name
  that exact context; the same owner archives its panel and destroys its context
  after execution. `runManagedSpectrolite` (1344–1420) has the same ownership.
  Spectrolite fixture `open-goal.ts75–101` checks panel context/ref/source plus
  attempt/build identity; each CDP session closes in finally. Its actions target
  that page, not global focus. Knowledge and PDF-vault compose this same fixture.
- Base `workers/testkit-driver/index.ts102–118` creates a unique CDP session ID
  for each requested panel, stores owner+panelId in a session map, and sends
  through that exact connection. It is not one mutable current page.
- Global tree/focus tests (`tests/panels.ts`, `_panel-tree-invariant.ts`) take
  workspace-wide before/after snapshots and must exclude concurrent owned
  fixtures too. They retain the SAME exclusive resource; replacing the key with
  a unique per-case key would incorrectly remove that conflict.
- Scheduling contract consumers: `types.ts220` declares resources;
  `test-runner.ts142` is the only production consumer. All declaration sites
  below continue using exclusive resources unless explicitly audited above.
  Add shared participation on the same key for the four audited families;
  exclusive participation wins if both modes are declared. Shared cases may
  overlap each other but never an exclusive participant. Earlier waiting
  exclusive cases fence later shared admissions on their resource.
- Catalog/list/retention boundaries: `cli.ts256–276` explicitly projects public
  descriptor fields; Host `systemTestRunner.ts51–62` strictly validates those
  fields and currently publishes NO scheduling resource fields. Worker
  `index.ts4891` calls that same list function. Shared scheduling metadata remains
  internal TestCase data, like existing exclusive resources. Goal IDs, prompts,
  splits, required units, descriptor schema and capture protocol do not change.
- Cancellation: TestRunner wakes waiting schedulers; admitted work keeps its
  resource through runOne and retained evidence, then finally releases it.
  Preserve this owner boundary and the existing concurrency telemetry.
- Host `collect-live-workflow-teacher.mjs372` processes groups sequentially and
 415 submits one managed run with --concurrency. `live-teacher-groups.mjs` groups
  exact workspace/baseline/device sets. Do not Promise.all groups: their current
  CLI budget is per instance, device leases span instances, and reviewer calls
  need global admission too. Same-instance fixture overlap needs no extra server.
- Opt out through existing --concurrency1. Default concurrency remains1; a caller
  explicitly requesting8 may now use8 disjoint owned fixtures in ONE instance.
  The caller's ledger budget and canonical scheduler still bound that workload.
- All other resource families retain their exclusive keys: Android/device,
  profile/local-models, protected-main/repository creation, Git configuration,
  worker category, client-device, global panel tree and focus, runtime rebuild,
  cleanup inspection and unaudited fixture families. This unit does not claim
  context ownership alone establishes safe profile/client/main isolation.
- Model engines are consumers of prompts/requests, not TestCase resource
  scheduling: Core NativeToolAgent executes tools; no llama/wllama/Python/SGLang
  protocol or inference changes. No paid probe or new instance is required.

Native performance guidance read from the exact System template performance
SKILL.md. The original configured8/actual1 observation is the baseline; focused
scheduler/fixture tests establish overlap and exclusion, not a measured paid
throughput multiplier or aggregate memory bound. Production useful throughput
must be read after the next graceful source activation.
skills/system-testing/tests/_panel-tree-invariant.test.ts
skills/system-testing/tests/adventure-campaign-play.ts
skills/system-testing/tests/adventure-review-managed.ts
skills/system-testing/tests/agentic-runtime.ts
skills/system-testing/tests/android-audit-managed.ts
skills/system-testing/tests/android-install-managed.ts
skills/system-testing/tests/android-pair-managed.ts
skills/system-testing/tests/browser-handoff-managed.ts
skills/system-testing/tests/build.test.ts
skills/system-testing/tests/build.ts
skills/system-testing/tests/cdp-gad-diagnostics.ts
skills/system-testing/tests/client-dev-loop.ts
skills/system-testing/tests/client-launch.ts
skills/system-testing/tests/collection-managed.ts
skills/system-testing/tests/delivery-history-managed.ts
skills/system-testing/tests/developer-ergonomics.ts
skills/system-testing/tests/docs-probes.ts
skills/system-testing/tests/git-interop.ts
skills/system-testing/tests/google-setup-managed.ts
skills/system-testing/tests/grimoire-managed.ts
skills/system-testing/tests/image-panel.ts
skills/system-testing/tests/intent-discovery.ts
skills/system-testing/tests/local-models.ts
skills/system-testing/tests/mobile.ts
skills/system-testing/tests/native-suite-managed.ts
skills/system-testing/tests/news-managed.ts
skills/system-testing/tests/panel-health-managed.ts
skills/system-testing/tests/panel-repair.ts
skills/system-testing/tests/panels.ts
skills/system-testing/tests/presentation-managed.ts
skills/system-testing/tests/project-lifecycle.ts
skills/system-testing/tests/publication-preflight.ts
skills/system-testing/tests/scaffold-matrix.ts
skills/system-testing/tests/self-development.ts
skills/system-testing/tests/spectrolite-managed.ts
skills/system-testing/tests/tendril-managed.ts
skills/system-testing/tests/tendrils.ts
skills/system-testing/tests/testkit-cleanup-managed.ts
skills/system-testing/tests/tour-rehearsal-managed.ts
skills/system-testing/tests/trello-live-import.ts
skills/system-testing/tests/unit-repair.ts
skills/system-testing/tests/vcs-advanced.ts
skills/system-testing/tests/vcs.ts
skills/system-testing/tests/web-brief-managed.ts

Verification: actual Host-owned focused Vitest invocation
`vibe-fixture-panel-scheduler-20261125a`, LOW1GiB/reserve7.5GiB,
**44/44 tests passed** (39 existing TestRunner regressions, four shared/exclusive
scheduler regressions, one real exported-case metadata regression). Vitest6.71s,
whole unit8.94s, peak479.4MiB. Checks exercise simultaneous fixture controls,
independent page/context values, exclusion through cleanup and retained capture,
writer fairness without blocking disjoint work, cancellation/join, unchanged
exclusive semantics and the concurrency-one opt out. No native renderer/model
throughput multiplier is inferred. Full composition typecheck and actual live
parallel acceptance remain separate/unverified; no NPM/install/build/inference
or extra instance ran for this check. Test-owned Vitest scratch was retired.
