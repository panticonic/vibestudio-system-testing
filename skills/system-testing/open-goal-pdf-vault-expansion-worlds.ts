import type { Correction } from "./open-goal-pdf-vault-worlds.js";
import type { OpenSpectroliteWorld } from "./open-goal-spectrolite-worlds.js";

const note = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
const callout = (text: string) => `<Callout color="blue"><Callout.Text>${text}</Callout.Text></Callout>`;
const sheet = (...lines: string[]) => ({ rows: lines.map(text => [text]) });
const quotesFrom = (document: string, quotes: { page: number; text: string }[], render: number[] = []) => ({
  document, pages: [...new Set(quotes.map(({ page }) => page))], text: { status: "verified" as const, quotes },
  render, action: "preserve-text" as const, evidenceTerms: [...new Set(quotes.map(({ page }) => String(page))), ...quotes.map(({ text }) => text)],
});
const edit = (path: string, route: OpenSpectroliteWorld["expected"]["route"], visible: string, editedSource: string, preview = false) => ({
  path, route, visible, editedSource,
  findings: [["document", "document-ready"], ["navigation", "navigation-ready"], ["revision", "draft-changed"],
    ...(preview ? [["preview", "preview-ready"]] : [])] as OpenSpectroliteWorld["expected"]["findings"],
});

