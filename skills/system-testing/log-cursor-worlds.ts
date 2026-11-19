export const managedLogCursorWorlds = [
  {
    id: "resume-one-repeated-failure",
    goal: "Resume the saved host-log cursor. Brief me on the repeated failed index write and preserve the exact boot and sequence bounds.",
    kind: "review-window",
    limit: 6,
    lines: [
      "Index write failed because its temporary directory is unavailable.",
      "Index write failed because its temporary directory is unavailable.",
    ],
  },
  {
    id: "hold-previous-boot-cursor",
    goal: "Determine whether the saved sequence belongs to this host boot before reading any new log records.",
    kind: "reset-for-new-boot",
    limit: 6,
    lines: ["Workspace background refresh completed."],
  },
  {
    id: "hold-overflowed-window",
    goal: "Check whether one record is enough to cover this saved log window. Preserve the cursor if the selected filter has more matches.",
    kind: "narrow-window",
    limit: 1,
    lines: ["First assigned index warning.", "Second assigned import warning."],
  },
] as const;
