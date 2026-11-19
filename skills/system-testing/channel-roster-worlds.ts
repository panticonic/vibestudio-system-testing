type Channel = "oncall" | "review";
type Handle = "scribe" | "triage" | "reviewer";
type Location = [channel: Channel, handle: Handle];
type Step = {
  channel: Channel;
  handle: Handle;
  action: "attach" | "detach" | "inspect";
  precondition: "absent" | "member" | "conflict";
  expected: "applied" | "unchanged" | "observed" | "held" | "blocked";
};

const scribe: Location = ["oncall", "scribe"];
const reviewScribe: Location = ["review", "scribe"];
const triage: Location = ["oncall", "triage"];
const reviewer: Location = ["review", "reviewer"];

const step = (
  [channel, handle]: Location,
  action: Step["action"],
  precondition: Step["precondition"],
  expected: Step["expected"],
): Step => ({ channel, handle, action, precondition, expected });
const add = (location: Location) =>
  step(location, "attach", "absent", "applied");
const present = (location: Location) =>
  step(location, "attach", "member", "unchanged");
const remove = (location: Location) =>
  step(location, "detach", "member", "applied");
const absent = (location: Location) =>
  step(location, "detach", "absent", "unchanged");
const inspect = (location: Location, before: Step["precondition"]) =>
  step(
    location,
    "inspect",
    before,
    before === "conflict" ? "held" : "observed",
  );
const conflicted = (
  location: Location,
  action: "attach" | "detach",
  blocked = false,
) => step(location, action, "conflict", blocked ? "blocked" : "held");

const scenario = (
  id: string,
  goal: string,
  starting: { members?: Location[]; conflicts?: Location[] },
  ...steps: Step[]
) => ({ id, goal, starting, steps });

