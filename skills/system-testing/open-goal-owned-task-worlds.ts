export type BoardStatus = "inbox" | "ready" | "active" | "review" | "done" | "cancelled";
export type AttemptRecord = {
  task: string; owner: string; attempt: string; artifact: string;
  phase: "failed" | "cancelled" | "draft" | "ready" | "accepted";
};
type Assignment = Omit<AttemptRecord, "phase">;
type LaneSeed = {
  key: string; title: string; recipient: string; extra?: [handle: string, name: string];
  artifactContents?: {mediaType:string;content:string};
  record?: AttemptRecord; recordScope?: "archive"; inspectRecipient?: string; deliver?: boolean; interrupted?: boolean;
};
type Race = { field: "attempt" | "owner"; value: string } | { field: "prerequisite"; title: string };
export type OwnedTaskWorld = {
  id: string; kind: "owned-task"; workspace: "personal"; sourceGroup: string; split?: "test";
  goal: string; project: string; assignment: Assignment;
  initial: BoardStatus; allowed: BoardStatus[]; requires: { title: string; status: BoardStatus }[];
  lanes: LaneSeed[]; race?: Race;
  expected: { selected: string | null; update: BoardStatus | null; handoff: string | null; reason: string[] };
};

export const ownedTaskRequiresUnits = [
  "skills/open-user-goal", "skills/open-owned-task-recovery", "workers/mission-planning-fixture",
  "workers/local-messaging-fixture", "workers/pubsub-channel", "skills/messaging",
];

const assignment = (task: string, owner: string, attempt: string, artifact: string): Assignment => ({ task, owner, attempt, artifact });
const prior = (key: string, title: string, recipient: string, task: Assignment, phase: AttemptRecord["phase"],
  changes?: Partial<Assignment>): LaneSeed => ({ key, title, recipient, record: { ...task, ...changes, phase } });
const destination = (key: string, title: string, recipient: string, interrupted = false): LaneSeed =>
  ({ key, title, recipient, deliver: true, interrupted });
const empty = (key: string, title: string, recipient: string): LaneSeed => ({ key, title, recipient });

function openTask(id: string, project: string, task: Assignment, goal: string, lanes: LaneSeed[],
  expected: OwnedTaskWorld["expected"], options: {
    held?: boolean; initial?: BoardStatus; requires?: OwnedTaskWorld["requires"]; allowed?: BoardStatus[]; race?: Race;
  } = {}): OwnedTaskWorld {
  return {
    id: "owned-task-" + id, kind: "owned-task", workspace: "personal", sourceGroup: "vibestudio:owned-task:" + id,
    ...(options.held ? { split: "test" } : {}), goal, project, assignment: task, lanes,
    initial: options.initial ?? "inbox", requires: options.requires ?? [], allowed: options.allowed ?? (expected.update ? ["ready", "review", "done"] : []),
    ...(options.race ? { race: options.race } : {}), expected,
  };
}

const disposition = (selected: string | null, update: BoardStatus | null, handoff: string | null = null,
  ...reason: string[]): OwnedTaskWorld["expected"] => ({ selected, update, handoff, reason });

const pallet = assignment("Pallet variance", "dock-owner", "PV-42", "variance.csv");
const gallery = assignment("Gallery labels", "label-owner", "GL-7", "labels.pdf");
const audio = assignment("Orchestra take", "mix-lead", "MX-17", "take17.wav");
const census = assignment("Attendance census", "census-auditor", "CA-13", "floor-a.json");
const claims = assignment("Claims packet", "claims-desk", "CP-31", "bundle-31.pdf");
const ovens = assignment("Bakery tray sheet", "oven-owner", "BT-9", "trays.tsv");
const traverse = assignment("Ground traverse", "map-curator", "GT-8", "traverse.geojson");
const art = assignment("Banner print", "proof-lead", "BP-72", "large-banner.pdf");
const queue = assignment("Volunteer intake", "shift-desk", "VI-11", "intake.txt");
const road = assignment("Road closure map", "map-desk", "RC-4", "route-4.svg");
const collections = assignment("Artifact register", "collection-lead", "AR-20", "register.csv");
const notes = assignment("Composer program notes", "program-editor", "PN-5", "program.txt");
const kit = assignment("Field kit inventory", "kit-owner", "FK-62", "kits.yml");
const route = assignment("Lighting route review", "lighting-owner", "LR-8", "path.md");
const volume = assignment("Storage volume audit", "volume-desk", "SV-52", "measurements.csv");
const calendar = assignment("Classroom calendar", "room-owner", "CC-35", "calendar.ics");
const relay = assignment("Relay tally", "relay-admin", "RT-9", "splits.csv");
const roof = assignment("Roof access map", "roof-desk", "RM-11", "roof-map.svg");
const permits = assignment("Food stand permits", "permit-editor", "FP-4", "licenses.pdf");
const samples = assignment("Dune sample chain", "dune-lab", "DS-23", "chain.tsv");
const ferry = assignment("Ferry loading plan", "ferry-loader", "FL-15", "loads.json");
const exhibit = assignment("Cedar exhibit manifest", "cedar-curator", "CE-50", "manifest.txt");
const orchard = assignment("Orchard pump review", "pump-steward", "OP-12", "calibration.csv");
const snow = assignment("Snow line bulletin", "winter-keeper", "SL-56", "bulletin.md");

