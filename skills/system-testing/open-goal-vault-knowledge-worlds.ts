import { openVaultRendererWorlds } from "./open-goal-vault-renderer-worlds.js";
import { openVaultGraphWorlds } from "./open-goal-vault-graph-worlds.js";
import type { VaultKnowledgeWorld } from "@workspace-skills/spectrolite-review-fixtures/knowledge-managed";
type World = VaultKnowledgeWorld;
type Step = World["expected"]["steps"][number];
type Findings = Extract<Step, { kind: "read" }>["findings"];
type Case = Omit<World, "kind" | "workspace" | "sourceGroup">;
const note = (title: string, body: string) =>
  "---\ntitle: " + title + "\n---\n\n# " + title + "\n\n" + body + "\n";
const callout = (text: string) =>
  '<Callout color="blue"><Callout.Text>' + text + "</Callout.Text></Callout>";
const doc: Findings[number] = ["document", "document-ready"];
const broken: Findings[number] = ["document", "broken-link"];
const same: Findings[number] = ["revision", "revision-unchanged"];
const changed: Findings[number] = ["revision", "draft-changed"];
const shown: Findings[number] = ["preview", "preview-ready"];
const plain: Findings[number] = ["preview", "preview-missing"];
const read = (path: string, ...findings: Findings): Step => ({
  kind: "read",
  path,
  findings: findings.length ? findings : [doc],
});
const hop = (from: string, target: string, to: string): Step => ({
  kind: "follow",
  from,
  target,
  to,
});
const write = (path: string, source: string): Step => ({
  kind: "write",
  path,
  source,
});
const goal = (input: Case): World => ({
  ...input,
  kind: "vaultWork",
  workspace: "spectrolite",
  sourceGroup: "vibestudio:spectrolite-knowledge:" + input.id,
});

type Link = { name: string; folder: string; text: string; findings?: Findings };
type Entry = {
  id: string;
  goal: string;
  requestedReturnRequired: boolean;
  start: string;
  startText: string;
  startFindings?: Findings;
  links: Link[];
  outcome: World["expected"]["outcome"];
  citations: string[];
  split?: "test";
  extra?: Record<string, string>;
  draft?: World["draft"];
  handoff?: World["handoff"];
  disposition?: World["expected"]["disposition"];
};
function evidence({
  id,
  goal: request,
  requestedReturnRequired,
  start,
  startText,
  startFindings,
  links,
  outcome,
  citations,
  split,
  extra,
  draft,
  handoff,
  disposition,
}: Entry): World {
  const openPath = start + ".mdx";
  const files: Record<string, string> = {
    [openPath]: note(start, startText),
    ...extra,
  };
  const steps: Step[] = startFindings ? [read(openPath, ...startFindings)] : [];
  let path = openPath;
  for (const { name, folder, text, findings } of links) {
    const destination = folder + "/" + name + ".mdx";
    files[destination] = note(name, text);
    steps.push(
      hop(path, name, destination),
      read(destination, ...(findings ?? [doc])),
    );
    path = destination;
  }
  return goal({
    id,
    goal: request,
    requestedReturnRequired,
    openPath,
    files,
    draft,
    split,
    handoff,
    expected: { outcome, citations, path, steps, disposition },
  });
}

