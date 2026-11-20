export const spectrolitePanel = "panels/spectrolite";
export const spectroliteVault = "projects/default";
export const spectroliteHandoffWork = [
  { kind: "domain", domain: "spectrolite", operation: "reviewSpectrolite" },
  { kind: "domain", domain: "spectrolite", operation: "planVaultHandoff" },
] as const;
type ReviewCheck =
  | "document"
  | "preview"
  | "navigation"
  | "revision"
  | "publication";
type Expected =
  | "document-ready"
  | "broken-link"
  | "preview-ready"
  | "preview-missing"
  | "render-error"
  | "navigation-ready"
  | "draft-changed"
  | "revision-unchanged"
  | "working-copy-dirty";

function note(heading: string, body: string) {
  return `---\ntitle: ${heading}\n---\n\n# ${heading}\n\n${body}\n`;
}

type Follow = {
  path: string;
  target: string;
  heading: string;
  destination: string;
};
type Options = {
  handoff?: "committed-review" | "draft-only" | "hold";
  links?: Record<string, string>;
  follow?: Follow[];
  previewText?: string;
  requiredText?: string[];
  draft?: {
    edits: Record<string, string>;
    committedTitle: string;
    staleText: string | null;
    visibleText?: string;
  };
};
function scenario(
  id: string,
  goal: string,
  path: string,
  heading: string,
  body: string,
  requested: [ReviewCheck, Expected][],
  options: Options = {},
) {
  return {
    id,
    goal,
    path,
    heading,
    files: { ...options.links, [path]: note(heading, body) },
    checks: requested.map(([check]) => check),
    expected: requested.map(([, expected]) => expected),
    requiredText: options.requiredText ?? [path],
    previewText: options.previewText ?? null,
    follow: options.follow,
    draft: options.draft,
    handoff: options.handoff,
  };
}

const callout = (text: string) =>
  `<Callout color="blue"><Callout.Text>${text}</Callout.Text></Callout>`;
