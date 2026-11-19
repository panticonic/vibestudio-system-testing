type Revision = {
  note: string;
  files: { path: string; text: string }[];
  indexed?: false;
};
type DecisionExpectation = {
  status: "verified" | "no-lead" | "missing-source" | "missing-field";
  quote?: string;
  line?: number;
};

export type MemoryWorld = {
  id: string;
  goal: string;
  field: string;
  target: number;
  revisions: Revision[];
  expected: DecisionExpectation;
  comparison?: {
    before: number;
    expected: DecisionExpectation;
    status: "changed" | "unchanged" | "unverified";
  };
};

export const decisionPath = "decision.md";
export function managedMemoryOperation(caseId: string) {
  const world = managedMemoryWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown managed verified memory case");
  return world.comparison ? "compareDecisionRevisions" : "recallDecision";
}
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

const verified = (quote: string, line = 1): DecisionExpectation => ({
  status: "verified",
  quote,
  line,
});

managedMemoryWorlds.push(
  {
    id: "compare-coverage-expansion",
    goal: "Compare the recorded coverage in the first and last approvals. Cite both exact revisions and preserve the original wording.",
    field: "Coverage",
    target: 2,
    revisions: [
      source("Approve pilot coverage", "Coverage: North district\n"),
      source(
        "Record an interim proposal",
        "Coverage: All districts (proposal)\n",
      ),
      source(
        "Approve extended coverage",
        "# Review\nCoverage: North and East districts\n",
      ),
    ],
    expected: verified("Coverage: North and East districts", 2),
    comparison: {
      before: 0,
      expected: verified("Coverage: North district"),
      status: "changed",
    },
  },
  {
    id: "compare-operating-window",
    goal: "Compare the two assigned service-window decisions. Use the named approvals even if a newer recall match is more recent.",
    field: "Service window",
    target: 1,
    revisions: [
      source(
        "Approve first service window",
        "Service window: 08:30 to 15:30 UTC\n",
      ),
      source(
        "Approve extended evening service",
        "Service window: 10:00 to 20:00 UTC\n",
      ),
      source("Schedule holiday staffing", "Service window: Monday only\n"),
    ],
    expected: verified("Service window: 10:00 to 20:00 UTC"),
    comparison: {
      before: 0,
      expected: verified("Service window: 08:30 to 15:30 UTC"),
      status: "changed",
    },
  },
  {
    id: "compare-custody-routing",
    goal: "Verify whether the custody destination changed between the two assigned decisions. Ignore any similarly named transfer field.",
    field: "Custody destination",
    target: 2,
    revisions: [
      source("Record receiving route", "Custody destination: Central desk\n"),
      source(
        "Record the reviewed handoff",
        "Transfer destination: Warehouse\nCustody destination: East desk\n",
      ),
      source(
        "Confirm the countersigned designation",
        "Transfer destination: Warehouse\nCustody destination: West desk\n",
      ),
    ],
    expected: verified("Custody destination: West desk", 2),
    comparison: {
      before: 1,
      expected: verified("Custody destination: East desk", 2),
      status: "changed",
    },
  },
  {
    id: "compare-restored-retention",
    goal: "Compare the approved retention value before the trial and at its rollback. Preserve separate evidence for both exact revisions.",
    field: "Retention ceiling",
    target: 2,
    revisions: [
      source("Initial retention approval", "Retention ceiling: 30 days\n"),
      source("Raise cap during the trial", "Retention ceiling: 90 days\n"),
      source(
        "Restore the initial cap",
        "# Rollback\nRetention ceiling: 30 days\n",
      ),
    ],
    expected: verified("Retention ceiling: 30 days", 2),
    comparison: {
      before: 0,
      expected: verified("Retention ceiling: 30 days"),
      status: "unchanged",
    },
  },
  {
    id: "compare-document-reformatted",
    goal: "Determine whether document reformatting changed the recorded intake group. Cite the original line from each version.",
    field: "Intake group",
    target: 1,
    revisions: [
      source(
        "Publish markdown list",
        "# Intake\nIntake group: Review operators\n",
      ),
      source(
        "Reformat the decision card",
        "# Decisions\n\nIntake group:\tReview operators\n",
      ),
    ],
    expected: verified("Intake group:\tReview operators", 3),
    comparison: {
      before: 0,
      expected: verified("Intake group: Review operators", 2),
      status: "unchanged",
    },
  },
  {
    id: "compare-independent-appendix-change",
    goal: "Compare exactly the assigned publication title before and after an unrelated report update.",
    field: "Publication title",
    target: 1,
    revisions: [
      source(
        "Approve the publication title",
        "Publication title: Winter archive\nOwner: Jo\n",
      ),
      source(
        "Record operator reassignment",
        "Publication title: Winter archive\nOwner: Nia\n",
      ),
    ],
    expected: verified("Publication title: Winter archive"),
    comparison: {
      before: 0,
      expected: verified("Publication title: Winter archive"),
      status: "unchanged",
    },
  },
  {
    id: "compare-review-file-removed",
    goal: "Check whether the second revision supersedes the first review quorum with a recorded new value. Preserve the first citation if the later file is unavailable.",
    field: "Review quorum",
    target: 1,
    revisions: [
      source("Record the initial quorum", "Review quorum: two reviewers\n"),
      removed("Remove the quorum source file"),
    ],
    expected: { status: "missing-source" },
    comparison: {
      before: 0,
      expected: verified("Review quorum: two reviewers"),
      status: "unverified",
    },
  },
  {
    id: "compare-route-restored-without-baseline",
    goal: "Compare the routing code between the retired revision and its restoration. Keep any missing endpoint explicit.",
    field: "Routing code",
    target: 2,
    revisions: [
      source("Initial routing approval", "Routing code: SP-18\n"),
      removed("Retire the routing record"),
      source("Restore the routing record", "Routing code: SP-24\n"),
    ],
    expected: verified("Routing code: SP-24"),
    comparison: {
      before: 1,
      expected: { status: "missing-source" },
      status: "unverified",
    },
  },
  {
    id: "compare-unindexed-amendment",
    goal: "Check whether the appointed coordinator changed at the assigned amendment. Preserve the original verified decision if recall does not locate the amendment.",
    field: "Coordinator",
    target: 1,
    revisions: [
      source("Record the original coordinator", "Coordinator: Jordan\n"),
      {
        ...source("Amend the coordinator listing", "Coordinator: Morgan\n"),
        indexed: false,
      },
    ],
    expected: { status: "no-lead" },
    comparison: {
      before: 0,
      expected: verified("Coordinator: Jordan"),
      status: "unverified",
    },
  },
  {
    id: "compare-unindexed-baseline",
    goal: "Verify the baseline and final cutoffs at their exact revisions. Report any missing baseline while preserving the final citation.",
    field: "Cutoff",
    target: 2,
    revisions: [
      {
        ...source("Approve the initial cutoff", "Cutoff: Wednesday\n"),
        indexed: false,
      },
      source("Discuss a temporary cutoff", "Cutoff: Thursday\n"),
      source("Approve the final cutoff", "Cutoff: Friday\n"),
    ],
    expected: verified("Cutoff: Friday"),
    comparison: {
      before: 0,
      expected: { status: "no-lead" },
      status: "unverified",
    },
  },
  {
    id: "compare-conflicting-approval",
    goal: "Compare the approved names across both revisions. If the amended record contains incompatible approvals, keep the comparison unresolved.",
    field: "Approver",
    target: 1,
    revisions: [
      source("Publish the original approval", "Approver: archives lead\n"),
      source(
        "Import competing approval entries",
        "Approver: operations lead\nApprover: intake manager\n",
      ),
    ],
    expected: { status: "missing-field" },
    comparison: {
      before: 0,
      expected: verified("Approver: archives lead"),
      status: "unverified",
    },
  },
  {
    id: "compare-blank-baseline-value",
    goal: "Compare the assigned transfer window across the two records. A blank earlier field and an alternate window do not supply a baseline.",
    field: "Transfer window",
    target: 1,
    revisions: [
      source(
        "Prepare the transfer record",
        "Transfer window:   \nAlternate transfer window: 07:00\n",
      ),
      source("Approve the actual transfer", "Transfer window: 12:00 UTC\n"),
    ],
    expected: verified("Transfer window: 12:00 UTC"),
    comparison: {
      before: 0,
      expected: { status: "missing-field" },
      status: "unverified",
    },
  },
);