const evidenceGoals = [
  evidence({
    id: "vault-compare-dock-shift-authority",
    requestedReturnRequired: true,
    start: "Dock Index",
    goal: "Do we give the night crew the time in the radio transcript or the signed shift order? From Dock Index, review the transcript and the order it cites, then state the exact controlling time and why it wins. Leave both records alone.",
    startText: "Start at [[Radio Transcript]].",
    links: [
      {
        name: "Radio Transcript",
        folder: "radio",
        text: "21:00 sounded possible. Read the signed [[Dock Shift Order]].",
      },
      {
        name: "Dock Shift Order",
        folder: "orders",
        text: "Signed by shift lead. Night relief begins at 22:30.",
      },
    ],
    outcome: "authority-confirmed",
    citations: ["21:00", "22:30", "Dock Shift Order"],
  }),
  evidence({
    id: "vault-compare-two-unsigned-instrument-records",
    requestedReturnRequired: true,
    split: "test",
    start: "Calibration Card",
    goal: "The calibration card links to two readings for the same instrument. Work through both records using the first reading's cross-link. Decide whether either can be treated as a released calibration and give both numbers to the owner. Do not choose a winner merely because one was written later.",
    startText: "See [[Station A Reading]].",
    links: [
      {
        name: "Station A Reading",
        folder: "lab",
        text: "Observed tolerance ±2 mm; no reviewer sign-off. Compare [[Station B Reading]].",
      },
      {
        name: "Station B Reading",
        folder: "lab",
        text: "Observed tolerance ±5 mm; different instrument configuration. Pending sign-off.",
      },
    ],
    outcome: "conflict-unresolved",
    citations: ["±2 mm", "±5 mm", "sign-off"],
  }),
  evidence({
    id: "vault-use-replacement-venue-decision",
    requestedReturnRequired: true,
    start: "Venue Bulletin",
    goal: "The public Venue Bulletin still cites yesterday's briefing. Trace the replacement chain from the bulletin through the old briefing to the final ruling, and tell me which venue is now authoritative. Report both destinations without editing.",
    startText: "Venue as discussed: [[Draft Venue Brief]].",
    links: [
      {
        name: "Draft Venue Brief",
        folder: "archive",
        text: "Old proposal: Cedar Hall. Superseded in full by [[Final Venue Ruling]].",
      },
      {
        name: "Final Venue Ruling",
        folder: "approved",
        text: "Signed location: Elm Pavilion.",
      },
    ],
    outcome: "authority-confirmed",
    citations: ["Cedar Hall", "Elm Pavilion", "Final Venue Ruling"],
  }),
  evidence({
    id: "vault-separate-budget-draft-from-adopted-cap",
    requestedReturnRequired: true,
    start: "Budget Decision Register",
    goal: "We need the adopted expense ceiling, and I think the working finance copy contains a later proposal. Read the Board Cap and then the Finance Working Copy it links, comparing the latter to its committed text. Tell me the authorized and proposed amounts.",
    startText: "The adopted figure starts at [[Board Cap]].",
    links: [
      {
        name: "Board Cap",
        folder: "decisions",
        text: "Adopted cap €4,500. [[Finance Working Copy]] tracks proposals separately.",
      },
      {
        name: "Finance Working Copy",
        folder: "finance",
        text: "Reference figure €4,500.",
        findings: [doc, changed],
      },
    ],
    draft: {
      "finance/Finance Working Copy.mdx": note(
        "Finance Working Copy",
        "New proposal €6,200. Board approval absent.",
      ),
    },
    outcome: "draft-differs",
    citations: ["€4,500", "€6,200", "Finance Working Copy"],
  }),
  evidence({
    id: "vault-attribute-correct-interview-version",
    requestedReturnRequired: true,
    start: "Interview Index",
    goal: "I'm writing the oral history caption. Check the archive excerpt and the release card that corrects it. Preserve the literal wording of both in your advice and identify what authenticated the correction.",
    startText: "Start with [[Archive Excerpt]].",
    links: [
      {
        name: "Archive Excerpt",
        folder: "media",
        text: "Transcript had first winter. Check [[Release Card]] for approved wording.",
      },
      {
        name: "Release Card",
        folder: "release",
        text: "Approved caption: first spring. Verified against recording ledger.",
      },
    ],
    outcome: "authority-confirmed",
    citations: ["first winter", "first spring", "recording ledger"],
  }),
  evidence({
    id: "vault-show-unsatisfied-checklist-authority",
    requestedReturnRequired: true,
    split: "test",
    start: "Mixing Instructions",
    goal: "Two linked drafts disagree about where the mixing checklist belongs. Read both before advising me. Neither claims to be the safety owner's release, so leave the destination open and record both proposed locations for the owner.",
    startText: "The proposal begins in [[Transfer Draft]].",
    links: [
      {
        name: "Transfer Draft",
        folder: "safety",
        text: "Proposed location: cabinet C. Unsigned. Related [[Store Room Memo]].",
      },
      {
        name: "Store Room Memo",
        folder: "stores",
        text: "Alternative: locker F. Pending safety review.",
      },
    ],
    outcome: "conflict-unresolved",
    citations: ["cabinet C", "locker F", "safety"],
  }),
  evidence({
    id: "vault-trace-retired-conservation-ledger",
    requestedReturnRequired: true,
    start: "Loan Transfer",
    startFindings: [broken],
    goal: "Did the old Conservation Ledger simply move, or was it retired? Review the broken link in Loan Transfer, then follow the retirement register and successor it cites. Report both labels and leave the tombstone intact.",
    startText:
      "Old ledger: [[Conservation Ledger]]. See [[Ledger Retirement Register]].",
    links: [
      {
        name: "Ledger Retirement Register",
        folder: "register",
        text: "Conservation Ledger retired. Use [[Condition Ledger]].",
      },
      {
        name: "Condition Ledger",
        folder: "records",
        text: "Current condition records.",
      },
    ],
    extra: {
      "records/Conservation Ledger.mdx": note(
        "Conservation Ledger",
        "Old condition entries.",
      ),
    },
    draft: { "records/Conservation Ledger.mdx": null },
    outcome: "retired-link",
    citations: ["Conservation Ledger", "Condition Ledger", "retired"],
  }),
  evidence({
    id: "vault-catch-identical-label-pointing-at-archive",
    requestedReturnRequired: true,
    start: "Visitor Counter",
    startFindings: [doc],
    goal: "Two links on Visitor Counter display Info Desk. Check the counter note, follow the old desk and then the current desk it links. Tell me which actual record is open for use today and where the visitor should go.",
    startText:
      "The top link is [[Archive Desk|Info Desk]]. [[Current Desk|Info Desk]] is the second.",
    links: [
      {
        name: "Archive Desk",
        folder: "archive",
        text: "Closed historical desk. Current route: [[Current Desk|Info Desk]].",
      },
      {
        name: "Current Desk",
        folder: "public",
        text: "Visit Room 12 for live help.",
      },
    ],
    outcome: "authority-confirmed",
    citations: ["Archive Desk", "Current Desk", "Room 12"],
  }),
  evidence({
    id: "vault-avoid-substitute-for-withdrawn-supplier",
    requestedReturnRequired: true,
    split: "test",
    start: "Order Draft",
    startFindings: [broken],
    goal: "The working Order Draft claims a supplier is current. Check whether its link still resolves and inspect the Procurement Register for a replacement. If none is approved, don't substitute the neighboring account or edit the draft.",
    startText:
      "Current supplier: [[Hearth Supplier]]. Review [[Procurement Register]].",
    links: [
      {
        name: "Procurement Register",
        folder: "procurement",
        text: "Hearth Supplier withdrawn. No approved replacement. [[River Supplier]] is another contract.",
      },
    ],
    extra: {
      "suppliers/Hearth Supplier.mdx": note(
        "Hearth Supplier",
        "Expired contract.",
      ),
      "suppliers/River Supplier.mdx": note(
        "River Supplier",
        "Separate contract.",
      ),
    },
    draft: { "suppliers/Hearth Supplier.mdx": null },
    outcome: "retired-link",
    citations: ["Hearth Supplier", "No approved replacement"],
  }),
  evidence({
    id: "vault-review-linked-route-through-display-alias",
    requestedReturnRequired: true,
    start: "Guest Intake",
    startFindings: [doc],
    goal: "A volunteer followed the Registration link and thought it was general admission. Review what the aliased link really points to, then follow that record's referral. Tell me the two places handle, before anyone edits the intake card.",
    startText: "Open [[Support Intake|Registration]].",
    links: [
      {
        name: "Support Intake",
        folder: "support",
        text: "Support Intake handles access requests. General admission begins at [[Admission Desk]].",
      },
      {
        name: "Admission Desk",
        folder: "public",
        text: "Admission Desk handles day passes.",
      },
    ],
    outcome: "authority-confirmed",
    citations: ["access requests", "day passes", "Support Intake"],
  }),
  evidence({
    id: "vault-check-freight-print-warning-in-renderer",
    requestedReturnRequired: true,
    start: "Freight Print Desk",
    startFindings: [doc],
    goal: "We print freight labels only if their warning appears in an actual callout. Read the approval's expected wording, then check the working Freight Print Proof against its committed proof and the renderer. Do not update either.",
    startText:
      "Approved warning: Stop at barrier three. See [[Freight Print Proof]].",
    links: [
      {
        name: "Freight Print Proof",
        folder: "print",
        text: callout("Stop at barrier three."),
        findings: [doc, plain, changed],
      },
    ],
    draft: {
      "print/Freight Print Proof.mdx": note(
        "Freight Print Proof",
        "Stop at barrier three.",
      ),
    },
    outcome: "preview-unavailable",
    citations: ["Stop at barrier three", "callout", "working"],
  }),
  evidence({
    id: "vault-assess-unchanged-advisory-with-unrelated-draft",
    requestedReturnRequired: true,
    split: "test",
    start: "Breakwater Summary",
    goal: "Check whether the Boarding Card really renders the colored boarding advisory and whether its text still matches the committed version. A separate draft in the vault shouldn't affect that comparison.",
    startText: "Use [[Boarding Card]].",
    links: [
      {
        name: "Boarding Card",
        folder: "cards",
        text: callout("Show wristbands before boarding."),
        findings: [doc, shown, same],
      },
    ],
    extra: { "staff/Drydock Log.mdx": note("Drydock Log", "Awaiting review.") },
    draft: {
      "staff/Drydock Log.mdx": note("Drydock Log", "Working layout test."),
    },
    outcome: "preview-confirmed",
    citations: ["Show wristbands before boarding", "committed"],
  }),
  evidence({
    id: "vault-compare-translated-callout-rendering",
    requestedReturnRequired: true,
    start: "Language Booth",
    goal: "The Language Booth needs the accessible notice in both languages. Follow the French card and its English companion. Confirm which card actually renders the requested callout, citing both literal instructions.",
    startText: "Start at [[French Access Card]].",
    links: [
      {
        name: "French Access Card",
        folder: "booth",
        text:
          callout("Accueil à gauche.") +
          "\n\nCompanion: [[English Access Card]].",
        findings: [doc, shown],
      },
      {
        name: "English Access Card",
        folder: "booth",
        text: "Reception on the left.",
        findings: [doc, plain],
      },
    ],
    outcome: "preview-unavailable",
    citations: ["Accueil à gauche", "Reception on the left", "callout"],
  }),
  evidence({
    id: "vault-assess-uncommitted-poster-that-renders",
    requestedReturnRequired: true,
    start: "Festival Poster Index",
    startFindings: [doc],
    goal: "Compare the working poster with the committed poster. The new text may already render, but tell me whether that makes it the signed copy. Report both the signed and working directions.",
    startText: "Signed instruction: use Maple Lane. See [[Festival Poster]].",
    links: [
      {
        name: "Festival Poster",
        folder: "public",
        text: callout("Enter on Maple Lane."),
        findings: [doc, shown, changed],
      },
    ],
    draft: {
      "public/Festival Poster.mdx": note(
        "Festival Poster",
        callout("Enter on Birch Walk."),
      ),
    },
    outcome: "draft-differs",
    citations: ["Maple Lane", "Birch Walk", "committed"],
  }),
];

