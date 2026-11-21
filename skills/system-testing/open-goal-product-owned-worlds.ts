import type { OpenCalendarWorld } from "@workspace-skills/open-calendar-goal/managed";
import type { ComponentSpec } from "@workspace-skills/visualize/types";
import type { OpenNewsEvidenceWorld } from "./open-goal-news-evidence-worlds.js";

export type GoogleRunbookWorld = {
  kind: "google-runbook"; workspace: "google-workspace"; id: string; sourceGroup: string; split?: "test";
  goal: string; calendar: OpenCalendarWorld; heading: string; before: string; after: string;
  approval: string; action: "revise" | "held" | "review-only"; authorization: string; coedit?: string;
};
function meetingRunbook(slug: string, heading: string, goal: string, options: {
  old: string; current: string; room: string; approval: string; action?: GoogleRunbookWorld["action"];
  authorization?: string; held?: true; coedit?: string; shifted?: boolean;
}): GoogleRunbookWorld {
  const id = "google-runbook-" + slug;
  const at = (time: string) => "2026-10-22T" + time + ":00Z";
  const updated = "2026-10-21T16:00:00Z";
  const event = { id: slug, summary: heading, status: "confirmed" as const, updated,
    description: "Venue: " + options.room, start: { dateTime: at(options.current) }, end: { dateTime: at("11:45") } };
  const ref = { calendarId: "operations", eventId: slug };
  const section = "Keep the accessibility contact and bring the signed checklist.";
  return {
    id, kind: "google-runbook", workspace: "google-workspace", sourceGroup: "vibestudio:google-runbook:" + slug,
    ...(options.held ? { split: "test" } : {}),
    goal: goal + " Use Operations Calendar on October 22, 2026, 09:00–12:00 UTC.",
    heading,
    before: "# " + heading + "\n\nStart: " + options.old + " UTC\nVenue: Former room\n\n" + section + "\n",
    after: "# " + heading + "\n\nStart: " + options.current + " UTC\nVenue: " + options.room + "\n\n" + section + "\n",
    approval: options.approval, action: options.action ?? "revise", authorization: options.authorization ?? "private-draft",
    ...(options.coedit ? { coedit: options.coedit } : {}),
    calendar: {
      id, goal, window: { start: at("09:00"), end: at("12:00") }, catalogPageSize: 1, canStage: false,
      timelines: [{ id: "operations", name: "Operations Calendar", description: "Approved operations events", timeZone: "UTC", initial: [[event]],
        ...(options.shifted ? { readback: { [slug]: { ...event, updated: "2026-10-21T20:00:00Z", start: { dateTime: at("11:15") } } } } : {}) },
        { id: "historical", name: "Historical Calendar", description: "Retained schedule, not operations authority", timeZone: "UTC",
          initial: [[{ ...event, id: "old-" + slug, start: { dateTime: at(options.old) } }]] }],
      expected: { scope: ["operations"], refresh: false, status: options.shifted ? "stale" : "selected",
        selection: options.shifted ? null : ref, evidence: options.shifted ? [{ ...ref, source: "readback" }] : [], verify: ref, stage: false },
    },
  };
}
export const googleRunbookWorlds = [
  meetingRunbook("ramp-shift-brief", "Ramp shift brief",
    "The ramp lead confirmed a new walkthrough. Update just the time and venue in our private ramp shift brief from the current Operations event and signed note. Keep the steward's late accessibility addition if it arrives during the edit.",
    { old: "09:30", current: "10:30", room: "North safety bay", approval: "APP-RAMP approves the 10:30 UTC walkthrough in North safety bay.", coedit: "\nWheelchairs check in with the floor steward.\n" }),
  meetingRunbook("projector-unload", "Projector unload",
    "We are rehearsing the projector unload change. Tell me whether the private runbook has the old instructions, and what the confirmed appointment actually says. This is an inspection for the lead, with no document change.",
    { old: "10:00", current: "10:45", room: "Dock B", approval: "APP-DOCK confirms 10:45 UTC at Dock B.", action: "review-only", authorization: "inspect" }),
  meetingRunbook("membership-onboarding", "Membership onboarding",
    "The membership team has permission to correct the local onboarding page, provided the operations lead's approved time agrees with the calendar. Look at both before changing anything.",
    { old: "09:45", current: "10:15", room: "Member entrance", approval: "APP-MEMBER approves 11:30 UTC at Member entrance.", action: "held" }),
  meetingRunbook("winter-kit-handoff", "Winter kit handoff",
    "Bring winter kit pickup instructions in line with the live booking and its approval. The archived calendar still advertises an earlier pickup. Correct the private local runbook only, including the loading room.",
    { old: "09:15", current: "10:00", room: "Supply annex", approval: "APP-KIT approves the 10:00 UTC pickup in Supply annex." }),
  meetingRunbook("planting-shift-revised-event", "Planting shift briefing",
    "Check our planting shift briefing against the current approval and the actual event. It can only change if the appointment still matches the approved version when you finish reading it.",
    { old: "09:30", current: "10:30", room: "Greenhouse lobby", approval: "APP-PLANT approves the 10:30 UTC briefing in Greenhouse lobby.",
      action: "held", held: true, shifted: true }),
  meetingRunbook("flight-case-withdrawn", "Flight case delivery",
    "The Operations booking and old signature suggest a correction to the Flight case delivery instructions. Check whether the steward's latest scope lets us use them. Leave the local text alone if the permission was withdrawn.",
    { old: "10:15", current: "11:00", room: "Cage 4", approval: "APP-CASE formerly approved 11:00 UTC in Cage 4. A later signed withdrawal removed the draft grant.",
      action: "held", authorization: "withdrawn", held: true }),
];

