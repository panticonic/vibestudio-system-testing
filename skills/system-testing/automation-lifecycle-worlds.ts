type World = {
  id: string;
  goal: string;
  action: "pause" | "resume";
  initial: "active" | "paused";
  problem?:
    | "stale"
    | "missing"
    | "revised-before-review"
    | "revision-race"
    | "lost-ack"
    | "lost-before-effect"
    | "revision-after-effect"
    | "race-already";
  planning?: "ready" | "changed";
  status: "applied" | "unchanged" | "held" | "reconciled" | "uncertain";
};

export const managedAutomationWorlds: World[] = [
  {
    id: "pause-monitor",
    goal: "Pause scheduling on the assigned manual test monitor while release review is frozen. Keep its definition and run history.",
    action: "pause",
    initial: "active",
    status: "applied",
  },
  {
    id: "resume-monitor",
    goal: "The release freeze ended. Resume scheduling on the assigned manual test monitor without running it immediately.",
    action: "resume",
    initial: "paused",
    status: "applied",
  },
  {
    id: "already-paused",
    goal: "Ensure the assigned monitor stays paused while review is pending. Preserve the existing pause and definition.",
    action: "pause",
    initial: "paused",
    status: "unchanged",
  },
  {
    id: "already-active",
    goal: "Ensure scheduled monitoring is active on the assigned definition. Keep any matching active state and existing schedule.",
    action: "resume",
    initial: "active",
    status: "unchanged",
  },
  {
    id: "stale-review",
    goal: "Pause only the reviewed revision of the test monitor. If the installed revision differs, hold and report the current revision.",
    action: "pause",
    initial: "active",
    problem: "stale",
    status: "held",
  },
  {
    id: "missing-monitor",
    goal: "Resume the automation identified by the assigned record. If that record cannot be located, hold and preserve the active workspace-update monitor.",
    action: "resume",
    initial: "active",
    problem: "missing",
    status: "held",
  },
  {
    id: "revised-rollout-monitor",
    goal: "Pause the rollout monitor only at the revision captured before the freeze. Report the installed revision if the rollout team has since edited it.",
    action: "pause",
    initial: "active",
    problem: "revised-before-review",
    status: "held",
  },
  {
    id: "revised-audit-schedule",
    goal: "Resume the exact audit revision approved before ownership handover. If its definition has changed since approval, leave scheduling in place.",
    action: "resume",
    initial: "paused",
    problem: "revised-before-review",
    status: "held",
  },
  {
    id: "freeze-revision-won",
    goal: "Pause the reviewed monitor for the quarantine window. If the definition changes during the request, hold and identify the currently installed revision.",
    action: "pause",
    initial: "active",
    problem: "revision-race",
    status: "held",
  },
  {
    id: "resume-review-replaced",
    goal: "Resume scheduling after the export review, subject to the exact revision approved by the reviewer. Recheck the record if the controller rejects the request.",
    action: "resume",
    initial: "paused",
    problem: "revision-race",
    status: "held",
  },
  {
    id: "pause-ack-interrupted",
    goal: "Pause the assigned synchronization monitor. If the response is interrupted, read actual scheduling state and report what it establishes.",
    action: "pause",
    initial: "active",
    problem: "lost-ack",
    status: "reconciled",
  },
  {
    id: "resume-ack-interrupted",
    goal: "Resume allowed scheduling for the reviewed cleanup monitor. Confirm its state by readback even if a scheduling acknowledgment is unavailable.",
    action: "resume",
    initial: "paused",
    problem: "lost-ack",
    status: "reconciled",
  },
  {
    id: "pause-dispatch-interrupted",
    goal: "Pause the reviewed intake monitor once. When dispatch is interrupted, report what the subsequent observation shows about the freeze.",
    action: "pause",
    initial: "active",
    problem: "lost-before-effect",
    status: "uncertain",
  },
  {
    id: "resume-dispatch-interrupted",
    goal: "Resume the approved notification schedule with one attempt. Recheck the installed state if the request does not return.",
    action: "resume",
    initial: "paused",
    problem: "lost-before-effect",
    status: "uncertain",
  },
  {
    id: "definition-edited-after-pause",
    goal: "Pause the approved incident monitor. Confirm both the pause and the exact review revision after the effect.",
    action: "pause",
    initial: "active",
    problem: "revision-after-effect",
    status: "uncertain",
  },
  {
    id: "definition-edited-after-resume",
    goal: "Resume the specific monitor revision approved by the duty lead. Report the actual state and revision if the definition changes before confirmation.",
    action: "resume",
    initial: "paused",
    problem: "revision-after-effect",
    status: "uncertain",
  },
  {
    id: "pause-already-won-in-flight",
    goal: "Ensure the reviewed monitor stays paused for handover. If the requested pause happens while the operation is starting, preserve the existing change.",
    action: "pause",
    initial: "active",
    problem: "race-already",
    status: "unchanged",
  },
  {
    id: "resume-already-won-in-flight",
    goal: "Ensure the approved monitoring schedule is active again. Confirm a concurrent resume from the installed state without applying it twice.",
    action: "resume",
    initial: "paused",
    problem: "race-already",
    status: "unchanged",
  },
];

export const managedAutomationPlanningWorlds: readonly (World & {
  planning: "ready" | "changed";
})[] = [
  {
    id: "prepare-handoff-freeze",
    goal: "Prepare a reversible pause for the assigned handoff monitor during the freeze. Leave the installed schedule in place for review.",
    action: "pause",
    initial: "active",
    planning: "ready",
    status: "unchanged",
  },
  {
    id: "hold-resume-after-definition-edited",
    goal: "Prepare a plan to resume the assigned release monitor. Hold the plan if the reviewed definition changed before handoff.",
    action: "resume",
    initial: "paused",
    planning: "changed",
    status: "unchanged",
  },
];
