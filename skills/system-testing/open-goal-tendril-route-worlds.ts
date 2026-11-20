export type RouteFunction = {
  name: string;
  description: string;
  phrases?: string[];
};
export type SlotSeed = {
  key: string;
  label: string;
  device: string | null;
  state: "current" | "offline" | "retired";
  functions: RouteFunction[];
};
export type BoardSeed = {
  key: string;
  title: string;
  room: string;
  audience: string;
  edition: "current" | "retired" | "draft";
  agent: "attached" | "detached";
  retainAllowed: boolean;
  slots: SlotSeed[];
  utterance: { text: string; via: "text" | "voice" };
};
export type Projection =
  | {
      kind: "local";
      name: string;
      phrase: string;
      text: string | null;
      captures: string[];
    }
  | { kind: "agent"; attached: boolean }
  | { kind: "ambiguous"; names: string[] };
type Expected = {
  board: "main" | null;
  slot: string | null;
  projection: Projection | null;
  decision: "verified" | "held";
  retain: boolean;
  reason: string[];
};
type Coedit =
  | { functions: RouteFunction[] }
  | { audience: string }
  | { state: SlotSeed["state"] };
type GoalOptions = {
  held?: boolean;
  reason?: string[];
  retain?: boolean;
  slot?: string | null;
  board?: "main" | null;
  main?: Partial<BoardSeed>;
  decoy?: Partial<BoardSeed>;
  coedit?: Coedit;
  reprobe?: boolean;
};
const fn = (name: string, ...phrases: string[]): RouteFunction => ({
  name,
  description: "Retained page capability " + name,
  phrases,
});
const slot = (
  key: string,
  label: string,
  functions: RouteFunction[],
  state: SlotSeed["state"] = "current",
): SlotSeed => ({
  key,
  label,
  functions,
  state,
  device: state === "retired" ? null : "owned-" + key,
});
const exact = (
  name: string,
  phrase: string,
  text: string | null = null,
  captures: string[] = [],
): Projection => ({ kind: "local", name, phrase, text, captures });
const agent = (attached: boolean): Projection => ({ kind: "agent", attached });

