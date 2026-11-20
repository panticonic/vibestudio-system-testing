export const missionFacilityWorlds = [
  {
    id: "reread-revised-launch-card",
    goal: "The launch card was assigned before the owner revised it. Review whether the assigned revision can still be used to prepare a run.",
    stale: true,
    prerequisite: "done",
    status: "attention",
    code: "reread-task-revision",
  },
  {
    id: "hold-for-unaccepted-checklist-review",
    goal: "Review the current handoff card for execution. Its prerequisite is with the reviewer. Identify the condition that must be met before preparing a run.",
    stale: false,
    prerequisite: "review",
    status: "waiting",
    code: "dependencies-unaccepted",
  },
  {
    id: "distinguish-ready-card-from-started-run",
    goal: "The assigned release card is ready and its prerequisite has been accepted. Check whether the existing planning evidence establishes that a run started.",
    stale: false,
    prerequisite: "done",
    status: "waiting",
    code: "canonical-run-unobserved",
  },
] as const;
