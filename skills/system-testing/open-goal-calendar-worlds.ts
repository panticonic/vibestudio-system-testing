// These fixture inputs are installed with the catalog. Only the routed
// Google Workspace case loads the optional calendar runtime.
type EventTime = { dateTime?: string; date?: string };
type Event = {
  id: string;
  summary?: string;
  description?: string;
  status: "confirmed" | "cancelled" | "tentative";
  updated: string;
  start?: EventTime;
  end?: EventTime;
};
type Page = readonly Event[] | number;
type Timeline = {
  id: string;
  name: string;
  description: string;
  timeZone: string;
  initial: readonly Page[];
  refresh?: readonly Page[];
  readback?: Readonly<Record<string, Event | number>>;
};
type EventRef = {
  calendarId: string;
  eventId: string;
  updated?: string;
  source?: "readback";
};
type World = {
  id: string;
  goal: string;
  sourceGroup: string;
  split: "train" | "test";
  window: { start: string; end: string };
  timelines: readonly Timeline[];
  catalogPageSize: number;
  canStage: boolean;
  expected: {
    scope: readonly string[];
    refresh: boolean;
    status: "selected" | "held" | "incomplete" | "stale";
    selection: EventRef | null;
    evidence: readonly EventRef[];
    verify?: EventRef;
    stage: boolean;
  };
};
const date = "2026-10-22";
const window = { start: date + "T09:00:00Z", end: date + "T12:00:00Z" };
const old = "2026-10-20T09:00:00Z";
const revised = "2026-10-21T16:00:00Z";
const clock = (time: string) => date + "T" + time + ":00Z";
const meeting = (id: string, summary: string, start: string, end: string, description = ""): Event => ({
  id, summary, description, status: "confirmed", updated: old,
  start: { dateTime: clock(start) }, end: { dateTime: clock(end) },
});
const canceled = (event: Event): Event => ({ id: event.id, status: "cancelled", updated: revised });
const source = (id: string, name: string, initial: readonly Page[], options?: Pick<Timeline, "refresh" | "readback">): Timeline =>
  ({ id, name, description: name + " scheduling calendar", timeZone: "UTC", initial, ...options });
const ref = (calendarId: string, eventId: string, updated?: string) => ({ calendarId, eventId, ...(updated ? { updated } : {}) });
const decoy = source("marketing", "Marketing Roadmap", [[meeting("brainstorm", "Discussion", "09:15", "11:30")]]);
const context = "Use the October 22, 2026 window from 09:00 through 12:00 UTC.";
const handoff = "Leave a scheduling handoff in this workspace.";

