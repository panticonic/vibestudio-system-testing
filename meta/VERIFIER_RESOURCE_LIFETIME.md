# Verification owns observations, the prepared fixture owns teardown

The native chat-continuity reference called `verify` twice: the accepted result,
then an incorrect return. The first call retired its worker, so the second
read failed in authoritative durable-object readiness before checking the wrong
return. The original Personal packet remains retained; this is a verifier
lifecycle defect, not evidence that Workerd memory retirement caused that error.

Inventory before editing (all paths relative to this template):

- `skills/system-testing/open-goal-chat-continuity-managed.ts`: `verify` read the
  current worker and retired all agents. Move retirement to a joined `close`
  hook, including constructor failure cleanup. Native membership/history,
  source preservation, transcript projection, private artifact, and negative
  return checks still run against the live owned fixture.
- `open-goal-intent-discovery-managed.ts`: `verifyNativeApplication` re-reads
  runtime entities, then closed them. Leave retirement in its existing final
  `close` hook so subsequent verification sees the same facts.
- `open-goal-launch-state-managed.ts`: `verify` reads both current panels, then
  archived them before its own incorrect-return replay. Leave archival in its
  existing final `close` hook.
- Canonical owners already join this hook after all work:
  `workers/system-test-runner/index.ts` qualification `finally`, and
  `workers/system-test-runner/authored-teacher.ts` outcome wrapper `finally`.
  The latter retains cleanup errors alongside actual raw execution evidence.

Exclusions checked with cleanup-call inventory:

- `open-goal-terminal-managed.ts:285–309,373–418` closes its temporary session
  before verifying the retained terminal transitions and registry absence.
  Its negative replay calls `verifyOutcome` over retained observations rather
  than the closed native session. Terminal retirement is an explicitly tested
  operation; removing it would drop the absence readback.
- `checklist-managed.ts:283–307` closes once, then positive/negative verification
  both consume the same retained report and retirement receipt.
- `open-goal-owned-operations-managed.ts:224` closes an operation and records its
  cleanup result as an actual requested effect, before pure report verification.
- `open-goal-retained-memory-managed.ts:230–278` already keeps its resource alive
  through repeated verification and closes only in the owner hook/setup catch.
- Cleanup calls in pty-continuity, log-follower, audience-response,
  outcome-workspace, development-audit, owned-research, local-presentation,
  notification-state, local-method, automation-activation, local-delivery,
  gad-durable-question, delivery-wake, native-image, and transcript-surface
  managed helpers are constructor failure paths or separate owner hooks.
- Browser, panel recovery/health, presentation, and board migration helpers
  close temporary CDP/file handles within individual observations. Those handles
  are reacquired on each observation; they do not retire the prepared fixture.
- Webhook retirement and same-turn Eval disposal are explicit domain operations,
  not verifier teardown. Model engines do not implement these native fixture
  constructors or consume their ownership hooks; no engine changes apply.

Conventional lifecycle regressions use the existing injected native ports and
real public preparation/qualification/verification functions. Retiring a test
worker or archiving a test panel really makes later reads unavailable, so the
old destructive ordering fails. These tests do not replace the canonical native
system-test route or assert unexecuted full-suite outcomes.
