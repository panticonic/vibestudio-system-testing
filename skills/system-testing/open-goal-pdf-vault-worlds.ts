import type { OpenPdfWorld } from "./open-goal-pdf-worlds.js";
import type { OpenSpectroliteWorld } from "./open-goal-spectrolite-worlds.js";

type Correction = {
  id: string;
  sourceGroup: string;
  split?: "test";
  goal: string;
  pdf: Omit<OpenPdfWorld, "goal" | "id" | "sourceGroup" | "workspace" | "kind">;
  vault: Pick<OpenSpectroliteWorld, "openPath" | "files" | "draft" | "writablePath" | "expected">;
  concurrent?: { path: string; append: string };
};
const note = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
const row = (text: string) => [text];
const facts = (document: string, page: number, quotes: string[], render: number[] = []) => ({
  document, pages: [page], text: { status: "verified" as const, quotes: quotes.map(text => ({ page, text })) },
  render, action: "preserve-text" as const, evidenceTerms: [String(page), ...quotes],
});
const review = (path: string, route: OpenSpectroliteWorld["expected"]["route"], editedSource: string, visible: string) => ({
  path, route, editedSource, visible,
  findings: [["document", "document-ready"], ["navigation", "navigation-ready"], ["revision", "draft-changed"]] as OpenSpectroliteWorld["expected"]["findings"],
});
const correctionCases: readonly Correction[] = [
  {
    id: "pdf-vault-loading-bay-correction", sourceGroup: "arts-facility-loading",
    goal: "The approved venue access packet changed the line for instrument unloading. From the vault's Event Access index, find the performer arrival draft and correct only its unloading line verbatim from page 2 of the approved PDF. Check the original printed page and the resulting working revision. Preserve the rest of the draft and leave it uncommitted.",
    pdf: {
      documents: {
        "venue-approved-access-packet.pdf": [{ rows: [row("Venue Access"), row("Unloading is on page two.")] },
          { rows: [row("Performer Arrivals"), row("Instrument unloading begins at Bay C at 17:15.")] }],
        "venue-early-access-packet.pdf": [{ rows: [row("Old Venue Access")] },
          { rows: [row("Instrument unloading begins at Bay A at 16:00.")] }],
      },
      expected: facts("venue-approved-access-packet.pdf", 2, ["Instrument unloading begins at Bay C at 17:15."], [2]),
    },
    vault: {
      openPath: "Event Access.mdx", writablePath: "drafts/Performer Arrival.mdx",
      files: {
        "Event Access.mdx": note("Event access", "Use [[Venue Desk]] for working arrivals. [[Front Gate]] is for ticketing."),
        "ops/Venue Desk.mdx": note("Venue desk", "Continue to [[Performer Arrival]]."),
        "drafts/Performer Arrival.mdx": note("Performer arrival", "Instrument unloading begins at Bay A at 16:00.\n\nKeep the passenger lane clear."),
        "Front Gate.mdx": note("Front gate", "Ticket windows open at five."),
      },
      draft: { "drafts/Performer Arrival.mdx": note("Performer arrival", "Instrument unloading begins at Bay A at 16:00.\n\nKeep the passenger lane clear.\n\nWorking note: elevators use separate access.") },
      expected: review("drafts/Performer Arrival.mdx", [
        { from: "Event Access.mdx", target: "Venue Desk", to: "ops/Venue Desk.mdx" },
        { from: "ops/Venue Desk.mdx", target: "Performer Arrival", to: "drafts/Performer Arrival.mdx" },
      ], note("Performer arrival", "Instrument unloading begins at Bay C at 17:15.\n\nKeep the passenger lane clear.\n\nWorking note: elevators use separate access."), "Instrument unloading begins at Bay C at 17:15."),
    },
  },
  {
    id: "pdf-vault-clinic-live-draft-update", sourceGroup: "mobile-clinic-queue-brief",
    goal: "The clinic's approved queue bulletin is the source of truth for walk-ins. Pick out the walk-in line and update the public queue notice from the Dispatch Desk vault note. Use the wording verbatim. A colleague is still editing the notice, so review the latest working copy, carry their change forward, and verify what the editor shows. Leave it as a working draft.",
    pdf: {
      documents: {
        "clinic-approved-queue-bulletin.pdf": [{ rows: [row("Clinic Intake"), row("Walk-ins start at the north canopy at 08:20."), row("Appointments use the lobby.")] }],
        "clinic-queue-draft.pdf": [{ rows: [row("Clinic Intake"), row("Walk-ins start at the west ramp at 08:00.")] }],
      },
      expected: facts("clinic-approved-queue-bulletin.pdf", 1, ["Walk-ins start at the north canopy at 08:20."]),
    },
    concurrent: { path: "public/Public Queue Notice.mdx", append: "\nPlease keep the blue ramp clear.\n" },
    vault: {
      openPath: "Dispatch Desk.mdx", writablePath: "public/Public Queue Notice.mdx",
      files: {
        "Dispatch Desk.mdx": note("Dispatch desk", "Check [[Public Queue Notice]] for walk-ins and [[Staff Check-in]] for volunteers."),
        "public/Public Queue Notice.mdx": note("Public queue notice", "Walk-ins start at the west ramp at 08:00.\n\nBring your appointment reference if one was issued."),
        "Staff Check-in.mdx": note("Staff check-in", "The volunteer clipboard stays here."),
      },
      expected: review("public/Public Queue Notice.mdx", [
        { from: "Dispatch Desk.mdx", target: "Public Queue Notice", to: "public/Public Queue Notice.mdx" },
      ], note("Public queue notice", "Walk-ins start at the north canopy at 08:20.\n\nBring your appointment reference if one was issued.") + "\nPlease keep the blue ramp clear.\n", "Please keep the blue ramp clear."),
    },
  },
  {
    id: "pdf-vault-signed-checklist-hold", sourceGroup: "winter-fleet-checklists",
    goal: "Update the cold-start line in the fleet's working vault checklist from page 3 of the signed winter dispatch packet, but only if that exact page is present. The unsigned PDF is still around and cannot authorize a change. If the signed page is missing, report what is missing and leave the vault alone.",
    pdf: {
      documents: {
        "winter-signed-dispatch.pdf": [{ rows: [row("Signed Winter Dispatch")] }, { rows: [row("Vehicle Assignments")] }],
        "winter-unsigned-dispatch.pdf": [{ rows: [row("Unsigned Winter Dispatch")] }, { rows: [row("Vehicle Assignments")] },
          { rows: [row("Cold-start inspection begins at 05:15.")] }],
      },
      expected: { document: "winter-signed-dispatch.pdf", pages: [3], missing: [3], render: [],
        action: "recover-missing-pages", evidenceTerms: ["3"] },
    },
    vault: {
      openPath: "Fleet Index.mdx",
      files: {
        "Fleet Index.mdx": note("Fleet index", "The working [[Cold Start Checklist]] is awaiting supporting evidence."),
        "Cold Start Checklist.mdx": note("Cold start checklist", "Cold-start inspection begins at 06:30."),
      },
      expected: { path: "Fleet Index.mdx", route: [], findings: [] },
    },
  },
  {
    id: "pdf-vault-held-archive-access-revision", sourceGroup: "museum-archive-reading-room",
    split: "test",
    goal: "Bring the archive receiving note in the vault into line with the signed collections circular. The drop-off location and cutoff are two separate lines in the signed copy. Find both lines and take them verbatim into the working receiving note, keeping the other copy and its local reminder. Verify the revised working note against its committed revision. Do not commit it.",
    pdf: {
      documents: {
        "collections-signed-receiving-circular.pdf": [{ rows: [row("Collection Receiving"), row("Drop-off is at the east desk."), row("Intake closes at 16:40."), row("Retain the claim stub.")] }],
        "collections-unsigned-receiving-circular.pdf": [{ rows: [row("Drop-off is at the west desk."), row("Intake closes at 17:00.")] }],
      },
      expected: facts("collections-signed-receiving-circular.pdf", 1, ["Drop-off is at the east desk.", "Intake closes at 16:40."]),
    },
    vault: {
      openPath: "Archive Workbench.mdx", writablePath: "receiving/Current Receiving.mdx",
      files: {
        "Archive Workbench.mdx": note("Archive workbench", "Go to [[Current Receiving]] for walk-in holdings or [[Archive Hours]] for readers."),
        "receiving/Current Receiving.mdx": note("Current receiving", "Drop-off is at the west desk.\n\nIntake closes at 17:00.\n\nRetain the claim stub."),
        "Archive Hours.mdx": note("Archive hours", "Reader appointments happen on Thursdays."),
      },
      draft: { "receiving/Current Receiving.mdx": note("Current receiving", "Drop-off is at the west desk.\n\nIntake closes at 17:00.\n\nRetain the claim stub.\n\nLocal reminder: attach a green label.") },
      expected: review("receiving/Current Receiving.mdx", [
        { from: "Archive Workbench.mdx", target: "Current Receiving", to: "receiving/Current Receiving.mdx" },
      ], note("Current receiving", "Drop-off is at the east desk.\n\nIntake closes at 16:40.\n\nRetain the claim stub.\n\nLocal reminder: attach a green label."), "Local reminder: attach a green label."),
    },
  },
];
export type OpenPdfVaultWorld = Omit<Correction, "pdf" | "vault"> & {
  kind: "pdfVault";
  workspace: "spectrolite";
  pdf: OpenPdfWorld;
  vault: OpenSpectroliteWorld;
};
export const openGoalPdfVaultWorlds: readonly OpenPdfVaultWorld[] = correctionCases.map(world => ({
  ...world, kind: "pdfVault", workspace: "spectrolite",
  pdf: { ...world.pdf, goal: world.goal, id: world.id, sourceGroup: world.sourceGroup, kind: "pdf", workspace: "examples" },
  vault: { ...world.vault, goal: world.goal, id: world.id, sourceGroup: world.sourceGroup, kind: "spectrolite", workspace: "spectrolite" },
}));
