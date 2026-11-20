import type { OpenSpectroliteWorld } from "./open-goal-spectrolite-worlds.js";

const note = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
const callout = (text: string) => `<Callout color="blue"><Callout.Text>${text}</Callout.Text></Callout>`;
const documentReady: ["document", string] = ["document", "document-ready"];
const navigationReady: ["navigation", string] = ["navigation", "navigation-ready"];
const previewReady: ["preview", string] = ["preview", "preview-ready"];
const draftChanged: ["revision", string] = ["revision", "draft-changed"];
const draftProof = [documentReady, navigationReady, draftChanged];

export const addedSpectroliteGoalWorlds: readonly OpenSpectroliteWorld[] = [
  {
    kind: "spectrolite", workspace: "spectrolite", id: "fix-working-label-proof-link-from-release-note",
    goal: "The release note gives the correct registry label. Follow its link to the working seed-label proof, repair the stale registry link using that label, and confirm the destination is now resolvable and the proof is still a working revision. Keep the editor's extra handling note.",
    sourceGroup: "vibestudio:spectrolite:botanic-label-proof",
    openPath: "Release Note.mdx", writablePath: "proofs/Seed Label Proof.mdx",
    files: {
      "Release Note.mdx": note("Release note", "The approved registry link label is Southern Registry. Apply it in [[Seed Label Proof]]."),
      "proofs/Seed Label Proof.mdx": note("Seed label proof", "Registry: [[Southern Register]].\n\nUse waterproof paper."),
      "approved/Southern Registry.mdx": note("Southern registry", "Current accession numbers."),
      "archive/Southern Register Archive.mdx": note("Southern register archive", "Superseded label proofs."),
    },
    draft: { "proofs/Seed Label Proof.mdx": note("Seed label proof", "Registry: [[Southern Register]].\n\nUse waterproof paper.\n\nHandling note: keep away from the misting bench.") },
    expected: { path: "proofs/Seed Label Proof.mdx",
      route: [{ from: "Release Note.mdx", target: "Seed Label Proof", to: "proofs/Seed Label Proof.mdx" }],
      findings: draftProof, visible: "Southern Registry",
      editedSource: note("Seed label proof", "Registry: [[Southern Registry]].\n\nUse waterproof paper.\n\nHandling note: keep away from the misting bench.") },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "verify-rendered-glaze-handling-revision",
    goal: "The glaze handling note should be unchanged from the committed copy, and its safety instruction should render as a callout. Go to the handling note from the workshop's materials index and verify both. Leave the damaged-materials note alone.",
    sourceGroup: "vibestudio:spectrolite:glaze-handling-audit",
    openPath: "Materials Index.mdx",
    files: {
      "Materials Index.mdx": note("Materials index", "See [[Glaze Handling]] for normal work. Consult [[Damaged Materials]] only after an incident."),
      "safety/Glaze Handling.mdx": note("Glaze handling", callout("Use the splash guard before mixing.")),
      "safety/Damaged Materials.mdx": note("Damaged materials", callout("Do not transfer damaged jars.")),
    },
    draft: { "safety/Damaged Materials.mdx": note("Damaged materials", callout("Do not transfer damaged jars.") + "\n\nPending container audit.") },
    expected: { path: "safety/Glaze Handling.mdx",
      route: [{ from: "Materials Index.mdx", target: "Glaze Handling", to: "safety/Glaze Handling.mdx" }],
      findings: [documentReady, navigationReady, previewReady, ["revision", "revision-unchanged"]],
      visible: "Use the splash guard before mixing." },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "trace-required-step-free-route-to-broken-note",
    goal: "Walk the step-free entry route from the access desk. The ramp guide is meant to link to the lift check. Tell me exactly where visitors get stuck, including the route that still works. Don't change the guide. The stairs card is a separate route.",
    sourceGroup: "vibestudio:spectrolite:accessible-entry-wayfinding",
    openPath: "Access Desk.mdx",
    files: {
      "Access Desk.mdx": note("Access desk", "Step-free visits start at [[Ramp Arrival]]. The upstairs route starts at [[Stair Entry]]."),
      "routes/Ramp Arrival.mdx": note("Ramp arrival", "Continue to [[Ramp Guide]]."),
      "routes/Ramp Guide.mdx": note("Ramp guide", "Lift clearance is recorded in [[Lift Check]]."),
      "routes/Stair Entry.mdx": note("Stair entry", "The lobby desk can open the stairwell."),
    },
    expected: { path: "routes/Ramp Guide.mdx", route: [
      { from: "Access Desk.mdx", target: "Ramp Arrival", to: "routes/Ramp Arrival.mdx" },
      { from: "routes/Ramp Arrival.mdx", target: "Ramp Guide", to: "routes/Ramp Guide.mdx" },
    ], findings: [["document", "broken-link"], navigationReady], visible: "Lift clearance" },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "replace-visible-safety-advisory-with-approved-copy",
    goal: "The lab approval note has the new storage advisory. Use its link to update the sentence inside the existing callout in the working label, keeping the callout and every other line as they are. Verify the new wording really renders and remains only a working change.",
    sourceGroup: "vibestudio:spectrolite:lab-storage-warning",
    openPath: "Advisory Approval.mdx", writablePath: "labels/Working Advisory.mdx",
    files: {
      "Advisory Approval.mdx": note("Advisory approval", "Approved sentence: Keep the transfer cabinet locked after 17:00.\n\nApply it to [[Working Advisory]]."),
      "labels/Working Advisory.mdx": note("Working advisory", callout("Close the cabinet when leaving.") + "\n\nThe instrument log stays on the lower shelf."),
    },
    expected: { path: "labels/Working Advisory.mdx",
      route: [{ from: "Advisory Approval.mdx", target: "Working Advisory", to: "labels/Working Advisory.mdx" }],
      findings: [documentReady, navigationReady, previewReady, draftChanged],
      visible: "Keep the transfer cabinet locked after 17:00.",
      editedSource: note("Working advisory", callout("Keep the transfer cabinet locked after 17:00.") + "\n\nThe instrument log stays on the lower shelf.") },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "inspect-missing-preview-in-retained-indexed-draft", split: "test",
    goal: "We are checking the orchestra chair checklist before publishing the score inserts. Follow the rehearsal index to the working chair checklist and check whether the draft is behind the committed version on the seat warning: is the warning just plain text or does an inline callout render? Don't change the checklist.",
    sourceGroup: "vibestudio:spectrolite:orchestra-chair-checklist",
    openPath: "Rehearsal Index.mdx",
    files: {
      "Rehearsal Index.mdx": note("Rehearsal index", "The draft sheet is [[Chair Checklist]]. The score archive is [[Score History]]."),
      "checks/Chair Checklist.mdx": note("Chair checklist", callout("Keep the first row clear of cases.")),
      "Score History.mdx": note("Score history", "Past rehearsals."),
    },
    draft: { "checks/Chair Checklist.mdx": note("Chair checklist", "Keep the first row clear of cases.\n\nDraft note: stands will be set after lunch.") },
    expected: { path: "checks/Chair Checklist.mdx",
      route: [{ from: "Rehearsal Index.mdx", target: "Chair Checklist", to: "checks/Chair Checklist.mdx" }],
      findings: [documentReady, navigationReady, ["preview", "preview-missing"], draftChanged], visible: "stands will be set after lunch" },
  },
  {
    kind: "spectrolite", workspace: "spectrolite", id: "make-two-approved-changes-without-touching-crew-note", split: "test",
    goal: "The freight lead's instructions opened in the vault are the approved copy. Update the vehicle staging draft linked there with its gate and time lines verbatim. Keep the crew reminder already in the working version. Verify the resulting link route and working revision, and leave it uncommitted.",
    sourceGroup: "vibestudio:spectrolite:stage-freight-working-release",
    openPath: "Freight Instructions.mdx", writablePath: "drafts/Vehicle Staging.mdx",
    files: {
      "Freight Instructions.mdx": note("Freight instructions", "Gate: use the East Annex.\n\nTime: arrive at 06:45.\n\nApply to [[Vehicle Staging]]."),
      "drafts/Vehicle Staging.mdx": note("Vehicle staging", "Gate: use the West Annex.\n\nTime: arrive at 07:30.\n\nWear a safety vest."),
      "ops/Scanner Setup.mdx": note("Scanner setup", "Leave scanners on dock."),
    },
    draft: { "drafts/Vehicle Staging.mdx": note("Vehicle staging", "Gate: use the West Annex.\n\nTime: arrive at 07:30.\n\nWear a safety vest.\n\nCrew reminder: bring the signed manifest.") },
    expected: { path: "drafts/Vehicle Staging.mdx",
      route: [{ from: "Freight Instructions.mdx", target: "Vehicle Staging", to: "drafts/Vehicle Staging.mdx" }],
      findings: draftProof, visible: "Crew reminder: bring the signed manifest.",
      editedSource: note("Vehicle staging", "Gate: use the East Annex.\n\nTime: arrive at 06:45.\n\nWear a safety vest.\n\nCrew reminder: bring the signed manifest.") },
  },
];
