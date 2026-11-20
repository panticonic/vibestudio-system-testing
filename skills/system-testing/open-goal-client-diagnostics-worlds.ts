import type {
  ClientDiagnosticsWorld as World,
  ClientFrame,
  ClientScene,
} from "./open-goal-client-diagnostics-managed.js";
type Step = World["expected"]["steps"][number];
type Input = Omit<World, "kind" | "workspace" | "sourceGroup">;
const observe = (
  surface: string,
  stage = "open",
  width?: number,
  overflow?: boolean,
): Step => ({
  kind: "observe",
  surface,
  stage,
  ...(width !== undefined && { width }),
  ...(overflow !== undefined && { overflow }),
});
const click = (
  surface: string,
  control: string,
  status: "applied" | "changed" = "applied",
): Step => ({
  kind: "apply",
  surface,
  action: { kind: "click", control },
  status,
});
const size = (surface: string, width: 320 | 390 | 1280): Step => ({
  kind: "apply",
  surface,
  action: { kind: "viewport", width },
  status: "applied",
});
const reload = (surface: string): Step => ({
  kind: "apply",
  surface,
  action: { kind: "reload" },
  status: "applied",
});
const recap: Step = { kind: "channel", view: "recap" };
const triage: Step = { kind: "channel", view: "triage" };
const frame = (
  version: string,
  text: string,
  extra: Partial<ClientFrame> = {},
): ClientFrame => ({ version, text, ...extra });
const button = (id: string, label: string, next: string) => ({
  id,
  label,
  next,
});
const scene = (
  id: string,
  title: string,
  audience: string,
  device: string,
  open: ClientFrame,
  extra: Partial<ClientScene> = {},
): ClientScene => ({
  id,
  title,
  audience,
  device,
  modifiable: false,
  initial: "open",
  frames: { open },
  allowed: [],
  ...extra,
});
const channel = (title: string, ...messages: string[]) => ({ title, messages });
function goal(
  id: string,
  goal: string,
  surfaces: ClientScene[],
  steps: Step[],
  outcome: World["expected"]["outcome"],
  citations: string[],
  options: Partial<Pick<Input, "channel" | "handoff" | "split">> & {
    preHandoff?: World["expected"]["preHandoff"];
  } = {},
): World {
  const { preHandoff, ...fixture } = options;
  return {
    kind: "clientDiagnostics",
    workspace: "examples",
    sourceGroup: "vibestudio:client-diagnostics:" + id,
    id,
    goal,
    surfaces,
    expected: { steps, outcome, citations, ...(preHandoff && { preHandoff }) },
    ...fixture,
  };
}