export const managedSpectroliteWorlds = [
  scenario(
    "release-handoff",
    "Verify the release handoff links to the checked decision record and the inline next action renders.",
    "Release Handoff.mdx",
    "Release handoff desk",
    `The approval rationale is in [[Release Decisions]].\n\n${callout("Confirm the rollback owner before the handoff.")}`,
    [
      ["document", "document-ready"],
      ["preview", "preview-ready"],
    ],
    {
      previewText: "Confirm the rollback owner before the handoff.",
      links: {
        "release/Release Decisions.mdx": note(
          "Release decision history",
          "Approved after a rollback drill.",
        ),
      },
    },
  ),
  scenario(
    "retired-runbook",
    "Flag the retired runbook reference while independently confirming the warning still renders.",
    "Retired Runbook.mdx",
    "Runbook retirement evidence",
    `Do not use [[Obsolete Rollback]].\n\n${callout("Use the owner escalation route.")}`,
    [
      ["document", "broken-link"],
      ["preview", "preview-ready"],
    ],
    {
      previewText: "Use the owner escalation route.",
      requiredText: ["Obsolete Rollback"],
    },
  ),
  scenario(
    "small-plain-brief",
    "Review the plain-text brief and establish whether there is an actual inline component preview.",
    "Project Brief.mdx",
    "Ferry reroute brief",
    "The quay reopens after inspection. Keep the alternate route until then.",
    [
      ["document", "document-ready"],
      ["preview", "preview-missing"],
    ],
  ),
  scenario(
    "literal-reference",
    "Distinguish the reference example inside the code block from an actionable wikilink.",
    "Syntax Guide.mdx",
    "Literal reference syntax",
    "Illustration only.\n\n```text\n[[Not A Live Target]]\n```",
    [["document", "document-ready"]],
  ),
  scenario(
    "missing-cross-references",
    "Identify both missing references before the change review.",
    "Change Review.mdx",
    "Missing review evidence",
    "Check [[Previous Protocol]] against [[Updated Appendix]].",
    [["document", "broken-link"]],
    { requiredText: ["Previous Protocol", "Updated Appendix"] },
  ),
  scenario(
    "forked-runbooks",
    "Resolve the deliberately qualified rollout link and review the document.",
    "Operations Index.mdx",
    "Operations index for day and night",
    "Night shift starts with [[night/Runbook]].",
    [["document", "document-ready"]],
    {
      links: {
        "day/Runbook.mdx": note(
          "Day shift runbook",
          "Dispatch through the east office.",
        ),
        "night/Runbook.mdx": note(
          "Night shift runbook",
          "Dispatch through the north office.",
        ),
      },
    },
  ),
  scenario(
    "read-linked-decision",
    "Follow the review index link to the actual decision, then verify the selected document and its preview.",
    "Published Decision.mdx",
    "Window extension approved",
    callout("Record the extension in the handoff."),
    [
      ["document", "document-ready"],
      ["preview", "preview-ready"],
    ],
    {
      previewText: "Record the extension in the handoff.",
      follow: [
        {
          path: "Review Index.mdx",
          target: "Published Decision",
          heading: "Review index for approvals",
          destination: "Published Decision.mdx",
        },
      ],
      links: {
        "Review Index.mdx": note(
          "Review index for approvals",
          "Open [[Published Decision]] for the outcome.",
        ),
      },
    },
  ),
  scenario(
    "preview-first",
    "Check the displayed action first, then verify the related revision citation remains an unresolved link.",
    "Maintenance Shift.mdx",
    "Maintenance shift restart",
    `${callout("Observe service recovery before closing.")}\n\nMissing event: [[Latest Service Audit]].`,
    [
      ["preview", "preview-ready"],
      ["document", "broken-link"],
    ],
    {
      previewText: "Observe service recovery before closing.",
      requiredText: ["Latest Service Audit"],
    },
  ),
  scenario(
    "reference-only-editor",
    "Use the current editor to review a note whose only link has a real target, with no live widget expected.",
    "Review Charter.mdx",
    "Editor review charter",
    "Keep [[Risk Register]] open throughout the decision.",
    [
      ["preview", "preview-missing"],
      ["document", "document-ready"],
    ],
    {
      links: {
        "governance/Risk Register.mdx": note(
          "Canonical risk register",
          "Retain the current evidence set.",
        ),
      },
    },
  ),
  scenario(
    "second-hop-missing",
    "Follow the index into the right report and identify the missing source asked for inside it.",
    "Water Survey.mdx",
    "North quay water survey",
    "Compare the stated outcome to [[Last Sampling Log]].",
    [["document", "broken-link"]],
    {
      requiredText: ["Last Sampling Log"],
      follow: [
        {
          path: "Survey Index.mdx",
          target: "Water Survey",
          heading: "Survey review index",
          destination: "Water Survey.mdx",
        },
      ],
      links: {
        "Survey Index.mdx": note(
          "Survey review index",
          "Read [[Water Survey]] before allocating a crew.",
        ),
      },
    },
  ),
];

type RouteNote = [path: string, heading: string, nextLink: string];
function trail(
  id: string,
  goal: string,
  route: RouteNote[],
  final: [path: string, heading: string, body: string],
  requested: [ReviewCheck, Expected][],
  options: Options = {},
) {
  return scenario(id, goal, ...final, requested, {
    ...options,
    follow: route.map(([path, heading, target], index) => ({
      path,
      heading,
      target,
      destination: route[index + 1]?.[0] ?? final[0],
    })),
    links: {
      ...options.links,
      ...Object.fromEntries(
        route.map(([path, heading, target]) => [
          path,
          note(
            heading,
            `Continue to [[${target}]] for the next reviewed note.`,
          ),
        ]),
      ),
    },
  });
}
const navigation = ["navigation", "navigation-ready"] satisfies [
  ReviewCheck,
  Expected,
];
const documentReady = ["document", "document-ready"] satisfies [
  ReviewCheck,
  Expected,
];
const previewReady = ["preview", "preview-ready"] satisfies [
  ReviewCheck,
  Expected,
];
const previewMissing = ["preview", "preview-missing"] satisfies [
  ReviewCheck,
  Expected,
];
const brokenLink = ["document", "broken-link"] satisfies [
  ReviewCheck,
  Expected,
];

