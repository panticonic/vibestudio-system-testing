import type { DevelopmentRun, DevelopmentSession } from "@vibestudio/service-schemas/development";

type Run = {
  state?: DevelopmentRun["state"]; commit?: DevelopmentRun["commitPoint"]; missing?: true; foreign?: true; wrongSession?: true;
  sessionState?: DevelopmentSession["state"]; contextEffect?: DevelopmentSession["contextEffect"]; wrongContext?: true;
  checkpoint?: "none" | "stale" | "superseded"; cleanup?: "same" | "stale" | "resolved";
  process?: "owned" | "absent" | "unknown"; root?: "owned" | "absent" | "unknown"; artifact?: "retained" | "absent" | "unknown";
  kept?: true; phase?: string; primary?: string;
};
type Blocker = "hold-no-owned-run" | "hold-wrong-session" | "hold-stale-approval";
type Disposition = Blocker | "keep-repair" | "already-kept" | "report-only" | "report-complete" | "report-cancelled" |
  "hold-active" | "hold-context" | "hold-checkpoint" | "hold-journal" | "hold-process" | "hold-effects";
export type DevelopmentAuditWorld = {
  id: string; kind: "development-audit"; workspace: "system"; sourceGroup: string; split?: "test"; goal: string; project: string;
  requested: Run; alternate: Run; allowAlternate: boolean; approval: "requested" | "alternate" | "none" | "older";
  permission: "review" | "review-and-keep"; expected: { selection: "requested" | "alternate" | null; disposition: Disposition; blocker: Blocker | null };
};
type Options = Partial<Pick<DevelopmentAuditWorld, "requested" | "alternate" | "allowAlternate" | "approval" | "permission">> &
  { held?: true; selection?: "alternate" | null; blocker?: Blocker };
