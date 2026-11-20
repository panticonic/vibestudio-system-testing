import type { Change, ScheduleState } from "@workspace-skills/open-owned-scheduled-recovery/types";

type Entry = {
  lane: "decision" | "archive"; disposition: "approved" | "proposed" | "withdrawn";
  change: Change; bind?: "prior-revision" | "other-schedule" | "other-owner";
  prerequisite?: ScheduleState; handoff?: boolean;
};
export type ScheduledRecoveryWorld = {
  id: string; kind: "scheduled-recovery"; workspace: "system"; sourceGroup: string; split?: "test";
  goal: string; title: string; group: string; dependency: string;
  initial: ScheduleState; minutes: number; cap?: number; dependencyState: ScheduleState;
  entries: Entry[];
  destination: string;
  readOnly?: boolean;
  interruption?: "delivery" | "schedule-revision" | "dependency";
  expected: { entry: number | null; effect: Change | null; handoff: boolean; reason: string[] };
};

export const scheduledRecoveryRequiresUnits = [
  "skills/open-user-goal", "skills/open-owned-scheduled-recovery", "workers/missions", "workers/pubsub-channel",
];

const cadence = (minutes: number): Change => ({ kind: "cadence", minutes });
const cap = (maxRuns: number): Change => ({ kind: "cap", maxRuns });
const window = (minutes: number, maxRuns: number): Change => ({ kind: "window", minutes, maxRuns });
const pause: Change = { kind: "pause" };
const resume: Change = { kind: "resume" };
const approved = (change: Change, options: Partial<Entry> = {}): Entry =>
  ({ lane: "decision", disposition: "approved", change, ...options });
const archive = (change: Change, options: Partial<Entry> = {}): Entry =>
  approved(change, { lane: "archive", ...options });
const proposed = (change: Change): Entry => approved(change, { disposition: "proposed" });
const withdrawn = (change: Change): Entry => approved(change, { disposition: "withdrawn" });
const result = (entry: number | null, effect: Change | null, handoff = false, ...reason: string[]) =>
  ({ entry, effect, handoff, reason });

function world(
  id: string, group: string, title: string, goal: string, entries: Entry[], expected: ScheduledRecoveryWorld["expected"],
  options: Partial<Pick<ScheduledRecoveryWorld, "initial" | "minutes" | "cap" | "dependency" | "dependencyState" |
    "destination" | "interruption" | "split" | "readOnly">> = {},
): ScheduledRecoveryWorld {
  return {
    id: "scheduled-recovery-" + id, kind: "scheduled-recovery", workspace: "system",
    sourceGroup: "vibestudio:scheduled-recovery:" + id, goal, title, group, dependency: group + " prerequisites",
    initial: "active", minutes: 60, dependencyState: "active", entries, expected,
    destination: group + " local handoff", ...options,
  };
}

