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
    groups: [{ first: 0, last: 1, count: 2, class: "failure" }],
  },
  {
    id: "resume-mixed-severity-window",
    goal: "Review the assigned host-log window after the indexing incident. Distinguish routine startup, a slow operation and the failed write. Report only noteworthy groups, retaining their original sequence ranges, and advance the saved cursor only through the inspected window.",
    kind: "review-window",
    limit: 6,
    lines: [
      "Workspace service started and is ready.",
      "Index compaction exceeded its latency budget and kept running.",
      "Index write failed because its temporary directory is unavailable.",
      "Index compaction exceeded its latency budget and kept running.",
    ],
    groups: [
      { first: 0, last: 0, count: 1, class: "routine" },
      { first: 1, last: 3, count: 2, class: "notable" },
      { first: 2, last: 2, count: 1, class: "failure" },
    ],
  },
  {
    id: "advance-after-healthy-window",
    goal: "Check whether the assigned host-log window contains anything that needs attention. Retain the boot and sequence bounds when handing off the cursor after the review.",
    kind: "review-window",
    limit: 6,
    lines: [
      "Workspace service started and is ready.",
      "Gateway is listening for workspace requests.",
    ],
    groups: [
      { first: 0, last: 0, count: 1, class: "routine" },
      { first: 1, last: 1, count: 1, class: "routine" },
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