export const openOwnedTaskWorlds = [
  openTask("failed-current-versus-old-success", "Freight desk", pallet,
    "The Freight desk still shows Pallet variance. Resume its current failed work if the safety check was signed. An older green receipt has been floating around. Leave the card ready for a new attempt if the current one truly failed.",
    [prior("current", "Live freight lane", "dock-owner", pallet, "failed"), prior("old", "Freight lane archive", "dock-owner", pallet, "accepted", { attempt: "PV-39" })],
    disposition("current", "ready"), { requires: [{ title: "Safety check", status: "done" }] }),
  openTask("review-exact-current-artifact", "Downtown exhibits", gallery,
    "Put Gallery labels into review in Downtown exhibits if its current proof is ready. There are receipts from two label runs. Keep the grant archive and other cards untouched.",
    [prior("early", "First label reports", "label-owner", gallery, "ready", { attempt: "GL-5" }), prior("revised", "Current print room", "label-owner", gallery, "ready")],
    disposition("revised", "review")),
  openTask("alternate-owner-same-take", "Orchestra", audio,
    "Before I accept Orchestra take, check whether either recording receipt belongs to the mix lead for this attempt. A second engineer used the same take number. Explain what we actually have and leave the card alone if neither qualifies.",
    [prior("observer", "Alternate console", "assistant-mixer", audio, "accepted", { owner: "assistant-mixer" }),
      prior("old", "Mix lead archive", "mix-lead", audio, "accepted", { attempt: "MX-16" })],
    disposition(null, null, null, "attempt")),
  openTask("same-owner-wrong-output", "Venue counts", census,
    "Has Venue counts' Attendance census really produced the floor A file? The auditor also did Floor B under this run. Please leave the card alone unless the exact requested floor is confirmed.",
    [prior("wrong", "Count reports", "census-auditor", census, "accepted", { artifact: "floor-b.json" }),
      prior("draft", "Working attendance", "census-auditor", census, "draft")],
    disposition(null, null, null, "artifact"), { allowed: ["done"] }),
  openTask("accept-and-handoff", "Member services", claims,
    "If Member services' Claims packet was accepted on this run, close its card and send the confirmed packet and attempt to @claims-review in Claims closing desk.",
    [prior("proof", "Claims work", "claims-desk", claims, "accepted"), prior("archive", "Claims archive", "claims-desk", claims, "ready", { attempt: "CP-29" }),
      destination("desk", "Claims closing desk", "claims-review")],
    disposition("proof", "done", "desk"), { requires: [{ title: "Final claims approval", status: "done" }] }),
  openTask("cancelled-current-approved-retry", "Morning bakery", ovens,
    "Is the Bakery tray sheet safe to retry now that sanitation was cleared? I need the cancelled run distinguished from the earlier completed tray draft. Set it ready only if the current attempt was cancelled.",
    [prior("archive", "Previous tray handover", "oven-owner", ovens, "accepted", { attempt: "BT-7" }), prior("cancelled", "Morning bakery work lane", "oven-owner", ovens, "cancelled")],
    disposition("cancelled", "ready"), { requires: [{ title: "Sanitation", status: "done" }] }),
  openTask("review-waiting-for-prerequisite", "Survey", traverse,
    "Can we release Ground traverse from the Survey board? Confirm what its current run delivered and explain why we can or cannot move it while its map check is with the reviewer.",
    [prior("actual", "Survey team", "map-curator", traverse, "accepted"), prior("partial", "Field tablet", "map-curator", traverse, "draft", { artifact: "survey-notes.txt" })],
    disposition("actual", null, null, "prerequisite"), { allowed: ["done"], requires: [{ title: "Map check", status: "review" }] }),
  openTask("hold-same-payload-wrong-recipient", "Studio proofs", art,
    "The Banner print proof text looks right, but was the actual item sent to our proof lead? Hold the card if the matching text was addressed to the observer instead.",
    [prior("copy", "Studio proofs", "proof-observer", art, "accepted"), prior("earlier", "Proof archive", "proof-lead", art, "accepted", { attempt: "BP-71" })],
    disposition(null, null, null, "owner"), { allowed: ["done"] }),
  openTask("verified-result-read-only", "Shift coordination", queue,
    "Find the exact current Volunteer intake result in Shift coordination and say whose attempt it was. I only want a live readback, no card changes or notes.",
    [prior("draft", "Intake drafts", "shift-desk", queue, "draft", { attempt: "VI-9" }), prior("current", "Intake reports", "shift-desk", queue, "ready")],
    disposition("current", null)),
  openTask("recover-lost-delivery-ack", "Street events", road,
    "Move Road closure map into review if this route file is ready. Pass its exact file and attempt to @traffic-review in Street crew handoff. I want the actual local acknowledgment before assuming it got there.",
    [prior("old", "Map practice", "map-desk", road, "accepted", { attempt: "RC-1" }), prior("current", "Road closure work", "map-desk", road, "ready"),
      destination("handoff", "Street crew handoff", "traffic-review", true)],
    disposition("current", "review", "handoff")),
  openTask("superseded-between-read-and-update", "Exhibit collections", collections,
    "Close Artifact register only when the current acceptance still covers it. The collector may change the assigned run while you are checking. If it moves, keep the newer card intact.",
    [prior("original", "Register work", "collection-lead", collections, "accepted"), prior("outside", "Trial inventory", "collection-lead", collections, "ready", { attempt: "AR-19" })],
    disposition(null, null, null, "attempt"), { allowed: ["done"], race: { field: "attempt", value: "AR-21" } }),
  openTask("owner-changes-during-review", "Program desk", notes,
    "Please move Composer program notes to review only if the current editor's copy is ready. The owner may get reassigned before the move. Leave the new owner's card where it is if their receipt is missing.",
    [prior("editor", "Program review lane", "program-editor", notes, "ready"), prior("other", "Program archive", "assistant-editor", notes, "accepted", { owner: "assistant-editor" })],
    disposition(null, null, null, "owner"), { allowed: ["review"], race: { field: "owner", value: "evening-editor" } }),
  openTask("dependency-reopened-at-cas", "Field issue desk", kit,
    "Requeue Field kit inventory if its current run failed and the kit audit is still signed. If the audit is reopened during review, leave the inventory card where it is and tell me the blocker.",
    [prior("kit-run", "Kit desk activity", "kit-owner", kit, "failed"), prior("old", "Kit trial lane", "kit-owner", kit, "accepted", { attempt: "FK-60" })],
    disposition("kit-run", null, null, "audit"), { allowed: ["ready"], requires: [{ title: "Kit audit", status: "done" }], race: { field: "prerequisite", title: "Kit audit" } }),
  openTask("two-terminal-claims-conflict", "Production lights", route,
    "One report calls Lighting route review ready and another calls the same route cancelled. Reconcile the current confirmations before changing anything. If the actual reports remain equally authoritative, leave the card and tell me about that conflict.",
    [prior("green", "Lighting report A", "lighting-owner", route, "ready"), prior("red", "Lighting report B", "lighting-owner", route, "cancelled")],
    disposition(null, null, null, "conflict"), { allowed: ["review"] }),
  openTask("inbox-owner-not-current-recipient", "Storage", volume,
    "Find the actual accepted measurements for Storage volume audit. Leave a local follow-up for @stock-auditor only in Volume Today if they still belong there. Don't send it to the archive crew.",
    [{...prior("result", "Storage measurements", "volume-desk", volume, "accepted"),artifactContents:{mediaType:"text/csv",content:"storage_zone,capacity_l,measured_l\nNorth,1200,1148\nSouth,900,836\n"}}, { ...empty("current", "Volume Today", "volume-triage"), inspectRecipient: "stock-auditor" },
      empty("archive", "Volume Archive", "stock-auditor")],
    disposition("result", null, null, "recipient")),
  openTask("right-recipient-in-one-room", "School timetable", calendar,
    "The Classroom calendar is ready to review if this attempt's calendar file is the one completed. Put it in review, then give @room-auditor the confirmed file and attempt in Classroom reviewing. Ignore the sample intake room.",
    [prior("current", "Calendar work", "room-owner", calendar, "ready"), empty("sample", "Sample intake", "room-auditor"),
      destination("reviewers", "Classroom reviewing", "room-auditor")],
    disposition("current", "review", "reviewers")),
  openTask("not-a-terminal-preliminary-receipt", "Track event", relay,
    "Before closing Relay tally, check whether the exact current file was accepted or merely drafted. Leave the working stage if we're still waiting for final confirmation.",
    [prior("draft", "Relay edits", "relay-admin", relay, "draft"), prior("older", "Relay last meet", "relay-admin", relay, "accepted", { attempt: "RT-7" })],
    disposition(null, null, null, "draft"), { allowed: ["done"] }),
  openTask("message-only-after-current-acceptance", "Site safety", roof,
    "Don't change the Roof access map card. If its exact current result is accepted, send the map and run ID to @access-review in Access approval.",
    [prior("old", "Roof walkthrough", "roof-desk", roof, "accepted", { attempt: "RM-9" }),
      prior("final", "Safety desk", "roof-desk", roof, "accepted"), destination("access", "Access approval", "access-review")],
    disposition("final", null, "access")),
  openTask("foreign-task-collision", "Market hall", permits,
    "Does the Food stand permits card in Market hall actually have an approval? The quiet-market archive has a lookalike card with the same title, file and attempt number. Keep our card as-is unless ours is recorded.",
    [{ ...prior("foreign", "Quiet market permit lane", "permit-editor", permits, "accepted"), recordScope: "archive" },
      empty("here", "Food stand reports", "permit-editor")],
    disposition(null, null, null, "task"), { allowed: ["done"] }),

  openTask("held-audited-cancelled-chain", "Dune field station", samples,
    "If our current Dune sample chain run was cancelled and its custody audit is signed, leave the collection ready to retry. A prior chain receipt from a different run doesn't count.",
    [prior("desert", "Dune laboratory return", "dune-lab", samples, "cancelled"), prior("archive", "Former survey", "dune-lab", samples, "accepted", { attempt: "DS-20" })],
    disposition("desert", "ready"), { held: true, requires: [{ title: "Custody audit", status: "done" }] }),
  openTask("held-ferry-owner-alias", "Island dock", ferry,
    "Approve Ferry loading plan only from the loader for the current berth. The launch observer can see the same spreadsheet. Keep our card where it is if the loader didn't acknowledge it.",
    [prior("wrong", "Berth observer room", "launch-observer", ferry, "accepted"),
      prior("draft", "Ferry loader room", "ferry-loader", ferry, "draft")],
    disposition(null, null, null, "owner"), { held: true, allowed: ["done"] }),
  openTask("held-exhibit-readback-after-ack-loss", "Cedar gallery", exhibit,
    "When Cedar exhibit manifest reaches its exact current approval, mark it done and make a local handoff with the manifest and attempt to @cedar-desk in Cedar closure. Confirm the actual delivery even if the first acknowledgment is missing.",
    [prior("setup", "Cedar setup", "cedar-curator", exhibit, "ready", { attempt: "CE-42" }),
      prior("reconciled", "Cedar current approval", "cedar-curator", exhibit, "accepted"), destination("closer", "Cedar closure", "cedar-desk", true)],
    disposition("reconciled", "done", "closer"), { held: true }),
  openTask("held-new-plant-attempt", "Orchard irrigation", orchard,
    "Put Orchard pump review into review if the active calibration record still agrees. An irrigation steward may issue a replacement attempt before you write. Keep the replacement assignment if that happens.",
    [prior("old", "Pump laboratory archive", "pump-steward", orchard, "ready", { attempt: "OP-10" }),
      prior("current", "Orchard readings", "pump-steward", orchard, "ready")],
    disposition(null, null, null, "attempt"), { held: true, allowed: ["review"], race: { field: "attempt", value: "OP-13" } }),
  openTask("held-finished-lane-dependencies", "Winter line", snow,
    "Confirm the current Snow line bulletin result while the slope check is still in progress. Can this bulletin be closed now? Leave other task and channel state alone.",
    [prior("actual", "Winter desk", "winter-keeper", snow, "accepted"), prior("preceding", "Last winter", "winter-keeper", snow, "accepted", { attempt: "SL-55" })],
    disposition("actual", null, null, "prerequisite"), { held: true, allowed: ["done"], requires: [{ title: "Slope check", status: "active" }] }),
];