managedSpectroliteWorlds.push(
  trail(
    "dispatch-approval-route",
    "Trace the dispatch decision through the release and approval indexes, then check the action in its preview.",
    [
      ["Dispatch Desk.mdx", "Dispatch desk entry", "release/Approval Index"],
      [
        "release/Approval Index.mdx",
        "Release approval index",
        "release/Confirmed Dispatch",
      ],
    ],
    [
      "release/Confirmed Dispatch.mdx",
      "Confirmed dispatch window",
      callout("Confirm the dispatcher at 08:00."),
    ],
    [navigation, previewReady, documentReady],
    { previewText: "Confirm the dispatcher at 08:00." },
  ),
  trail(
    "intake-routing-qualified",
    "Follow the night intake branch and verify the qualified route rather than the day runbook.",
    [
      ["Intake Routing.mdx", "Intake routes index", "night/Runbook"],
      ["night/Runbook.mdx", "Night branch procedure", "night/Gate"],
    ],
    [
      "night/Gate.mdx",
      "Night gate decision",
      "The night desk opens only after the facilities check.",
    ],
    [navigation, documentReady],
    {
      links: {
        "day/Runbook.mdx": note("Day branch decoy", "Use the morning queue."),
      },
    },
  ),
  trail(
    "maintenance-final-receipt-missing",
    "Follow the maintenance handoff to its final record. Separate the verified route from the missing completion receipt.",
    [
      ["Maintenance Desk.mdx", "Maintenance desk index", "Service Window"],
      ["Service Window.mdx", "Maintenance window handoff", "Restart Result"],
    ],
    [
      "Restart Result.mdx",
      "Restart result awaiting receipt",
      "Completion is recorded in [[Restart Receipt]].",
    ],
    [navigation, brokenLink],
    { requiredText: ["Restart Receipt"] },
  ),
  trail(
    "survey-two-missing-sources",
    "Find the survey outcome through the owned notes and identify both unresolved references in the final editor.",
    [
      ["Survey Desk.mdx", "Survey desk index", "survey/Sampling Index"],
      [
        "survey/Sampling Index.mdx",
        "Sampling evidence list",
        "survey/Findings",
      ],
    ],
    [
      "survey/Findings.mdx",
      "Survey findings for field review",
      "Compare [[First Sample Archive]] and [[Later Sample Archive]].",
    ],
    [brokenLink, navigation],
    { requiredText: ["First Sample Archive", "Later Sample Archive"] },
  ),
  trail(
    "archive-policy-plain",
    "Trace the archive policy to its issued copy, then verify whether the plain document includes any component preview.",
    [
      [
        "Records Desk.mdx",
        "Records desk starting note",
        "policy/Archive Index",
      ],
      [
        "policy/Archive Index.mdx",
        "Archive policy index",
        "policy/Issued Copy",
      ],
    ],
    [
      "policy/Issued Copy.mdx",
      "Issued archive policy",
      "Hold the evidence pack for annual review.",
    ],
    [navigation, previewMissing, documentReady],
  ),
  trail(
    "inline-cutoff-and-stale-pointer",
    "Find the active enrollment note. Check the rendered cutoff even if its linked approval record is missing.",
    [
      ["Enrollment Desk.mdx", "Enrollment desk index", "Enrollment Review"],
      ["Enrollment Review.mdx", "Enrollment review route", "Active Cutoff"],
    ],
    [
      "Active Cutoff.mdx",
      "Active enrollment cutoff",
      `${callout("Close applications at 17:00 UTC.")}\n\nSee [[Approval Bundle]].`,
    ],
    [previewReady, navigation, brokenLink],
    {
      previewText: "Close applications at 17:00 UTC.",
      requiredText: ["Approval Bundle"],
    },
  ),
  trail(
    "editor-example-is-literal",
    "Trace the syntax example to its canonical note and distinguish a literal token in a code fence from a broken wiki link.",
    [
      ["Conventions Desk.mdx", "Conventions desk index", "Author Guide"],
      ["Author Guide.mdx", "Author guide index", "Link Example"],
    ],
    [
      "Link Example.mdx",
      "Literal link example",
      "Do not execute this example.\n\n```text\n[[An Unresolvable Sample]]\n```",
    ],
    [documentReady, navigation, previewMissing],
  ),
  trail(
    "three-hop-incident-brief",
    "Follow all three hops from the response desk to the approved recovery note, then verify its rendered action.",
    [
      [
        "Response Desk.mdx",
        "Response desk starting point",
        "Incident Register",
      ],
      ["Incident Register.mdx", "Incident register index", "Recovery Review"],
      ["Recovery Review.mdx", "Recovery review signoff", "Approved Recovery"],
    ],
    [
      "Approved Recovery.mdx",
      "Approved service recovery",
      callout("Verify the standby queue before resuming intake."),
    ],
    [navigation, previewReady],
    { previewText: "Verify the standby queue before resuming intake." },
  ),
  trail(
    "three-hop-reconciliation-hold",
    "Follow the full reconciliation route before identifying the unresolved signoff in the selected outcome.",
    [
      ["Reconciliation Desk.mdx", "Reconciliation desk index", "Ledger Review"],
      ["Ledger Review.mdx", "Ledger review index", "Candidate Report"],
      [
        "Candidate Report.mdx",
        "Candidate report route",
        "Final Reconciliation",
      ],
    ],
    [
      "Final Reconciliation.mdx",
      "Final reconciliation note",
      "Await [[Signed Reconciliation]].",
    ],
    [navigation, brokenLink],
    { requiredText: ["Signed Reconciliation"] },
  ),
  trail(
    "qualified-partner-notes",
    "Follow the deliberately qualified partner briefing route and check its resolved reference to next steps.",
    [
      ["Audience Desk.mdx", "Audience desk routes", "partners/Briefing"],
      [
        "partners/Briefing.mdx",
        "Partner briefing branch",
        "partners/Next Steps",
      ],
    ],
    [
      "partners/Next Steps.mdx",
      "Partner next-steps note",
      "The partner readiness conditions are in [[partners/Checklist]].",
    ],
    [documentReady, navigation],
    {
      links: {
        "team/Briefing.mdx": note(
          "Internal briefing decoy",
          "For the internal team.",
        ),
        "partners/Checklist.mdx": note(
          "Partner checklist record",
          "Check access to the planning room.",
        ),
      },
    },
  ),
  trail(
    "physical-handoff-owner-card",
    "Trace the custody handoff through the current review notes and verify the owner shown in the handoff card.",
    [
      [
        "Custody Desk.mdx",
        "Custody desk initial routes",
        "Custody Authorizations",
      ],
      [
        "Custody Authorizations.mdx",
        "Custody authorizations index",
        "Transfer Owner",
      ],
    ],
    [
      "Transfer Owner.mdx",
      "Current custody transfer owner",
      callout("The receiving desk signs the handoff."),
    ],
    [previewReady, navigation],
    { previewText: "The receiving desk signs the handoff." },
  ),
  trail(
    "exact-extension-route",
    "Follow the references that spell out the MDX extension, then check the selected review note.",
    [
      ["Revision Desk.mdx", "Revision desk entry", "Draft Ledger.mdx"],
      [
        "Draft Ledger.mdx",
        "Draft ledger starting review",
        "Published Ledger.mdx",
      ],
    ],
    [
      "Published Ledger.mdx",
      "Published ledger decision",
      "The archived draft is informational.",
    ],
    [navigation, documentReady, previewMissing],
  ),
  trail(
    "nearest-canonical-doc",
    "Verify the unresolved-reference report through the canonical short target rather than the archived note with the same name.",
    [
      ["Vault Desk.mdx", "Vault audit starting note", "Audit Ledger"],
      ["Audit Ledger.mdx", "Canonical short audit ledger", "Unresolved Files"],
    ],
    [
      "Unresolved Files.mdx",
      "Unresolved attachment report",
      "Still waiting on [[Archive Seal]].",
    ],
    [navigation, brokenLink],
    {
      links: {
        "archive/Audit Ledger.mdx": note(
          "Long archived ledger decoy",
          "Legacy notes only.",
        ),
      },
      requiredText: ["Archive Seal"],
    },
  ),
  trail(
    "intake-three-hop-with-sources",
    "Check the full referral route and the resolved source named at the final decision.",
    [
      ["Referral Desk.mdx", "Referral desk starting note", "Intake Rules"],
      ["Intake Rules.mdx", "Intake routing rulebook", "Review Queue"],
      ["Review Queue.mdx", "Review queue notes", "Referral Decision"],
    ],
    [
      "Referral Decision.mdx",
      "Approved referral decision",
      "Use [[Referral Checklist]] at the desk.",
    ],
    [navigation, documentReady],
    {
      links: {
        "Referral Checklist.mdx": note(
          "Issued referral checklist",
          "Confirm the beneficiary details.",
        ),
      },
    },
  ),
  trail(
    "cutoff-preview-with-clock-context",
    "Follow the publication notes to the public timetable and verify the time zone appears in the selected preview.",
    [
      ["Timetable Desk.mdx", "Timetable desk entry", "Timetable Review"],
      ["Timetable Review.mdx", "Timetable readiness note", "Public Timetable"],
    ],
    [
      "Public Timetable.mdx",
      "Public timetable confirmation",
      callout("The final entry is at 18:30 UTC."),
    ],
    [navigation, previewReady],
    { previewText: "The final entry is at 18:30 UTC." },
  ),
  trail(
    "board-decision-without-preview",
    "Trace the board's routing decision. A valid navigation trail and canonical note can coexist with no component preview.",
    [
      ["Board Desk.mdx", "Board desk current notes", "Agenda Routing"],
      ["Agenda Routing.mdx", "Agenda routing index", "Quorum Decision"],
    ],
    [
      "Quorum Decision.mdx",
      "Board quorum decision",
      "The board requires two reviewers for this intake.",
    ],
    [previewMissing, navigation, documentReady],
  ),
);

