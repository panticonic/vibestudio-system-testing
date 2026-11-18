type World = {
  id: string;
  goal: string;
  action: "pause" | "resume";
  initial: "active" | "paused";
  problem?: "stale" | "missing";
  status: "applied" | "unchanged" | "held";
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
];
