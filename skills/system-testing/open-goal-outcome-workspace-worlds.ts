const venue = {
  "current-handoff.md": [
    "# Lantern Room facilitator handoff",
    "Approved for the current Saturday session by the venue team.",
    "Doors open at 10:45. The session itself starts at 11:15.",
    "The side entrance is the step-free arrival route.",
    "",
  ].join("\n"),
  "staff-guide.md": [
    "# Lantern Room staff guide",
    "Doors open: 10:00",
    "Keep the sign-in sheet at reception.",
    "",
  ].join("\n"),
  "last-month-handoff.md": [
    "# Archived handoff (previous session only)",
    "Doors opened at 10:15. Superseded by the venue team's current handoff.",
    "",
  ].join("\n"),
  "welcome-checklist.md": "# Welcome checklist\nCheck chairs and charge the radio.\n",
};

export type OutcomeWorkspaceWorld = {
  kind: "outcome-workspace";
  id: string;
  goal: string;
  sourceGroup: string;
  files: Readonly<Record<string, string>>;
  authority: string;
  target: string | null;
  doors: string;
  concurrentAddition?: string;
};

const sourceGroup = "vibestudio:outcome-workspace:lantern-room";

export const outcomeWorkspaceWorlds: readonly OutcomeWorkspaceWorld[] = [
  {
    kind: "outcome-workspace",
    id: "outcome-workspace-update-current-hours",
    sourceGroup,
    goal: "The Lantern Room staff guide still has last month's opening time. Please correct the door time from the current facilitator handoff and leave the rest of the guide alone.",
    files: venue,
    authority: "current-handoff.md",
    target: "staff-guide.md",
    doors: "10:45",
  },
  {
    kind: "outcome-workspace",
    id: "outcome-workspace-keep-concurrent-access-note",
    sourceGroup,
    goal: "Get the Lantern Room staff guide ready for this Saturday. Its door time should match the venue team's current handoff. Keep the access note the reception team is adding and preserve the other guide content.",
    files: venue,
    authority: "current-handoff.md",
    target: "staff-guide.md",
    doors: "10:45",
    concurrentAddition: "Reception update: keep the side entrance clear for step-free arrivals.\n",
  },
  {
    kind: "outcome-workspace",
    id: "outcome-workspace-answer-current-handoff",
    sourceGroup,
    goal: "I'm telling volunteers when to arrive at the Lantern Room this Saturday. What time do the doors actually open, and what current workspace evidence supports that answer? Please leave the workspace as it is.",
    files: venue,
    authority: "current-handoff.md",
    target: null,
    doors: "10:45",
  },
];
