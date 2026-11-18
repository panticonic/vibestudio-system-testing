export const spectrolitePanel = "panels/spectrolite";
export const spectroliteVault = "projects/default";
type ReviewCheck = "document" | "preview";
type Expected =
  | "document-ready"
  | "broken-link"
  | "preview-ready"
  | "preview-missing"
  | "render-error";

function note(heading: string, body: string) {
  return `---\ntitle: ${heading}\n---\n\n# ${heading}\n\n${body}\n`;
}

type Options = {
  links?: Record<string, string>;
  follow?: { path: string; target: string; heading: string };
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
      follow: {
        path: "Review Index.mdx",
        target: "Published Decision",
        heading: "Review index for approvals",
      },
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
      follow: {
        path: "Survey Index.mdx",
        target: "Water Survey",
        heading: "Survey review index",
      },
      links: {
        "Survey Index.mdx": note(
          "Survey review index",
          "Read [[Water Survey]] before allocating a crew.",
        ),
      },
    },
  ),
];