const changedRevision = ["revision", "draft-changed"] satisfies [
  ReviewCheck,
  Expected,
];
const sameRevision = ["revision", "revision-unchanged"] satisfies [
  ReviewCheck,
  Expected,
];
const dirtyVault = ["publication", "working-copy-dirty"] satisfies [
  ReviewCheck,
  Expected,
];

type DraftNotes = {
  path: string;
  committed: [heading: string, body: string];
  working: [heading: string, body: string];
  staleText: string;
  visibleText?: string;
};

function revisedNote(
  id: string,
  goal: string,
  notes: DraftNotes,
  requested: [ReviewCheck, Expected][],
  options: Options = {},
) {
  const { path, committed, working, staleText, visibleText } = notes;
  const world = scenario(id, goal, path, ...working, requested, {
    ...options,
    draft: {
      edits: { [path]: note(...working) },
      committedTitle: committed[0],
      staleText,
      visibleText,
    },
  });
  world.files[path] = note(...committed);
  return world;
}

function coeditedVault(
  id: string,
  goal: string,
  current: [path: string, heading: string, body: string],
  separate: [
    path: string,
    heading: string,
    committedBody: string,
    workingBody: string,
  ],
  requested: [ReviewCheck, Expected][],
  options: Options = {},
) {
  const [path, title, original, replacement] = separate;
  return scenario(id, goal, ...current, requested, {
    ...options,
    links: { ...options.links, [path]: note(title, original) },
    draft: {
      edits: { [path]: note(title, replacement) },
      committedTitle: current[1],
      staleText: null,
    },
  });
}