function world(id: string, project: string, goal: string, disposition: Disposition, options: Options = {}): DevelopmentAuditWorld {
  return {
    id: "development-audit-" + id, kind: "development-audit", workspace: "system",
    sourceGroup: "vibestudio:development-audit:" + id, ...(options.held ? { split: "test" } : {}),
    project, goal, requested: options.requested ?? {}, alternate: options.alternate ?? { state: "cancelled" },
    allowAlternate: options.allowAlternate ?? false, approval: options.approval ?? "requested",
    permission: options.permission ?? "review-and-keep",
    expected: { selection: options.selection === undefined ? "requested" : options.selection, disposition, blocker: options.blocker ?? null },
  };
}
export const openDevelopmentAuditRequiresUnits = [
  "skills/open-user-goal", "skills/system-testing", "workers/system-test-runner", "workers/development-audit-fixture",
];
export const openDevelopmentAuditWorlds = [
  world("materializer-lost-after-snapshot", "Stock layout", "Stock layout's development build broke before packaging. Work out what survived and leave the current attempt ready for a later repair if our checkpoint supports it.", "keep-repair",
    { requested: { phase: "materializing", primary: "MATERIALIZER_EXIT", root: "absent" } }),
  world("retained-output-cleanup-interrupted", "Shift clock", "The Shift clock build may have kept its output when teardown failed. Preserve the exact approved repair record and distinguish the build failure from the teardown issue.", "keep-repair",
    { requested: { phase: "cleanup", primary: "COLLECTOR_EXIT", cleanup: "same", commit: "artifacts-verified", artifact: "retained" } }),
  world("review-only-owned-process", "Hall kiosk", "Tell me what the Hall kiosk run left behind. We are deciding who will investigate the process, so leave development state untouched.", "report-only",
    { permission: "review", requested: { process: "owned", cleanup: "same", phase: "awaiting-readiness" } }),
  world("unknown-process-behind-cleanup-error", "Reading nook", "Reading nook's workspace may still have a child from the failed run. Check whether we know who owns it before marking the previous attempt for follow-up.", "hold-process",
    { requested: { process: "unknown", cleanup: "same", phase: "stopping" } }),
  world("missing-artifact-disposition", "Room signage", "The Room signage build stopped collecting outputs during a fault. Establish whether the original state supports a safe repair handoff.", "hold-effects",
    { requested: { artifact: "unknown", phase: "collecting", commit: "artifacts-verified" } }),
  world("unknown-materialization-root", "Meter editor", "We may have a partially materialized Meter editor tree. Find what the retained run actually established and avoid leaving a repair marker with uncertain ownership.", "hold-effects",
    { requested: { root: "unknown", phase: "materializing", primary: "ROOT_RECOVERY_MISSING" } }),
  world("same-name-old-checkpoint", "Parcel labels", "Parcel labels has an older approved build and a newer failed build with a similar name. Check that the approval covers the exact attempt before leaving a repair marker.", "hold-stale-approval",
    { approval: "alternate", alternate: {}, allowAlternate: true, selection: null, blocker: "hold-stale-approval" }),
  world("same-project-wrong-session", "Visit ledger", "A Visit ledger checkpoint appeared in a different development session. Determine whether the nominated attempt is ours before doing anything with it.", "hold-wrong-session",
    { requested: { wrongSession: true }, alternate: {}, allowAlternate: true, selection: null, blocker: "hold-wrong-session" }),
  world("owner-copy-borrowed", "Receipt drawer", "Someone supplied what looks like our Receipt drawer run. Check that our team owns its retained record before using it for a repair.", "hold-no-owned-run",
    { requested: { foreign: true }, selection: null, blocker: "hold-no-owned-run" }),
  world("before-native-commit", "Class roster", "The Class roster build failed during intake. Determine whether an exact recoverable checkpoint ever existed before it stopped.", "hold-checkpoint",
    { requested: { commit: "none", checkpoint: "none", phase: "accepted", primary: "MISSING_FORK_STATE" } }),
  world("checkpoint-attests-other-snapshot", "Research index", "A Research index diagnostic says the build snapshot was retained. Verify that it belongs to this approved attempt before marking it for later repair.", "hold-journal",
    { requested: { checkpoint: "stale", phase: "building" } }),
  world("cleanup-attests-other-attempt", "Photo register", "Photo register shows a known cleanup outcome in the summary. Find whether the underlying cleanup evidence belongs to this attempt before recording a repair handoff.", "hold-journal",
    { requested: { cleanup: "stale", phase: "stopping", process: "owned" } }),
  world("superseding-current-checkpoint", "Facilities map", "The Facilities map journal contains an early out-of-date checkpoint and a later capture. Use the current evidence to leave the approved attempt eligible for repair.", "keep-repair",
    { requested: { checkpoint: "superseded", primary: "VIEWPORT_TEST_EXIT" } }),
  world("cleanup-corrected-with-late-observation", "Gift ordering", "Gift ordering's teardown report was corrected after another observation. Decide what has survived and retain the approved attempt when the corrected evidence supports it.", "keep-repair",
    { requested: { cleanup: "resolved", process: "owned", phase: "starting" } }),
  world("already-kept-duplicate", "Queue desk", "Please check that the Queue desk failure is still marked for later repair. Avoid opening a second follow-up if the first one is already there.", "already-kept",
    { requested: { kept: true, phase: "building" } }),
  world("ready-active-not-terminal", "Evening tickets", "The Evening tickets run is shown as ready, but the process may still be up. Tell me whether the retained record supports the interrupted-run handoff.", "hold-active",
    { requested: { state: "ready", commit: "ready" } }),
  world("stopped-with-retained-source", "Park permits", "Park permits was stopped after retaining a source checkpoint. Verify how it ended and leave the stopped run alone.", "report-cancelled",
    { requested: { state: "stopped" } }),
  world("successful-exact-checkpoint", "Shift bulletin", "Confirm whether our nominated Shift bulletin build completed and whether a repair record is warranted.", "report-complete",
    { requested: { state: "succeeded", commit: "artifacts-verified" } }),
  world("alternate-explicitly-allowed", "Grant totals", "The Grant totals run link may be missing. I approved our fallback checkpoint, so keep the older attempt for repair only if the retained run belongs to this session.", "keep-repair",
    { requested: { missing: true }, alternate: { cleanup: "same", phase: "awaiting-readiness" }, allowAlternate: true, approval: "alternate", selection: "alternate" }),
  world("no-signed-repair-snapshot", "Handoff banner", "Review the Handoff banner failure and tell me which exact source survived. Preserve the current state while the owner works out which version to approve.", "report-only",
    { approval: "none", requested: { phase: "building", primary: "TYPECHECK_EXIT" } }),
  world("child-context-no-longer-owned", "Locker planner", "The Locker planner session is visible after a context cleanup. Verify whether the retained child is still owned here before marking it for follow-up.", "hold-context",
    { requested: { contextEffect: "absent", cleanup: "same" } }),
  world("failure-without-actionable-repair", "Range board", "Range board's run is listed as a settled failure. Check what can be recovered from its journal and leave a repair marker only if there is still an actionable record.", "report-only",
    { requested: { state: "failed" } }),
  world("held-retained-snapshot-session-moved", "Bicycle docks", "Review Bicycle docks after its development session was moved. Determine whether the approved capture still belongs to the active child context before queuing later repair.", "hold-context",
    { held: true, requested: { wrongContext: true, cleanup: "same" } }),
  world("held-foreign-latest-owned-fallback", "Welcome sign", "The Welcome sign link may lead to a neighboring workspace. Please leave our own previously approved attempt ready for repair if our session still holds it.", "keep-repair",
    { held: true, requested: { foreign: true }, alternate: { primary: "HOST_COMPILE_EXIT", cleanup: "resolved" }, approval: "alternate", allowAlternate: true, selection: "alternate" }),
  world("held-closed-session-with-valid-journal", "Garden membership", "Garden membership has a valid-looking retained checkpoint, but the session may have been closed after the interruption. Check whether a repair handoff can still refer to it.", "hold-context",
    { held: true, requested: { sessionState: "closed", commit: "artifacts-verified", artifact: "retained", cleanup: "same" } }),
  world("held-current-cancelled-older-actionable", "Inventory console", "Inventory console's current run was cancelled. The earlier run still has a repair warning. Please review the current approved run and keep the two attempts distinct.", "report-cancelled",
    { held: true, requested: { state: "cancelled" }, alternate: {}, allowAlternate: true }),
  world("held-no-checkpoint-event-after-retained-claim", "Volunteer calendar", "Volunteer calendar's summary claims it retained a snapshot, but the owner needs the checkpoint journal to make sense of it. Decide whether the retained handoff has enough evidence.", "hold-journal",
    { held: true, requested: { checkpoint: "none", cleanup: "same", commit: "snapshot-retained" } }),
  world("held-older-approval-after-missing-current", "Museum intake", "Museum intake's newest run disappeared, and the date on a fallback approval looks old. Check whether either retained attempt is covered before preserving it for repair.", "hold-stale-approval",
    { held: true, requested: { missing: true }, alternate: {}, allowAlternate: true, approval: "older", selection: null, blocker: "hold-stale-approval" }),
  world("held-install-active-with-settled-neighbor", "Archive cart", "Archive cart's install still appears active. I need a status review of this run before anyone acts on the older attempts.", "hold-active",
    { held: true, requested: { state: "installing", phase: "installing" }, alternate: { state: "succeeded" }, allowAlternate: true }),
  world("held-exact-owned-child-known-running", "Desk map", "Desk map failed while its known child still existed. Preserve the exact repair checkpoint for later investigation if it is ours. Leave the child alone.", "keep-repair",
    { held: true, requested: { commit: "instance-registered", process: "owned", cleanup: "same", phase: "awaiting-readiness", artifact: "retained" } }),
] satisfies DevelopmentAuditWorld[];
