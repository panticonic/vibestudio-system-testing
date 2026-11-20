import type { MigrationStatus } from "../template-candidate/types.js";

export type MigrationRecord = {
  id: string;
  kind: "candidate" | "deployment" | "dependency" | "approval" | "receipt";
  title: string;
  text: string;
};
export type OpenTemplateMigrationWorld = {
  kind: "templateMigration";
  id: string;
  workspace: "examples";
  sourceGroup: string;
  split?: "test";
  workspaceBaseline?: string;
  goal: string;
  records: MigrationRecord[];
  movement?: { record: string; text: string };
  authority?: { candidateId: string; source: "examples"; approvalId: string };
  handoff?: { recipient: string; candidateId: string | null };
  expected: {
    status: MigrationStatus;
    candidateId: string | null;
    reads: string[];
    facts: string[];
  };
};
type Input = Omit<
  OpenTemplateMigrationWorld,
  "kind" | "workspace" | "sourceGroup" | "workspaceBaseline"
>;
const examplesBaseline = "81b3857e28387ddcd70cb5e4d6c8a913ee87e10e";
const record = (
  id: string,
  kind: MigrationRecord["kind"],
  title: string,
  text: string,
): MigrationRecord => ({ id, kind, title, text });
const candidate = (id: string, title: string, text: string) =>
  record(id, "candidate", title, text);
const approval = (id: string, title: string, text: string) =>
  record(id, "approval", title, text);
const dependency = (id: string, title: string, text: string) =>
  record(id, "dependency", title, text);
const deployment = (id: string, title: string, text: string) =>
  record(id, "deployment", title, text);
const receipt = (id: string, title: string, text: string) =>
  record(id, "receipt", title, text);
const expected = (
  status: MigrationStatus,
  candidateId: string | null,
  reads: string[],
  ...facts: string[]
) => ({ status, candidateId, reads, facts });

function migration(input: Input): OpenTemplateMigrationWorld {
  return {
    ...input,
    kind: "templateMigration",
    workspace: "examples",
    id: "template-migration-" + input.id,
    sourceGroup: "vibestudio:template-migration:" + input.id,
    ...(input.authority ? { workspaceBaseline: examplesBaseline } : {}),
  };
}

