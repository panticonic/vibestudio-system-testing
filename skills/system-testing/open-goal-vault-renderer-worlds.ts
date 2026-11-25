import type { VaultKnowledgeWorld } from "@workspace-skills/spectrolite-review-fixtures/knowledge-managed";

type Step = VaultKnowledgeWorld["expected"]["steps"][number];
type Check = Extract<Step, { kind: "read" }>["findings"][number];
type World = Omit<VaultKnowledgeWorld, "kind" | "workspace" | "sourceGroup">;

const ready: Check = ["document", "document-ready"];
const shown: Check = ["preview", "preview-ready"];
const compileError: Check = ["preview", "compile-error"];
const renderError: Check = ["preview", "render-error"];
const draft: Check = ["revision", "draft-changed"];
const read = (path: string, ...findings: Check[]): Step => ({
  kind: "read",
  path,
  findings: findings.length ? findings : [ready],
});
const hop = (from: string, target: string, to: string): Step => ({
  kind: "follow",
  from,
  target,
  to,
});
const note = (title: string, body: string) =>
  "---\ntitle: " + title + "\n---\n\n# " + title + "\n\n" + body + "\n";
const callout = (body: string) =>
  '<Callout color="blue"><Callout.Text>' + body + "</Callout.Text></Callout>";
const blockStartup = (message: string) =>
  "export const startup = (() => { throw new Error(" +
  JSON.stringify(message) +
  "); })();\n\n";
const blockRender = (name: string, message: string) =>
  "export function " +
  name +
  "() { throw new Error(" +
  JSON.stringify(message) +
  "); }\n\n<" +
  name +
  " />";
const world = (data: World): VaultKnowledgeWorld => ({
  ...data,
  kind: "vaultWork",
  workspace: "spectrolite",
  sourceGroup: "vibestudio:spectrolite-renderer:" + data.id,
});

const gateApproval = "Gate Link Approval.mdx";
const gateCopy = "working/Overnight Gate Copy.mdx";
const gatePath = "approvals/night/Night Gate Notice.mdx";
const gateRewrite = note(
  "Overnight Gate Copy",
  "See [[approvals/night/Night Gate Notice|Gate instructions]].\n\nCarry the key ring.",
);

const oldComponent = "maintenance/Evening Status Card.mdx";
const approvedComponent = "approvals/Component Waiver.mdx";
const upgraded = note(
  "Evening Status Card",
  callout("Return meters to Shelf Eight.") + "\n\nService label: keep blue.",
);

