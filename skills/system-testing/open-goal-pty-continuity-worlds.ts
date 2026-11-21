type Blocker = "hold-no-session" | "hold-context" | "hold-generation";
type Disposition = Blocker | "hold-running" | "hold-gap" | "hold-reset" | "hold-proof" |
  "report-failed" | "report-signal" | "report-good" | "stage-good";
type Attempt = {
  prefix?: string; suffix?: string; state?: "running" | "failure" | "signal"; missing?: true;
  context?: "prior"; pid?: "prior"; checkpoint?: "tail" | "empty" | "ahead" | "split"; damage?: "trim" | "clear";
  staleDigest?: true; needsReturnCode?: false;
};
export type PtyWorld = {
  id: string; kind: "pty-continuity"; workspace: "system"; sourceGroup: string; split?: "test";
  goal: string; subject: string; nominated: Attempt; alternative: Attempt; allowAlternative: boolean; mayStage: boolean;
  expected: { side: "nominated" | "alternative" | null; blocker: Blocker | null; disposition: Disposition };
};
type Options = Partial<Pick<PtyWorld, "nominated" | "alternative" | "allowAlternative" | "mayStage">> &
  { held?: true; side?: "alternative" | null; blocker?: Blocker };
function world(id: string, subject: string, goal: string, disposition: Disposition, opts: Options = {}): PtyWorld {
  return {
    id: "pty-continuity-" + id, kind: "pty-continuity", workspace: "system", sourceGroup: "vibestudio:pty-continuity:" + id,
    ...(opts.held ? { split: "test" } : {}), subject, goal, nominated: opts.nominated ?? {},
    alternative: opts.alternative ?? { state: "failure" }, allowAlternative: opts.allowAlternative ?? false,
    mayStage: opts.mayStage ?? true,
    expected: { side: opts.side === undefined ? "nominated" : opts.side, blocker: opts.blocker ?? null, disposition },
  };
}
export const openPtyContinuityRequiresUnits = [
  "skills/open-user-goal", "skills/system-testing", "workers/system-test-runner", "extensions/shell", "packages/pty-stream",
];
export const openPtyContinuityWorlds = [
  world("shift-confirmation-saved-offset", "Stock shift", "My Stock shift console disconnected just after I acknowledged the header. Check how the owned attempt finished and keep its continuation locally if it is complete.", "stage-good",
    { nominated: { prefix: "header accepted | ", suffix: "count closed", checkpoint: "tail" } }),
  world("two-identical-output-other-process", "Reading rota", "Two Reading rota terminals printed the same closeout, but I need the attempt from my previous console. Can its evidence still be used for the local closeout?", "hold-generation",
    { nominated: { pid: "prior", suffix: "closed" }, alternative: { suffix: "closed" }, allowAlternative: true, side: null, blocker: "hold-generation" }),
  world("workspace-confused-with-older-context", "Intake banner", "The Intake banner tab may have been opened in an older workspace revision. Please verify which session the retained result belongs to before keeping it.", "hold-context",
    { nominated: { context: "prior" }, alternative: {}, allowAlternative: true, side: null, blocker: "hold-context" }),
  world("old-attachment-fell-behind-window", "Library count", "I was disconnected during a long Library count. Can we actually resume from my saved position, or has the terminal dropped part of the requested evidence?", "hold-gap",
    { nominated: { prefix: "queued | ".repeat(160), suffix: "closed | ".repeat(100), damage: "trim" } }),
  world("older-epoch-after-clear", "Help-desk directory", "I cleared the Help-desk directory terminal after stepping through the report. Find out if the earlier checkpoint can still substantiate what happened.", "hold-reset",
    { nominated: { damage: "clear", suffix: "printed directory" } }),
  world("after-future-offset", "Roster clock", "The reconnect marker for Roster clock came from a client that had just changed tabs. Tell me whether it can recover the exact owner result.", "hold-reset",
    { nominated: { checkpoint: "ahead" }, alternative: { checkpoint: "tail" } }),
  world("positive-text-failed-exit", "Opening notices", "Opening notices left a reassuring line before the child returned. Determine whether the original process actually succeeded and keep the closeout only if it did.", "report-failed",
    { nominated: { suffix: "notices look ready", state: "failure" } }),
  world("terminated-after-writing-final-line", "Repair ledger", "Repair ledger wrote a final-looking line just before the console disappeared. Work out whether the process was stopped or genuinely returned normally.", "report-signal",
    { nominated: { suffix: "final ledger", state: "signal" } }),
  world("processing-at-resume", "Customer list", "The Customer list output arrived while the terminal was still busy. Reattach to the exact attempt and tell me whether there is a final result yet.", "hold-running",
    { nominated: { state: "running", checkpoint: "tail", suffix: "working" } }),
  world("interim-quote-no-final-witness", "Daily intake", "Give me the latest retained observation from Daily intake. It's still running and I only want to know what the console has already emitted.", "report-good",
    { nominated: { state: "running", needsReturnCode: false, suffix: "batch observed" } }),
  world("approval-limited-to-report", "Door count", "Read the original Door count terminal and tell me whether the run finished cleanly. Leave the workspace as it is.", "report-good",
    { mayStage: false, nominated: { checkpoint: "tail", suffix: "count reconciled" } }),
  world("prior-digest-with-current-cursor", "Activity summary", "The saved Activity summary transcript and its reconnect point may come from different attempts. Keep a local copy only if they agree with the original terminal.", "hold-proof",
    { nominated: { checkpoint: "tail", staleDigest: true } }),
  world("multibyte-valid-continuation", "Welcoming captions", "My caption terminal disconnected after confirming the bilingual header. Keep the exact remaining result if the original run finished and the accented text is intact.", "stage-good",
    { nominated: { prefix: "Édito 🎬 | ", suffix: "Bienvenue à Zürich", checkpoint: "tail" } }),
  world("within-multibyte-character", "Tour route", "The reconnect marker for Tour route may land in the middle of a label. Check whether the original saved result can be trusted before keeping it.", "hold-proof",
    { nominated: { prefix: "🚲 départ | ", suffix: "ouvrez", checkpoint: "split" } }),
  world("empty-tail-at-exact-exit", "Pickup check", "My Pickup check client had already read every line before losing the terminal. Please confirm whether the same attempt subsequently returned and keep the exact closeout if so.", "stage-good",
    { nominated: { checkpoint: "empty", suffix: "ready" } }),
  world("absent-current-approved-alternative", "Mailbox review", "The latest Mailbox review terminal may be unavailable. If the older assigned run is the authorized substitute, use its completed continuation for the local handoff.", "stage-good",
    { nominated: { missing: true }, alternative: { checkpoint: "tail", suffix: "mail review complete" }, allowAlternative: true, side: "alternative" }),
  world("absent-current-no-authorized-alternative", "Office map", "The Office map terminal link no longer works. See whether our nominated result survived. The other desk's terminal is for comparison only.", "hold-no-session",
    { nominated: { missing: true }, alternative: {}, side: null, blocker: "hold-no-session" }),
  world("complete-after-retained-prefix-trim", "Museum inventory", "I already received the early Museum inventory printout. Only the last portion matters now. Verify whether it resumes cleanly from that saved point and retain the closeout if so.", "stage-good",
    { nominated: { prefix: "catalogued | ".repeat(180), suffix: "closed", damage: "trim", checkpoint: "tail" } }),
  world("warning-text-does-not-override-exit", "Energy totals", "The Energy totals console included a warning and a summary. Decide whether the original run actually finished and save the confirmed local receipt if applicable.", "stage-good",
    { nominated: { prefix: "warning: estimates | ", suffix: "verification complete" }, alternative: { state: "signal" } }),
  world("failed-alternative-without-fabricating-success", "Supplies labels", "If the nominated Supplies labels terminal is gone, the owner approved our backup. Report what the backup actually did and only retain a successful handoff.", "report-failed",
    { nominated: { missing: true }, alternative: { state: "failure", suffix: "printed preliminary" }, allowAlternative: true, side: "alternative" }),
  world("held-fallback-cursor-neighbor-mismatch", "Sign-in export", "I approved the backup Sign-in export console after losing the first. Reconstruct what happened only if the saved fragment actually belongs to that backup.", "hold-proof",
    { held: true, nominated: { missing: true }, alternative: { checkpoint: "tail", staleDigest: true }, allowAlternative: true, side: "alternative" }),
  world("held-current-active-neighbor-complete", "Workshop fixtures", "Workshop fixtures went quiet after some output. The older tab shows a clean result. Check the exact current session before writing any local completion note.", "hold-running",
    { held: true, nominated: { state: "running", suffix: "ready for inspection" }, alternative: {}, allowAlternative: true }),
  world("held-context-reuse-after-missing", "Broadcast sheet", "The first Broadcast sheet attachment vanished. The backup link may be from the previous workspace. Determine whether an owned, exact substitute exists.", "hold-context",
    { held: true, nominated: { missing: true }, alternative: { context: "prior" }, allowAlternative: true, side: null, blocker: "hold-context" }),
  world("held-long-byte-window-unicode", "Municipal notes", "Resume the result for Municipal notes from the last part I received, after a long list of accented labels. Keep the local receipt when the remainder and actual exit are complete.", "stage-good",
    { held: true, nominated: { prefix: "référence 🎛️ | ".repeat(125), suffix: "fin d’examen", damage: "trim", checkpoint: "tail" } }),
  world("held-scrollback-cleared-after-failure", "Tide board", "The Tide board run failed and the console was cleared before reconnecting. Separate what the retained state can establish from the missing continuation.", "hold-reset",
    { held: true, nominated: { state: "failure", damage: "clear", checkpoint: "tail" } }),
  world("held-signal-in-fallback", "Catering totals", "The main Catering totals terminal is unavailable. Check the approved backup for a real completion before making a scratch note.", "report-signal",
    { held: true, nominated: { missing: true }, alternative: { state: "signal", checkpoint: "tail", suffix: "summing" }, allowAlternative: true, side: "alternative" }),
  world("held-two-unavailable-with-history", "City directory", "Recover the exact City directory result if either of the approved terminal attempts still exists. Leave a clear status if neither can be reconstructed.", "hold-no-session",
    { held: true, nominated: { missing: true }, alternative: { missing: true }, allowAlternative: true, side: null, blocker: "hold-no-session" }),
  world("held-digest-first-byte-payload", "Volunteer locations", "Verify that the first retained byte of Volunteer locations agrees with the saved record. This is an inspection for the shift lead, with no written record needed.", "report-good",
    { held: true, mayStage: false, nominated: { suffix: "Δ locations checked" } }),
] satisfies PtyWorld[];