const layouts = [
  goal(
    "client-compare-same-titled-visitor-and-staff-board",
    "The two notices are both called Depot Board. Compare the Visitors display first and the Staff desktop second. Which one gives the public location and where does the internal crew report? Leave the boards unchanged.",
    [
      scene(
        "visitor",
        "Depot Board",
        "Visitors",
        "lobby-display",
        frame("public-2", "Wait by Sand Door."),
      ),
      scene(
        "staff",
        "Depot Board",
        "Staff",
        "desktop",
        frame("internal-7", "Report to Pump Room."),
      ),
    ],
    [observe("visitor"), observe("staff")],
    "local-disagreement",
    ["Sand Door", "Pump Room"],
  ),
  goal(
    "client-check-narrow-queue-overflow-and-restore",
    "Does the public Queue Monitor clip the right-hand instructions on a 320px phone? Check desktop, test the phone width, then restore 1280 and confirm recovery. Keep the staff preview alone.",
    [
      scene(
        "monitor",
        "Queue Monitor",
        "Visitors",
        "browser",
        frame("queue-4", "Keep right at the bell.", { minWidth: 650 }),
        { modifiable: true, allowed: ["viewport"] },
      ),
      scene(
        "private",
        "Queue Monitor",
        "Staff",
        "desktop",
        frame("private-3", "Use behind the counter."),
      ),
    ],
    [
      observe("monitor", "open", 1280, false),
      size("monitor", 320),
      observe("monitor", "open", 320, true),
      size("monitor", 1280),
      observe("monitor", "open", 1280, false),
    ],
    "recovered",
    ["320", "1280", "Keep right"],
  ),
  goal(
    "client-compare-layout-without-editing-signed-display",
    "Check the signed Exhibition Hall display and compare it with the prep desktop. Tell me if they announce different routes. Don't resize or reload the signed display.",
    [
      scene(
        "signed",
        "Exhibition Hall",
        "Visitors",
        "signed-display",
        frame("signed-v4", "Use Gallery Two."),
      ),
      scene(
        "prep",
        "Exhibition Hall",
        "Staff",
        "desktop",
        frame("draft-v5", "Use Gallery Four."),
      ),
    ],
    [observe("signed"), observe("prep")],
    "local-disagreement",
    ["Gallery Two", "Gallery Four"],
    { split: "test" },
  ),
  goal(
    "client-inspect-operator-console-before-blaming-the-display",
    "The transport display looks healthy, but the staff console shows a reconnect warning. Check the transport display first and the staff console after it. Report the warning and the verified visitor message separately.",
    [
      scene(
        "screen",
        "Transport Route",
        "Visitors",
        "display",
        frame("transport-5", "Tram departs at 06:10."),
      ),
      scene(
        "console",
        "Transport Route",
        "Staff",
        "desktop",
        frame("operator-5", "Driver manifest loaded.", {
          log: { level: "warn", message: "Roster reconnect pending" },
        }),
      ),
    ],
    [observe("screen"), observe("console")],
    "local-disagreement",
    ["06:10", "Roster reconnect pending"],
  ),
  goal(
    "client-compare-responsive-notice-without-sending-anything",
    "Check that the rehearsal notice fits at 390px and still reads the same. Leave the rehearsal client at that width. The production display belongs to another owner.",
    [
      scene(
        "rehearsal",
        "Rehearsal Notice",
        "Volunteers",
        "mobile-preview",
        frame("rehearsal-2", "Meet in Green Room."),
        { modifiable: true, allowed: ["viewport"] },
      ),
      scene(
        "prod",
        "Rehearsal Notice",
        "Public",
        "display",
        frame("public-8", "Performances begin at noon."),
      ),
    ],
    [
      observe("rehearsal"),
      size("rehearsal", 390),
      observe("rehearsal", "open", 390, false),
    ],
    "healthy",
    ["390", "Green Room"],
  ),
];

const durable = [
  goal(
    "client-separate-visitor-cache-from-latest-durable-request",
    "Visitors see a previously issued meeting time, but a new request may be awaiting a response. Inspect the Lobby Meeting board and then check the owned channel. Report the exact newer request and its standing.",
    [
      scene(
        "board",
        "Lobby Meeting",
        "Visitors",
        "display",
        frame("posted-1", "Meet at 10:00."),
      ),
    ],
    [observe("board"), recap],
    "awaiting-agent",
    ["10:00", "Could we move to 11:20?"],
    {
      channel: channel(
        "Lobby meeting conversation",
        "Original call is 10:00.",
        "Could we move to 11:20?",
      ),
    },
  ),
  goal(
    "client-hold-apparent-completion-with-no-durable-answer",
    "The service desk browser shows Request done. Check the browser and the owned conversation before telling the clerk whether an answer actually arrived. Keep the latest question exactly.",
    [
      scene(
        "desk",
        "Service Desk",
        "Clerks",
        "browser",
        frame("optimistic-2", "Request done."),
      ),
    ],
    [observe("desk"), recap],
    "awaiting-agent",
    ["Request done", "Who can approve the return?"],
    {
      split: "test",
      channel: channel("Return conversation", "Who can approve the return?"),
    },
  ),
  goal(
    "client-diagnose-empty-roster-with-clean-publication",
    "The shared support panel has nobody taking ownership. Read the panel, then triage the owned support channel's roster. Tell me whether the durable publication itself is broken.",
    [
      scene(
        "support",
        "Support Intake",
        "Staff",
        "desktop",
        frame("support-1", "Waiting for an owner."),
      ),
    ],
    [observe("support"), triage],
    "roster-needed",
    ["Waiting for an owner", "roster"],
    { channel: channel("Support owned channel") },
  ),
  goal(
    "client-reconcile-two-presentations-before-checking-channel-tail",
    "The Hall Updates phone is older than the welcome monitor. Compare the phone then the monitor, then check the owned channel for the newest published line. Who still needs to answer?",
    [
      scene(
        "phone",
        "Hall Updates",
        "Volunteers",
        "phone",
        frame("r17", "Doors at 08:00."),
      ),
      scene(
        "welcome",
        "Hall Updates",
        "Visitors",
        "monitor",
        frame("r18", "Doors at 08:30."),
      ),
    ],
    [observe("phone"), observe("welcome"), recap],
    "awaiting-agent",
    ["r17", "r18", "Can the lead confirm 08:30?"],
    {
      channel: channel(
        "Hall volunteer conversation",
        "The display was updated.",
        "Can the lead confirm 08:30?",
      ),
    },
  ),
  goal(
    "client-show-an-untouched-empty-triage-channel",
    "The Dispatch desktop shows no assigned responder. Verify its message and then check the channel roster and durable integrity. The map kiosk is not part of this incident.",
    [
      scene(
        "dispatch",
        "Dispatch station",
        "Operators",
        "desktop",
        frame("dispatch-14", "No assigned responder."),
      ),
      scene(
        "map",
        "Dispatch station",
        "Visitors",
        "map-kiosk",
        frame("map-8", "Explore the venue."),
      ),
    ],
    [observe("dispatch"), triage],
    "roster-needed",
    ["No assigned responder", "roster"],
    { split: "test", channel: channel("Dispatch owned channel") },
  ),
  goal(
    "client-read-canonical-question-despite-already-cached-approval",
    "The archive kiosk uses the word approved. Read its exact version and inspect the owned record of the handoff discussion. Pass back the canonical question if it is still unanswered and do not revise the kiosk.",
    [
      scene(
        "kiosk",
        "Archive approvals",
        "Visitors",
        "kiosk",
        frame("cached-7", "Approved by the previous shift."),
      ),
    ],
    [observe("kiosk"), recap],
    "awaiting-agent",
    ["cached-7", "Can the registrar confirm the transfer?"],
    {
      channel: channel(
        "Archive handoff channel",
        "Can the registrar confirm the transfer?",
      ),
    },
  ),
];