export const openTemplateMigrationWorlds = [
  migration({
    id: "stage-owner-reviewed-field-guide",
    goal: "The Field Guide steward authorized an isolated review of the available Examples release. Check the approval and exact owner before preparing it. Leave the current deployment in place, confirm the native candidate, and leave Mira a local handoff.",
    records: [
      candidate(
        "field-review",
        "Field Guide current review",
        "Owner Mira. Use the exact available Examples target {{incoming}} for the Field Guide. Installation is still {{installed}}.",
      ),
      approval(
        "field-order",
        "Field Guide owner decision",
        "Mira authorizes one isolated native review for Field Guide current review at {{incoming}}. Handoff to Mira only. Semantic validation remains pending.",
      ),
      deployment(
        "field-live",
        "Field Guide deployment",
        "Protected Examples installation {{installed}}, main event {{main}}. No handoff or draft replaces it.",
      ),
    ],
    authority: {
      candidateId: "field-review",
      source: "examples",
      approvalId: "field-order",
    },
    handoff: { recipient: "Mira", candidateId: "field-review" },
    expected: expected(
      "candidate-staged",
      "field-review",
      ["field-review", "field-order", "field-live"],
      "Mira",
      "semantic",
    ),
  }),
  migration({
    id: "stage-only-counter-copy-own-release",
    goal: "Two Cutover Review records look alike. Find the one belonging to the Counter Desk and prepare only its approved native Examples candidate. Tell me what separates the other record. Do not publish or leave a handoff.",
    records: [
      candidate(
        "counter-review",
        "Cutover Review",
        "Counter Desk, owner Anwar, Examples {{incoming}}. This is the approved candidate under review.",
      ),
      candidate(
        "archive-copy",
        "Cutover Review",
        "Archive Services look-alike. This archived copy names the older installed version {{installed}} and has no Counter Desk authority.",
      ),
      approval(
        "counter-approval",
        "Anwar's exact preparation authorization",
        "Prepare the exact Counter Desk candidate at {{incoming}} in a review context only. No local handoff.",
      ),
    ],
    authority: {
      candidateId: "counter-review",
      source: "examples",
      approvalId: "counter-approval",
    },
    expected: expected(
      "candidate-staged",
      "counter-review",
      ["counter-review", "archive-copy", "counter-approval"],
      "Counter Desk",
      "Archive Services",
    ),
  }),
  migration({
    id: "stage-reviewed-compatible-examples-with-deferred-checks",
    goal: "Audit the Tool Chest migration before staging anything. The new dependency approval may supersede the old constraint. If the exact Examples target is supported, prepare its isolated review and state what may still need testing. Leave protected deployment alone.",
    records: [
      candidate(
        "chest-review",
        "Tool Chest source pin",
        "Tool Chest release owner Lin. Examples {{incoming}} must be kept distinct from installed {{installed}}.",
      ),
      dependency(
        "old-guard",
        "Tool Chest dependency restriction",
        "Older package-shelf pin was suspended for shell-bridge 1. It must not be silently reused.",
      ),
      approval(
        "support-order",
        "Tool Chest current compatibility acceptance",
        "Lin approves the exact {{incoming}} native review with shell-bridge 2. Shell-bridge 1 stays excluded. Do not deploy. Smoke checks remain pending.",
      ),
    ],
    authority: {
      candidateId: "chest-review",
      source: "examples",
      approvalId: "support-order",
    },
    expected: expected(
      "candidate-staged",
      "chest-review",
      ["chest-review", "old-guard", "support-order"],
      "shell-bridge 2",
      "checks",
    ),
  }),
  migration({
    id: "handoff-draft-does-not-prove-deployment",
    goal: "Is the Training Shelf migration already adopted? Check its local preview receipt against the installed template and give Jo a local decision receipt if the existing owner note permits it. Don't open a second candidate.",
    records: [
      candidate(
        "shelf-draft",
        "Training Shelf review draft",
        "Preview candidate label training-v3. This owned scratch draft has never been adopted on protected main.",
      ),
      receipt(
        "shelf-preview",
        "Training Shelf successful local preview",
        "Private preview rendered training-v3. No deployment event, source pin, or adoption occurred.",
      ),
      approval(
        "shelf-readback",
        "Training Shelf decision recipient",
        "Jo may receive a local draft-only review receipt. No preparation or publication is approved.",
      ),
    ],
    handoff: { recipient: "Jo", candidateId: "shelf-draft" },
    expected: expected(
      "draft-only",
      "shelf-draft",
      ["shelf-draft", "shelf-preview", "shelf-readback"],
      "training-v3",
      "preview",
      "Jo",
    ),
  }),
  migration({
    id: "reject-foreign-warehouse-candidate",
    goal: "Can the Warehouse group take over this Migration Ready card? Match the candidate owner's current transfer authority to the card and deployment, then tell the steward which ownership block remains. Leave no handoff.",
    records: [
      candidate(
        "warehouse-shared",
        "Migration Ready",
        "Candidate exists for Field Logistics. Warehouse is not the review owner.",
      ),
      approval(
        "transfer-register",
        "Current transfer decision",
        "Warehouse may inspect. Candidate transfer from Field Logistics is unapproved.",
      ),
      deployment(
        "warehouse-live",
        "Warehouse installed basis",
        "Examples {{installed}} remains at protected main {{main}}.",
      ),
    ],
    expected: expected(
      "foreign-candidate",
      "warehouse-shared",
      ["warehouse-shared", "transfer-register", "warehouse-live"],
      "Field Logistics",
      "unapproved",
    ),
  }),
  migration({
    id: "obsolete-runtime-dependency-despite-green-preview",
    goal: "The Dispatch board shows a green preview of the migration. Decide whether that is enough to adopt the draft when its runtime dependency is marked obsolete. Record the blocker for the local Release Desk only if the owner note allows.",
    records: [
      candidate(
        "dispatch-draft",
        "Dispatch migration preview",
        "A private cached preview rendered. Runtime dependency: dispatch-transport 1; home filter unchanged.",
      ),
      dependency(
        "dispatch-support",
        "Dispatch compatibility ledger",
        "dispatch-transport 1 is obsolete for the installed host. Current requirement is 2 with receipt bridging.",
      ),
      approval(
        "dispatch-reader",
        "Dispatch review desk",
        "Release Desk may receive a local hold receipt, not a candidate or deployment.",
      ),
    ],
    handoff: { recipient: "Release Desk", candidateId: "dispatch-draft" },
    expected: expected(
      "obsolete-dependency",
      "dispatch-draft",
      ["dispatch-draft", "dispatch-support", "dispatch-reader"],
      "dispatch-transport 1",
      "cached preview",
      "Release Desk",
    ),
  }),
  migration({
    id: "dependency-pin-cannot-be-updated-by-local-note",
    goal: "A draft claims the Library upgrade can use a floating vendor alias. Check the installed pin and the retained compatibility rule. Decide if the local draft is acceptable and keep the release unchanged.",
    records: [
      candidate(
        "library-draft",
        "Library draft",
        "Local review requests vendor-tabs@latest without an immutable source pin.",
      ),
      dependency(
        "library-contract",
        "Library dependency policy",
        "Vendor Tabs must match the pinned dependency layer. vendor-tabs@latest is not reviewed or supported.",
      ),
      deployment(
        "library-main",
        "Library deployed template",
        "Examples currently pins {{installed}} in protected main {{main}}.",
      ),
    ],
    expected: expected(
      "obsolete-dependency",
      "library-draft",
      ["library-draft", "library-contract", "library-main"],
      "vendor-tabs@latest",
      "pinned",
    ),
  }),
  migration({
    id: "same-release-similar-preview",
    goal: "The Index desk has a preview named Renewal. Determine whether the actual approved release matching the workspace's installed template has already been deployed, and whether that changes what we can conclude about the similarly named preview.",
    records: [
      candidate(
        "renewal-release",
        "Renewal approved release",
        "This release specifically names installed Examples {{installed}} and protected event {{main}}.",
      ),
      candidate(
        "renewal-preview",
        "Renewal export preview",
        "Separate local review of a proposed kiosk alteration. Same title, different artifact. No protected main adoption.",
      ),
      receipt(
        "renewal-adoption",
        "Renewal signed local adoption receipt",
        "The approved release was adopted on protected {{main}} with Examples {{installed}}. This receipt excludes the export preview.",
      ),
    ],
    expected: expected(
      "already-deployed",
      "renewal-release",
      ["renewal-release", "renewal-preview", "renewal-adoption"],
      "approved release",
      "export preview",
    ),
  }),
  migration({
    id: "wrong-protected-base-receipt",
    goal: "See if the old Facilities review can be relied on for our current template. Compare the recorded approval head with protected main and say what evidence has to be refreshed. Do not stage anything.",
    records: [
      candidate(
        "facilities-review",
        "Facilities review draft",
        "Draft belongs to Facilities. It was written against approved event facilities-old-base.",
      ),
      approval(
        "facilities-old",
        "Facilities sign-off",
        "Approved facilities-old-base only. The approval does not float to a different protected event.",
      ),
      deployment(
        "facilities-now",
        "Facilities protected main",
        "Current protected deployment is {{main}}, pinned to {{installed}}.",
      ),
    ],
    expected: expected(
      "stale-review",
      "facilities-review",
      ["facilities-review", "facilities-old", "facilities-now"],
      "facilities-old-base",
      "refresh",
    ),
  }),
  migration({
    id: "approval-changes-during-observation",
    goal: "Check whether the Parcel review may be handed to Pri. The owner is still editing today's decision. If it changes while you inspect it, reread the current record before acting.",
    records: [
      candidate(
        "parcel-copy",
        "Parcel migration review",
        "Owned local draft. Main is {{main}}. Handoff decision depends on today's current record.",
      ),
      approval(
        "parcel-today",
        "Parcel owner current decision",
        "Allow a local handoff to Pri once the source check is signed.",
      ),
      receipt(
        "parcel-test",
        "Parcel source check",
        "Draft source check signed by Release QA. No adoption event.",
      ),
    ],
    movement: {
      record: "parcel-today",
      text: "Revised by owner: hold all Parcel handoff pending source review reopening. Prior handoff to Pri is withdrawn.",
    },
    expected: expected(
      "awaiting-approval",
      "parcel-copy",
      ["parcel-copy", "parcel-today", "parcel-test"],
      "withdrawn",
      "Pri",
    ),
  }),
  migration({
    id: "matching-version-no-release-action",
    goal: "The Help Room says we need to reinstall the Examples release that is already recorded on main. Check the exact release memo against the installed template. If it really is unchanged, do nothing.",
    records: [
      candidate(
        "help-release",
        "Help Room request",
        "Request asks for release {{installed}}. No different workspace part or target was selected.",
      ),
      deployment(
        "help-now",
        "Help Room installed pin",
        "Protected Examples {{installed}} is recorded at main {{main}}.",
      ),
    ],
    expected: expected(
      "current",
      "help-release",
      ["help-release", "help-now"],
      "already",
      "installed",
    ),
  }),
  migration({
    id: "reviewable-not-authorized-to-adopt",
    goal: "The Model Shelf team needs a local migration review for Syl. Confirm the candidate and its matching dependency layers, but tell them separately whether adoption has been authorized. Use an internal review receipt only.",
    records: [
      candidate(
        "model-copy",
        "Model Shelf migration review",
        "Owned draft for Syl, protected base {{main}}. Importer 4 places data in the same private area.",
      ),
      dependency(
        "model-layers",
        "Model Shelf dependency edition",
        "Importer 4 and readonly checksum layer both match current reviewed sources.",
      ),
      approval(
        "model-recipients",
        "Model Shelf review mandate",
        "Syl may receive a local ready-for-review receipt. There is no adoption authorization.",
      ),
    ],
    handoff: { recipient: "Syl", candidateId: "model-copy" },
    expected: expected(
      "ready-for-review",
      "model-copy",
      ["model-copy", "model-layers", "model-recipients"],
      "Importer 4",
      "Syl",
      "adoption",
    ),
  }),
  migration({
    id: "recovered-receipt-wrong-channel",
    goal: "The Return Desk misplaced its old migration record, and the only receipt I can find has the same title in a different group's archive. Tell me if I can treat that as evidence of the Return Desk's current adoption. Keep it read-only.",
    records: [
      candidate(
        "return-review",
        "Return Desk migration",
        "Return Desk local candidate, actual protected base {{main}}. No attached deployment receipt.",
      ),
      receipt(
        "neighbor-adoption",
        "Return Desk migration",
        "Archived Returns Logistics deployment for their separate owner and main event returns-logistics-old.",
      ),
      deployment(
        "return-main",
        "Return Desk deployment",
        "Current Examples installed pin {{installed}} on {{main}}; no Return Desk's candidate receipt in the ledger.",
      ),
    ],
    expected: expected(
      "insufficient-evidence",
      "return-review",
      ["return-review", "neighbor-adoption", "return-main"],
      "Returns Logistics",
      "no",
      "receipt",
    ),
  }),
  migration({
    id: "pointed-to-foreign-retained-artifact",
    goal: "The Garden team wants an action note about the available migration, but their retained approval names a different owner under the same display label. If that blocks the action, record just the hold for the local Orchard Clerk.",
    records: [
      candidate(
        "garden-candidate",
        "Garden installation preview",
        "Candidate owner Garden Operations. Linked review known as March Gate.",
      ),
      approval(
        "garden-previous",
        "March Gate approval",
        "Previous March Gate applies to Orchard Engineering, not Garden Operations.",
      ),
      approval(
        "garden-hold-note",
        "Current Garden internal review",
        "Orchard Clerk may receive a local hold note. No transfer, installation or preparation is approved.",
      ),
    ],
    handoff: { recipient: "Orchard Clerk", candidateId: "garden-candidate" },
    expected: expected(
      "foreign-candidate",
      "garden-candidate",
      ["garden-candidate", "garden-previous", "garden-hold-note"],
      "Garden Operations",
      "Orchard Engineering",
      "Orchard Clerk",
    ),
  }),
  migration({
    id: "held-untrusted-widget-source",
    split: "test",
    goal: "The Harbors review is asking us to retain the shiny widget from a different source. Compare both the dependency policy and its candidate's authority before doing anything. Keep the actual installation protected.",
    records: [
      candidate(
        "harbor-proposal",
        "Harbors prospective migration",
        "Release candidate imports tide-widget from a mirror that is absent from the approved source list.",
      ),
      dependency(
        "harbor-policy",
        "Harbors allowed template layers",
        "Only the canonical tide-widget source is approved. The mirror has no reviewed immutable pin.",
      ),
      approval(
        "harbor-release",
        "Harbors adoption authority",
        "Private viewing only until the candidate matches the canonical source.",
      ),
    ],
    expected: expected(
      "obsolete-dependency",
      "harbor-proposal",
      ["harbor-proposal", "harbor-policy", "harbor-release"],
      "tide-widget",
      "mirror",
      "canonical",
    ),
  }),
  migration({
    id: "held-draft-moves-applied-evidence",
    split: "test",
    goal: "Audit the Far Gate candidate against its retained installation note. The duty officer may correct that note during this review. Make sure whether actual deployment is still claimed before leaving a local adoption conclusion.",
    records: [
      candidate(
        "gate-draft",
        "Far Gate draft",
        "Owner Duty Officer. Local candidate Far Gate alpha.",
      ),
      deployment(
        "gate-ledger",
        "Duty Officer installation ledger",
        "Pending reconcile: someone claimed that Far Gate alpha replaced {{installed}}.",
      ),
      receipt(
        "gate-preview",
        "Far Gate footprint",
        "Preview check only, with no adoption receipt.",
      ),
    ],
    movement: {
      record: "gate-ledger",
      text: "Duty Officer correction: Far Gate alpha is draft-only. Protected {{main}} with Examples {{installed}} is still deployed; keep the note private.",
    },
    expected: expected(
      "draft-only",
      "gate-draft",
      ["gate-draft", "gate-ledger", "gate-preview"],
      "Far Gate alpha",
      "draft-only",
    ),
  }),
  migration({
    id: "held-valid-receipt-for-current-deployment",
    split: "test",
    goal: "Recover the Trail Cabin adoption basis for the Post Desk. Compare the draft receipt with the real installed event. Leave the exact local proof only if today's owner note gives Post Desk the right audience.",
    records: [
      candidate(
        "trail-release",
        "Trail Cabin approved release",
        "Trail Cabin protected deployment used Examples {{installed}}, main {{main}}.",
      ),
      receipt(
        "trail-preview",
        "Trail Cabin private preview",
        "Older working preview only, not the protected deployment.",
      ),
      approval(
        "trail-post",
        "Trail Cabin handoff authority",
        "Owner allows one local Post Desk receipt for the deployed source on protected {{main}}. No new candidate.",
      ),
    ],
    handoff: { recipient: "Post Desk", candidateId: "trail-release" },
    expected: expected(
      "already-deployed",
      "trail-release",
      ["trail-release", "trail-preview", "trail-post"],
      "Post Desk",
      "preview",
      "deployed",
    ),
  }),
  migration({
    id: "held-approval-for-obsolete-base",
    split: "test",
    goal: "Someone says the Spares candidate was already approved. Check whether that approval names today's installed source and reject a review that has an older dependency pin. No new preparation.",
    records: [
      candidate(
        "spares-working",
        "Spares current candidate",
        "Owned local candidate based on protected main {{main}}, installed {{installed}}.",
      ),
      approval(
        "spares-old",
        "Spares archived approval",
        "Approved only the commit that pinned warehouse-cache 0; that approval predates this basis.",
      ),
      dependency(
        "spares-current",
        "Spares latest dependency note",
        "warehouse-cache 3 is now required at this protected source. Prior approval must be refreshed against the exact new basis.",
      ),
    ],
    expected: expected(
      "stale-review",
      "spares-working",
      ["spares-working", "spares-old", "spares-current"],
      "warehouse-cache 0",
      "warehouse-cache 3",
      "refresh",
    ),
  }),
  migration({
    id: "held-missing-original-owner-chain",
    split: "test",
    goal: "Check the Team Archive's migration candidate. The document title and preview look compelling, but we need to know which current owner can approve the change. Give only the evidence that survives the owner check.",
    records: [
      candidate(
        "archive-proposal",
        "Team Archive migration candidate",
        "Editor Cora created a private preview. The candidate's old lead left, and no replacement owner was recorded.",
      ),
      receipt(
        "archive-preview",
        "Team Archive preview receipt",
        "Rendered by Cora. Preview receipt lists no owner authorization or protected adoption.",
      ),
      approval(
        "archive-boundary",
        "Team Archive current approvals",
        "No signed transfer of release authority exists. Review is private and no recipient is authorized.",
      ),
    ],
    expected: expected(
      "awaiting-approval",
      "archive-proposal",
      ["archive-proposal", "archive-preview", "archive-boundary"],
      "Cora",
      "release authority",
    ),
  }),
  migration({
    id: "handoff-review-with-version-ownership",
    goal: "The Catalog team has an approved local review draft but no deployment. Check the review version and compatible dependency against the installed workspace. Leave a local ready-for-review package for the Build Desk and no other owner.",
    records: [
      candidate(
        "catalog-draft",
        "Catalog migration workspace review",
        "Review 4.2 is local and owned by Catalog. Its planned dependency uses chart-loader 6.",
      ),
      dependency(
        "catalog-compatibility",
        "Catalog approved compatibility",
        "chart-loader 6 is supported against installed Examples {{installed}}. This does not install review 4.2.",
      ),
      approval(
        "catalog-handoff",
        "Catalog internal distribution",
        "Only Build Desk may receive the exact local ready-for-review package.",
      ),
    ],
    handoff: { recipient: "Build Desk", candidateId: "catalog-draft" },
    expected: expected(
      "ready-for-review",
      "catalog-draft",
      ["catalog-draft", "catalog-compatibility", "catalog-handoff"],
      "4.2",
      "chart-loader 6",
      "Build Desk",
    ),
  }),
];

export const openTemplateMigrationRequiresUnits = [
  "skills/open-user-goal",
  "skills/template-candidate",
  "skills/template-candidate-bindings",
  "extensions/templates",
];
