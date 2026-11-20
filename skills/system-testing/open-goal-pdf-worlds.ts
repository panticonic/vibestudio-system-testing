type Sheet = { rows?: string[][]; marks?: [number, number, number, number][] };
type PageLayout = { page: number; kind: "table" | "columns" | "sequence"; order: string[] };
type PdfExpectation = {
  document: string;
  pages: number[];
  missing?: number[];
  text?: { status: "verified" | "no-match"; quotes: { page: number; text: string }[] };
  layouts?: PageLayout[];
  render: number[];
  action: "preserve-text" | "preserve-table-rows" | "read-columns-in-order" |
    "provide-text-equivalent" | "recover-missing-pages" | "keep-page-specific-structure";
  evidenceTerms: string[];
  ink?: number[];
};
export type OpenPdfWorld = {
  id: string;
  workspace: "examples";
  kind: "pdf";
  goal: string;
  sourceGroup: string;
  split?: "test";
  documents: Record<string, Sheet[]>;
  expected: PdfExpectation;
};
const sheet = (...rows: string[][]): Sheet => ({ rows });
const table = (page: number, rows: string[][]): PageLayout =>
  ({ page, kind: "table", order: rows.flat() });
const columns = (page: number, rows: string[][]): PageLayout =>
  ({ page, kind: "columns", order: [0, 1].flatMap((column) => rows.map((row) => row[column]!)) });

const clinic = [["Session", "Accessible Room"], ["Intake", "West Lift"],
  ["Counseling", "East Ramp"], ["Follow-up", "Lower Hall"]];
const observation = [["River Observations", "Equipment Care"], ["Check the current.", "Dry the sensor."],
  ["Note the waterline.", "Pack the lead."], ["Record the reading.", "Store the charger."]];
const workshop = [["Practice Session", "Time"], ["Tactile Diagrams", "10 AM"],
  ["Screen Reader Demo", "11 AM"], ["Questions", "Noon"]];
const appendix = [["Participant Notes", "Organizer Notes"], ["Bring a laptop.", "Open at nine."],
  ["Pick a partner.", "Test the mic."]];
const held = [["Woodland Trail", "Coastal Trail"], ["Enter at the oak.", "Start at the jetty."],
  ["Follow red stones.", "Follow blue signs."], ["Leave by the gate.", "Exit at the shelter."]];