export const openVaultRendererWorlds = [
  world({
    id: "vault-repair-visible-link-with-identical-public-label",
    requestedReturnRequired: false,
    goal: "The working Overnight Gate Copy points its Gate instructions label at the wrong same-titled record. Follow the approval to the exact endorsed record, then correct the working link while preserving the displayed label and key-ring reminder. Follow the repaired link to verify it.",
    openPath: gateApproval,
    files: {
      [gateApproval]: note(
        "Gate Link Approval",
        "The signed text is at [[approvals/night/Night Gate Notice|Endorsed instructions]].",
      ),
      [gatePath]: note(
        "Night Gate Notice",
        "Signed overnight requirement: use Brass Entry. Correct [[Overnight Gate Copy]].",
      ),
      "Night Gate Notice.mdx": note(
        "Night Gate Notice",
        "Superseded: use Glass Entry.",
      ),
      [gateCopy]: note(
        "Overnight Gate Copy",
        "See [[Night Gate Notice|Gate instructions]].\n\nCarry the key ring.",
      ),
    },
    writable: [gateCopy],
    expected: {
      path: gatePath,
      outcome: "edited",
      citations: ["Gate instructions", "Brass Entry", "key ring"],
      steps: [
        read(gateApproval),
        hop(gateApproval, "approvals/night/Night Gate Notice", gatePath),
        read(gatePath),
        hop(gatePath, "Overnight Gate Copy", gateCopy),
        read(gateCopy),
        { kind: "write", path: gateCopy, source: gateRewrite },
        read(gateCopy, ready, draft),
        hop(gateCopy, "approvals/night/Night Gate Notice", gatePath),
      ],
    },
  }),
  world({
    id: "vault-confirm-which-identical-title-shortcut-wins",
    requestedReturnRequired: true,
    split: "test",
    goal: "At Sculpture Index, follow the ordinary Handling Memo shortcut and then its explicit signed replacement. Tell me why the shortcut chose the older record even with two matching titles. Compare the glove advice, and leave both paths untouched.",
    openPath: "Sculpture Index.mdx",
    files: {
      "Sculpture Index.mdx": note(
        "Sculpture Index",
        "Older shortcuts use [[Handling Memo]].",
      ),
      "Handling Memo.mdx": note(
        "Handling Memo",
        "Archived: cotton gloves. Active signed version is [[registrar/current/Handling Memo|Current handling]].",
      ),
      "registrar/current/Handling Memo.mdx": note(
        "Handling Memo",
        "Signed requirement: use nitrile gloves.",
      ),
    },
    expected: {
      path: "registrar/current/Handling Memo.mdx",
      outcome: "authority-confirmed",
      citations: [
        "cotton gloves",
        "nitrile gloves",
        "registrar/current/Handling Memo.mdx",
        "short",
      ],
      steps: [
        hop("Sculpture Index.mdx", "Handling Memo", "Handling Memo.mdx"),
        read("Handling Memo.mdx"),
        hop(
          "Handling Memo.mdx",
          "registrar/current/Handling Memo",
          "registrar/current/Handling Memo.mdx",
        ),
        read("registrar/current/Handling Memo.mdx"),
      ],
    },
  }),
  world({
    id: "vault-distinguish-example-syntax-from-a-live-reference",
    requestedReturnRequired: true,
    goal: "A trainee flagged the old target in the example on Recipe Index as a broken dependency. Inspect which link is live, walk only that live route, and tell the trainee what remains safe to copy from the code sample. Don't create a missing note.",
    openPath: "Recipe Index.mdx",
    files: {
      "Recipe Index.mdx": note(
        "Recipe Index",
        "The example below shows an obsolete label.\n\n" +
          ["```text", "[[Expired Recipe]]", "```"].join("\n") +
          "\n\nThe current authority is [[Recipe Revision]].",
      ),
      "kitchen/Recipe Revision.mdx": note(
        "Recipe Revision",
        "Approved labels use composite batch numbers.",
      ),
    },
    expected: {
      path: "kitchen/Recipe Revision.mdx",
      outcome: "authority-confirmed",
      citations: ["Expired Recipe", "code sample", "composite batch numbers"],
      steps: [
        read("Recipe Index.mdx"),
        hop(
          "Recipe Index.mdx",
          "Recipe Revision",
          "kitchen/Recipe Revision.mdx",
        ),
        read("kitchen/Recipe Revision.mdx"),
      ],
    },
  }),
  world({
    id: "vault-hold-render-failure-even-after-source-compiles",
    requestedReturnRequired: true,
    split: "test",
    goal: "Stage a local review for the Shift Lead only if the linked Shift Gauge Card actually renders. If it fails, preserve the exact preview error and leave the current and committed card alone. Don't issue a receipt from source code alone.",
    openPath: "Gauge Review.mdx",
    files: {
      "Gauge Review.mdx": note(
        "Gauge Review",
        "Shift Lead reviews [[Shift Gauge Card]].",
      ),
      "status/Shift Gauge Card.mdx": note(
        "Shift Gauge Card",
        blockRender("GaugeCard", "Gauge configuration absent"),
      ),
    },
    handoff: { path: "status/Shift Gauge Card.mdx", audience: "Shift Lead" },
    expected: {
      path: "status/Shift Gauge Card.mdx",
      outcome: "handoff-held",
      disposition: "hold",
      citations: ["Gauge configuration absent", "render", "Shift Lead"],
      steps: [
        hop(
          "Gauge Review.mdx",
          "Shift Gauge Card",
          "status/Shift Gauge Card.mdx",
        ),
        read("status/Shift Gauge Card.mdx", ready, renderError),
      ],
    },
  }),
  world({
    id: "vault-recover-module-preview-then-stage-working-proof",
    requestedReturnRequired: false,
    goal: "Component Waiver authorizes replacing the broken inline startup module in the linked Evening Status Card with the approved callout. Keep its service label, verify the actual new rendering, and leave a draft-only receipt for Maintenance Desk.",
    openPath: approvedComponent,
    files: {
      [approvedComponent]: note(
        "Component Waiver",
        "Approved callout: Return meters to Shelf Eight. Keep service label. Local reviewer: Maintenance Desk. Edit [[Evening Status Card]].",
      ),
      [oldComponent]: note(
        "Evening Status Card",
        blockStartup("Retired meter module") +
          callout("Return meters to Shelf Two.") +
          "\n\nService label: keep blue.",
      ),
    },
    writable: [oldComponent],
    handoff: { path: oldComponent, audience: "Maintenance Desk" },
    expected: {
      path: oldComponent,
      outcome: "handoff-staged",
      disposition: "draft-only",
      citations: ["Retired meter module", "Shelf Eight", "Maintenance Desk"],
      steps: [
        read(approvedComponent),
        hop(approvedComponent, "Evening Status Card", oldComponent),
        read(oldComponent, ready, compileError),
        { kind: "write", path: oldComponent, source: upgraded },
        read(oldComponent, ready, shown, draft),
      ],
    },
  }),
  world({
    id: "vault-distinguish-module-load-failure-from-render-failure",
    requestedReturnRequired: true,
    goal: "Release Desk sees two failed inline previews. Follow the Startup Proof and its linked Runtime Proof. Tell me which fault occurs before rendering and which appears when a component renders, with the exact messages. Don't edit either file.",
    openPath: "Release Desk.mdx",
    files: {
      "Release Desk.mdx": note("Release Desk", "Begin at [[Startup Proof]]."),
      "proof/Startup Proof.mdx": note(
        "Startup Proof",
        blockStartup("Setup registry missing") +
          callout("Readiness banner.") +
          "\n\nNext: [[Runtime Proof]].",
      ),
      "proof/Runtime Proof.mdx": note(
        "Runtime Proof",
        blockRender("StageNotice", "Display limits unavailable"),
      ),
    },
    expected: {
      path: "proof/Runtime Proof.mdx",
      outcome: "preview-unavailable",
      citations: [
        "Setup registry missing",
        "Display limits unavailable",
        "render",
      ],
      steps: [
        hop("Release Desk.mdx", "Startup Proof", "proof/Startup Proof.mdx"),
        read("proof/Startup Proof.mdx", ready, compileError),
        hop(
          "proof/Startup Proof.mdx",
          "Runtime Proof",
          "proof/Runtime Proof.mdx",
        ),
        read("proof/Runtime Proof.mdx", ready, renderError),
      ],
    },
  }),
];