const recovery = [
  goal(
    "client-recover-owned-guide-from-stale-operator-panel",
    "The live Visitor Guide still has the early route. Use the visible Refresh route control on the visitor copy, confirm the update, and leave the similarly named staff panel alone.",
    [
      scene(
        "visitor",
        "Visitor Guide",
        "Visitors",
        "lobby",
        frame("guide-1", "Use Copper Walk.", {
          controls: [button("refresh", "Refresh route", "new")],
        }),
        {
          modifiable: true,
          allowed: ["refresh"],
          frames: {
            open: frame("guide-1", "Use Copper Walk.", {
              controls: [button("refresh", "Refresh route", "new")],
            }),
            new: frame("guide-2", "Use Silver Walk."),
          },
        },
      ),
      scene(
        "staff",
        "Visitor Guide",
        "Staff",
        "desktop",
        frame("staff-1", "Staff only instruction."),
      ),
    ],
    [
      observe("visitor"),
      click("visitor", "refresh"),
      observe("visitor", "new"),
    ],
    "recovered",
    ["guide-2", "Silver Walk"],
  ),
  goal(
    "client-hold-disabled-publication-control",
    "The Public Reading preview is signed, but the Switch edition control looks unavailable. Check the live control, leave the edition as it is, and report exactly what remains possible.",
    [
      scene(
        "reading",
        "Public Reading",
        "Visitors",
        "display",
        frame("signed-3", "Read at Birch Gallery.", {
          controls: [
            {
              id: "edition",
              label: "Switch edition",
              next: null,
              disabled: true,
            },
          ],
        }),
      ),
    ],
    [observe("reading")],
    "action-held",
    ["Switch edition", "Birch Gallery"],
    { split: "test" },
  ),
  goal(
    "client-replan-after-owner-suspends-available-control",
    "Use Reconnect on the booking terminal if the current owner still allows it. If the scene changes before the click finishes, reread it and use the latest authority. Do not reattempt a disabled action.",
    [
      scene(
        "booking",
        "Booking terminal",
        "Operators",
        "terminal",
        frame("book-2", "Waiting for venue data."),
        {
          modifiable: true,
          allowed: ["connect"],
          race: { control: "connect", to: "held" },
          frames: {
            open: frame("book-2", "Waiting for venue data.", {
              controls: [button("connect", "Reconnect", "ready")],
            }),
            ready: frame("book-3", "Venue data available."),
            held: frame("book-4", "Owner suspended reconnect.", {
              controls: [
                {
                  id: "connect",
                  label: "Reconnect",
                  next: null,
                  disabled: true,
                },
              ],
            }),
          },
        },
      ),
    ],
    [
      observe("booking"),
      click("booking", "connect", "changed"),
      observe("booking", "held"),
    ],
    "action-held",
    ["book-4", "suspended reconnect"],
  ),
  goal(
    "client-reload-departure-display-after-boot-fault",
    "Read the current Departure Screen failure, then reopen the owned display once. Confirm a freshly mounted renderer now shows the correct call and keep the operator copy unchanged.",
    [
      scene(
        "public",
        "Departure Screen",
        "Travelers",
        "display",
        frame("initial-11", "Departure list unavailable."),
        {
          modifiable: true,
          allowed: ["reload"],
          reload: "reopened",
          frames: {
            open: frame("initial-11", "Departure list unavailable.", {
              log: { level: "error", message: "Departure feed failed at boot" },
            }),
            reopened: frame("fresh-12", "Board from Gate Four."),
          },
        },
      ),
      scene(
        "ops",
        "Departure Screen",
        "Staff",
        "desktop",
        frame("ops-11", "Await gate operator."),
      ),
    ],
    [observe("public"), reload("public"), observe("public", "reopened")],
    "recovered",
    ["Departure feed failed", "Gate Four"],
  ),
  goal(
    "client-confirm-second-local-control-appears-after-first",
    "The check-in viewer is on its paused state. Resume local preview, inspect the intermediate permission screen, then use Show roster only if that button really appears. Confirm the viewer result without touching the durable channel.",
    [
      scene(
        "checkin",
        "Check-in viewer",
        "Hosts",
        "desktop",
        frame("paused-3", "Preview paused."),
        {
          modifiable: true,
          allowed: ["resume", "show"],
          frames: {
            open: frame("paused-3", "Preview paused.", {
              controls: [button("resume", "Resume preview", "permitted")],
            }),
            permitted: frame("permitted-4", "Preview can show roster.", {
              controls: [button("show", "Show roster", "active")],
            }),
            active: frame("active-5", "Local roster preview visible."),
          },
        },
      ),
    ],
    [
      observe("checkin"),
      click("checkin", "resume"),
      observe("checkin", "permitted"),
      click("checkin", "show"),
      observe("checkin", "active"),
    ],
    "recovered",
    ["permitted-4", "Local roster preview visible"],
    { split: "test" },
  ),
  goal(
    "client-fix-phone-mirror-after-desktop-owner-confirmation",
    "The steward's desktop has the current schedule. Check that first and then recover the outdated volunteer phone copy using its Sync display button. Verify the phone matches the approved time and leave the desktop alone.",
    [
      scene(
        "desk",
        "Schedule mirror",
        "Stewards",
        "desktop",
        frame("schedule-9", "Briefing 13:25."),
      ),
      scene(
        "phone",
        "Schedule mirror",
        "Volunteers",
        "phone",
        frame("schedule-8", "Briefing 12:45."),
        {
          modifiable: true,
          allowed: ["sync"],
          frames: {
            open: frame("schedule-8", "Briefing 12:45.", {
              controls: [button("sync", "Sync display", "latest")],
            }),
            latest: frame("schedule-9", "Briefing 13:25."),
          },
        },
      ),
    ],
    [
      observe("desk"),
      observe("phone"),
      click("phone", "sync"),
      observe("phone", "latest"),
    ],
    "recovered",
    ["12:45", "13:25", "schedule-9"],
  ),
];