export const addedPdfVaultCorrections: readonly Correction[] = [
  {
    id: "pdf-vault-align-loading-and-staging-from-separate-pages",
    sourceGroup: "vibestudio:pdf-vault:field-exhibit-crate-routing",
    goal: "Synchronize the field exhibit crate instructions in the working vault with the amended courier circular. The staging instruction is on page 1 and the loading limit is on page 2. Copy those two lines exactly, keep the barcode instruction and working reminder, and verify the uncommitted result. The Courier Index leads to the working note.",
    pdf: {
      documents: {
        "courier-amended-field-exhibit-circular.pdf": [
          sheet("Amended Courier Circular", "Stage crates along the marked wall."),
          sheet("Loading Limits", "Load at most 18 kg per crate."),
        ],
        "courier-earlier-field-exhibit-circular.pdf": [
          sheet("Earlier Courier Circular", "Stage crates outside the loading area."),
          sheet("Loading Limits", "Load at most 20 kg per crate."),
        ],
      },
      expected: quotesFrom("courier-amended-field-exhibit-circular.pdf", [
        { page: 1, text: "Stage crates along the marked wall." }, { page: 2, text: "Load at most 18 kg per crate." },
      ]),
    },
    vault: {
      openPath: "Courier Index.mdx", writablePath: "dispatch/Crate Instructions.mdx",
      files: {
        "Courier Index.mdx": note("Courier index", "The working crate text is [[Crate Instructions]]. [[Invoice Contacts]] is for billing."),
        "dispatch/Crate Instructions.mdx": note("Crate instructions", "Stage crates outside the loading area.\n\nLoad at most 20 kg per crate.\n\nFace barcodes out."),
        "Invoice Contacts.mdx": note("Invoice contacts", "Invoices go to the central desk."),
      },
      draft: { "dispatch/Crate Instructions.mdx": note("Crate instructions", "Stage crates outside the loading area.\n\nLoad at most 20 kg per crate.\n\nFace barcodes out.\n\nWorking reminder: count empty cartons.") },
      expected: edit("dispatch/Crate Instructions.mdx", [
        { from: "Courier Index.mdx", target: "Crate Instructions", to: "dispatch/Crate Instructions.mdx" },
      ], "Load at most 18 kg per crate.", note("Crate instructions", "Stage crates along the marked wall.\n\nLoad at most 18 kg per crate.\n\nFace barcodes out.\n\nWorking reminder: count empty cartons.")),
    },
  },
  {
    id: "pdf-vault-reconcile-transit-call-board-during-coedit",
    sourceGroup: "vibestudio:pdf-vault:transit-maintenance-call-board",
    goal: "The transit supervisor's signed release changed the signal test start line. Get the exact line from that PDF, then correct the working call board linked from the Signal Desk vault note. Someone is adding a separate radio reminder at the same time. Keep the latest unrelated copy and verify the uncommitted version.",
    pdf: {
      documents: {
        "supervisor-signed-signal-release.pdf": [sheet("Signal Test Release", "Signal testing starts at Platform 8 at 22:10.")],
        "signal-release-unapproved-proof.pdf": [sheet("Signal Test Proof", "Signal testing starts at Platform 5 at 22:00.")],
      },
      expected: quotesFrom("supervisor-signed-signal-release.pdf", [{ page: 1, text: "Signal testing starts at Platform 8 at 22:10." }]),
    },
    concurrent: { path: "ops/Working Call Board.mdx", append: "\nRadio reminder: check in on channel four.\n" },
    vault: {
      openPath: "Signal Desk.mdx", writablePath: "ops/Working Call Board.mdx",
      files: {
        "Signal Desk.mdx": note("Signal desk", "Crew call details live in [[Working Call Board]]."),
        "ops/Working Call Board.mdx": note("Working call board", "Signal testing starts at Platform 5 at 22:00.\n\nReport to the supervisor first."),
      },
      expected: edit("ops/Working Call Board.mdx", [
        { from: "Signal Desk.mdx", target: "Working Call Board", to: "ops/Working Call Board.mdx" },
      ], "Radio reminder: check in on channel four.", note("Working call board", "Signal testing starts at Platform 8 at 22:10.\n\nReport to the supervisor first.") + "\nRadio reminder: check in on channel four.\n"),
    },
  },
  {
    id: "pdf-vault-hold-unsigned-label-claim-absent-from-signed-copy",
    sourceGroup: "vibestudio:pdf-vault:conservation-material-signoff",
    goal: "Only update the working coating-instructions note if the signed conservation issue actually states the new curing time. The draft copy includes a time that someone pencilled in. Inspect the selectable text on page 1 of the signed issue. If it gives no curing time, explain the unsupported claim and leave the vault as it is.",
    pdf: {
      documents: {
        "conservation-signed-issue.pdf": [sheet("Signed Conservation Issue", "Record surface condition before applying the coating.", "Ventilate the room before opening supplies.")],
        "conservation-working-draft.pdf": [sheet("Working Draft", "Cure the coating for 36 hours.")],
      },
      expected: {
        document: "conservation-signed-issue.pdf", pages: [1],
        text: { status: "no-match", quotes: [], noMatchLines: [
          "Signed Conservation Issue", "Record surface condition before applying the coating.",
          "Ventilate the room before opening supplies.",
        ] },
        render: [], action: "needs-review", evidenceTerms: ["1", "curing"],
      },
    },
    holdReason: { terms: ["curing"], reference: "The signed issue does not state a curing time." },
    vault: {
      openPath: "Conservation Desk.mdx",
      files: {
        "Conservation Desk.mdx": note("Conservation desk", "The working instructions are at [[Coating Instructions]]."),
        "Coating Instructions.mdx": note("Coating instructions", "Cure time is pending confirmation."),
      },
      expected: { path: "Conservation Desk.mdx", route: [], findings: [] },
    },
  },
  {
    id: "pdf-vault-use-manifest-addendum-instead-of-cover",
    sourceGroup: "vibestudio:pdf-vault:winter-market-delivery-addendum",
    goal: "Change the winter market vendor draft's delivery sentence to the one in the signed manifest addendum. The cover and packing checklist still use the old arrival window; use only page 3. Check the original print view of that sheet and the edited working revision. Keep the other copy in the draft.",
    pdf: {
      documents: {
        "market-signed-delivery-manifest.pdf": [
          sheet("Signed Market Manifest", "Vendor deliveries start at 05:30."),
          sheet("Packing Checklist", "Vendor deliveries start at 05:30."),
          sheet("Signed Addendum", "Vendor deliveries start at 06:15 through Gate 2."),
        ],
        "market-delivery-cover.pdf": [sheet("Cover", "Vendor deliveries start at 05:30.")],
      },
      expected: quotesFrom("market-signed-delivery-manifest.pdf", [{ page: 3, text: "Vendor deliveries start at 06:15 through Gate 2." }], [3]),
    },
    vault: {
      openPath: "Market Operations.mdx", writablePath: "vendors/Delivery Draft.mdx",
      files: {
        "Market Operations.mdx": note("Market operations", "Review open topics in [[Vendor Desk]]."),
        "vendors/Vendor Desk.mdx": note("Vendor desk", "Current schedule text is [[Delivery Draft]]."),
        "vendors/Delivery Draft.mdx": note("Delivery draft", "Vendor deliveries start at 05:30.\n\nDeliveries end before the market opens."),
      },
      expected: edit("vendors/Delivery Draft.mdx", [
        { from: "Market Operations.mdx", target: "Vendor Desk", to: "vendors/Vendor Desk.mdx" },
        { from: "vendors/Vendor Desk.mdx", target: "Delivery Draft", to: "vendors/Delivery Draft.mdx" },
      ], "Vendor deliveries start at 06:15 through Gate 2.", note("Delivery draft", "Vendor deliveries start at 06:15 through Gate 2.\n\nDeliveries end before the market opens.")),
    },
  },
  {
    id: "pdf-vault-retain-held-apron-callout-from-public-note", split: "test",
    sourceGroup: "vibestudio:pdf-vault:textile-exhibit-care-callout",
    goal: "The signed care bulletin gives the most recent apron-handling instruction. Put that line verbatim into the existing callout in the working textile exhibit note linked from the Care Index. Preserve the cotton-glove reminder and verify the rendered callout and the working revision. Do not commit.",
    pdf: {
      documents: {
        "textile-signed-care-bulletin.pdf": [sheet("Signed Textile Care", "Hang wet aprons on the low rack only.")],
        "textile-training-notes.pdf": [sheet("Old training materials", "Hang wet aprons by the sink.")],
      },
      expected: quotesFrom("textile-signed-care-bulletin.pdf", [{ page: 1, text: "Hang wet aprons on the low rack only." }]),
    },
    vault: {
      openPath: "Care Index.mdx", writablePath: "care/Textile Exhibit.mdx",
      files: {
        "Care Index.mdx": note("Care index", "The reusable care warning is at [[Textile Exhibit]]."),
        "care/Textile Exhibit.mdx": note("Textile exhibit", callout("Hang wet aprons by the sink.") + "\n\nKeep a spare apron nearby."),
      },
      draft: { "care/Textile Exhibit.mdx": note("Textile exhibit", callout("Hang wet aprons by the sink.") + "\n\nKeep a spare apron nearby.\n\nReminder: use cotton gloves for folding.") },
      expected: edit("care/Textile Exhibit.mdx", [
        { from: "Care Index.mdx", target: "Textile Exhibit", to: "care/Textile Exhibit.mdx" },
      ], "Hang wet aprons on the low rack only.", note("Textile exhibit", callout("Hang wet aprons on the low rack only.") + "\n\nKeep a spare apron nearby.\n\nReminder: use cotton gloves for folding."), true),
    },
  },
  {
    id: "pdf-vault-hold-graphic-only-pipe-label-revision", split: "test",
    sourceGroup: "vibestudio:pdf-vault:community-plant-utility-diagram",
    goal: "Update the utility vault note from the approved pipe isolation sheet only if it contains a selectable signed isolation line. The layout proof has old text. Look at the approved sheet's actual raster and local text layer. If it contains graphic marks alone, explain what approved text needs to be recovered, leave OCR off, and leave the vault unchanged.",
    pdf: {
      documents: {
        "utility-approved-pipe-isolation-sheet.pdf": [{ marks: [[38, 62, 120, 22], [202, 90, 75, 19]] }],
        "utility-layout-proof.pdf": [sheet("Old layout proof", "Close the upper bypass valve.")],
      },
      expected: {
        document: "utility-approved-pipe-isolation-sheet.pdf", pages: [1], text: { status: "no-match", quotes: [] },
        render: [1], action: "provide-text-equivalent", evidenceTerms: ["1", "text"], ink: [38, 91, 277, 138],
      },
    },
    holdReason: { terms: ["text"], reference: "The approved image has visible marks but no selectable text." },
    vault: {
      openPath: "Utilities Index.mdx",
      files: {
        "Utilities Index.mdx": note("Utilities index", "Operating notes live in [[Isolation Procedure]]."),
        "Isolation Procedure.mdx": note("Isolation procedure", "The isolation line is awaiting a signed transcription."),
      },
      expected: { path: "Utilities Index.mdx", route: [], findings: [] },
    },
  },
];