const scenarios: readonly World[] = [
  {
    id: "calendar-audio-handoff", sourceGroup: "launch-audio-room-allocation", split: "train",
    goal: "Our audio team wants the first confirmed review that actually fits in Studio Audio. The options are in Review Proposals. It’s fine to start as the previous booking ends. Save a recommendation in the workspace for the 09:00–12:00 UTC block on October 22, 2026.",
    window, catalogPageSize: 2, canStage: true,
    timelines: [decoy,
      source("review", "Review Proposals", [[meeting("early", "Audio review A", "09:20", "09:50")], [meeting("later", "Audio review B", "10:00", "10:30")]]),
      source("audio", "Studio Audio", [[meeting("mix", "Studio mix signoff", "09:00", "10:00")]])],
    expected: { scope: ["review", "audio"], refresh: true, status: "selected",
      selection: ref("review", "later"), evidence: [ref("audio", "mix")], verify: ref("review", "later"), stage: true },
  },
  {
    id: "calendar-cancelled-hold", sourceGroup: "accessibility-room-cancellation", split: "train",
    goal: "I heard a Quiet Room booking may have been cancelled. Work out the earliest Accessibility Review proposal we could use that morning, using the latest update if the provider shows the same booking twice. Record any cancellation that opens up the slot in a workspace handoff. Leave the team to make the booking. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [source("accessibility", "Accessibility Review", [[meeting("one", "Early review", "09:30", "10:00")], [meeting("two", "Late review", "11:00", "11:30")]]),
      decoy, source("quiet", "Quiet Room", [[meeting("intro", "Orientation", "09:00", "10:00")],
        [canceled(meeting("intro", "Orientation", "09:00", "10:00"))]])],
    expected: { scope: ["accessibility", "quiet"], refresh: true, status: "selected",
      selection: ref("accessibility", "one"), evidence: [ref("quiet", "intro", revised)], verify: ref("accessibility", "one"), stage: true },
  },
  {
    id: "calendar-new-studio-conflict", sourceGroup: "press-review-last-minute-change", split: "train",
    goal: "The producer schedule is moving and people are asking when the press review can happen. Use Press Review Options and check the Edit Suite and Producer Coverage. I need the earliest one that still works when you hand it over, with the blocker if the recommendation had to change. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [decoy, source("press", "Press Review Options", [[meeting("early", "Press readthrough", "09:30", "10:00"),
      meeting("late", "Press readthrough alternate", "10:45", "11:15")]]),
      source("edit", "Edit Suite", [[]]),
      source("producer", "Producer Coverage", [[]], { refresh: [[], [meeting("live", "Live studio escalation", "09:20", "10:10")]] })],
    expected: { scope: ["press", "edit", "producer"], refresh: true, status: "selected",
      selection: ref("press", "late"), evidence: [ref("producer", "live")], verify: ref("press", "late"), stage: true },
  },
  {
    id: "calendar-latest-before-pickup", sourceGroup: "exhibit-courier-cutoff", split: "train",
    goal: "Give the exhibit crew as much setup time as possible. From Checkout Proposals, use the latest checkout that finishes by 11:30 UTC and fits Loading Bay. If a reservation eliminates a candidate that otherwise meets those conditions, carry that reservation into the workspace handoff for the crew. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [decoy, source("checkout", "Checkout Proposals", [[meeting("optional", "Early checkout", "09:30", "09:45"),
      meeting("middle", "Later checkout", "10:30", "10:50")], [meeting("latest", "Pre-cutoff checkout", "11:00", "11:30"),
      meeting("after", "Checkout after cutoff", "11:20", "11:50")]]),
      source("bay", "Loading Bay", [[meeting("dispatch", "Fitting dispatch", "11:05", "11:15")]])],
    expected: { scope: ["checkout", "bay"], refresh: true, status: "selected", selection: ref("checkout", "middle"),
      evidence: [ref("bay", "dispatch")], verify: ref("checkout", "middle"), stage: true },
  },
  {
    id: "calendar-tentative-equipment", sourceGroup: "equipment-tentative-reservations", split: "train",
    goal: "Can we finish the podcast without risking a double-booking? Find the earliest Podcast Retakes option that fits Microphone Ledger. Protect tentative equipment reservations while the team is still approving them and make a workspace handoff with the record if it changes our choice. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [source("retake", "Podcast Retakes", [[meeting("first", "Retake before review", "09:15", "09:35"),
      meeting("alternate", "Retake after review", "10:30", "10:50")]]),
      source("microphone", "Microphone Ledger", [[{ ...meeting("tentative", "Field recording kit", "09:25", "10:10"), status: "tentative" }]]), decoy],
    expected: { scope: ["retake", "microphone"], refresh: true, status: "selected", selection: ref("retake", "alternate"),
      evidence: [ref("microphone", "tentative")], verify: ref("retake", "alternate"), stage: true },
  },
  {
    id: "calendar-proposal-moved", sourceGroup: "screening-provider-stale-revision", split: "train",
    goal: "Can we use the earliest available option from Screening Proposals in Screening Room? Save a handoff only for a current proposal. If the reservation moved while you were looking it over, tell us its new time and leave the handoff untouched. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [source("screen", "Screening Proposals", [[meeting("screening", "Community screening", "09:30", "10:00")]], {
      readback: { screening: { ...meeting("screening", "Community screening", "11:15", "11:45"), updated: revised } },
    }), source("screen-room", "Screening Room", [[]]), decoy],
    expected: { scope: ["screen", "screen-room"], refresh: true, status: "stale",
      selection: null, evidence: [{ ...ref("screen", "screening"), source: "readback" }], verify: ref("screen", "screening"), stage: false },
  },
  {
    id: "calendar-incomplete-resource", sourceGroup: "archive-window-partial-provider-read", split: "train",
    goal: "Find an archive intake time from Intake Proposals when we have Courier Coverage. Save a handoff only if you can confirm that both calendars are known for the whole window. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [source("intake", "Intake Proposals", [[meeting("pickup", "Archive intake", "10:15", "10:45")]]),
      source("courier", "Courier Coverage", [[meeting("pickup-other", "Collection elsewhere", "09:15", "09:45")], 503]), decoy],
    expected: { scope: ["intake", "courier"], refresh: false, status: "incomplete", selection: null, evidence: [], stage: false },
  },
  {
    id: "calendar-maintenance-hold", sourceGroup: "rig-and-monitor-window-contention", split: "train",
    goal: "Recover the maintenance decision. I need the earliest option from Maintenance Windows that fits Rig Access and Monitoring Coverage. If nothing fits, leave the next shift a written hold with the conflicts behind it. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [source("monitor", "Monitoring Coverage", [[meeting("drill", "On-call drill", "10:50", "11:30")]]), decoy,
      source("windows", "Maintenance Windows", [[meeting("early", "Early maintenance", "09:30", "10:00"),
        meeting("late", "Late maintenance", "11:00", "11:30")]]),
      source("rig", "Rig Access", [[meeting("calibrate", "Rig calibration", "09:30", "10:00")]])],
    expected: { scope: ["windows", "rig", "monitor"], refresh: true, status: "held",
      selection: null, evidence: [ref("rig", "calibrate"), ref("monitor", "drill")], stage: true },
  },
  {
    id: "calendar-read-only-intake", sourceGroup: "inventory-read-only-scheduling-assessment", split: "train",
    goal: "Tell me the earliest current option from Inventory Review Proposals when Warehouse Crew can make it. I only need an answer in this run. " + context,
    window, catalogPageSize: 2, canStage: false,
    timelines: [source("crew", "Warehouse Crew", [[meeting("departure", "Shift check", "09:15", "09:30")]]), decoy,
      source("stock", "Inventory Review Proposals", [[meeting("first", "Inventory review", "09:30", "10:00"), meeting("second", "Inventory review alternate", "11:30", "12:00")]])],
    expected: { scope: ["stock", "crew"], refresh: false, status: "selected", selection: ref("stock", "first"),
      evidence: [], verify: ref("stock", "first"), stage: false },
  },
  {
    id: "calendar-all-day-closure", sourceGroup: "museum-rehearsal-full-day-access", split: "test",
    goal: "Continue the rehearsal decision. Pick the earliest possible slot from Museum Rehearsal Proposals that fits Gallery Access. An all-day closure means the gallery is unavailable for that full local day. Leave a written hold for the museum team if nothing fits. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [decoy, source("gallery", "Gallery Access", [[{
      id: "closure", summary: "Gallery closed for inventory", status: "confirmed", updated: old,
      start: { date }, end: { date: "2026-10-23" },
    }]]), source("rehearsal", "Museum Rehearsal Proposals", [[meeting("early", "Early rehearsal", "09:30", "10:00")],
      [meeting("late", "Late rehearsal", "11:00", "11:30")]])],
    expected: { scope: ["rehearsal", "gallery"], refresh: true, status: "held",
      selection: null, evidence: [ref("gallery", "closure")], stage: true },
  },
  {
    id: "calendar-offset-conflict", sourceGroup: "remote-translation-mixed-offsets", split: "test",
    goal: "Find the earliest remote Interpretation Proposals slot we can cover with the interpreter. The calendars can show different local times for the same instant. If something in Interpreter Coverage takes an earlier option off the table, include it in the handoff. " + context + " " + handoff,
    window, catalogPageSize: 2, canStage: true,
    timelines: [source("interp", "Interpretation Proposals", [[meeting("first", "EN/DE interpretation", "09:45", "10:15")],
      [meeting("second", "EN/DE interpretation backup", "11:10", "11:40")]]),
      decoy, source("coverage", "Interpreter Coverage", [[{
        ...meeting("standup", "Regional support briefing", "09:30", "10:30"),
        start: { dateTime: date + "T11:30:00+02:00" }, end: { dateTime: date + "T12:30:00+02:00" },
      }]])],
    expected: { scope: ["interp", "coverage"], refresh: true, status: "selected",
      selection: ref("interp", "second"), evidence: [ref("coverage", "standup")], verify: ref("interp", "second"), stage: true },
  },
  {
    id: "calendar-withdrawn-proposal", sourceGroup: "patient-transport-removed-provider-record", split: "test",
    goal: "Our patient simulation team needs the first option from Simulation Transport Proposals when the Simulation Van is free. Save a workspace handoff if the proposal is still on the provider’s calendar. " + context,
    window, catalogPageSize: 2, canStage: true,
    timelines: [decoy, source("transport", "Simulation Transport Proposals", [[meeting("one", "Transport simulation", "09:30", "09:50")]],
      { readback: { one: 404 } }), source("van", "Simulation Van", [[]])],
    expected: { scope: ["transport", "van"], refresh: true, status: "stale", selection: null,
      evidence: [], verify: ref("transport", "one"), stage: false },
  },
];

export const openGoalCalendarWorlds = scenarios.map((scenario) => ({
  ...scenario,
  kind: "calendar" as const,
  workspace: "google-workspace" as const,
  sourceGroup: "vibestudio:calendar:" + scenario.sourceGroup,
}));