type DocumentEdit = {
  name: string;
  before: string;
  after: string;
  checks?: Findings;
};
type JointEdit = {
  id: string;
  goal: string;
  requestedReturnRequired: boolean;
  authority: string;
  approval: string;
  first: DocumentEdit;
  second: DocumentEdit;
  citations: string[];
  split?: "test";
  movement?: string;
};
function joint({
  id,
  goal: request,
  requestedReturnRequired,
  authority,
  approval,
  first,
  second,
  citations,
  split,
  movement,
}: JointEdit): World {
  const start = authority + ".mdx";
  const a = "working/" + first.name + ".mdx";
  const b = "working/" + second.name + ".mdx";
  const next = "\n\nRelated copy: [[" + second.name + "]].";
  const aEnd = note(first.name, first.after + next) + (movement ?? "");
  const bEnd = note(second.name, second.after);
  return goal({
    id,
    goal: request,
    requestedReturnRequired,
    openPath: start,
    split,
    files: {
      [start]: note(
        authority,
        approval + "\n\nBegin at [[" + first.name + "]].",
      ),
      [a]: note(first.name, first.before + next),
      [b]: note(second.name, second.before),
    },
    writable: [a, b],
    ...(movement && { movement: { path: a, addition: movement } }),
    expected: {
      outcome: "edited",
      path: b,
      citations,
      steps: [
        read(start),
        hop(start, first.name, a),
        read(a),
        write(a, aEnd),
        read(a, ...(first.checks ?? [doc, changed])),
        hop(a, second.name, b),
        read(b),
        write(b, bEnd),
        read(b, ...(second.checks ?? [doc, changed])),
      ],
    },
  });
}

