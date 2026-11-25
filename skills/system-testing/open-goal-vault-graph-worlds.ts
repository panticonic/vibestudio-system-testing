import type { VaultKnowledgeWorld } from "@workspace-skills/spectrolite-review-fixtures/knowledge-managed";

type Step = VaultKnowledgeWorld["expected"]["steps"][number];
type Read = Extract<Step, { kind: "read" }>;
type Finding = Read["findings"][number];
type Visit = { note: string; findings: Finding[]; write?: boolean };
type Note = [path: string, body: string, draft?: string];
type GraphCase = {
  id: string;
  goal: string;
  requestedReturnRequired: boolean;
  notes: Record<string, Note>;
  start: string;
  route: Visit[];
  basis: string[];
  changes?: Record<string, string>;
  movement?: { note: string; addition: string };
  handoff?: {
    note: string;
    audience: string;
    disposition: NonNullable<VaultKnowledgeWorld["expected"]["disposition"]>;
  };
  authority?: string;
  outcome: VaultKnowledgeWorld["expected"]["outcome"];
  citations: string[];
  held?: true;
};
const doc: Finding = ["document", "document-ready"];
const missing: Finding = ["document", "broken-link"];
const rendered: Finding = ["preview", "preview-ready"];
const noPreview: Finding = ["preview", "preview-missing"];
const clean: Finding = ["revision", "revision-unchanged"];
const dirty: Finding = ["revision", "draft-changed"];
const read = (note: string, ...findings: Finding[]): Visit => ({
  note,
  findings: findings.length ? findings : [doc],
});
const go = (note: string): Visit => ({ note, findings: [] });
const write = (note: string, ...findings: Finding[]): Visit => ({
  ...read(note, ...findings),
  write: true,
});
const back = (text: string, key = "index") => text + " Back to {" + key + "}.";
const badge = (text: string) =>
  '<Callout color="blue"><Callout.Text>' + text + "</Callout.Text></Callout>";

function graph(input: GraphCase): VaultKnowledgeWorld {
  const path = (key: string) => {
    const note = input.notes[key];
    if (!note) throw new Error("Unknown fixture note: " + key);
    return note[0] + ".mdx";
  };
  const source = (key: string, body: string) => {
    const title = path(key).split("/").at(-1)!.slice(0, -4);
    const expanded = body.replace(
      /\{([a-zA-Z]+)(?:\|([^}]+))?\}/gu,
      (_, key: string, label?: string) =>
        "[[" + path(key).slice(0, -4) + (label ? "|" + label : "") + "]]",
    );
    return (
      "---\ntitle: " + title + "\n---\n\n# " + title + "\n\n" + expanded + "\n"
    );
  };
  const files: Record<string, string> = {};
  const draft: Record<string, string> = {};
  for (const [key, [, body, working]] of Object.entries(input.notes)) {
    files[path(key)] = source(key, body);
    if (working !== undefined) draft[path(key)] = source(key, working);
  }
  const steps: Step[] = [];
  let current = input.start;
  for (const visit of input.route) {
    if (current !== visit.note) {
      steps.push({
        kind: "follow",
        from: path(current),
        target: path(visit.note).slice(0, -4),
        to: path(visit.note),
      });
      current = visit.note;
    }
    if (visit.write) {
      const body = input.changes?.[current];
      if (body === undefined)
        throw new Error("Missing authored edit for " + current);
      const addition =
        input.movement?.note === current ? input.movement.addition : "";
      steps.push({
        kind: "write",
        path: path(current),
        source: source(current, body) + addition,
      });
    }
    if (visit.findings.length)
      steps.push({
        kind: "read",
        path: path(current),
        findings: visit.findings,
      });
  }
  return {
    kind: "vaultWork",
    workspace: "spectrolite",
    id: "vault-graph-" + input.id,
    goal: input.goal,
    requestedReturnRequired: input.requestedReturnRequired,
    sourceGroup: "vibestudio:spectrolite-graph:" + input.id,
    ...(input.held ? { split: "test" } : {}),
    openPath: path(input.start),
    files,
    ...(Object.keys(draft).length ? { draft } : {}),
    ...(input.changes
      ? { writable: Object.keys(input.changes).map(path) }
      : {}),
    ...(input.movement
      ? {
          movement: {
            path: path(input.movement.note),
            addition: input.movement.addition,
          },
        }
      : {}),
    ...(input.handoff
      ? {
          handoff: {
            path: path(input.handoff.note),
            audience: input.handoff.audience,
          },
        }
      : {}),
    expected: {
      steps,
      path: path(current),
      outcome: input.outcome,
      citations: input.citations,
      disposition: input.handoff?.disposition,
      graph: {
        basis: input.basis.map(path),
        ...(input.authority ? { authorityPath: path(input.authority) } : {}),
      },
    },
  };
}