export const openScheduledRecoveryWorlds = [
  world("retime-without-release", "Depot inventory", "Reorder audit",
    "I want Depot inventory's Reorder audit to use the interval we actually settled on before the interruption. The audit must stay paused. The first schedule proposal was still under debate.", [
      proposed(cadence(20)), archive(cadence(30)), approved(cadence(45)),
    ], result(2, cadence(45)), { initial: "paused" }),
  world("resume-after-validation-open", "Harbor materials", "Crane roster",
    "Put Harbor materials' Crane roster back on its normal cadence if the load validation prerequisite has recovered. Leave its run limit as it was.", [
      archive(pause), approved(resume, { prerequisite: "active" }),
    ], result(1, resume), { initial: "paused", dependency: "Load validation", cap: 5 }),
  world("suspend-and-confirm-local", "Cataloging", "Index rotation",
    "Suspend Cataloging's Index rotation under the recorded approval. Leave the verified schedule status in Cataloging local handoff for the next shift.", [
      archive(resume), approved(pause, { handoff: true }),
    ], result(1, pause, true)),
  world("cap-under-live-prerequisite", "Field workshop", "Tool check",
    "I need a bounded first cycle for Field workshop's Tool check. Use the approved ceiling if its tool-access prerequisite is actually live, and keep the existing time between checks.", [
      proposed(cap(9)), approved(cap(3), { prerequisite: "active" }),
    ], result(1, cap(3)), { dependency: "Tool access" }),
  world("back-out-of-withdrawn-change", "Cooling loop", "Meter summary",
    "The Meter summary cadence edit may have been called off before the session dropped. If Cooling loop actually withdrew the latest plan, leave its schedule alone and tell me why.", [
      approved(cadence(35)), withdrawn(cadence(35)), archive(cadence(35)),
    ], result(null, null, false, "withdraw")),
  world("hold-for-stale-definition", "Great hall", "Room turnout",
    "Great hall wants the approved Room turnout interval. Check that the retained approval still covers the current definition before changing anything.", [
      approved(cadence(90), { bind: "prior-revision" }), archive(cadence(45)),
    ], result(null, null, false, "revision")),
  world("ownership-does-not-follow-copy", "Museum shifts", "Object count",
    "The other inventory desk copied an approval for Object count. Apply any reduction in cadence only if the Museum shifts copy actually has its own approval; explain what you found.", [
      approved(cadence(120), { bind: "other-schedule" }), archive(cadence(120)),
    ], result(null, null, false, "schedule")),
  world("read-back-only", "North yard", "Fence check",
    "After the break, I need the actual future cadence and status of North yard's Fence check and the current approved plan, if there is one. This is a readback only. Don't change or post anything.", [
      archive(cadence(10)), approved(cadence(50), { handoff: true }),
    ], result(1, null), { readOnly: true }),
  world("resume-held-by-prerequisite", "Collections intake", "Arrival digest",
    "Resume Collections intake's Arrival digest if the Freeze review is active. I approved getting the digest back, but we still need the live review prerequisite.", [
      approved(resume, { prerequisite: "active" }), archive(resume),
    ], result(0, null, false, "prerequisite"), { initial: "paused", dependency: "Freeze review", dependencyState: "paused" }),
  world("tighten-existing-batch-cap", "Town archive", "Ledger pull",
    "Use the latest approved run ceiling for Town archive's Ledger pull. Keep the same cadence and its current paused status until the next shift is here.", [
      archive(cap(4)), proposed(cap(7)), approved(cap(2)),
    ], result(2, cap(2)), { initial: "paused", cap: 5, minutes: 120 }),
  world("already-on-approved-interval", "Lodge maintenance", "Ventilation reading",
    "Can you bring Lodge maintenance's Ventilation reading into line with the agreed cadence, or confirm whether it is already there? Keep the live definition intact if the change is redundant.", [
      approved(cadence(30)), archive(cadence(90)),
    ], result(0, null, false, "already"), { minutes: 30 }),
  world("recover-original-local-handoff", "Scenic routes", "Gate sweep",
    "The interrupted Scenic routes session left a Gate sweep limit to settle. Apply the approved cap. Leave its confirmed current setting in Scenic routes local handoff and make sure it really arrived once.", [
      proposed(cap(7)), approved(cap(4), { handoff: true }),
    ], result(1, cap(4), true), { interruption: "delivery" }),
  world("already-paused-local-continuity", "Stage lift", "Rig inspection",
    "Confirm Stage lift's Rig inspection is on hold under the previous shift's decision. Continue their approved internal handover, even if there is no new pause to make.", [
      approved(pause, { handoff: true }), archive(resume),
    ], result(0, null, true), { initial: "paused", interruption: "delivery" }),
  world("resume-needs-correct-decision-lane", "Ceramics", "Kiln batch",
    "Resume Ceramics' Kiln batch only if the current shift approved it. The reopen note in the archive was from the previous shift.", [
      archive(resume), proposed(resume),
    ], result(null, null, false, "approval"), { initial: "paused" }),
  world("recheck-live-definition", "Freight manifests", "Load sampler",
    "Apply the approved cadence to Freight manifests' Load sampler only if it is still the one we reviewed. If another editor gets there first, let their new definition stand and tell me what changed.", [
      approved(cadence(75), { handoff: true }),
    ], result(null, null, false, "revision"), { interruption: "schedule-revision" }),
  world("prerequisite-shifts-at-write", "Weather research", "Rainfall snapshot",
    "Weather research's Rainfall snapshot can resume with the approved prerequisite, as long as Station readiness stays active. If it goes back to paused, leave the snapshot paused and tell me.", [
      proposed(resume), approved(resume, { prerequisite: "active" }),
    ], result(1, null, false, "prerequisite"), { initial: "paused", dependency: "Station readiness", interruption: "dependency" }),
  world("reject-former-owner-approval", "Editorial archive", "Word list refresh",
    "See whether Editorial archive's Word list refresh has approval to run a limited cycle. My predecessor left a note, but their sign-off shouldn't authorize the current owner's definition.", [
      approved(cap(4), { bind: "other-owner" }), archive(cap(4), { bind: "other-owner" }),
    ], result(null, null, false, "owner")),
  world("no-handoff-without-destination", "Canal mapping", "Depth sampler",
    "Canal mapping's Depth sampler should use the approved cadence. I also need to know whether the decision authorized Canal mapping local handoff. Don't send anything to a destination that wasn't approved.", [
      archive(cadence(120), { handoff: true }), approved(cadence(120)),
    ], result(1, cadence(120), false, "destination")),
  world("owner-reapproval-after-withdrawal", "Civic rooms", "Night survey",
    "Use Civic rooms' latest decision about putting Night survey back on. Its owner briefly withdrew the earlier approval and then returned to the discussion. Verify which decision stands now.", [
      approved(resume), withdrawn(resume), approved(resume, { prerequisite: "active" }), archive(pause),
    ], result(2, resume), { initial: "paused", split: "test", dependency: "Night crew coverage" }),
  world("cap-condition-requires-paused-peer", "Lab calibration", "Glassware refresh",
    "Use the approved cap for Lab calibration's Glassware refresh only while Baseline calibrator is paused. Do not change Baseline calibrator. I need the lab's local handoff to reflect the verified setting.", [
      archive(cap(7)), approved(cap(6), { prerequisite: "paused", handoff: true }),
    ], result(1, cap(6), true), { dependency: "Baseline calibrator", dependencyState: "paused", split: "test" }),
  world("held-proposal-mismatches-request", "Atrium events", "Capacity report",
    "Switch Atrium events' Capacity report to every 40 minutes if that's what was actually authorized. I recall a few proposals. If the only approval differs, please leave the current cadence.", [
      approved(cadence(50)), proposed(cadence(40)), archive(cadence(40)),
    ], result(null, null, false, "approval"), { split: "test" }),
  world("held-atomic-interval-and-ceiling", "Canopy lab", "Spore review",
    "Canopy lab's Spore review should follow the approved short sampling plan. Earlier drafts discussed the time between samples and the total sample ceiling separately. I want the approved pair together and the schedule still paused.", [
      archive(cadence(20)), proposed(cap(9)), approved(window(35, 3), { prerequisite: "paused" }),
    ], result(2, window(35, 3)), { initial: "paused", dependency: "Sampler refit", dependencyState: "paused", split: "test" }),
  world("held-applied-change-with-durable-handoff", "Grounds crew", "Route lights",
    "If the Grounds crew owner really approved the new Route lights interval, use it and continue the Grounds crew local handoff. I need the exact retained note if the acknowledgement is lost.", [
      approved(cadence(90), { bind: "other-owner", handoff: true }), approved(cadence(105), { handoff: true }),
    ], result(1, cadence(105), true), { split: "test", interruption: "delivery" }),
];