const jointGoals = [
  joint({
    id: "vault-repair-access-directions-across-public-and-internal-cards",
    requestedReturnRequired: false,
    authority: "Accessibility Ruling",
    goal: "The signed Accessibility Ruling supersedes both directions. Update the Visitor Entry Card first, prove its advisory still renders, then use its linked Steward Card to update that instruction too. Keep both personal reminders.",
    approval:
      "Approved: use Birch Gate. Visitors need the color callout; stewards should retain their clipboard reminder.",
    first: {
      name: "Visitor Entry Card",
      before: callout("Use Cedar Gate.") + "\n\nBring water.",
      after: callout("Use Birch Gate.") + "\n\nBring water.",
      checks: [doc, shown, changed],
    },
    second: {
      name: "Steward Card",
      before: "Use Cedar Gate.\n\nBring the clipboard.",
      after: "Use Birch Gate.\n\nBring the clipboard.",
    },
    citations: ["Birch Gate", "Visitor Entry Card", "Steward Card"],
  }),
  joint({
    id: "vault-update-quiet-hour-and-event-sign-with-different-details",
    requestedReturnRequired: false,
    authority: "Noise Permit",
    goal: "Read the permit, update the venue's Quiet Hour Sheet and then its linked Event Exit Sign. The internal sheet needs the new time, and the public sign needs the approved exit street. Do not copy the internal time into the public sign.",
    approval:
      "Approved internal quiet hour: 20:15. Public exit direction: Orchard Street.",
    first: {
      name: "Quiet Hour Sheet",
      before: "Quiet hour: 21:00.\n\nLog complaints at the desk.",
      after: "Quiet hour: 20:15.\n\nLog complaints at the desk.",
    },
    second: {
      name: "Event Exit Sign",
      before: "Exit onto Park Road.\n\nKeep the pavement clear.",
      after: "Exit onto Orchard Street.\n\nKeep the pavement clear.",
    },
    citations: ["20:15", "Orchard Street"],
  }),
  joint({
    id: "vault-reconcile-a-changing-steward-note-with-wardens-copy",
    requestedReturnRequired: false,
    authority: "Firewatch Approval",
    split: "test",
    goal: "The Firewatch Approval controls the new muster point. Update the working Steward Checklist first, then fix the linked Warden Copy. If the steward file changes while you are working, preserve the new material and rebase the correction. Keep the committed vault untouched.",
    approval: "Muster point: Bell Courtyard (not East Arcade).",
    first: {
      name: "Steward Checklist",
      before: "Muster at East Arcade.\n\nConfirm floor attendance.",
      after: "Muster at Bell Courtyard.\n\nConfirm floor attendance.",
    },
    second: {
      name: "Warden Copy",
      before: "Crew muster: East Arcade.\n\nKeep the radio spare.",
      after: "Crew muster: Bell Courtyard.\n\nKeep the radio spare.",
    },
    movement: "\nOwner addendum: keep the north stair clear.\n",
    citations: ["Bell Courtyard", "north stair", "Warden Copy"],
  }),
  joint({
    id: "vault-fix-donor-instructions-without-sharing-internal-id",
    requestedReturnRequired: false,
    authority: "Donor Desk Approval",
    goal: "Use the approval to fix the operating Receipt Checklist and then its linked public Drop-off Card. Keep the staff-only disposition code on the internal sheet. The public card should gain only the approved return address.",
    approval:
      "Internal disposition code: RET-4. Public address: Lantern Annex.",
    first: {
      name: "Receipt Checklist",
      before: "Disposition code: RET-2.\n\nNumber every carton.",
      after: "Disposition code: RET-4.\n\nNumber every carton.",
    },
    second: {
      name: "Drop-off Card",
      before: "Return to the East Shed.\n\nUse a sealed bag.",
      after: "Return to Lantern Annex.\n\nUse a sealed bag.",
    },
    citations: ["RET-4", "Lantern Annex", "Drop-off Card"],
  }),
  joint({
    id: "vault-sync-the-caption-and-preserve-two-language-confirmations",
    requestedReturnRequired: false,
    authority: "Caption Signoff",
    goal: "Read Caption Signoff, fix the French Caption Sheet, and then its linked English Companion Card. Preserve the printed line breaks and the English callout. Read both working revisions after writing them.",
    approval:
      "French approved line: Salle du nord. English approved line: North room.",
    first: {
      name: "French Caption Sheet",
      before: "Salle de l'est.\n\nNe rien déposer ici.",
      after: "Salle du nord.\n\nNe rien déposer ici.",
    },
    second: {
      name: "English Companion Card",
      before: callout("East room.") + "\n\nDo not leave bags here.",
      after: callout("North room.") + "\n\nDo not leave bags here.",
      checks: [doc, shown, changed],
    },
    citations: ["Salle du nord", "North room", "callout"],
  }),
  joint({
    id: "vault-rebase-print-labels-after-catalog-owner-moves-working-head",
    requestedReturnRequired: true,
    authority: "Specimen Label Decision",
    split: "test",
    goal: "Apply the museum's signed specimen identifier to the Gallery Label and then its linked Inventory Slip. The registrar may add a note to the working label during the update. Preserve that note and its callout; give me independent working readback from both documents.",
    approval:
      "Approved specimen identifier: M-345. Must not use guessed label M-354.",
    first: {
      name: "Gallery Label",
      before: callout("Specimen M-354.") + "\n\nKeep original base.",
      after: callout("Specimen M-345.") + "\n\nKeep original base.",
      checks: [doc, shown, changed],
    },
    second: {
      name: "Inventory Slip",
      before: "Identifier: M-354.\n\nRetain tray barcode.",
      after: "Identifier: M-345.\n\nRetain tray barcode.",
    },
    movement: "\nRegistrar note: the left column needs a bilingual caption.\n",
    citations: ["M-345", "bilingual caption", "Inventory Slip"],
  }),
];