export type NewsEditionReviewWorld = {
  kind: "news-edition-review"; workspace: "news"; id: string; sourceGroup: string; split?: "test";
  goal: string; news: OpenNewsEvidenceWorld; title: string; format: "stats" | "checklist" | "timeline";
  facts: string; grant: "private-draft" | "inspect" | "withdrawn"; action: "packet" | "review-only" | "hold";
  spec: ComponentSpec; superseded?: boolean;
};
function edition(slug: string, title: string, goal: string, options: {
  format: NewsEditionReviewWorld["format"]; facts: string; spec: ComponentSpec; articles: string[];
  grant?: NewsEditionReviewWorld["grant"]; action?: NewsEditionReviewWorld["action"]; revoked?: boolean; held?: true; superseded?: boolean;
}): NewsEditionReviewWorld {
  const id = "news-edition-review-" + slug;
  const sourceGroup = "vibestudio:news-edition-review:" + slug;
  return {
    id, sourceGroup, kind: "news-edition-review", workspace: "news", ...(options.held ? { split: "test" } : {}),
    title, goal, format: options.format, facts: options.facts, spec: options.spec, grant: options.grant ?? "private-draft",
    action: options.action ?? "packet", ...(options.superseded ? { superseded: true } : {}),
    news: {
      id, kind: "news-evidence", workspace: "news", sourceGroup, goal, desk: title + " editing desk", topic: title,
      views: ["archive", "saved"], focus: "publication", privateNote: false,
      ...(options.revoked ? { reader: { allowed: false } } : {}),
      articles: options.articles.map((text, index) => ({ key: "source-" + index, path: "/" + slug + "/authority-" + index,
        text, supports: ["new"], saved: index === 0 })),
      edition: { declared: options.articles.length },
      expected: { reason: options.revoked ? "reader-revoked" : "grounded-development",
        action: options.revoked ? "hold" : "report", schedule: "manual-available",
        explanation: options.revoked ? "The retained reader permission was revoked. Hold the edition." :
          "The original retained source supports the current edition. Keep the current reader and leave scheduling unchanged.",
        claims: options.revoked ? [/revok/iu] : [/original|retained/iu] },
    },
  };
}
export const newsEditionReviewWorlds = [
  edition("park-closures-figure", "Park closures",
    "The Park closures desk wants a private editor-ready count of park notices and confirmed closures. Reconcile the saved edition against the actual source records and prepare compact figures with those counts. Keep publication off.",
    { format: "stats", facts: "Park notices: 2. Confirmed closures: 1.", articles: ["North Park is closed during repairs.", "South Park remains open."],
      spec: { component: "Stats", props: { title: "Park closures", items: [{ label: "Park notices", value: 2 }, { label: "Confirmed closures", value: 1 }] } } }),
  edition("storm-desk-checklist", "Storm desk",
    "Build an internal review checklist for the Storm desk's Saturday briefing. Separate the already sourced shelters from the unchecked transport desk signoff. Keep it in a private packet for my review.",
    { format: "checklist", facts: "Shelter addresses verified. Transport desk signoff pending.", articles: ["Shelter addresses were verified by facilities. Transport desk signoff remains pending."],
      spec: { component: "Checklist", props: { title: "Storm desk", items: [{ label: "Shelter addresses", checked: true }, { label: "Transport desk signoff", checked: false }] } } }),
  edition("river-works-sequence", "River works",
    "Make a private timeline of the River works desk's two confirmed milestones for the visual editor. Check the current edition and keep the exact announced dates. This is a draft for review.",
    { format: "timeline", facts: "2026-10-24 Fence installed. 2026-10-29 Inspection.",
      articles: ["2026-10-24 Fence installed.", "2026-10-29 Inspection."], spec: { component: "Timeline",
        props: { title: "River works", items: [{ time: "2026-10-24", title: "Fence installed" }, { time: "2026-10-29", title: "Inspection" }] } } }),
  edition("library-visual-explanation", "Library forum",
    "I want to know whether a checklist would help the Library forum editor separate ready from pending evidence. Explain based on the retained edition. This is an editorial consultation with no saved asset.",
    { format: "checklist", facts: "Venue verified. Live transcript pending.", grant: "inspect", action: "review-only",
      articles: ["Venue verified. Live transcript pending."], spec: { component: "Checklist", props: { title: "Library forum", items: [{ label: "Venue", checked: true }, { label: "Live transcript", checked: false }] } } }),
  edition("school-reader-revoked", "School works",
    "The School works desk has a prior visual draft request, but reader access may have been revoked. Confirm our retained basis before opening a private timeline. Leave a hold if you cannot substantiate it.",
    { format: "timeline", facts: "2026-11-03 Contractor arrives.", held: true, revoked: true, action: "hold",
      articles: ["2026-11-03 Contractor arrives."], spec: { component: "Timeline", props: { title: "School works", items: [{ time: "2026-11-03", title: "Contractor arrives" }] } } }),
  edition("ballot-desk-revision", "Ballot access",
    "Prepare a private figure card for the Ballot access edition only if the latest desk brief still authorizes it. A replacement instruction might have withdrawn the authorization after the older brief.",
    { format: "stats", facts: "Entrances inspected: 3.", grant: "private-draft", superseded: true, held: true, action: "hold",
      articles: ["Three entrances inspected."], spec: { component: "Stats", props: { title: "Ballot access", items: [{ label: "Entrances inspected", value: 3 }] } } }),
];
