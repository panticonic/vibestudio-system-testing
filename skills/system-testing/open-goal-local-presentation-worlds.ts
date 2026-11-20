import type {
  ComponentSpec,
  PresentationSection,
} from "@workspace-skills/visualize/types";
import type { PresentationWorld } from "./presentation-worlds.js";

type RecordStatus = "current" | "signed" | "archive" | "draft";
export type RecordSeed = SourceDetails & {
  id: string;
  status: RecordStatus;
  previewAllowed: boolean;
  sections: PresentationSection[];
};
type Display = Extract<
  PresentationWorld["expected"][number],
  { labels: string[] }
>;
type Answer = PresentationWorld["expected"][number];
type SourceDetails = { title: string; desk: string; period: string };
type Options = {
  coedit?: { id: string; sections: PresentationSection[] };
  holds?: readonly string[];
  omitted?: string[];
  notes?: string[];
  held?: boolean;
};
const section = (
  id: string,
  ask: string,
  data: string,
  required = true,
): PresentationSection => ({ id, ask, data, required });
const record = (
  id: string,
  details: SourceDetails,
  status: RecordStatus,
  previewAllowed: boolean,
  sections: PresentationSection[],
): RecordSeed => ({ id, ...details, status, previewAllowed, sections });
const display = (
  id: string,
  component: ComponentSpec,
  labels: string[],
  interaction?: Display["interaction"],
): Display => ({
  id,
  component,
  labels,
  ...(interaction ? { interaction } : {}),
});
const chart = (
  id: string,
  type: "line" | "bar" | "area" | "donut",
  x: string,
  y: string | string[],
  data: Record<string, string | number>[],
  unit?: string,
) => {
  const keys = [x, ...(Array.isArray(y) ? y : [y])];
  return display(
    id,
    {
      component: "Chart",
      props: { type, data, x, y, ...(unit ? { unit } : {}) },
    },
    data.map((row) => String(row[x])),
    {
      kind: "chart-table",
      before: "Show table",
      after: "Show chart",
      cells: [
        keys,
        ...data.map((row) =>
          keys.map(
            (key) => String(row[key]) + (key !== x && unit ? " " + unit : ""),
          ),
        ),
      ],
    },
  );
};
const stats = (id: string, items: [string, string | number][]) =>
  display(
    id,
    {
      component: "Stats",
      props: { items: items.map(([label, value]) => ({ label, value })) },
    },
    items.flatMap(([label, value]) => [label, String(value)]),
  );
const compare = (
  id: string,
  attributes: string[],
  items: [string, (string | number)[]][],
) =>
  display(
    id,
    {
      component: "Compare",
      props: {
        options: items.map(([name, values]) => ({
          name,
          attributes: Object.fromEntries(
            attributes.map((key, i) => [key, values[i]!]),
          ),
        })),
      },
    },
    [
      ...attributes,
      ...items.flatMap(([name, values]) => [name, ...values.map(String)]),
    ],
  );
const timeline = (id: string, items: [string, string][]) =>
  display(
    id,
    {
      component: "Timeline",
      props: { items: items.map(([time, title]) => ({ time, title })) },
    },
    items.flat(),
  );
const checklist = (id: string, items: string[], toggle: string) =>
  display(id, { component: "Checklist", props: { items } }, items, {
    kind: "checklist",
    item: toggle,
    before: "0/" + items.length,
    after: "1/" + items.length,
  });
const choices = (id: string, options: string[], click: string) =>
  display(id, { component: "Choices", props: { id, options } }, options, {
    kind: "choice",
    choices: [click],
    selected: [click],
  });

function presentation(
  id: string,
  group: string,
  goal: string,
  sources: RecordSeed[],
  target: string | null,
  expected: Answer[],
  options: Options = {},
) {
  const current = sources.find((source) => source.id === target);
  const requirements: PresentationWorld | null = current
    ? {
        id,
        request: {
          goal,
          sections: options.coedit?.sections ?? current.sections,
        },
        expected,
        omitted: options.omitted ?? [],
      }
    : null;
  return {
    id: "present-local-" + id,
    workspace: "examples",
    kind: "localPresentation",
    sourceGroup: "vibestudio:local-presentation:" + group,
    ...(options.held
      ? {
          split: "test" as const,
          relatedSourceGroup:
            "vibestudio:local-presentation:municipal-bulletins",
        }
      : {}),
    goal,
    sources,
    ...(options.coedit ? { coedit: options.coedit } : {}),
    expected: {
      target,
      requirements,
      ...(options.holds ? { holds: options.holds } : {}),
      notes: options.notes ?? [],
    },
  } as const;
}