const handoffGoals = [
  evidence({
    id: "vault-stage-clean-wardrobe-review-for-costume-desk",
    requestedReturnRequired: false,
    start: "Costume Lead",
    goal: "Review the linked Wardrobe Holding Plan and its live advisory. If the exact committed plan is clean and renders, leave a local review receipt addressed to Costume Desk. Do not send it.",
    startText: "Owner: Costume Desk. Review [[Wardrobe Holding Plan]].",
    links: [
      {
        name: "Wardrobe Holding Plan",
        folder: "plans",
        text: callout("Use rack six for returns."),
        findings: [doc, shown, same],
      },
    ],
    handoff: {
      path: "plans/Wardrobe Holding Plan.mdx",
      audience: "Costume Desk",
    },
    disposition: "committed-review",
    outcome: "handoff-staged",
    citations: ["rack six", "Costume Desk", "committed"],
  }),
  evidence({
    id: "vault-stage-vetting-receipt-for-uncommitted-proof",
    requestedReturnRequired: false,
    start: "Prototype Review",
    goal: "The Design Bench wants to review the current Assembly Warning proof, even if it's a working-only change. Compare it to the committed version, check the rendered callout, then stage a local receipt for Design Bench under the correct working disposition.",
    startText: "Approved reviewer: Design Bench. Follow [[Assembly Warning]].",
    links: [
      {
        name: "Assembly Warning",
        folder: "proof",
        text: callout("Handle by the outer case."),
        findings: [doc, shown, changed],
      },
    ],
    draft: {
      "proof/Assembly Warning.mdx": note(
        "Assembly Warning",
        callout("Handle by the base only."),
      ),
    },
    handoff: { path: "proof/Assembly Warning.mdx", audience: "Design Bench" },
    disposition: "draft-only",
    outcome: "handoff-staged",
    citations: ["base only", "Design Bench", "draft"],
  }),
  evidence({
    id: "vault-hold-handoff-when-inline-notice-no-longer-renders",
    requestedReturnRequired: true,
    start: "Piano Move Review",
    split: "test",
    goal: "Prepare a local handoff for the Piano Team only if the linked Ramp Packing Standard has a live advisory. The working copy might have removed the callout. Compare it with the committed copy and say what holds the handoff. Do not change the standard.",
    startText: "Audience: Piano Team. See [[Ramp Packing Standard]].",
    links: [
      {
        name: "Ramp Packing Standard",
        folder: "standards",
        text: callout("Wrap the rail before loading."),
        findings: [doc, plain, changed],
      },
    ],
    draft: {
      "standards/Ramp Packing Standard.mdx": note(
        "Ramp Packing Standard",
        "Wrap the rail before loading.",
      ),
    },
    handoff: {
      path: "standards/Ramp Packing Standard.mdx",
      audience: "Piano Team",
    },
    disposition: "hold",
    outcome: "handoff-held",
    citations: ["Piano Team", "callout", "working"],
  }),
  evidence({
    id: "vault-explain-draft-only-handoff-from-globally-dirty-vault",
    requestedReturnRequired: true,
    start: "Market Brief",
    goal: "The Market Clerk needs a local receipt for the Stall Assignment card. Verify both its actual rendering and whether its content matches the commit. Treat the review as draft-only if the vault has unrelated uncommitted work, and explain why the exact card and vault can differ in readiness.",
    startText: "Market Clerk owns this review. Open [[Stall Assignment]].",
    links: [
      {
        name: "Stall Assignment",
        folder: "market",
        text: callout("Collect keys at Bay Five."),
        findings: [doc, shown, same],
      },
    ],
    extra: {
      "private/Setup Chores.mdx": note("Setup Chores", "Assign tables."),
    },
    draft: {
      "private/Setup Chores.mdx": note(
        "Setup Chores",
        "Assign tables and confirm delivery.",
      ),
    },
    handoff: { path: "market/Stall Assignment.mdx", audience: "Market Clerk" },
    disposition: "draft-only",
    outcome: "handoff-staged",
    citations: ["Bay Five", "Market Clerk", "draft-only"],
  }),
];

export const openVaultKnowledgeWorlds = [
  ...evidenceGoals,
  ...jointGoals,
  ...handoffGoals,
  ...openVaultRendererWorlds,
  ...openVaultGraphWorlds,
];