function scenario(
  id: string,
  group: string,
  title: string,
  room: string,
  audience: string,
  goal: string,
  text: string,
  via: BoardSeed["utterance"]["via"],
  functions: RouteFunction[],
  projection: Projection | null,
  options: GoalOptions = {},
) {
  const main: BoardSeed = {
    key: "main",
    title,
    room,
    audience,
    edition: "current",
    agent: "attached",
    retainAllowed: options.retain ?? false,
    utterance: { text, via },
    slots: [slot("operator", "Operator panel", functions)],
    ...options.main,
  };
  const copy: BoardSeed = {
    ...main,
    key: "neighbor",
    room: room + " workshop",
    audience: "training volunteers",
    edition: "retired",
    retainAllowed: false,
    slots: [slot("operator", "Operator panel", [fn("exercise", text)])],
    ...options.decoy,
  };
  const expected: Expected = {
    board: options.board === undefined ? "main" : options.board,
    slot: options.slot === undefined ? "operator" : options.slot,
    projection,
    decision: options.reason ? "held" : "verified",
    retain: options.retain ?? false,
    reason: options.reason ?? [],
  };
  return {
    id: "tendril-route-" + id,
    workspace: "examples",
    kind: "tendrilRoute",
    sourceGroup: "vibestudio:tendril-route:" + group,
    ...(options.held
      ? {
          split: "test" as const,
          relatedSourceGroup: "vibestudio:tendril-route:botanical-campus",
        }
      : {}),
    goal,
    boards: [copy, main],
    expected,
    ...(options.coedit
      ? { coedit: options.coedit, reprobe: options.reprobe === true }
      : {}),
  } as const;
}
const test = { held: true } as const;
export const openTendrilRouteWorlds = [
  scenario(
    "clock-exact-over-wildcard",
    "stage-time",
    "Stage timer",
    "Lighting booth",
    "show lead",
    "The show lead wonders whether the phrase on the lighting booth's Stage timer will stop their timer or enter a general stop request. Check the current local operator panel and keep the route evidence private.",
    "Please stop the timer, thanks!",
    "voice",
    [fn("setStop", "stop *"), fn("stopTimer", "stop the timer")],
    exact("stopTimer", "stop the timer"),
    { retain: true },
  ),
  scenario(
    "capture-supply-label",
    "animal-care",
    "Supply board",
    "Care cellar",
    "inventory lead",
    "On the care cellar's Supply board, see how the captured restocking instruction would behave and what item label it carries. I want a dry review before opening stock.",
    "Could you mark Oat Milk, thank you?",
    "text",
    [fn("markStock", "mark *"), fn("markDrawer", "drawer *")],
    exact("markStock", "mark *", "Oat Milk"),
  ),
  scenario(
    "two-arguments-receiving",
    "print-receiving",
    "Receiving queue",
    "Ink desk",
    "receiving coordinator",
    "Review the ink desk's current Receiving queue and tell me what both parts of the incoming request would mean. Leave the queue alone.",
    "move Proof Box to Rack Four",
    "voice",
    [fn("moveParcel", "move *"), fn("moveToRack", "move * to *")],
    exact("moveToRack", "move * to *", "Proof Box", ["Proof Box", "Rack Four"]),
  ),
  scenario(
    "attached-agent-fallback",
    "frame-repair",
    "Repair panel",
    "Framing office",
    "restoration keeper",
    "The framing office has a captured question on its Repair panel. Is this a built-in control or would it go to the attached conversation? Only check the route.",
    "Why are these frame corners mismatched?",
    "text",
    [fn("rotatePreview", "rotate preview")],
    agent(true),
  ),
  scenario(
    "detached-room-hold",
    "lighting-tape",
    "Focus board",
    "Rig office",
    "light crew",
    "Before we rely on the rig office's Focus board for help, make sure its recorded question can reach someone. If it would need an agent with no attachment, stop there.",
    "How do we improve the corner lighting?",
    "voice",
    [fn("nextLight", "next fixture")],
    agent(false),
    { main: { agent: "detached" }, reason: ["attach"] },
  ),
  scenario(
    "page-only-no-fallback",
    "prepared-buffet",
    "Serving checklist",
    "Kitchen pass",
    "service captain",
    "I need the captured instruction on the Kitchen pass Serving checklist to stay a local page command. If it would enter the conversation, give me a hold and don't send it.",
    "Open thirteen extra portions",
    "text",
    [fn("openDrawer", "open drawer *")],
    agent(true),
    { reason: ["local"] },
  ),
  scenario(
    "offline-tablet-no-desktop",
    "coach-room",
    "Warm-up list",
    "Practice office",
    "team coach",
    "Can the Practice tablet run the captured warm-up instruction for the coach? Use that tablet only and hold if it isn't current, even though a desktop copy is around.",
    "next drill",
    "voice",
    [fn("nextDrill", "next drill")],
    null,
    {
      slot: null,
      main: {
        slots: [
          slot(
            "tablet",
            "Practice tablet",
            [fn("nextDrill", "next drill")],
            "offline",
          ),
          slot("office", "Office desktop", [fn("nextDrill", "next drill")]),
        ],
      },
      reason: ["offline"],
    },
  ),
  scenario(
    "retired-specimen-slot",
    "specimen-rooms",
    "Specimen notes",
    "Sorting bay",
    "collections keeper",
    "Review the Sorting bay Specimen notes instruction specifically on the retired scan station. If the request points at an old route, don't use the newly installed cabinet panel in its place.",
    "scan tray",
    "text",
    [fn("scan", "scan tray")],
    null,
    {
      slot: null,
      main: {
        slots: [
          slot(
            "old",
            "Retired scan station",
            [fn("scan", "scan tray")],
            "retired",
          ),
          slot("current", "Cabinet panel", [fn("scan", "scan tray")]),
        ],
      },
      reason: ["retir"],
    },
  ),
  scenario(
    "missing-approved-audience",
    "flood-warehouse",
    "Sandbag roster",
    "Depot dispatch",
    "dispatch supervisors",
    "The Depot dispatch supervisors ask whether their Sandbag roster's recorded cue is usable. A practice board with the same title is not a substitute for the supervisors' current board.",
    "queue North Gate",
    "text",
    [fn("queueGate", "queue *")],
    null,
    {
      board: null,
      slot: null,
      main: { edition: "draft" },
      reason: ["current"],
    },
  ),
  scenario(
    "duplicate-current-audience",
    "key-issue",
    "Keys ledger",
    "Credential desk",
    "shift manager",
    "We have two current Keys ledgers both labelled for the Credential desk shift manager. Check how the captured phrase would route only if the owner scope identifies one ledger. Otherwise leave it undecided.",
    "show cabinet",
    "voice",
    [fn("showCabinet", "show cabinet")],
    null,
    {
      board: null,
      slot: null,
      decoy: {
        room: "Credential desk",
        audience: "shift manager",
        edition: "current",
      },
      reason: ["ambigu"],
    },
  ),
  scenario(
    "unretained-registration-precedence",
    "radio-channel",
    "Station mixer",
    "Continuity booth",
    "audio lead",
    "Can the audio lead trust how the Continuity booth's Station mixer will interpret the captured voice line? If two equally specific page controls claim it and no order is retained, say so.",
    "hold cue",
    "voice",
    [fn("holdBroadcast", "hold cue"), fn("holdMonitor", "hold cue")],
    { kind: "ambiguous", names: ["holdBroadcast", "holdMonitor"] },
    { reason: ["ambigu"] },
  ),
  scenario(
    "refresh-replaced-exact-action",
    "battery-exchange",
    "Swap log",
    "Charging desk",
    "bench operator",
    "Review the most recent Swap log cue for the Charging desk, including any correction to its exposed actions while you work. Save the verified private evidence for the bench operator.",
    "return blue pack",
    "text",
    [fn("hotReturn", "return blue pack"), fn("returnPack", "return *")],
    exact("returnPack", "return *", "blue pack"),
    {
      retain: true,
      coedit: {
        functions: [
          fn("returnPack", "return *"),
          fn("inspectPack", "inspect pack"),
        ],
      },
      reprobe: true,
    },
  ),
  scenario(
    "audience-changed-at-probe",
    "day-camp",
    "Pickup sign",
    "Camp exit",
    "front desk",
    "Check the captured pickup instruction only for the front desk's current Camp exit board. If its audience switches to another group during the review, leave that new group's route alone.",
    "hold for pickup",
    "voice",
    [fn("hold", "hold for pickup")],
    null,
    { coedit: { audience: "visitor volunteers" }, reason: ["audience"] },
  ),
  scenario(
    "pinned-cue-no-retry",
    "textile-station",
    "Repair sampler",
    "Loom studio",
    "quality owner",
    "The quality owner needs the exact Repair sampler revision they were reviewing. If the Loom studio updates its cue handler while you're checking, tell me to pause instead of moving the evidence forward.",
    "finish edge",
    "text",
    [fn("finish", "finish edge")],
    null,
    {
      coedit: { functions: [fn("reviewEdge", "finish edge")] },
      reason: ["revis"],
    },
  ),
  scenario(
    "scope-picks-rehearsal-record",
    "gallery-greeting",
    "Door signals",
    "Visitor operations",
    "gallery lead",
    "Use the gallery lead's Door signals board in Visitor operations. The school desk uses the same title and voice keyword, but its handler isn't our route. Retain a private record of the verified gallery route.",
    "welcome group",
    "voice",
    [fn("showWelcome", "welcome group")],
    exact("showWelcome", "welcome group"),
    {
      retain: true,
      decoy: {
        room: "School desk",
        audience: "program assistants",
        edition: "current",
        slots: [
          slot("operator", "Operator panel", [
            fn("startLesson", "welcome group"),
          ]),
        ],
      },
    },
  ),
  scenario(
    "unicode-cue-native-folding",
    "botanical-desk-guides",
    "Tour cue list",
    "Conservatory desk",
    "greenhouse guide",
    "See whether the conservatory desk's captured accessibility cue is covered by a local control. A report of its actual route is enough; don't trigger it.",
    "ＯＫＡＹ, SHOW SEAT OPTIONS, thanks!",
    "voice",
    [fn("showBenches", "show seat options"), fn("showAny", "show *")],
    exact("showBenches", "show seat options"),
    test,
  ),
  scenario(
    "field-unit-office-fails",
    "botanical-plant-beds",
    "Transplant log",
    "Propagation office",
    "bed steward",
    "The bed steward wants to check the captured Transplant log phrase on the field tablet. Do not use the office monitor's route if the field unit has dropped out.",
    "record tray Fern count",
    "text",
    [fn("logTray", "record tray *")],
    null,
    {
      ...test,
      slot: null,
      main: {
        slots: [
          slot(
            "field",
            "Field tablet",
            [fn("logTray", "record tray *")],
            "offline",
          ),
          slot("office", "Office monitor", [fn("logTray", "record tray *")]),
        ],
      },
      reason: ["offline"],
    },
  ),
  scenario(
    "glazing-two-argument-route",
    "botanical-winter-glazing",
    "Pane requests",
    "Glasshouse maintenance",
    "facilities technician",
    "Tell the facilities technician the exact action and source/destination carried by the captured Glasshouse maintenance cue. Keep a private evidence receipt so they can review those arguments.",
    "please compare North Pane with Roof Shade, thanks",
    "voice",
    [
      fn("compareAnything", "compare *"),
      fn("compareFixtures", "compare * with *"),
    ],
    exact("compareFixtures", "compare * with *", "North Pane", [
      "North Pane",
      "Roof Shade",
    ]),
    { ...test, retain: true },
  ),
  scenario(
    "cross-desk-vendor-hold",
    "botanical-seed-vouchers",
    "Voucher clock",
    "Seed library",
    "lending desk",
    "The lending desk wants to check Voucher clock at the Seed library. If their copy never reached a current edition, say so rather than using the current vendor example.",
    "request next ticket",
    "voice",
    [fn("nextTicket", "request next ticket")],
    null,
    {
      ...test,
      board: null,
      slot: null,
      main: { edition: "draft" },
      decoy: {
        room: "Seed vendor",
        audience: "wholesale sales",
        edition: "current",
      },
      reason: ["current"],
    },
  ),
  scenario(
    "refresh-plant-sale-cue",
    "botanical-sale-donation",
    "Donation stock",
    "Plant sale",
    "volunteer cashier",
    "Check what the latest Plant sale donation-stock voice cue will do, including any correction made in the meantime. Leave a private evidence receipt if it stays on the volunteer cashier's local board.",
    "count reserved plants",
    "voice",
    [fn("askCount", "count *"), fn("seeReserved", "count reserved plants")],
    exact("auditReserved", "count reserved plants"),
    {
      ...test,
      retain: true,
      coedit: {
        functions: [
          fn("askCount", "count *"),
          fn("auditReserved", "count reserved plants"),
        ],
      },
      reprobe: true,
    },
  ),
];

export type TendrilRouteWorld = (typeof openTendrilRouteWorlds)[number];