function editions(
  details: SourceDetails,
  current: PresentationSection[],
  decoy: PresentationSection[],
  decoyDetails: Partial<SourceDetails> = {},
  mainStatus: RecordStatus = "current",
) {
  return [
    record(
      "reference-copy",
      { ...details, ...decoyDetails },
      "archive",
      false,
      decoy,
    ),
    record("working-record", details, mainStatus, true, current),
  ];
}

const draftFlow = [
  section(
    "flow",
    "Show how many service kits were filled at each shift checkpoint.",
    "Hour and kits: 06:00 36; 08:00 50; 10:00 48.",
  ),
];
const currentFlow = [
  section(
    "flow",
    "Show how many service kits were filled at each shift checkpoint.",
    "Hour and kits: 06:00 36; 08:00 50; 10:00 64.",
  ),
];
const held = { held: true } as const;
export const openLocalPresentationWorlds = [
  presentation(
    "press-throughput",
    "pressroom",
    "For the pressroom shift lead, make the recent production shape easy to see and leave a way to read every count without relying on the graphic. Use the morning ledger.",
    editions(
      { title: "Press checks", desk: "Pressroom", period: "Morning shift" },
      [
        section(
          "paper",
          "Show how sheet counts changed from one checkpoint to the next. Keep the printed headers checkpoint and sheets.",
          "08:00 122 sheets; 10:00 148; 12:00 137.",
        ),
      ],
      [section("paper", "Show sheet counts.", "08:00 210; 10:00 224.")],
      { period: "Previous shift" },
    ),
    "working-record",
    [
      chart("paper", "line", "checkpoint", "sheets", [
        { checkpoint: "08:00", sheets: 122 },
        { checkpoint: "10:00", sheets: 148 },
        { checkpoint: "12:00", sheets: 137 },
      ]),
    ],
  ),

  presentation(
    "tool-station-equipment",
    "machine-shop",
    "Maintenance needs to see the differences between the two benches for the incoming repair shift. Use Electrical's bench ledger and keep this to our local preview.",
    editions(
      { title: "Bench ledger", desk: "Electrical", period: "Repair shift" },
      [
        section(
          "bench",
          "Compare the interchangeable benches by grounded sockets and clear width; keep widths in cm.",
          "North has 6 sockets and 80 cm width; South has 10 sockets and 110 cm width. Labels: Sockets, Width (cm).",
        ),
      ],
      [
        section(
          "bench",
          "Compare benches.",
          "North 22 sockets and 220 cm; South 4 sockets and 40 cm.",
        ),
      ],
      { desk: "Facilities" },
    ),
    "working-record",
    [
      compare(
        "bench",
        ["Sockets", "Width (cm)"],
        [
          ["North", [6, 80]],
          ["South", [10, 110]],
        ],
      ),
    ],
  ),

  presentation(
    "cold-storage-status",
    "cold-storage",
    "Give the night crew a compact view of the outstanding refrigeration readings, but skip the overtime rumor from the same record.",
    editions(
      { title: "Freezer checks", desk: "Cold storage", period: "Night shift" },
      [
        section(
          "temperature",
          "Surface the latest stable temperature and outstanding alerts as two headline figures.",
          "Lowest temperature: -18 °C. Open alarms: 2.",
        ),
        section(
          "rumor",
          "Unconfirmed overtime rumor.",
          "An unconfirmed comment about overtime.",
          false,
        ),
      ],
      [
        section(
          "temperature",
          "Previous snapshot.",
          "Lowest temperature: -11 °C. Open alarms: 4.",
        ),
      ],
      { period: "Previous night" },
    ),
    "working-record",
    [
      stats("temperature", [
        ["Lowest temperature", "-18 °C"],
        ["Open alarms", 2],
      ]),
    ],
    { omitted: ["rumor"] },
  ),

  presentation(
    "rig-handover-order",
    "stage-rigging",
    "The next rigging lead needs to see the sequence of signed handover milestones and the one sentence explaining who still has the key. Leave scheduling untouched.",
    editions(
      { title: "Rig handover", desk: "Stage rigging", period: "Opening day" },
      [
        section(
          "milestones",
          "Present the signed hoist handover in clock order.",
          "07:15 Anchor check; 08:40 Hoist test; 09:30 Safety sign-off.",
        ),
        section(
          "key",
          "Explain key custody in one sentence.",
          "The floor lead holds the key.",
        ),
      ],
      [
        section(
          "milestones",
          "Draft drill.",
          "06:00 Anchor check; 07:10 Hoist test.",
        ),
      ],
      { period: "Drill" },
      "signed",
    ),
    "working-record",
    [
      timeline("milestones", [
        ["07:15", "Anchor check"],
        ["08:40", "Hoist test"],
        ["09:30", "Safety sign-off"],
      ]),
      { id: "key", status: "plain" },
    ],
    { notes: ["floor lead", "key"] },
  ),

  presentation(
    "generator-walkthrough",
    "site-facilities",
    "Make it easy for the relief operator to walk through the morning generator inspection and mark off the checks in a private practice view. Preserve the signed checklist.",
    editions(
      { title: "Generator checks", desk: "Facilities", period: "Morning" },
      [
        section(
          "steps",
          "Provide tickable inspection steps.",
          "Check fuel level; Inspect intake; Log battery voltage.",
        ),
      ],
      [
        section(
          "steps",
          "Older inspection steps.",
          "Fill oil; Check exhaust routing.",
        ),
      ],
      { period: "Spring" },
      "signed",
    ),
    "working-record",
    [
      checklist(
        "steps",
        ["Check fuel level", "Inspect intake", "Log battery voltage"],
        "Inspect intake",
      ),
    ],
  ),

  presentation(
    "studio-bex-booking",
    "recording-studio",
    "The studio coordinator is waiting for my decision about rooms for Bex's session. Show the two confirmed options so I can choose here. Don't send or reserve anything.",
    editions(
      {
        title: "Bex's booking options",
        desk: "Studio coordination",
        period: "Friday evening",
      },
      [
        section(
          "room-choice",
          "Ask the user to pick one of the confirmed rooms.",
          "Confirmed rooms: Cedar; Willow.",
        ),
      ],
      [section("room-choice", "Proposed rooms.", "Maple; Spruce.")],
      { period: "Friday morning" },
    ),
    "working-record",
    [choices("room-choice", ["Cedar", "Willow"], "Willow")],
  ),

  presentation(
    "grain-share-composition",
    "grain-audit",
    "For the signed grain intake audit, help us see which origin accounted for which share of accepted sacks. Keep the numeric counts available for the low-vision reviewer.",
    editions(
      { title: "Grain intake", desk: "Intake audit", period: "June" },
      [
        section(
          "share",
          "Show each origin's share of total accepted sacks using a ring chart. Use origin and sacks.",
          "North ridge 42 sacks; Mill valley 28; East basin 10.",
        ),
      ],
      [
        section(
          "share",
          "Preliminary sacks.",
          "North ridge 60; Mill valley 20; East basin 20.",
        ),
      ],
      { period: "May" },
      "signed",
    ),
    "working-record",
    [
      chart("share", "donut", "origin", "sacks", [
        { origin: "North ridge", sacks: 42 },
        { origin: "Mill valley", sacks: 28 },
        { origin: "East basin", sacks: 10 },
      ]),
    ],
  ),

  presentation(
    "science-fair-two-series",
    "science-fair",
    "Use the current science fair count to show how arrivals and clearances changed together today. Report the scheduled closing time alongside it, and make the counts independently readable.",
    editions(
      { title: "Gate count", desk: "Science fair", period: "Saturday" },
      [
        section(
          "traffic",
          "Show both movement series on the same time scale, keeping time, arrivals and clearances as the headers.",
          "09:00 18 arrivals 13 clearances; 11:00 34 arrivals 25 clearances; 13:00 22 arrivals 29 clearances.",
        ),
        section(
          "closure",
          "Give the scheduled closing time in plain text.",
          "Closing is 17:00.",
        ),
      ],
      [section("traffic", "Vendor gate arrivals.", "09:00 44; 11:00 9.")],
      { desk: "Vendor gate" },
    ),
    "working-record",
    [
      chart(
        "traffic",
        "line",
        "time",
        ["arrivals", "clearances"],
        [
          { time: "09:00", arrivals: 18, clearances: 13 },
          { time: "11:00", arrivals: 34, clearances: 25 },
          { time: "13:00", arrivals: 22, clearances: 29 },
        ],
      ),
      { id: "closure", status: "plain" },
    ],
    { notes: ["17:00"] },
  ),

  presentation(
    "residency-room-brief",
    "artist-residency",
    "The residents are choosing where to rehearse. Let us compare the documented access and capacity for the rooms; the old sponsor mockup has no say here.",
    editions(
      {
        title: "Rehearsal rooms",
        desk: "Residency coordinator",
        period: "Fall term",
      },
      [
        section(
          "rooms",
          "Compare access type and seats across options.",
          "Studio A: step-free, 18 seats. Studio B: stairs only, 32 seats. Keys are Access and Seats.",
        ),
      ],
      [
        section(
          "rooms",
          "Old access mockup.",
          "Studio A 32, stairs; Studio B 18, ramp.",
        ),
      ],
      { desk: "Sponsor" },
    ),
    "working-record",
    [
      compare(
        "rooms",
        ["Access", "Seats"],
        [
          ["Studio A", ["step-free", 18]],
          ["Studio B", ["stairs only", 32]],
        ],
      ),
    ],
  ),

  presentation(
    "helpdesk-measured-queue",
    "helpdesk",
    "Show the shift lead where the current helpdesk backlog is sitting. Keep the comparisons accessible, and don't use the onboarding exercise that shares its name.",
    editions(
      {
        title: "Queue groups",
        desk: "Service operations",
        period: "Thursday noon",
      },
      [
        section(
          "groups",
          "Compare numbers by queue; use category and waiting as headings.",
          "Accounts 13; Devices 4; Access 21.",
        ),
      ],
      [
        section(
          "groups",
          "Training exercise.",
          "Accounts 7; Devices 22; Access 5.",
        ),
      ],
      { desk: "Onboarding" },
    ),
    "working-record",
    [
      chart("groups", "bar", "category", "waiting", [
        { category: "Accounts", waiting: 13 },
        { category: "Devices", waiting: 4 },
        { category: "Access", waiting: 21 },
      ]),
    ],
  ),

  presentation(
    "coedit-kit-line",
    "relief-packing",
    "Use the latest relief shift tally for the briefing, including corrections made while you're working. We need to compare checkpoints and be able to read the exact values from the preview.",
    editions(
      { title: "Kit tally", desk: "Relief packing", period: "Morning" },
      draftFlow,
      [
        section(
          "flow",
          "Demonstration tally.",
          "06:00 8 kits; 08:00 12; 10:00 10.",
        ),
      ],
      { desk: "Training" },
    ),
    "working-record",
    [
      chart("flow", "line", "hour", "kits", [
        { hour: "06:00", kits: 36 },
        { hour: "08:00", kits: 50 },
        { hour: "10:00", kits: 64 },
      ]),
    ],
    { coedit: { id: "working-record", sections: currentFlow } },
  ),

  presentation(
    "signed-river-crossings",
    "watershed-team",
    "Prepare a private view from the signed crossings record. If that signed ledger revises while you're doing it, wait for another sign-off rather than carrying on with a new preview.",
    editions(
      { title: "Crossing count", desk: "Watershed", period: "Late survey" },
      [
        section(
          "passes",
          "Compare measured crossings per checkpoint. Use checkpoint and crossings.",
          "bank 5; bridge 12; weir 3.",
        ),
      ],
      [section("passes", "Practice count.", "bank 10; bridge 4; weir 5.")],
      { period: "Drill" },
      "signed",
    ),
    "working-record",
    [],
    {
      holds: ["revis"],
      coedit: {
        id: "working-record",
        sections: [
          section(
            "passes",
            "Compare measured crossings.",
            "bank 5; bridge 14; weir 3.",
          ),
        ],
      },
    },
  ),

  presentation(
    "verified-scope-woodlot",
    "woodlot-assessment",
    "Can you make a briefing from the forestry assessor's completed woodlot run? A neighboring estimate is useful for context, but don't present it in place of the assessor's confirmed return.",
    [
      record(
        "other-desk",
        {
          title: "Woodlot run",
          desk: "Neighbor estimate",
          period: "New survey",
        },
        "current",
        true,
        [section("trees", "Count plots.", "Oak 52; Alder 11.")],
      ),
      record(
        "assessor-draft",
        {
          title: "Woodlot run",
          desk: "Forestry assessor",
          period: "New survey",
        },
        "draft",
        false,
        [section("trees", "Pending validation.", "Oak 5; Alder unconfirmed.")],
      ),
    ],
    null,
    [],
    { holds: ["confirm"] },
  ),

  presentation(
    "signed-catalog-sequence",
    "object-catalog",
    "Show the route a specimen actually took into the collection before our next branch meeting. Use the accession desk's signed record, not the demonstrator's draft.",
    editions(
      { title: "Specimen entry", desk: "Accession desk", period: "January" },
      [
        section(
          "sequence",
          "Present accession milestones in calendar order.",
          "Jan 10 Intake; Jan 12 Photo record; Jan 19 Cabinet assignment.",
        ),
      ],
      [
        section(
          "sequence",
          "Practice milestones.",
          "Jan 8 Photo record; Jan 14 Intake.",
        ),
      ],
      { desk: "Demonstration" },
      "signed",
    ),
    "working-record",
    [
      timeline("sequence", [
        ["Jan 10", "Intake"],
        ["Jan 12", "Photo record"],
        ["Jan 19", "Cabinet assignment"],
      ]),
    ],
  ),

  presentation(
    "audio-levels-and-transfer",
    "oral-history",
    "Give the oral-history team a compact summary of today's capture quality followed by the redo checklist. This is for the booth operator, not the exhibit crew's test record.",
    editions(
      { title: "Capture review", desk: "Booth operator", period: "Tuesday" },
      [
        section(
          "quality",
          "Summarize the recordings and clips that need correction as headline values.",
          "Recordings: 12; Clipped: 3.",
        ),
        section(
          "redo",
          "Make a practice checklist for the redo plan.",
          "Tag clipped takes; Reset gain; Repeat room tone.",
        ),
      ],
      [section("quality", "Demo quality.", "Recordings: 10; Clipped: 0.")],
      { desk: "Exhibit crew" },
    ),
    "working-record",
    [
      stats("quality", [
        ["Recordings", 12],
        ["Clipped", 3],
      ]),
      checklist(
        "redo",
        ["Tag clipped takes", "Reset gain", "Repeat room tone"],
        "Reset gain",
      ),
    ],
  ),

  presentation(
    "permit-cycle-correction",
    "municipal-permit-cycles",
    "Before the permit desk briefing, summarize how many renewals cleared at each counter after corrections. If a correction comes in during your review, use it. Let the committee get the numbers from the preview without interpreting marks.",
    editions(
      { title: "Renewals cleared", desk: "Permit desk", period: "May close" },
      [
        section(
          "counters",
          "Compare cleared renewals by counter. Use counter and cleared.",
          "East 16; West 28; Annex 13.",
        ),
      ],
      [
        section(
          "counters",
          "April cleared renewals.",
          "East 32; West 3; Annex 9.",
        ),
      ],
      { period: "April close" },
    ),
    "working-record",
    [
      chart("counters", "bar", "counter", "cleared", [
        { counter: "East", cleared: 18 },
        { counter: "West", cleared: 28 },
        { counter: "Annex", cleared: 13 },
      ]),
    ],
    {
      ...held,
      coedit: {
        id: "working-record",
        sections: [
          section(
            "counters",
            "Compare cleared renewals by counter. Use counter and cleared.",
            "East 18; West 28; Annex 13.",
          ),
        ],
      },
    },
  ),

  presentation(
    "step-free-reading-rooms",
    "municipal-reading-rooms",
    "Can we give the volunteer coordinator a private side-by-side view of the branch rooms' step-free setup and chairs from this season's confirmed survey? The previous temporary-room survey is easy to confuse with it.",
    editions(
      { title: "Branch room survey", desk: "Library access", period: "Autumn" },
      [
        section(
          "reading-rooms",
          "Compare confirmed rooms with headings Step-free and Chairs.",
          "Bay room: yes, 26 chairs. Main room: no, 40 chairs.",
        ),
      ],
      [
        section(
          "reading-rooms",
          "Temporary-room survey.",
          "Bay room: no, 6 chairs. Main room: yes, 10 chairs.",
        ),
      ],
      { period: "Summer" },
    ),
    "working-record",
    [
      compare(
        "reading-rooms",
        ["Step-free", "Chairs"],
        [
          ["Bay room", ["yes", 26]],
          ["Main room", ["no", 40]],
        ],
      ),
    ],
    held,
  ),

  presentation(
    "water-treatment-pinned",
    "municipal-treatment-notice",
    "Prepare a preview of the signed water-treatment interval bulletin for my file. I want that reviewable revision only. If it is corrected while you work, tell me and leave the preview blank.",
    editions(
      {
        title: "Treatment interval",
        desk: "Water operations",
        period: "Week 7",
      },
      [
        section(
          "volume",
          "Show processed volume at each check.",
          "07:00 40 m³; 09:00 43 m³; 11:00 49 m³.",
        ),
      ],
      [section("volume", "Retired bulletin.", "07:00 29 m³; 09:00 39 m³.")],
      { period: "Week 6" },
      "signed",
    ),
    "working-record",
    [],
    {
      ...held,
      holds: ["revis"],
      coedit: {
        id: "working-record",
        sections: [
          section(
            "volume",
            "Show processed volume.",
            "07:00 40 m³; 09:00 45 m³; 11:00 49 m³.",
          ),
        ],
      },
    },
  ),

  presentation(
    "ward-alert-authority",
    "municipal-ward-alert",
    "Use the ward desk's approved disruption notice to prepare an internal display. An old approved mockup from the communications class is not valid evidence for this opening.",
    [
      record(
        "class-copy",
        {
          title: "Disruption notice",
          desk: "Communications class",
          period: "Tuesday opening",
        },
        "signed",
        true,
        [
          section(
            "time",
            "Show reopen milestones.",
            "08:00 Blocked; 09:00 Reopened.",
          ),
        ],
      ),
      record(
        "ward-draft",
        {
          title: "Disruption notice",
          desk: "Ward desk",
          period: "Tuesday opening",
        },
        "draft",
        false,
        [section("time", "Proposed times.", "Opening time unconfirmed.")],
      ),
    ],
    null,
    [],
    { ...held, holds: ["approv"] },
  ),

  presentation(
    "flood-table-and-drill",
    "municipal-flood-drill",
    "Use the civil response desk's signed drill sheet to show the measured peak by sensor and then the steps volunteers should practise. Let someone verify the exact values without the chart. This should stay private.",
    editions(
      { title: "Flood drill", desk: "Civil response", period: "Rehearsal 4" },
      [
        section(
          "peaks",
          "Compare measured peaks, with sensor and peak as headers and cm as the unit.",
          "Canal 12 cm; Orchard 21 cm; Mill 17 cm.",
        ),
        section(
          "drill",
          "Make practice steps selectable.",
          "Post spotter; Check radios; Record closure.",
        ),
      ],
      [
        section(
          "peaks",
          "Synthetic classroom values.",
          "Canal 32 cm; Orchard 20 cm; Mill 11 cm.",
        ),
      ],
      { desk: "Classroom" },
      "signed",
    ),
    "working-record",
    [
      chart(
        "peaks",
        "bar",
        "sensor",
        "peak",
        [
          { sensor: "Canal", peak: 12 },
          { sensor: "Orchard", peak: 21 },
          { sensor: "Mill", peak: 17 },
        ],
        "cm",
      ),
      checklist(
        "drill",
        ["Post spotter", "Check radios", "Record closure"],
        "Check radios",
      ),
    ],
    held,
  ),
];

export type LocalPresentationWorld =
  (typeof openLocalPresentationWorlds)[number];
