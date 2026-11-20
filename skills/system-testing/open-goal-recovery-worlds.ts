import type { OpenRecoveryWorld } from "./open-goal-recovery-managed.js";

const workspace = { kind: "recovery", workspace: "system" } as const;
const complete = (key: string) => ({ key, status: "complete" as const });
const cite = (key: string, note: number) => ({ key, note });

export const openGoalRecoveryWorlds = [
  {
    ...workspace, id: "continue-mailroom-sort-from-latest-accepted-window",
    goal: "I had a mailroom sorting cutoff before the terminal disconnected. Recover the signed cutoff from Mailroom Dispatch after the saved note. If it is approved, leave a scratch handoff with the latest cutoff so the next shift can continue.",
    sourceGroup: "vibestudio:recovery:mailroom-cutoff",
    sessions: [
      { key: "draft", title: "Mailroom Drafts", description: "Planning notes", messages: [
        "Proposed mailroom cutoff: 16:00 UTC.",
      ] },
      { key: "main", title: "Mailroom Dispatch", description: "Accepted shift decisions", saved: { at: 0 }, messages: [
        "Pre-shift status recorded. Waiting for cutoff signature.",
        "Duty lead signed the sorting cutoff at 17:30 UTC. Continue on that schedule.",
      ] },
    ],
    canStage: true,
    expected: { reads: [complete("main")], disposition: "continue", citations: [cite("main", 1)], stage: true, reason: ["17:30"] },
  },
  {
    ...workspace, id: "distinguish-copied-tour-release-from-museum-hold",
    goal: "A reset left me with a copied 'tour can go' message. Read Museum Operations and then Volunteer Notes. Can the gallery tour actually go ahead? Stage the disposition for the next shift, including the gate the operations room recorded.",
    sourceGroup: "vibestudio:recovery:gallery-tour-copied-approval",
    sessions: [
      { key: "ops", title: "Museum Operations", description: "Duty controller's official decisions", messages: [
        "Duty controller: hold the gallery tour until the fire doors are inspected.",
      ] },
      { key: "mirror", title: "Volunteer Notes", description: "Volunteer group and copied notes", messages: [
        "Copied chat message: tour can go. This is an unconfirmed volunteer note.",
      ] },
    ],
    canStage: true,
    expected: { reads: [complete("ops"), complete("mirror")], disposition: "hold",
      citations: [cite("ops", 0), cite("mirror", 0)], stage: true, reason: ["fire doors"] },
  },
  {
    ...workspace, id: "preserve-harbor-hold-at-stable-replay-frontier",
    goal: "Give the next operator a handoff of the accepted recovery window in Harbor Turnaround. Use the snapshot opened from the saved cursor for this handoff, even if a new note arrives while it is loading. Can loading resume in that snapshot?",
    sourceGroup: "vibestudio:recovery:harbor-replay-frontier",
    sessions: [
      { key: "harbor", title: "Harbor Turnaround", description: "Signed dock status", replay: { pageSize: 2, maxPages: 6 }, messages: [
        "Berth assignment is stable.",
        "Shift lead: keep loading on hold until the fender inspection clears.",
      ], late: "Shift lead: the fender inspection is complete, and loading may resume in the next window." },
    ],
    canStage: true,
    expected: { reads: [complete("harbor")], disposition: "hold",
      citations: [cite("harbor", 1)], stage: true, reason: ["fender"] },
  },
  {
    ...workspace, id: "report-incomplete-insurance-renewal-replay",
    goal: "Recover the decision on Insurance Renewal from where my session left off. If you can't reach the decision in the available replay, tell me the evidence is incomplete and leave the handoff unstaged. Please don't quote an unverified outcome.",
    sourceGroup: "vibestudio:recovery:insurance-history-coverage",
    sessions: [
      { key: "insurance", title: "Insurance Renewal", description: "Runbook and final compliance decision",
        saved: { at: 0 }, replay: { pageSize: 1, maxPages: 1 }, messages: [
          "Saved checkpoint: review documents received.",
          "Clerk: renewal decision still pending.",
          "Compliance: do not renew until the updated schedule is signed.",
        ] },
    ],
    canStage: true,
    expected: { reads: [{ key: "insurance", status: "partial" }], disposition: "incomplete",
      citations: [], stage: false },
  },
  {
    ...workspace, id: "recover-library-service-from-owning-room",
    goal: "The counter reset opened Library Review, but its saved point may belong to Library Service. Check Review first and then read Service if the cursor doesn't match. Establish whether the counter can reopen from the owning room. Don't resend any notes or write a handoff.",
    sourceGroup: "vibestudio:recovery:library-cross-room-cursor",
    sessions: [
      { key: "copied", title: "Library Review", description: "Planning examples copied for review",
        saved: { channel: "service", at: 0 }, messages: ["Library counter reopening was proposed."] },
      { key: "service", title: "Library Service", description: "Accepted desk sign-off", messages: [
        "Library counter reopening was proposed.",
        "The duty manager signed off on reopening the counter at 09:00 UTC.",
      ] },
    ],
    canStage: false,
    expected: { reads: [{ key: "copied", status: "foreign" }, complete("service")],
      disposition: "continue", citations: [cite("service", 1)], stage: false, reason: ["09:00"] },
  },
  {
    ...workspace, id: "avoid-empty-handoff-for-caught-up-label-printing",
    goal: "Check Label Printing since my saved point. I only need new work. If the saved point is caught up, say so and skip the empty handoff or any resubmission.",
    sourceGroup: "vibestudio:recovery:label-printing-empty-tail",
    sessions: [
      { key: "labels", title: "Label Printing", description: "Queued jobs and notes", saved: { at: "head" }, messages: [
        "Print queue reviewed at shift end.",
      ] },
    ],
    canStage: true,
    expected: { reads: [{ key: "labels", status: "caught-up" }], disposition: "caught-up", citations: [], stage: false },
  },
  {
    ...workspace, id: "recover-separate-parts-order-correction",
    goal: "After the saved Parts Dispatch checkpoint there may be a repeated instruction and a separate correction. Find whether the correction was actually accepted, and leave the next shift a handoff of the later dispatch instruction and its correction. Do not send it again.",
    sourceGroup: "vibestudio:recovery:parts-order-correction",
    sessions: [
      { key: "parts", title: "Parts Dispatch", description: "Accepted dispatch instructions", saved: { at: 0 }, messages: [
        "Use bin C.",
        "Use bin C.",
        "Correction to the latest dispatch: use bin D. Supervisor accepted it.",
      ] },
    ],
    canStage: true,
    expected: { reads: [complete("parts")], disposition: "continue",
      citations: [cite("parts", 1), cite("parts", 2)], stage: true, reason: ["bin D"] },
  },
  {
    ...workspace, id: "hold-antenna-work-on-a-future-saved-cursor", split: "test",
    goal: "My saved point in Antenna Maintenance may be ahead of the restored conversation. Check it before resuming the transfer work. If it is ahead, explain why you cannot establish what happened after it and leave both the room and handoff alone.",
    sourceGroup: "vibestudio:recovery:antenna-future-checkpoint",
    sessions: [
      { key: "antenna", title: "Antenna Maintenance", description: "Accepted shift work", saved: { at: "future" }, messages: [
        "Torque readings accepted.",
      ] },
    ],
    canStage: false,
    expected: { reads: [{ key: "antenna", status: "future" }], disposition: "incomplete",
      citations: [], stage: false },
  },
  {
    ...workspace, id: "handoff-unconfirmed-permit-gate-after-depot-reconnect", split: "test",
    goal: "Resume the Depot Move handoff after reconnecting. Read Vehicle Planning first, then Permit Desk. Hand off whether vehicle readiness alone lets the move go ahead, with the latest relevant note from each room. Do not start the move.",
    sourceGroup: "vibestudio:recovery:depot-permit-confirmation",
    sessions: [
      { key: "move", title: "Vehicle Planning", description: "Vehicle readiness notes", messages: [
        "All vans were inspected and are ready for the Depot Move.",
      ] },
      { key: "permit", title: "Permit Desk", description: "Authority to start a move", messages: [
        "Driver request is in review. Permit has not been signed for Depot Move.",
      ] },
    ],
    canStage: true,
    expected: { reads: [complete("move"), complete("permit")], disposition: "hold",
      citations: [cite("move", 0), cite("permit", 0)], stage: true, reason: ["permit"] },
  },
] as const satisfies readonly (OpenRecoveryWorld & {
  kind: "recovery"; workspace: "system"; sourceGroup: string; split?: "test";
})[];
