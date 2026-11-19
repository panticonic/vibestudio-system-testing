import type {
  ComponentSpec,
  PresentationRequest,
} from "@workspace-skills/visualize/types";

export type PresentationInteraction =
  | { kind: "chart-table"; before: string; after: string; cells: string[][] }
  | { kind: "checklist"; item: string; before: string; after: string }
  | { kind: "choice"; choices: string[]; selected: string[] };

type Display = {
  id: string;
  component: ComponentSpec;
  labels: string[];
  interaction?: PresentationInteraction;
};

type Disposition =
  | { id: string; status: "plain" }
  | {
      id: string;
      status: "deferred";
      component: "Calculator" | "Diagram" | "OneOff";
    }
  | {
      id: string;
      status: "needs-review";
      reason: string;
      reasonTerms?: string[];
    };

export type PresentationWorld = {
  id: string;
  request: PresentationRequest;
  expected: (Display | Disposition)[];
  omitted: string[];
};

const section = (id: string, ask: string, data: string, required = true) => ({
  id,
  ask,
  data,
  required,
});
const display = (
  id: string,
  component: ComponentSpec,
  labels: string[],
  interaction?: PresentationInteraction,
): Display => ({
  id,
  component,
  labels,
  ...(interaction ? { interaction } : {}),
});

const checklist = (id: string, items: string[], toggle?: number): Display =>
  display(
    id,
    { component: "Checklist", props: { items } },
    items,
    toggle === undefined
      ? undefined
      : {
          kind: "checklist",
          item: items[toggle]!,
          before: `0/${items.length}`,
          after: `1/${items.length}`,
        },
  );

const series = (
  id: string,
  type: "bar" | "line" | "area" | "pie" | "donut",
  x: string,
  y: string | string[],
  data: Record<string, string | number>[],
): Display => {
  const columns = [x, ...(Array.isArray(y) ? y : [y])];
  return display(
    id,
    { component: "Chart", props: { type, x, y, data } },
    data.map((row) => String(row[x])),
    {
      kind: "chart-table",
      before: "Show table",
      after: "Show chart",
      cells: [
        columns,
        ...data.map((row) => columns.map((key) => String(row[key]))),
      ],
    },
  );
};

const stats = (id: string, entries: [string, string | number][]): Display =>
  display(
    id,
    {
      component: "Stats",
      props: { items: entries.map(([label, value]) => ({ label, value })) },
    },
    entries.flatMap(([label, value]) => [label, String(value)]),
  );

const timeline = (id: string, entries: [string, string][]): Display =>
  display(
    id,
    {
      component: "Timeline",
      props: { items: entries.map(([time, title]) => ({ time, title })) },
    },
    entries.flat(),
  );

const compare = (
  id: string,
  metric: string,
  entries: [string, string | number][],
): Display =>
  display(
    id,
    {
      component: "Compare",
      props: {
        options: entries.map(([name, value]) => ({
          name,
          attributes: { [metric]: value },
        })),
      },
    },
    [metric, ...entries.flatMap(([name, value]) => [name, String(value)])],
  );

const choices = (
  id: string,
  options: string[],
  clicks: string[],
  selected: string[],
  multiple = false,
): Display =>
  display(
    id,
    {
      component: "Choices",
      props: { id, options, ...(multiple ? { multiple } : {}) },
    },
    options,
    { kind: "choice", choices: clicks, selected },
  );

const held = (id: string, term: string): Disposition => ({
  id,
  status: "needs-review",
  reason: `The ${term} values are unavailable.`,
  reasonTerms: [term],
});

function brief(
  id: string,
  goal: string,
  sections: PresentationRequest["sections"],
  expected: PresentationWorld["expected"],
  omitted: string[] = [],
): PresentationWorld {
  return { id, request: { goal, sections }, expected, omitted };
}