export const openVaultGraphWorlds = [
  graph({
    id: "quiet-room-after-sound-check",
    requestedReturnRequired: false,
    goal: "The Quiet Room card has the wrong opening time. Check both the staffing commitment and the sound-check restriction before correcting the visitor card. Keep the lift directions and leave the Quiet Room card open.",
    notes: {
      index: [
        "Evening Operations",
        "The two constraints are {staff|cover} and {sound|sound check}. The editable {card} is separate.",
      ],
      staff: [
        "rotas/Staffing Commitment",
        back("Signed rota: a host is available at 17:40."),
      ],
      sound: [
        "technical/Sound Restriction",
        back("Closed to visitors until sound check clears at 18:10."),
      ],
      card: ["public/Quiet Room Card", "Opens at 17:00. Take the west lift."],
    },
    start: "index",
    route: [
      read("staff"),
      go("index"),
      read("sound"),
      go("index"),
      read("card"),
      write("card", doc, dirty),
    ],
    basis: ["staff", "sound"],
    changes: { card: "Opens at 18:10. Take the west lift." },
    outcome: "edited",
    citations: ["17:40", "18:10", "west lift"],
  }),
  graph({
    id: "assisted-loading-separate-addresses",
    requestedReturnRequired: false,
    goal: "Please reconcile the assisted loading instructions. The parking map and the steward's commitment govern different people. Correct the customer sign and the desk note so visitors and escorts stop queuing in the same place. Leave the desk note open.",
    notes: {
      index: [
        "Loading Notice Board",
        "Compare {map} and {steward}; then update {sign} and {desk}.",
      ],
      map: [
        "survey/Loading Map",
        back(
          "Public passenger pickup is Door 2. The service hatch is barred to visitors.",
        ),
      ],
      steward: [
        "crew/Steward Commitment",
        back("Escorts collect keys at Hatch D and meet passengers at Door 2."),
      ],
      sign: [
        "public/Passenger Sign",
        back("Meet at Hatch D. Keep the ramp clear."),
      ],
      desk: [
        "team/Help Desk Note",
        "Escorts collect keys at Door 2. Meeting point Door 2. Keep the radio on.",
      ],
    },
    start: "index",
    route: [
      read("map"),
      go("index"),
      read("steward"),
      go("index"),
      read("sign"),
      write("sign"),
      go("index"),
      read("desk"),
      write("desk"),
    ],
    basis: ["map", "steward"],
    changes: {
      sign: back("Meet at Door 2. Keep the ramp clear."),
      desk: "Escorts collect keys at Hatch D. Meeting point Door 2. Keep the radio on.",
    },
    outcome: "edited",
    citations: ["Door 2", "Hatch D", "Keep the radio on"],
  }),
  graph({
    id: "paper-map-cycle",
    requestedReturnRequired: true,
    goal: "Can we rely on the map shelf's closure notice? Its desk note and distribution record refer to each other. Find the actual authority, consider the alternate record, and come back to the map shelf without changing anything.",
    notes: {
      index: ["Map Shelf", "Investigate {desk} and {dispatch}."],
      desk: [
        "notes/Desk Note",
        back("Says Tuesday, carried from {dispatch}. No authority signature."),
      ],
      dispatch: [
        "routes/Distribution Record",
        "Points back to {desk}. Both copies derive from a draft. {order} is the issued decision. Return to {index}.",
      ],
      order: [
        "decisions/Bridge Order 41",
        back("Signed by the bridge manager. Closure begins Thursday at 06:00."),
      ],
    },
    start: "index",
    route: [
      read("desk"),
      read("dispatch"),
      read("order", doc, clean),
      go("index"),
    ],
    basis: ["desk", "dispatch", "order"],
    authority: "order",
    outcome: "authority-confirmed",
    citations: ["Tuesday", "Thursday at 06:00", "Bridge Order 41"],
  }),
  graph({
    id: "match-display-alias-to-policy",
    requestedReturnRequired: false,
    goal: "Two links titled ‘Packing rules’ have the same wording on the Transfer Index. Check the live and archive destinations before fixing the detachable packing card's shortcut. Keep ‘Packing rules’ as the visible label and leave the card open.",
    notes: {
      index: [
        "Transfer Index",
        "{old|Packing rules} and {current|Packing rules}. Review {card} afterward.",
      ],
      old: [
        "archive/Packing Rules",
        back("Expired: loose padding was permitted."),
      ],
      current: [
        "policy/Packing Rules",
        back("Authoritative release: close-cell foam only."),
      ],
      card: [
        "desk/Packing Card",
        "See {old|Packing rules}. Retain the serial line.",
      ],
    },
    start: "index",
    route: [
      read("old"),
      go("index"),
      read("current"),
      go("index"),
      read("card"),
      write("card", doc, dirty),
    ],
    basis: ["old", "current"],
    changes: { card: "See {current|Packing rules}. Retain the serial line." },
    outcome: "edited",
    citations: ["close-cell foam", "Packing rules", "archive/Packing Rules"],
  }),
  graph({
    id: "exchange-limit-two-valid-windows",
    requestedReturnRequired: false,
    goal: "The two signed exchange instructions disagree because one is for Friday and the other for setup on Saturday. Fix the Exchange Sign to name both windows, preserve the lost-ticket instruction, and leave the sign open.",
    notes: {
      index: [
        "Exchange Index",
        "Signed windows: {fri} and {sat}. Public output: {sign}.",
      ],
      fri: [
        "signed/Friday Window",
        back("Friday exchange 14:00 to 16:00. Signed by box office."),
      ],
      sat: [
        "signed/Saturday Setup",
        back("Saturday exchange 09:00 to 10:30. Signed by setup lead."),
      ],
      sign: [
        "public/Exchange Sign",
        "Friday and Saturday 12:00 to 15:00. Lost ticket: ask at desk B.",
      ],
    },
    start: "index",
    route: [
      read("sat"),
      go("index"),
      read("fri"),
      go("index"),
      read("sign"),
      write("sign"),
    ],
    basis: ["fri", "sat"],
    changes: {
      sign: "Friday exchange 14:00 to 16:00. Saturday exchange 09:00 to 10:30. Lost ticket: ask at desk B.",
    },
    outcome: "edited",
    citations: ["14:00 to 16:00", "09:00 to 10:30", "desk B"],
  }),
  graph({
    id: "choose-approved-recording-excerpt",
    requestedReturnRequired: false,
    goal: "We need a local review receipt for the Recording Desk, only for the excerpt the speaker's consent and archive control sheet both permit. Check the scope in both records, then verify the exact rendered Listening Copy and hand that copy off locally. Do not change the source.",
    notes: {
      index: [
        "Listening Index",
        "Review {consent}, {control}, and {copy}. Direct public release has no approval.",
      ],
      consent: [
        "rights/Speaker Consent",
        back(
          "Speaker permits staff review of 01:10–01:33. No public distribution.",
        ),
      ],
      control: [
        "archive/Recording Control",
        back("Approved staff review cut 01:10–01:33, source tape Q7."),
      ],
      copy: [
        "desk/Listening Copy",
        badge("Staff review excerpt 01:10–01:33 from tape Q7."),
      ],
    },
    start: "index",
    route: [
      read("consent"),
      go("index"),
      read("control"),
      go("index"),
      read("copy", doc, rendered, clean),
    ],
    basis: ["consent", "control"],
    handoff: {
      note: "copy",
      audience: "Recording Desk",
      disposition: "committed-review",
    },
    outcome: "handoff-staged",
    citations: ["01:10–01:33", "tape Q7", "Recording Desk"],
  }),
  graph({
    id: "graphic-signature-missing",
    requestedReturnRequired: true,
    goal: "Consider a local handoff of the Valve Diagram to the Shift Annotator. The mechanical check says which tag is right, but the signed instruction requires the diagram to actually show the tag. If the current diagram has no rendered proof, hold the handoff. Leave it open and explain the two different facts.",
    notes: {
      index: [
        "Valve Release",
        "Proof comes from {ticket} and {rule}. Inspect {diagram} itself.",
      ],
      ticket: [
        "mechanical/Valve Ticket",
        back("Technician verified tag V-37 in person."),
      ],
      rule: [
        "safety/Diagram Release Rule",
        back("Signed: require a rendered tag in the diagram for handoff."),
      ],
      diagram: [
        "plates/Valve Diagram",
        "Source note says tag V-37.",
        "Working text still names V-37 but the graphic was removed.",
      ],
    },
    start: "index",
    route: [
      read("ticket"),
      go("index"),
      read("rule"),
      go("index"),
      read("diagram", doc, noPreview, dirty),
    ],
    basis: ["ticket", "rule"],
    handoff: {
      note: "diagram",
      audience: "Shift Annotator",
      disposition: "hold",
    },
    outcome: "handoff-held",
    citations: ["V-37", "rendered", "Shift Annotator"],
  }),
  graph({
    id: "inspection-write-after-owner-update",
    requestedReturnRequired: false,
    goal: "The scaffold inspection card still says the old interval. Use the inspector's sign-off and the weather note to set the wet-weather review to 25 minutes. Preserve any new steward text if the card moves while you work. Leave the corrected card open.",
    notes: {
      index: [
        "Scaffold Board",
        "{signoff} explains {weather}. Proposed changes belong on {card}.",
      ],
      signoff: [
        "safety/Inspector Sign-Off",
        back(
          "Wet interval approved at 25 minutes only with the weather restriction. Read {weather}.",
        ),
      ],
      weather: [
        "site/Weather Note",
        back(
          "The reduced interval applies during rain; dry interval remains 60 minutes.",
        ),
      ],
      card: [
        "crew/Scaffold Card",
        "During rain: review every 40 minutes. Dry: 60 minutes.",
      ],
    },
    start: "index",
    route: [
      read("signoff"),
      read("weather"),
      go("index"),
      read("card"),
      write("card", doc, dirty),
    ],
    basis: ["signoff", "weather"],
    changes: { card: "During rain: review every 25 minutes. Dry: 60 minutes." },
    movement: {
      note: "card",
      addition: "\nOwner update: record wind observations in Log C.\n",
    },
    outcome: "edited",
    citations: ["25 minutes", "60 minutes", "Log C"],
  }),
  graph({
    id: "compound-effective-boundaries",
    requestedReturnRequired: true,
    goal: "The Overnight Permit index points to a published extension and its separate location condition. Find both and tell me exactly where and until when the night team can work. Leave the index open and make no edits.",
    notes: {
      index: [
        "Overnight Permit Index",
        "Read {extension}; verify {boundary} independently.",
      ],
      extension: [
        "permits/Permit 18 Extension",
        back("Signed until 01:15, conditional on {boundary}."),
      ],
      boundary: [
        "survey/Location Condition",
        back("Valid for East trench only. West trench remains closed."),
      ],
    },
    start: "index",
    route: [read("boundary"), go("index"), read("extension"), go("index")],
    basis: ["boundary", "extension"],
    authority: "extension",
    outcome: "authority-confirmed",
    citations: ["01:15", "East trench only", "West trench"],
  }),
  graph({
    id: "draft-seat-count-and-signed-limit",
    requestedReturnRequired: true,
    goal: "Tell the booking steward which occupancy figure is safe to use. The signed permit and room model both matter and the capacity sketch is a working revision. Explain the committed limit, the current draft proposal and what makes the draft conditional. Leave the capacity sketch open without editing.",
    notes: {
      index: [
        "Occupancy Desk",
        "The signed {permit} and {model} inform {sketch}.",
      ],
      permit: ["signed/Occupancy Permit", back("Legal capacity is 76 people.")],
      model: [
        "engineering/Room Model",
        back("86 requires a second staffed exit that has not been inspected."),
      ],
      sketch: [
        "drafts/Capacity Sketch",
        "Planning baseline: 76 people.",
        "Unapproved sketch: 86 people with a second staffed exit.",
      ],
    },
    start: "index",
    route: [
      read("permit"),
      go("index"),
      read("model"),
      go("index"),
      read("sketch", doc, dirty),
    ],
    basis: ["permit", "model"],
    outcome: "draft-differs",
    citations: ["76 people", "86 people", "second staffed exit"],
  }),
  graph({
    id: "approved-small-format-only",
    requestedReturnRequired: true,
    goal: "The label designer wants to know whether the approved wording can go on the pocket card as well as the large sign. The accessibility note and design consent have different scopes. Make only the permitted change to the pocket card and keep its specimen ID. Leave the pocket card open.",
    notes: {
      index: [
        "Specimen Index",
        "Use {access} and {consent}; edit {card}, not the large sample {sign}.",
      ],
      access: [
        "access/Pocket Legibility",
        back(
          "Large print rule: say ‘use the transfer grip’. Pocket card rule: label the ‘blue grip’.",
        ),
      ],
      consent: [
        "design/Display Consent",
        back(
          "The pocket card can say ‘blue grip’. The large sign is pending a designer review.",
        ),
      ],
      sign: [
        "proofs/Large Grip Sign",
        back("Temporary poster: use the top grip."),
      ],
      card: ["cards/Pocket Grip Card", "Use the top grip. Specimen R-2."],
    },
    start: "index",
    route: [
      read("access"),
      go("index"),
      read("consent"),
      go("index"),
      read("card"),
      write("card"),
    ],
    basis: ["access", "consent"],
    changes: { card: "Use the blue grip. Specimen R-2." },
    outcome: "edited",
    citations: ["blue grip", "Specimen R-2", "large sign"],
  }),
  graph({
    id: "training-copy-keeps-owner-remark",
    requestedReturnRequired: false,
    goal: "Check the approval for the training instructions and the maintenance exception before adjusting the Practice Card. Preserve the owner's co-edit and any uses of the old wording outside training. Verify the working Practice Card callout and stage a local draft receipt for the Teaching Lead.",
    notes: {
      index: [
        "Teaching Index",
        "Training approval {approval}; maintenance exception {maintenance}. Current {card}.",
      ],
      approval: [
        "approved/Training Release",
        back("Practice drill now uses cartridge N2."),
      ],
      maintenance: [
        "maint/Maintenance Exception",
        back("Cartridge C1 remains in use for maintenance only."),
      ],
      card: [
        "internal/Practice Card",
        badge("Practice drill: cartridge C1.") + " Keep the blue example.",
      ],
    },
    start: "index",
    route: [
      read("maintenance"),
      go("index"),
      read("approval"),
      go("index"),
      read("card"),
      write("card", doc, rendered, dirty),
    ],
    basis: ["approval", "maintenance"],
    changes: {
      card: badge("Practice drill: cartridge N2.") + " Keep the blue example.",
    },
    movement: {
      note: "card",
      addition: "\nOwner update: apprentice Log F remains required.\n",
    },
    handoff: {
      note: "card",
      audience: "Teaching Lead",
      disposition: "draft-only",
    },
    outcome: "handoff-staged",
    citations: ["cartridge N2", "Log F", "Teaching Lead", "draft-only"],
  }),
  graph({
    id: "tombstone-avoids-live-name-collision",
    requestedReturnRequired: true,
    goal: "The Procurement Index has a dead vendor record and an abnormally similar branch for a live vendor. Use the separation note and the retirement register to say whether the dead record can be replaced. Leave Procurement Index open and preserve all pointers.",
    notes: {
      index: [
        "Procurement Index",
        "Former vendor: [[Alder Group]]. Similar link: {active|Alder Group}. Review {register} and {note}.",
      ],
      register: [
        "records/Retirement Register",
        back("Alder Group record is withdrawn. No approved successor."),
      ],
      note: [
        "ownership/Vendor Separation",
        back(
          "Alder Group Transport is separate; its contract cannot fill the withdrawn record.",
        ),
      ],
      active: [
        "active/Alder Group Transport",
        back("Still handles local freight under contract AT-8."),
      ],
    },
    start: "index",
    route: [
      read("index", missing),
      read("active"),
      go("index"),
      read("register"),
      go("index"),
      read("note"),
      go("index"),
    ],
    basis: ["active", "register", "note"],
    outcome: "retired-link",
    citations: [
      "Alder Group",
      "Alder Group Transport",
      "No approved successor",
    ],
  }),
  graph({
    id: "steward-desk-two-measurements",
    requestedReturnRequired: true,
    goal: "Work out why the Training Desk saw two ramp readings with the same title and report which is the live record. Bring the two measurements and the meter log together without changing any note. Return to the Training Desk when done.",
    notes: {
      index: [
        "Training Desk",
        "{old|Ramp Reading} and {live|Ramp Reading}. The {log} gives meter provenance.",
      ],
      old: [
        "archive/Ramp Reading",
        back("Recorded 7.1°. Meter R-1 was out for recalibration."),
      ],
      live: [
        "active/Ramp Reading",
        back("Recorded 5.2° with certified meter R-9. Signed by event lead."),
      ],
      log: [
        "technical/Calibration Log",
        back(
          "R-9 current through August. R-1 records are for archive comparison only.",
        ),
      ],
    },
    start: "index",
    route: [
      read("old"),
      go("index"),
      read("log"),
      go("index"),
      read("live"),
      go("index"),
    ],
    basis: ["old", "log", "live"],
    authority: "live",
    outcome: "authority-confirmed",
    citations: ["7.1°", "5.2°", "R-9", "R-1"],
  }),
  graph({
    id: "map-with-conditioned-access",
    requestedReturnRequired: false,
    goal: "Correct the staff Entry Instructions for the temporary alternate access. Verify the building memo plus the date-specific restriction before editing, and keep the usual entrance for other days. Leave the corrected instructions open.",
    notes: {
      index: [
        "Hall Access Index",
        "The {memo} links to the {calendar}. Correct {entry}.",
      ],
      memo: [
        "facilities/Access Memo",
        back(
          "Use Annex E when the East foyer closure is in force. See {calendar}.",
        ),
      ],
      calendar: [
        "events/Foyer Calendar",
        back("Only 12 April, 08:30–15:00, is affected."),
      ],
      entry: [
        "staff/Entry Instructions",
        "Use East foyer on all dates. Keep the staff badge visible.",
      ],
    },
    start: "index",
    route: [
      read("memo"),
      read("calendar"),
      go("index"),
      read("entry"),
      write("entry"),
    ],
    basis: ["memo", "calendar"],
    changes: {
      entry:
        "Use Annex E only on 12 April, 08:30–15:00. Otherwise use East foyer. Keep the staff badge visible.",
    },
    outcome: "edited",
    citations: ["Annex E", "12 April", "08:30–15:00", "staff badge"],
  }),
  graph({
    id: "sealed-sample-chain",
    requestedReturnRequired: false,
    held: true,
    goal: "Audit the two sealed soil samples and update the Chamber Tag and Courier Log only if the signed numbering and lab rule agree. Keep the archive example untouched. Leave the Courier Log open so the lab can inspect it.",
    notes: {
      index: [
        "Soil Intake",
        "{numbers} and {rule} govern {tag} and {log}. Training {archive} is separate.",
      ],
      numbers: [
        "signed/Sample Numbers",
        back("Field sign-off: upland seal U-62, marsh seal M-23."),
      ],
      rule: [
        "lab/Seal Rule",
        back(
          "Read Chamber Tag upland first. Courier Log marsh first. Do not swap the actual identifiers.",
        ),
      ],
      tag: ["live/Chamber Tag", back("Upland M-23, marsh U-62. Shelf yellow.")],
      log: ["live/Courier Log", "Marsh U-62, upland M-23. Keep cold."],
      archive: ["archive/Courier Log", back("Training specimen U-00.")],
    },
    start: "index",
    route: [
      read("numbers"),
      go("index"),
      read("rule"),
      go("index"),
      read("tag"),
      write("tag"),
      go("index"),
      read("log"),
      write("log"),
    ],
    basis: ["numbers", "rule"],
    changes: {
      tag: back("Upland U-62, marsh M-23. Shelf yellow."),
      log: "Marsh M-23, upland U-62. Keep cold.",
    },
    outcome: "edited",
    citations: ["U-62", "M-23", "upland first", "marsh first"],
  }),
  graph({
    id: "subtitle-rights-scope",
    requestedReturnRequired: false,
    held: true,
    goal: "Prepare the Access Curator's local subtitle review from the exact authorized interval. The interview rights note grants more time than the accessibility approval. Do not widen the audience or edit the cut. Verify the rendered Subtitle Proof and leave it open.",
    notes: {
      index: [
        "Subtitle Ledger",
        "Review {rights}, then compare {access}; approval scope must agree with {proof}.",
      ],
      rights: [
        "rights/Interview Rights",
        back("Staff subtitle review authorized 04:00–04:45. No press release."),
      ],
      access: [
        "access/Caption Approval",
        back("Access Curator may review only 04:19–04:32."),
      ],
      proof: [
        "releases/Subtitle Proof",
        badge("Access Curator review 04:19–04:32, interview J-44."),
      ],
    },
    start: "index",
    route: [
      read("rights"),
      go("index"),
      read("access"),
      go("index"),
      read("proof", doc, rendered, clean),
    ],
    basis: ["rights", "access"],
    handoff: {
      note: "proof",
      audience: "Access Curator",
      disposition: "committed-review",
    },
    outcome: "handoff-staged",
    citations: ["04:00–04:45", "04:19–04:32", "Access Curator"],
  }),
  graph({
    id: "hold-unattested-bridge-load",
    requestedReturnRequired: true,
    held: true,
    goal: "Two teams reported different bridge load limits under the same label. Check both, then trace the review record before deciding whether any single number is defensible. Leave the bridge index open and keep all source notes intact.",
    notes: {
      index: [
        "Bridge Review Index",
        "{contract|Load Note} and {monitor|Load Note}; see {review}.",
      ],
      contract: [
        "works/Load Note",
        back("Field trial at 11 tonnes with dry bearings; no release."),
      ],
      monitor: [
        "survey/Load Note",
        back("Wet operation sketch: 7 tonnes. Reviewer has not signed."),
      ],
      review: [
        "review/Release Ledger",
        back(
          "Both visits are open. No published operating limit or signed carrying authority.",
        ),
      ],
    },
    start: "index",
    route: [
      read("monitor"),
      go("index"),
      read("contract"),
      go("index"),
      read("review"),
      go("index"),
    ],
    basis: ["contract", "monitor", "review"],
    outcome: "conflict-unresolved",
    citations: ["11 tonnes", "7 tonnes", "No published operating limit"],
  }),
  graph({
    id: "variance-date-with-corrected-working-proof",
    requestedReturnRequired: false,
    held: true,
    goal: "The Freestanding Banner proof still uses the wrong variance date. Read the compliance authorization and the custodial log first. Correct only the working proof, keep any new owner text, then stage a local draft review for the Floor Supervisor once the callout renders.",
    notes: {
      index: [
        "Banner Variance Index",
        "Check {variance} and {custody}, then work on {proof}.",
      ],
      variance: [
        "compliance/Variance 22",
        back("Signed variance covers 9 September only. No public release."),
      ],
      custody: [
        "crew/Custodial Log",
        back("Post take-down record in Binder H. Keep the high-wind note."),
      ],
      proof: [
        "proof/Freestanding Banner",
        badge("Variance day: 8 September.") + " High-wind rule: remove banner.",
      ],
    },
    start: "index",
    route: [
      read("custody"),
      go("index"),
      read("variance"),
      go("index"),
      read("proof"),
      write("proof", doc, rendered, dirty),
    ],
    basis: ["custody", "variance"],
    changes: {
      proof:
        badge("Variance day: 9 September.") + " High-wind rule: remove banner.",
    },
    movement: {
      note: "proof",
      addition: "\nOwner addendum: use Binder H for take-down.\n",
    },
    handoff: {
      note: "proof",
      audience: "Floor Supervisor",
      disposition: "draft-only",
    },
    outcome: "handoff-staged",
    citations: ["9 September", "Binder H", "Floor Supervisor", "draft-only"],
  }),
  graph({
    id: "easement-season-alias-split",
    requestedReturnRequired: false,
    held: true,
    goal: "The winter directions say the same thing as the summer card even though two identically labelled links describe different easements. Find both records and fix only the winter card with its permitted dates and gate. Preserve the emergency contact and leave the winter card open.",
    notes: {
      index: [
        "Path Easement Index",
        "{summer|Access Easement} and {winter|Access Easement} have distinct scope. Correct {card}.",
      ],
      summer: [
        "summer/Access Easement",
        back("May through October use Gate S3."),
      ],
      winter: [
        "winter/Access Easement",
        back("November through March use Gate W6. Closed in April."),
      ],
      card: [
        "crew/Winter Directions",
        "May through October use Gate S3. Emergency contact: Desk 4.",
      ],
    },
    start: "index",
    route: [
      read("summer"),
      go("index"),
      read("winter"),
      go("index"),
      read("card"),
      write("card"),
    ],
    basis: ["summer", "winter"],
    changes: {
      card: "November through March use Gate W6. Closed in April. Emergency contact: Desk 4.",
    },
    outcome: "edited",
    citations: ["Gate W6", "Gate S3", "Closed in April", "Desk 4"],
  }),
];
