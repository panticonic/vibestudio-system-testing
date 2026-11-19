export const spectrolitePanel = "panels/spectrolite";
export const spectroliteVault = "projects/default";
type ReviewCheck = "document" | "preview" | "navigation";
type Expected =
  | "document-ready"
  | "broken-link"
  | "preview-ready"
  | "preview-missing"
  | "render-error"
  | "navigation-ready";

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
  links?: Record<string, string>;
  follow?: Follow[];
  previewText?: string;
  requiredText?: string[];
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