managedSpectroliteWorlds.push(
  scenario(
    "review-handoff-committed-checklist",
    "Prepare a peer review handoff for the rendered dispatch checklist. Identify the exact committed revision a reviewer can reopen.",
    "Dispatch Checklist.mdx",
    "Dispatch checklist",
    callout("Confirm the staging window with dispatch."),
    [documentReady, previewReady, sameRevision],
    {
      previewText: "Confirm the staging window with dispatch.",
      handoff: "committed-review",
    },
  ),
  revisedNote(
    "review-handoff-uncommitted-brief",
    "The editor preview changed after the last commit. Plan a draft review for the visible brief and identify the exact revision the reviewer should inspect.",
    {
      path: "Morning Brief.mdx",
      committed: ["Prior morning brief", callout("Confirm at seven.")],
      working: ["Updated morning brief", callout("Confirm at eight.")],
      staleText: "Confirm at seven.",
    },
    [changedRevision, previewReady, dirtyVault],
    { previewText: "Confirm at eight.", handoff: "draft-only" },
  ),
  scenario(
    "review-handoff-hold-plain-release",
    "Prepare a peer review of the committed release note. Verify the rollback reference and whether the current editor has a rendered component. Hold the handoff if the preview evidence is missing.",
    "Release Ledger.mdx",
    "Release ledger",
    "Use the owner listed in [[Rollback Roster]] before opening peer review.",
    [documentReady, sameRevision, previewMissing],
    {
      links: {
        "operations/Rollback Roster.mdx": note(
          "Rollback roster",
          "Confirm the current release owner.",
        ),
      },
      handoff: "hold",
    },
  ),
  revisedNote(
    "review-handoff-hold-after-preview-removal",
    "The editor was revised after the launch note was committed. Compare it with its accepted revision and decide whether the peer review can use its current preview. Cite the current editor and do not point reviewers at the retired action.",
    {
      path: "Launch Readiness.mdx",
      committed: ["Launch readiness", callout("The previous slot is Tuesday.")],
      working: [
        "Launch readiness revised",
        "The slot is awaiting a new owner decision.",
      ],
      staleText: "The previous slot is Tuesday.",
    },
    [changedRevision, previewMissing, dirtyVault],
    { handoff: "hold" },
  ),
  revisedNote(
    "draft-evacuation-route",
    "Confirm the revised gate in the draft preview, check the cited muster plan, and report what the current vault state shows about publication.",
    {
      path: "Evacuation.mdx",
      committed: [
        "Original evacuation route",
        callout("Exit through the east gate."),
      ],
      working: [
        "Revised evacuation route",
        `${callout("Exit through the west gate.")}\n\nSee [[Muster Plan]].`,
      ],
      staleText: "Exit through the east gate.",
    },
    [changedRevision, previewReady, documentReady, dirtyVault],
    {
      previewText: "Exit through the west gate.",
      links: {
        "Muster Plan.mdx": note(
          "Approved muster point",
          "Meet at the far fence.",
        ),
      },
    },
  ),
  revisedNote(
    "draft-customs-exception",
    "Check whether the new customs exception names a real approval, and identify whether the exception is already committed.",
    {
      path: "Customs Desk.mdx",
      committed: ["Routine clearance", "Inspect the packing list."],
      working: [
        "Customs exception proposal",
        "Waiver still needs [[Signed Export Waiver]].",
      ],
      staleText: "Inspect the packing list.",
    },
    [brokenLink, changedRevision, dirtyVault],
    { requiredText: ["Signed Export Waiver"] },
  ),
  revisedNote(
    "draft-sound-check-remove-card",
    "Determine whether the current sound check still has an inline preview now that the setup instructions are in plain text.",
    {
      path: "Sound Check.mdx",
      committed: [
        "Sound check card",
        callout("Switch to the lobby amplifier."),
      ],
      working: [
        "Sound check procedure",
        "Bring the handheld meter and test each input from the mixing desk.",
      ],
      staleText: "Switch to the lobby amplifier.",
    },
    [previewMissing, changedRevision],
  ),
  revisedNote(
    "draft-load-test-add-card",
    "Verify the live load test now shows the equipment threshold and determine if the vault still holds an uncommitted revision.",
    {
      path: "Load Test.mdx",
      committed: ["Load test setup", "Stage the empty trailer."],
      working: ["Load test limit", callout("Stop loading at 400 kg.")],
      staleText: "Stage the empty trailer.",
    },
    [previewReady, dirtyVault, changedRevision],
    { previewText: "Stop loading at 400 kg." },
  ),
  revisedNote(
    "draft-literal-repair",
    "Verify that the quoted example in the repaired handbook no longer counts as a missing reference, and check if that repair is committed.",
    {
      path: "Handbook Examples.mdx",
      committed: ["Broken handbook example", "Example: [[Temporary Project]]."],
      working: [
        "Repaired handbook example",
        "Use this literal token:\n\n```text\n[[Temporary Project]]\n```",
      ],
      staleText: "Broken handbook example",
    },
    [documentReady, changedRevision, previewMissing],
  ),
  revisedNote(
    "draft-ledger-referral-route",
    "Navigate to the active ledger from the signoff desk, verify its newer hold notice, and determine whether it has been committed.",
    {
      path: "audit/Ledger.mdx",
      committed: [
        "Ledger release notice",
        callout("Issue all reimbursement letters."),
      ],
      working: [
        "Ledger hold notice",
        callout("Hold letters with missing receipts."),
      ],
      staleText: "Issue all reimbursement letters.",
    },
    [navigation, changedRevision, previewReady],
    {
      previewText: "Hold letters with missing receipts.",
      links: {
        "Signoff Desk.mdx": note(
          "Signoff desk",
          "Review [[audit/Ledger]] first.",
        ),
      },
      follow: [
        {
          path: "Signoff Desk.mdx",
          heading: "Signoff desk",
          target: "audit/Ledger",
          destination: "audit/Ledger.mdx",
        },
      ],
    },
  ),
  revisedNote(
    "draft-resolve-duplicate-checklist",
    "Verify that the revised dispatch note points to the overnight checklist and report whether the vault still has uncommitted edits.",
    {
      path: "Dispatch Brief.mdx",
      committed: ["Dispatch brief", "Use [[Checklist]]."],
      working: ["Dispatch brief revised", "Use [[overnight/Checklist]]."],
      staleText: "Dispatch brief\n",
    },
    [documentReady, dirtyVault, changedRevision],
    {
      links: {
        "day/Checklist.mdx": note(
          "Day checklist",
          "Collect the morning slips.",
        ),
        "overnight/Checklist.mdx": note(
          "Overnight checklist",
          "Count the emergency radios.",
        ),
      },
    },
  ),
  revisedNote(
    "draft-clinic-two-missing",
    "Identify both references missing from the clinic draft while independently checking the displayed triage action.",
    {
      path: "Clinic Handoff.mdx",
      committed: ["Clinic morning handoff", "File the visit log."],
      working: [
        "Clinic afternoon handoff",
        `See [[Room Clearance]] and [[Staff Allocation]].\n\n${callout("Send arrivals to the temporary triage desk.")}`,
      ],
      staleText: "File the visit log.",
    },
    [changedRevision, brokenLink, previewReady],
    {
      requiredText: ["Room Clearance", "Staff Allocation"],
      previewText: "Send arrivals to the temporary triage desk.",
    },
  ),
  revisedNote(
    "draft-access-hours-time-zone",
    "Inspect the updated opening time and report whether the local copy still needs to be committed.",
    {
      path: "Access Hours.mdx",
      committed: ["Access hours", callout("Open the gates at noon.")],
      working: [
        "Access hours revised",
        callout("Open the gates at 11:30 CET."),
      ],
      staleText: "Open the gates at noon.",
    },
    [previewReady, changedRevision, dirtyVault],
    { previewText: "Open the gates at 11:30 CET." },
  ),
  revisedNote(
    "draft-bridge-inspection-hop",
    "Follow the inspection desk's two-hop route and confirm that the bridge closure draft still lacks a named engineering receipt.",
    {
      path: "field/Bridge Record.mdx",
      committed: ["Bridge reopened", "Vehicle access is unrestricted."],
      working: ["Bridge clearance pending", "Await [[Engineering Signoff]]."],
      staleText: "Vehicle access is unrestricted.",
    },
    [navigation, brokenLink, changedRevision, dirtyVault],
    {
      requiredText: ["Engineering Signoff"],
      links: {
        "Inspection Desk.mdx": note("Inspection desk", "Open [[field/Queue]]."),
        "field/Queue.mdx": note(
          "Field inspection queue",
          "Read [[field/Bridge Record]].",
        ),
      },
      follow: [
        {
          path: "Inspection Desk.mdx",
          heading: "Inspection desk",
          target: "field/Queue",
          destination: "field/Queue.mdx",
        },
        {
          path: "field/Queue.mdx",
          heading: "Field inspection queue",
          target: "field/Bridge Record",
          destination: "field/Bridge Record.mdx",
        },
      ],
    },
  ),
  revisedNote(
    "draft-pilot-checkpoint",
    "Read back the staged pilot checkpoint and distinguish the current text from the previously committed checkpoint even though the title is unchanged.",
    {
      path: "Pilot Checkpoint.mdx",
      committed: ["Pilot checkpoint", "Checkpoint after the first shipment."],
      working: [
        "Pilot checkpoint",
        "Checkpoint after the receiving confirmation.",
      ],
      staleText: "Checkpoint after the first shipment.",
      visibleText: "Checkpoint after the receiving confirmation.",
    },
    [changedRevision, documentReady, previewMissing],
  ),
  revisedNote(
    "draft-visitor-verified-escort",
    "Verify the amended escort source and current visitor instruction before reporting the vault’s current publication status.",
    {
      path: "Visitor Entry.mdx",
      committed: [
        "Visitor entry preliminary",
        "Escort rules are in [[Old Escort Policy]].",
      ],
      working: [
        "Visitor entry reviewed",
        `Consult [[Escorts]].\n\n${callout("Issue badges only after the escort arrives.")}`,
      ],
      staleText: "Old Escort Policy",
    },
    [documentReady, previewReady, dirtyVault, changedRevision],
    {
      links: {
        "Escorts.mdx": note(
          "Active escort instructions",
          "Verify the arrival at reception.",
        ),
      },
      previewText: "Issue badges only after the escort arrives.",
    },
  ),
  revisedNote(
    "draft-market-power-fallback",
    "Locate the fallback plan in the edited market brief, verify that the inline instruction renders, then identify its commitment status.",
    {
      path: "Market Power.mdx",
      committed: [
        "Electrical assignment",
        "Plug all stalls into the main supply.",
      ],
      working: [
        "Electrical fallback assignment",
        `${callout("Switch cold storage to the reserve circuit.")}\n\nSee [[Reserve Circuit]].`,
      ],
      staleText: "Plug all stalls into the main supply.",
    },
    [previewReady, documentReady, changedRevision],
    {
      links: {
        "Reserve Circuit.mdx": note(
          "Reserve load limits",
          "Reserve the top feed for cold storage only.",
        ),
      },
      previewText: "Switch cold storage to the reserve circuit.",
    },
  ),
  revisedNote(
    "draft-signage-title-only",
    "Check whether a wording change limited to the sign title creates a different working revision, and whether its unchanged inline action still renders.",
    {
      path: "Road Sign.mdx",
      committed: [
        "Temporary road signage",
        callout("Direct foot traffic to the covered crossing."),
      ],
      working: [
        "Temporary crossing signage",
        callout("Direct foot traffic to the covered crossing."),
      ],
      staleText: "Temporary road signage",
    },
    [changedRevision, previewReady],
    { previewText: "Direct foot traffic to the covered crossing." },
  ),
  coeditedVault(
    "draft-stewardship-unrelated-minutes",
    "Check that the selected stewardship charter is unchanged while a separate meeting record keeps the working copy dirty.",
    [
      "Stewardship.mdx",
      "Stewardship charter",
      "The designated reviewer signs changes.",
    ],
    [
      "Minutes.mdx",
      "Meeting minutes",
      "Meeting opened at 09:00.",
      "Meeting opened at 09:00 and adjourned at 09:45.",
    ],
    [sameRevision, dirtyVault, documentReady],
  ),
  coeditedVault(
    "draft-ticket-card-unrelated-schedule",
    "Confirm the issued ticket card is still the committed copy and renders correctly while the adjacent schedule remains dirty.",
    [
      "Ticket Desk.mdx",
      "Ticket desk notice",
      callout("Bring the booking reference."),
    ],
    [
      "Duty Schedule.mdx",
      "Duty schedule",
      "Staff open both positions.",
      "Staff open the east position first.",
    ],
    [previewReady, sameRevision, dirtyVault],
    { previewText: "Bring the booking reference." },
  ),
  coeditedVault(
    "draft-incident-existing-missing-link",
    "Identify the unresolved asset log in the unchanged incident note and independently report the vault’s current publication status.",
    [
      "Incident Ledger.mdx",
      "Incident ledger",
      "Await [[Independent Asset Log]].",
    ],
    [
      "Dispatch Times.mdx",
      "Dispatch times",
      "Standby at 07:00.",
      "Standby at 06:45.",
    ],
    [brokenLink, sameRevision, dirtyVault],
    { requiredText: ["Independent Asset Log"] },
  ),
  coeditedVault(
    "draft-commission-linked-source-edited",
    "Check the commissioned note's stable revision and live resolution of its supporting reference after that supporting note was edited.",
    [
      "Commission.mdx",
      "Commissioned repair",
      "Use [[Inspection Scope]] for the written boundaries.",
    ],
    [
      "Inspection Scope.mdx",
      "Inspection scope",
      "Inspect the canopy.",
      "Inspect the canopy and gutter.",
    ],
    [documentReady, sameRevision, dirtyVault],
  ),
  coeditedVault(
    "draft-routed-checklist-unrelated-index",
    "Follow the modified index to the unchanged checklist and verify the route and report whether the vault has uncommitted edits.",
    ["Crew Checklist.mdx", "Crew checklist", "Stage the labeling tools."],
    [
      "Crew Desk.mdx",
      "Crew desk index",
      "Keep this desk open.",
      "Open [[Crew Checklist]] when the crew assembles.",
    ],
    [navigation, sameRevision, dirtyVault, previewMissing],
    {
      follow: [
        {
          path: "Crew Desk.mdx",
          heading: "Crew desk index",
          target: "Crew Checklist",
          destination: "Crew Checklist.mdx",
        },
      ],
    },
  ),
  coeditedVault(
    "draft-reviewer-separate-implementation",
    "Confirm that the publication checklist itself has no inline preview and matches its commitment even after the implementation note changed.",
    [
      "Publication Checklist.mdx",
      "Publication checklist",
      "Record the name of the reviewer.",
    ],
    [
      "Implementation.mdx",
      "Implementation notes",
      "Retain last quarter's schedule.",
      "Use the reissued schedule after facilities approval.",
    ],
    [previewMissing, dirtyVault, sameRevision],
  ),
);
