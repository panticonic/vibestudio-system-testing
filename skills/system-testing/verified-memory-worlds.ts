type Revision = {
  note: string;
  files: { path: string; text: string }[];
  indexed?: false;
};
export type MemoryWorld = {
  id: string;
  goal: string;
  field: string;
  target: number;
  revisions: Revision[];
  expected: {
    status: "verified" | "no-lead" | "missing-source" | "missing-field";
    quote?: string;
    line?: number;
  };
};

export const decisionPath = "decision.md";
const source = (note: string, text: string): Revision => ({
  note,
  files: [{ path: decisionPath, text }],
});
const removed = (note: string): Revision => ({
  note,
  files: [{ path: "README.md", text: "No active decision file.\n" }],
});

export const managedMemoryWorlds: MemoryWorld[] = [
  {
    id: "latest-policy",
    goal: "Verify the active intake limit at the assigned revision. Older recall matches may mention a different value.",
    field: "Intake limit",
    target: 1,
    revisions: [
      source("Initial limit", "# Intake\nIntake limit: 8 files\n"),
      source("Revise the intake limit", "# Intake\nIntake limit: 5 files\n"),
    ],
    expected: { status: "verified", quote: "Intake limit: 5 files", line: 2 },
  },
  {
    id: "prior-window",
    goal: "Verify the historical intake window at the assigned older revision after the handbook changed.",
    field: "Intake window",
    target: 0,
    revisions: [
      source("First available window", "Intake window: Monday morning\n"),
      source("Move the appointment", "Intake window: Thursday afternoon\n"),
    ],
    expected: {
      status: "verified",
      quote: "Intake window: Monday morning",
      line: 1,
    },
  },
  {
    id: "removed-file",
    goal: "Determine whether the original renewal target is still recorded in the assigned revision after removal.",
    field: "Renewal target",
    target: 1,
    revisions: [
      source("Original renewal target", "Renewal target: 18 November\n"),
      removed("Retire source file"),
    ],
    expected: { status: "missing-source" },
  },
  {
    id: "decoy-file",
    goal: "Find the escalation window in the assigned decision file after the repository reorganized.",
    field: "Escalation window",
    target: 1,
    revisions: [
      source("Original escalation log", "Escalation window: 48 hours\n"),
      {
        note: "Archive the decision and add an unrelated draft",
        files: [{ path: "notes.md", text: "Escalation window: 12 hours\n" }],
      },
    ],
    expected: { status: "missing-source" },
  },
  {
    id: "missing-field",
    goal: "Check the assigned decision for its handoff contact. A similarly named backup does not answer it.",
    field: "Handoff contact",
    target: 1,
    revisions: [
      source("Create the handoff decision", "Handoff contact: North desk\n"),
      source(
        "Keep only the backup route",
        "Backup handoff contact: West desk\n",
      ),
    ],
    expected: { status: "missing-field" },
  },
  {
    id: "conflicting-field",
    goal: "Verify the handoff owner only if the assigned file records exactly one value.",
    field: "Handoff owner",
    target: 0,
    revisions: [
      source(
        "Combine unresolved ownership notes",
        "Handoff owner: Mira\nHandoff owner: Jules\n",
      ),
    ],
    expected: { status: "missing-field" },
  },
  {
    id: "older-hit-only",
    goal: "Look up the requested decision at the assigned revision. A hit at another revision does not answer it.",
    field: "Pickup day",
    target: 1,
    revisions: [
      source("Publish pickup notice", "Pickup day: Tuesday\n"),
      {
        ...source("Replace the local notice", "Pickup day: Wednesday\n"),
        indexed: false,
      },
    ],
    expected: { status: "no-lead" },
  },
  {
    id: "restored-decision",
    goal: "Verify the decision as restored in the final revision after the source was removed and recreated.",
    field: "Workshop cap",
    target: 2,
    revisions: [
      source("Initial cap", "# Training\nWorkshop cap: 9\n"),
      removed("Retire the temporary cap"),
      source("Restore the reviewed cap", "# Training\n\nWorkshop cap: 15\n"),
    ],
    expected: { status: "verified", quote: "Workshop cap: 15", line: 3 },
  },
];