export const managedPresentationWorlds: PresentationWorld[] = [
  {
    id: "equipment-load",
    request: {
      goal: "Compare the benches first, then plot the incoming jobs. Skip the unrelated paint note.",
      sections: [
        {
          id: "jobs",
          required: true,
          ask: "Draw a line chart with day and jobs as the keys.",
          data: "Mon 24 jobs; Tue 38 jobs; Wed 31 jobs.",
        },
        {
          id: "benches",
          required: true,
          ask: "Compare the two benches by their sockets.",
          data: "East bench has 6 sockets; West bench has 10 sockets.",
        },
        {
          id: "paint",
          required: false,
          ask: "What color is the door?",
          data: "The door is turquoise.",
        },
      ],
    },
    expected: [
      {
        id: "benches",
        component: {
          component: "Compare",
          props: {
            options: [
              { name: "East bench", attributes: { sockets: 6 } },
              { name: "West bench", attributes: { sockets: 10 } },
            ],
          },
        },
        labels: ["East bench", "West bench", "sockets"],
      },
      {
        id: "jobs",
        component: {
          component: "Chart",
          props: {
            type: "line",
            x: "day",
            y: "jobs",
            data: [
              { day: "Mon", jobs: 24 },
              { day: "Tue", jobs: 38 },
              { day: "Wed", jobs: 31 },
            ],
          },
        },
        labels: ["Mon", "Tue", "Wed"],
      },
    ],
    omitted: ["paint"],
  },
  {
    id: "exhibit-installation",
    request: {
      goal: "Show the installation schedule, then the setup checklist.",
      sections: [
        {
          id: "setup",
          required: true,
          ask: "Show a checklist with these labels in order.",
          data: "Check mount screws; Test gallery light; Remove floor covers.",
        },
        {
          id: "schedule",
          required: true,
          ask: "Show a timeline with the stated times and titles.",
          data: "07:20 Delivery; 08:00 Art hanging; 09:45 Safety walkthrough.",
        },
      ],
    },
    expected: [
      {
        id: "schedule",
        component: {
          component: "Timeline",
          props: {
            items: [
              { time: "07:20", title: "Delivery" },
              { time: "08:00", title: "Art hanging" },
              { time: "09:45", title: "Safety walkthrough" },
            ],
          },
        },
        labels: ["07:20", "Art hanging", "Safety walkthrough"],
      },
      {
        id: "setup",
        component: {
          component: "Checklist",
          props: {
            items: [
              "Check mount screws",
              "Test gallery light",
              "Remove floor covers",
            ],
          },
        },
        labels: [
          "Check mount screws",
          "Test gallery light",
          "Remove floor covers",
        ],
      },
    ],
    omitted: [],
  },
  {
    id: "unsampled-hall",
    request: {
      goal: "Show the confirmed headline counts. Hold the hall comparison until capacity readings are available.",
      sections: [
        {
          id: "counts",
          required: true,
          ask: "Show both confirmed headline counts.",
          data: "Confirmed bookings: 24; Waitlisted: 9.",
        },
        {
          id: "halls",
          required: true,
          ask: "Compare the North and South halls by verified capacity.",
          data: "Neither North nor South hall capacity is confirmed.",
        },
      ],
    },
    expected: [
      {
        id: "counts",
        component: {
          component: "Stats",
          props: {
            items: [
              { label: "Confirmed bookings", value: 24 },
              { label: "Waitlisted", value: 9 },
            ],
          },
        },
        labels: ["Confirmed bookings", "24", "Waitlisted", "9"],
      },
      {
        id: "halls",
        status: "needs-review",
        reason: "The hall capacities are unconfirmed.",
      },
    ],
    omitted: [],
  },
  {
    id: "energy-readout",
    request: {
      goal: "State the reporting date, compare the current totals, then hand off the interactive cost calculator.",
      sections: [
        {
          id: "date",
          required: true,
          ask: "What is the reporting date?",
          data: "The reporting date is 18 November.",
        },
        {
          id: "totals",
          required: true,
          ask: "Show headline totals with their units.",
          data: "Grid: 23 kWh. Battery: 7 kWh.",
        },
        {
          id: "estimate",
          required: true,
          ask: "Let me vary the rate and see total cost change.",
          data: "Total cost equals energy used times cost per kWh.",
        },
      ],
    },
    expected: [
      { id: "date", status: "plain" },
      {
        id: "totals",
        component: {
          component: "Stats",
          props: {
            items: [
              { label: "Grid", value: "23 kWh" },
              { label: "Battery", value: "7 kWh" },
            ],
          },
        },
        labels: ["Grid", "23 kWh", "Battery", "7 kWh"],
      },
      { id: "estimate", status: "deferred", component: "Calculator" },
    ],
    omitted: [],
  },
  brief(
    "dispatch-pressure",
    "Show the shift counts first, then compare the two response queues. Omit the internal comment.",
    [
      section(
        "queues",
        "Compare Day desk and Night desk by open tickets using the attribute tickets.",
        "Day desk: 8 tickets. Night desk: 13 tickets.",
      ),
      section(
        "shift",
        "Show a bar chart of tickets by shift. Keys shift and tickets.",
        "Early: 7; Midday: 12; Late: 4.",
      ),
      section("comment", "State the mascot.", "The mascot is a fox.", false),
    ],
    [
      series("shift", "bar", "shift", "tickets", [
        { shift: "Early", tickets: 7 },
        { shift: "Midday", tickets: 12 },
        { shift: "Late", tickets: 4 },
      ]),
      compare("queues", "tickets", [
        ["Day desk", 8],
        ["Night desk", 13],
      ]),
    ],
    ["comment"],
  ),
  brief(
    "incident-restoration",
    "Show the response timeline, then the verified completion checklist.",
    [
      section(
        "checklist",
        "Show a Checklist with these exact three steps.",
        "Rotate temporary key; Confirm standby replica; Close recovery log.",
      ),
      section(
        "timeline",
        "Show a Timeline with the times and titles in order.",
        "06:04 Alert opened; 06:12 Replica promoted; 06:46 Traffic restored.",
      ),
    ],
    [
      timeline("timeline", [
        ["06:04", "Alert opened"],
        ["06:12", "Replica promoted"],
        ["06:46", "Traffic restored"],
      ]),
      checklist(
        "checklist",
        [
          "Rotate temporary key",
          "Confirm standby replica",
          "Close recovery log",
        ],
        1,
      ),
    ],
  ),
  brief(
    "lab-reagent-packing",
    "Show the packing checklist, then the key cold-chain totals.",
    [
      section(
        "totals",
        "Display the headline values and exact units as Stats.",
        "Ice packs: 6 packs. Cooling duration: 14 h.",
      ),
      section(
        "packing",
        "Display a checklist using each supplied label.",
        "Seal reference tube; Inspect cold box; Label custody sheet; Confirm pickup.",
      ),
    ],
    [
      checklist(
        "packing",
        [
          "Seal reference tube",
          "Inspect cold box",
          "Label custody sheet",
          "Confirm pickup",
        ],
        2,
      ),
      stats("totals", [
        ["Ice packs", "6 packs"],
        ["Cooling duration", "14 h"],
      ]),
    ],
  ),
  brief(
    "filing-queue-split",
    "Show the category split first, then offer a single choice about follow-up.",
    [
      section(
        "filing-next",
        "Ask the reader to pick one option with Choices. Use id filing-next. Options only.",
        "Audit oldest; Audit largest; Review exceptions.",
      ),
      section(
        "volume",
        "Show a donut chart with category and files fields.",
        "Routine 54; Priority 33; Escalated 13.",
      ),
    ],
    [
      series("volume", "donut", "category", "files", [
        { category: "Routine", files: 54 },
        { category: "Priority", files: 33 },
        { category: "Escalated", files: 13 },
      ]),
      choices(
        "filing-next",
        ["Audit oldest", "Audit largest", "Review exceptions"],
        ["Audit largest", "Review exceptions"],
        ["Review exceptions"],
      ),
    ],
  ),
  brief(
    "workshop-agenda-vote",
    "Show agenda times, then collect a multiple selection of workshop topics.",
    [
      section(
        "agenda-vote",
        "Use a Choices component with id agenda-vote, enable multiple and use the listed options only.",
        "Tool demos; Accessibility; Testing strategy.",
      ),
      section(
        "agenda",
        "Show a Timeline with the stated times and titles.",
        "09:00 Welcome; 09:30 Breakouts; 11:00 Readouts.",
      ),
    ],
    [
      timeline("agenda", [
        ["09:00", "Welcome"],
        ["09:30", "Breakouts"],
        ["11:00", "Readouts"],
      ]),
      choices(
        "agenda-vote",
        ["Tool demos", "Accessibility", "Testing strategy"],
        ["Tool demos", "Testing strategy"],
        ["Tool demos", "Testing strategy"],
        true,
      ),
    ],
  ),
  brief(
    "library-visit-route",
    "Give the stops in route order and then show the bag checklist.",
    [
      section(
        "bag",
        "Make a checklist with the exact labels.",
        "Pack receipt pouch; Bring reader card; Confirm courier number.",
      ),
      section(
        "route",
        "Show the two stops as an ordered PlaceMap route using the supplied names and coordinates.",
        "North Library at lat 46.12 lng 10.20, then South Archive at lat 46.10 lng 10.18.",
      ),
    ],
    [
      display(
        "route",
        {
          component: "PlaceMap",
          props: {
            route: true,
            places: [
              { name: "North Library", lat: 46.12, lng: 10.2 },
              { name: "South Archive", lat: 46.1, lng: 10.18 },
            ],
          },
        },
        ["North Library", "South Archive"],
      ),
      checklist(
        "bag",
        ["Pack receipt pouch", "Bring reader card", "Confirm courier number"],
        0,
      ),
    ],
  ),
  brief(
    "readership-trend",
    "Show reference and loan requests as two lines, then show the headline counts.",
    [
      section(
        "summary",
        "Show two headline figures as Stats.",
        "New members: 12. Renewals: 32.",
      ),
      section(
        "requests",
        "Use a line Chart with month as x and series reference and loans in that order.",
        "Mar reference 5 loans 12; Apr reference 7 loans 15; May reference 8 loans 17.",
      ),
    ],
    [
      series(
        "requests",
        "line",
        "month",
        ["reference", "loans"],
        [
          { month: "Mar", reference: 5, loans: 12 },
          { month: "Apr", reference: 7, loans: 15 },
          { month: "May", reference: 8, loans: 17 },
        ],
      ),
      stats("summary", [
        ["New members", 12],
        ["Renewals", 32],
      ]),
    ],
  ),
  brief(
    "campus-occupancy",
    "Show the confirmed room totals and hold the unmeasured building trend.",
    [
      section(
        "trend",
        "Plot verified building occupancy values by day in a line chart.",
        "No verified occupancy values were collected this week.",
      ),
      section(
        "totals",
        "Show these headline counts as Stats.",
        "Rooms reserved: 9. Rooms inspected: 7.",
      ),
    ],
    [
      stats("totals", [
        ["Rooms reserved", 9],
        ["Rooms inspected", 7],
      ]),
      held("trend", "occupancy"),
    ],
  ),
  brief(
    "shift-groups-and-reserves",
    "Compare the teams using reserve hours, then show the handover checklist.",
    [
      section(
        "steps",
        "Use a Checklist with the given labels in the given order.",
        "Lock side gate; Leave night log; Confirm keys.",
      ),
      section(
        "reserves",
        "Use Compare and the attribute hours for the two teams.",
        "Quay crew: 11 hours. Ferry crew: 8 hours.",
      ),
    ],
    [
      compare("reserves", "hours", [
        ["Quay crew", 11],
        ["Ferry crew", 8],
      ]),
      checklist(
        "steps",
        ["Lock side gate", "Leave night log", "Confirm keys"],
        2,
      ),
    ],
  ),
  brief(
    "funding-round-summary",
    "Give the award date as a simple fact, compare allocation categories, then defer a what-if calculator.",
    [
      section(
        "award-day",
        "What is the award date?",
        "The award date is 5 June.",
      ),
      section(
        "allocations",
        "Show these as a pie Chart with category and amount only.",
        "Scholarships 52; Travel 18; Materials 30.",
      ),
      section(
        "what-if",
        "Let me vary the exchange rate and recalculate the budget.",
        "Each local amount is multiplied by the exchange rate.",
      ),
    ],
    [
      { id: "award-day", status: "plain" },
      series("allocations", "pie", "category", "amount", [
        { category: "Scholarships", amount: 52 },
        { category: "Travel", amount: 18 },
        { category: "Materials", amount: 30 },
      ]),
      { id: "what-if", status: "deferred", component: "Calculator" },
    ],
  ),
  brief(
    "concessions-trend",
    "Show the daily return trend as an area chart, then compare the two return desks.",
    [
      section(
        "desks",
        "Use a Compare view by the attribute trays.",
        "Upper desk: 16 trays. Lower desk: 18 trays.",
      ),
      section(
        "returns",
        "Use an area Chart with day and returns.",
        "Thu: 6; Fri: 14; Sat: 20.",
      ),
    ],
    [
      series("returns", "area", "day", "returns", [
        { day: "Thu", returns: 6 },
        { day: "Fri", returns: 14 },
        { day: "Sat", returns: 20 },
      ]),
      compare("desks", "trays", [
        ["Upper desk", 16],
        ["Lower desk", 18],
      ]),
    ],
  ),
  brief(
    "cold-storage-unknown",
    "Show the valid storage options and hold the map until coordinates are confirmed.",
    [
      section(
        "map",
        "Use PlaceMap for East Annex and Hill Store with verified coordinates.",
        "The coordinates for both locations are unconfirmed.",
      ),
      section(
        "storage",
        "Compare Locker A and Locker B by the attribute shelves.",
        "Locker A has 8 shelves. Locker B has 12 shelves.",
      ),
    ],
    [
      compare("storage", "shelves", [
        ["Locker A", 8],
        ["Locker B", 12],
      ]),
      held("map", "coordinates"),
    ],
  ),
  brief(
    "permit-renewal",
    "Show the permit renewal dates and offer a single next step.",
    [
      section(
        "permit-next",
        "Use Choices with id permit-next and only the supplied options.",
        "Check equipment; Confirm insurance; Review fee.",
      ),
      section(
        "permits",
        "Show a Timeline with the stated dates as times.",
        "07 Aug Draft filed; 12 Aug Documents accepted; 23 Aug Council review.",
      ),
    ],
    [
      timeline("permits", [
        ["07 Aug", "Draft filed"],
        ["12 Aug", "Documents accepted"],
        ["23 Aug", "Council review"],
      ]),
      choices(
        "permit-next",
        ["Check equipment", "Confirm insurance", "Review fee"],
        ["Confirm insurance"],
        ["Confirm insurance"],
      ),
    ],
  ),
  brief(
    "supply-gap-decision",
    "Use the confirmed quantities and offer multiple supply priorities. Omit the discarded desk count.",
    [
      section(
        "supply-priorities",
        "Use a multiple Choices view with id supply-priorities. Include only these options.",
        "Paper; Batteries; Cable ties.",
      ),
      section(
        "stock",
        "Show headline counts with the stated units.",
        "Reserve paper: 4 boxes. Spare lamps: 12 units.",
      ),
      section(
        "desks",
        "List the obsolete desk count.",
        "There were 14 desks before the refit.",
        false,
      ),
    ],
    [
      stats("stock", [
        ["Reserve paper", "4 boxes"],
        ["Spare lamps", "12 units"],
      ]),
      choices(
        "supply-priorities",
        ["Paper", "Batteries", "Cable ties"],
        ["Paper", "Cable ties", "Paper"],
        ["Cable ties"],
        true,
      ),
    ],
    ["desks"],
  ),
  brief(
    "warehouse-handover",
    "Show night-shift checks first, then both picking series, and put the pickup timeline last.",
    [
      section(
        "pickup",
        "Show a Timeline of these pickup stages.",
        "05:40 Loading; 06:10 Inspection; 06:50 Departure.",
      ),
      section(
        "series",
        "Draw a bar Chart with depot as x and picked then packed as y.",
        "North picked 18 packed 11; South picked 22 packed 16.",
      ),
      section(
        "checks",
        "Show a Checklist of the assigned checks.",
        "Review key log; Charge radios; Isolate damaged tote.",
      ),
    ],
    [
      checklist(
        "checks",
        ["Review key log", "Charge radios", "Isolate damaged tote"],
        0,
      ),
      series(
        "series",
        "bar",
        "depot",
        ["picked", "packed"],
        [
          { depot: "North", picked: 18, packed: 11 },
          { depot: "South", picked: 22, packed: 16 },
        ],
      ),
      timeline("pickup", [
        ["05:40", "Loading"],
        ["06:10", "Inspection"],
        ["06:50", "Departure"],
      ]),
    ],
  ),
  brief(
    "public-library-rollover",
    "Show the shelf counts, defer the shelving mechanism diagram, and show the move checklist at the end.",
    [
      section(
        "steps",
        "Show the steps as a Checklist.",
        "Mark shelf boundary; Confirm aisle clearance; Move final cart.",
      ),
      section(
        "shelves",
        "Show the two headline figures as Stats.",
        "Tall shelves: 17. Short shelves: 23.",
      ),
      section(
        "system",
        "Use a diagram to explain how the shelf trays connect to the rails.",
        "Trays attach to rails, which are supported by the frame.",
      ),
    ],
    [
      stats("shelves", [
        ["Tall shelves", 17],
        ["Short shelves", 23],
      ]),
      { id: "system", status: "deferred", component: "Diagram" },
      checklist(
        "steps",
        ["Mark shelf boundary", "Confirm aisle clearance", "Move final cart"],
        2,
      ),
    ],
  ),
];