export const managedChannelRosterWorlds = [
  scenario(
    "same-handle-two-channels",
    "Put the scribe in handover and review. Confirm both have their own participant before removing it from handover.",
    {},
    add(scribe),
    add(reviewScribe),
    inspect(scribe, "member"),
    remove(scribe),
    inspect(reviewScribe, "member"),
  ),
  scenario(
    "idempotent-attach",
    "Confirm the repeated scribe request keeps its existing participant and lets triage join separately.",
    { members: [scribe] },
    present(scribe),
    add(triage),
    inspect(scribe, "member"),
    inspect(triage, "member"),
  ),
  scenario(
    "remove-absent-participant",
    "Leave the missing scribe absent and keep the active triage participant in handover.",
    { members: [triage] },
    absent(scribe),
    inspect(triage, "member"),
    add(reviewScribe),
    inspect(scribe, "absent"),
  ),
  scenario(
    "review-to-oncall-transfer",
    "Move review duty to the on-call scribe after detaching the review scribe.",
    { members: [reviewScribe] },
    inspect(reviewScribe, "member"),
    remove(reviewScribe),
    add(scribe),
    inspect(reviewScribe, "absent"),
  ),
  scenario(
    "staged-cleanup",
    "Retire both assigned participants while preserving the retained reviewer.",
    { members: [scribe, triage, reviewer] },
    remove(triage),
    inspect(scribe, "member"),
    remove(scribe),
    inspect(reviewer, "member"),
  ),
  scenario(
    "remove-then-reopen",
    "Detach and confirm the scribe is absent before reopening its membership in the same channel.",
    { members: [scribe] },
    remove(scribe),
    inspect(scribe, "absent"),
    add(scribe),
    inspect(scribe, "member"),
  ),
  scenario(
    "interleave-inspections",
    "Confirm review has no reviewer, change two handover participants, then verify review is still empty.",
    { members: [scribe] },
    inspect(reviewer, "absent"),
    add(triage),
    remove(scribe),
    inspect(reviewer, "absent"),
  ),
  scenario(
    "double-detach",
    "Apply the first review detachment and treat the second as already satisfied.",
    { members: [reviewer, reviewScribe] },
    remove(reviewer),
    absent(reviewer),
    inspect(reviewScribe, "member"),
    inspect(reviewer, "absent"),
  ),
  scenario(
    "shared-handle-one-retained",
    "Verify the review scribe, remove it, and confirm the same handle is still active in handover.",
    { members: [scribe, reviewScribe] },
    inspect(reviewScribe, "member"),
    remove(reviewScribe),
    present(scribe),
    inspect(reviewScribe, "absent"),
  ),
  scenario(
    "alternate-reviewers",
    "Replace the review scribe with an assigned reviewer while leaving on-call triage available.",
    { members: [reviewScribe, triage] },
    add(reviewer),
    remove(reviewScribe),
    inspect(triage, "member"),
    inspect(reviewer, "member"),
  ),
  scenario(
    "read-before-local-change",
    "Read the active scribe, then close it and independently join the review scribe.",
    { members: [scribe] },
    inspect(scribe, "member"),
    remove(scribe),
    absent(scribe),
    add(reviewScribe),
    inspect(reviewScribe, "member"),
  ),
  scenario(
    "reopen-both-in-order",
    "Retire and reopen each scribe in its own channel, keeping proof from both rosters.",
    { members: [scribe, reviewScribe] },
    remove(reviewScribe),
    remove(scribe),
    add(scribe),
    add(reviewScribe),
  ),
  scenario(
    "scope-isolated-detach",
    "A missing review scribe must leave the on-call scribe untouched, then the reviewer can join.",
    { members: [scribe] },
    absent(reviewScribe),
    inspect(scribe, "member"),
    add(reviewer),
    inspect(reviewScribe, "absent"),
  ),
  scenario(
    "confirm-then-second-shift",
    "Confirm the staffed triage channel while setting up review coverage and checking for an on-call scribe.",
    { members: [triage] },
    present(triage),
    add(reviewer),
    add(reviewScribe),
    inspect(scribe, "absent"),
  ),
  scenario(
    "readonly-roster-inventory",
    "Read members and absences across the two channels, keeping the roster unchanged.",
    { members: [scribe, reviewer] },
    inspect(triage, "absent"),
    inspect(scribe, "member"),
    inspect(reviewScribe, "absent"),
    inspect(reviewer, "member"),
  ),
  scenario(
    "hold-conflicted-handle",
    "Hold a conflicting scribe change, skip later writes to that same handle, and proceed with independent review coverage.",
    { conflicts: [scribe] },
    conflicted(scribe, "attach"),
    conflicted(scribe, "detach", true),
    add(reviewScribe),
    inspect(reviewScribe, "member"),
  ),
  scenario(
    "inspect-a-conflict-again",
    "Keep inspection available after a conflicting handle and keep subsequent writes held until identity is clear.",
    { conflicts: [reviewScribe] },
    inspect(reviewScribe, "conflict"),
    conflicted(reviewScribe, "attach", true),
    inspect(reviewScribe, "conflict"),
    add(scribe),
  ),
  scenario(
    "conflict-does-not-block-neighbor",
    "Hold changes to the conflicting scribe and continue with triage in the same channel.",
    { conflicts: [scribe] },
    conflicted(scribe, "detach"),
    add(triage),
    inspect(triage, "member"),
    conflicted(scribe, "attach", true),
  ),
  scenario(
    "conflict-across-two-channels",
    "Separate two unrelated conflicts and continue the reviewer assignment.",
    { conflicts: [scribe, reviewScribe] },
    conflicted(scribe, "attach"),
    conflicted(reviewScribe, "detach"),
    conflicted(scribe, "detach", true),
    add(reviewer),
  ),
  scenario(
    "busy-roster-mixed-handoff",
    "Keep both staff shifts consistent through an attach, duplicate attach, detach and final audit.",
    { members: [triage, reviewScribe] },
    add(scribe),
    present(scribe),
    remove(reviewScribe),
    inspect(triage, "member"),
    inspect(reviewScribe, "absent"),
  ),
];