const handoffs = [
  goal(
    "client-stage-durable-next-step-for-actual-triage",
    "The gallery desk says a reviewer is assigned. Check that renderer and the owned review channel's roster. If the roster is empty even though the record is intact, leave a local next step for Gallery Lead. Send nothing.",
    [
      scene(
        "gallery",
        "Gallery Review",
        "Coordinators",
        "desktop",
        frame("gallery-5", "Reviewer assigned."),
      ),
    ],
    [observe("gallery"), triage],
    "handoff-staged",
    ["Reviewer assigned", "roster", "Gallery Lead"],
    {
      channel: channel("Gallery owned channel"),
      handoff: "Gallery Lead",
      preHandoff: "roster-needed",
    },
  ),
  goal(
    "client-stage-owned-race-recovery-after-new-operator-version",
    "The loading display can refresh locally. If the owner advances its revision mid-refresh, check the newly available control before trying again. After recovering the exact current instructions, leave a local receipt for Loading Lead.",
    [
      scene(
        "loading",
        "Loading display",
        "Assistants",
        "display",
        frame("load-10", "Await loading slot."),
        {
          modifiable: true,
          allowed: ["refresh", "resume"],
          race: { control: "refresh", to: "owner" },
          frames: {
            open: frame("load-10", "Await loading slot.", {
              controls: [button("refresh", "Refresh loading", "done")],
            }),
            owner: frame("load-11", "Owner staged current route.", {
              controls: [button("resume", "Apply owner update", "done")],
            }),
            done: frame("load-12", "Load at Copper Dock."),
          },
        },
      ),
    ],
    [
      observe("loading"),
      click("loading", "refresh", "changed"),
      observe("loading", "owner"),
      click("loading", "resume"),
      observe("loading", "done"),
    ],
    "handoff-staged",
    ["load-11", "Copper Dock", "Loading Lead"],
    { split: "test", handoff: "Loading Lead", preHandoff: "recovered" },
  ),
  goal(
    "client-stage-two-surface-diagnostic-without-owning-other-board",
    "Review the public event board and the adjacent reservation desk in that order. The board repeats the old address. Check the durable coordination question too and stage a local correction proposal for Evening Coordinator. Don't change either surface.",
    [
      scene(
        "public",
        "Event Route",
        "Guests",
        "sign",
        frame("early-e1", "Entrance at Orchard Gate."),
      ),
      scene(
        "reserve",
        "Reservation desk",
        "Staff",
        "desktop",
        frame("reservation-e3", "Entrance at River Gate."),
      ),
    ],
    [observe("public"), observe("reserve"), recap],
    "handoff-staged",
    [
      "Orchard Gate",
      "River Gate",
      "Evening Coordinator",
      "Is River Gate approved for the event?",
    ],
    {
      channel: channel(
        "Evening owned channel",
        "Is River Gate approved for the event?",
      ),
      handoff: "Evening Coordinator",
      preHandoff: "local-disagreement",
    },
  ),
  goal(
    "client-stage-refresh-readback-with-a-current-published-question",
    "The library's local notice needs a refresh, and the coordinator asked a follow-up in the owned discussion. Read the old notice, compare the latest published question, refresh the library display and verify it. Leave both pieces of evidence for Library Desk in a local handoff.",
    [
      scene(
        "notice",
        "Library Returns",
        "Visitors",
        "desk-display",
        frame("r-old", "Returns due on Monday."),
        {
          modifiable: true,
          allowed: ["refresh"],
          frames: {
            open: frame("r-old", "Returns due on Monday.", {
              controls: [button("refresh", "Refresh returns notice", "live")],
            }),
            live: frame("r-live", "Returns due on Tuesday."),
          },
        },
      ),
    ],
    [
      observe("notice"),
      recap,
      click("notice", "refresh"),
      observe("notice", "live"),
    ],
    "handoff-staged",
    ["Tuesday", "Will the outside slot be open?", "Library Desk"],
    {
      channel: channel(
        "Library notice owned channel",
        "Will the outside slot be open?",
      ),
      handoff: "Library Desk",
      preHandoff: "recovered",
    },
  ),
  goal(
    "client-leave-overflow-diagnostic-instead-of-promising-mobile-access",
    "At 320px, compare the public signup sheet with the editor's desktop preview. If only the public embed overflows, leave a remediation note for Web Desk. Leave the public client at the tested width and keep the editor's layout.",
    [
      scene(
        "embed",
        "Signup Sheet",
        "Public",
        "embed",
        frame("embed-v6", "Next column is the waiver.", { minWidth: 600 }),
        { modifiable: true, allowed: ["viewport"] },
      ),
      scene(
        "editor",
        "Signup Sheet",
        "Editor",
        "desktop",
        frame("desktop-v6", "Waiver fits next to signup."),
      ),
    ],
    [
      observe("embed", "open", 1280, false),
      size("embed", 320),
      observe("embed", "open", 320, true),
      observe("editor", "open", 1280, false),
    ],
    "handoff-staged",
    ["320", "waiver", "Web Desk"],
    { split: "test", handoff: "Web Desk", preHandoff: "local-disagreement" },
  ),
];

export const openClientDiagnosticsWorlds = [
  ...layouts,
  ...durable,
  ...recovery,
  ...handoffs,
];
export const clientDiagnosticsRequiresUnits = [
  "skills/open-user-goal",
  "skills/gad-context",
  "skills/panel-health-runtime",
  "workers/pubsub-channel",
];