export const openGoalPdfWorlds: readonly OpenPdfWorld[] = [
  {
    id: "open-pdf-clinic-accessible-schedule", kind: "pdf", workspace: "examples", sourceGroup: "community-clinic-schedules",
    goal: "I need to turn the approved clinic schedule into something a screen-reader user can follow. Look at its original page and tell me how the sessions and accessible rooms should be read so nobody goes to the wrong entrance.",
    documents: {
      "clinic-approved-schedule.pdf": [sheet(...clinic)],
      "clinic-room-inventory.pdf": [sheet(["Room Inventory"], ["Three folding tables."])],
    },
    expected: { document: "clinic-approved-schedule.pdf", pages: [1], layouts: [table(1, clinic)],
      render: [1], action: "preserve-table-rows", evidenceTerms: ["1", "Intake", "West Lift"] },
  },
  {
    id: "open-pdf-river-reading-order", kind: "pdf", workspace: "examples", sourceGroup: "river-field-cards",
    goal: "The river field card is about to be transcribed as audio. Inspect the actual printed page and work out the reading order of the two topics. I want the audio to make sense when there is no page to look at.",
    documents: {
      "river-field-card.pdf": [sheet(...observation)],
      "river-budget.pdf": [sheet(["Sensor", "Cost"], ["Lead", "8 credits"])],
    },
    expected: { document: "river-field-card.pdf", pages: [1], layouts: [columns(1, observation)],
      render: [1], action: "read-columns-in-order", evidenceTerms: ["1", "River Observations", "Equipment Care"] },
  },
  {
    id: "open-pdf-workshop-mixed-structure", kind: "pdf", workspace: "examples", sourceGroup: "inclusive-workshop-packets",
    goal: "Review the complete approved workshop handout before we turn it into accessible text. Use the rendered original sheets to decide how a listener should encounter the first-page schedule and the notes on the next page. Tell me what needs to be preserved across the handout.",
    documents: {
      "workshop-approved-handout.pdf": [sheet(...workshop), sheet(...appendix)],
      "workshop-print-instructions.pdf": [sheet(["Printer Setup"], ["Print simplex."])],
    },
    expected: { document: "workshop-approved-handout.pdf", pages: [1, 2],
      layouts: [table(1, workshop), columns(2, appendix)], render: [1, 2],
      action: "keep-page-specific-structure", evidenceTerms: ["1", "2", "schedule", "notes"] },
  },
  {
    id: "open-pdf-visual-only-campus-map", kind: "pdf", workspace: "examples", sourceGroup: "campus-evacuation-diagrams",
    goal: "Is the approved campus evacuation map blank, or does it contain marks that people using a screen reader would miss? Check its original rendering and its selectable text. Keep this local and leave OCR off. Say what an accessible handoff would need.",
    documents: {
      "campus-approved-evacuation-map.pdf": [{ marks: [[56, 112, 110, 40], [215, 64, 145, 28]] }],
      "campus-safety-contact.pdf": [sheet(["Facilities assistance"], ["Call the operations desk."])],
    },
    expected: { document: "campus-approved-evacuation-map.pdf", pages: [1],
      text: { status: "no-match", quotes: [] }, render: [1], action: "provide-text-equivalent",
      evidenceTerms: ["1", "text"], ink: [56, 48, 360, 136] },
  },
  {
    id: "open-pdf-admissions-text-verbatim", kind: "pdf", workspace: "examples", sourceGroup: "archive-admissions-notices",
    goal: "Check the current archive admissions notice and tell me if the appointment line can be handed over as selectable text. I need the original line as evidence and a visual check of the page it came from.",
    documents: {
      "archive-current-admissions.pdf": [sheet(["Archive Access"], ["Appointments start at 9 AM."], ["Use the west entry."])],
      "archive-previous-admissions.pdf": [sheet(["Archive Access"], ["Appointments start at 8 AM."])],
    },
    expected: { document: "archive-current-admissions.pdf", pages: [1],
      text: { status: "verified", quotes: [{page: 1, text: "Appointments start at 9 AM."}] },
      render: [1], action: "preserve-text", evidenceTerms: ["1", "9 AM"] },
  },
  {
    id: "open-pdf-approved-contract-missing-sheet", kind: "pdf", workspace: "examples", sourceGroup: "guild-contract-packets",
    goal: "We need an accessible copy of the council sign-off sheet, which should be page 3 of the approved guild contract packet. Check that exact approved attachment and tell me whether the sheet is available for transcription. Don't replace it with a draft.",
    documents: {
      "guild-approved-contract.pdf": [sheet(["Guild Contract"], ["Approved Cover"]), sheet(["Approved Changes"])],
      "guild-draft-contract.pdf": [sheet(["Draft Contract"]), sheet(["Draft Changes"]), sheet(["Draft Council Sign-off"])],
    },
    expected: { document: "guild-approved-contract.pdf", pages: [3], missing: [3],
      render: [], action: "recover-missing-pages", evidenceTerms: ["3"] },
  },
  {
    id: "open-pdf-held-trail-instructions", kind: "pdf", workspace: "examples", sourceGroup: "park-trail-wayfinding", split: "test",
    goal: "Our audio volunteer needs to narrate the route directions on page 2 of the approved park booklet. Check the printed directions and tell us how to read them without mixing the two trail routes. Leave the cover out.",
    documents: {
      "park-approved-booklet.pdf": [sheet(["Park Trails"], ["Route Directions on page two"]), sheet(...held)],
      "park-weather-sheet.pdf": [sheet(["Coastal Weather"], ["Bands of showers."])],
    },
    expected: { document: "park-approved-booklet.pdf", pages: [2], layouts: [columns(2, held)],
      render: [2], action: "read-columns-in-order", evidenceTerms: ["2", "Woodland Trail", "Coastal Trail"] },
  },
  {
    id: "open-pdf-held-repair-docket-text", kind: "pdf", workspace: "examples", sourceGroup: "library-repair-dockets", split: "test",
    goal: "Can the volunteer transcribe the drop-off line using selectable text from the signed library repair docket? Check the original rendered page and quote the line exactly if it's there.",
    documents: {
      "library-signed-repair-docket.pdf": [sheet(["Repair Docket"], ["Drop-off is at loading bay 2."], ["Signed by Facilities."])],
      "library-draft-repair-docket.pdf": [sheet(["Repair Docket"], ["Drop-off is at the front desk."])],
    },
    expected: { document: "library-signed-repair-docket.pdf", pages: [1],
      text: { status: "verified", quotes: [{page: 1, text: "Drop-off is at loading bay 2."}] },
      render: [1], action: "preserve-text", evidenceTerms: ["1", "loading bay 2"] },
  },
];
