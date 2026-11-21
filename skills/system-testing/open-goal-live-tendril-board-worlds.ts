import { tendrilCandidateBuild, tendrilPanel, type ManagedTendrilWorld, type TendrilFixtureStep } from "./tendril-worlds.js";

type Step = TendrilFixtureStep;
type Candidate = keyof typeof tendrilCandidateBuild;
const check: Step = { kind: "read" };
const label = (value: string): Step => ({ kind: "write", field: { key: "label", value } });
const timer = (value: number): Step => ({ kind: "write", field: { key: "minutes", value } });
const call = (name: string, key: string, value: string | number | boolean): Step => ({
  kind: "invoke", name, expected: { key, value },
});
const start = call("startReview", "phase", "review");
const intake = call("returnToIntake", "phase", "intake");
const confirm = call("acknowledge", "confirmed", true);
const withdraw = call("clearReview", "confirmed", false);
const clear = call("clearTimer", "minutes", 0);
const layout = (candidate: Candidate): Step => ({ kind: "update", candidate, expectedBuild: tendrilCandidateBuild[candidate] });
const back = (expectedBuild: string): Step => ({ kind: "restore", expectedBuild });

export type LiveTendrilBoardWorld = {
  kind: "live-tendril-board";
  workspace: "system";
  id: string;
  title: string;
  goal: string;
  split: "train" | "test";
  sourceGroup: string;
  fixture: ManagedTendrilWorld;
};
function board(id: string, title: string, goal: string, steps: Step[], held = false): LiveTendrilBoardWorld {
  const caseId = `live-tendril-board-${id}`;
  return {
    kind: "live-tendril-board", workspace: "system", id: caseId, title, goal, split: held ? "test" : "train",
    sourceGroup: `vibestudio:open-tendril-board:${id}`,
    fixture: { id: caseId, request: { goal, platforms: ["headless"], allowPending: false, steps } },
  };
}

export const openLiveTendrilBoardRequiresUnits = ["skills/open-user-goal", "skills/tendrils", tendrilPanel, "workers/tendril"];

export const openLiveTendrilBoardWorlds = [
  board("volunteer-check-in-reset", "Volunteer check-in", "The Volunteer check-in handoff should show Intake again. Keep the East entrance label, set a seven-minute check-in timer, then clear the timer after taking one separate reading for the incoming desk.",
    [label("East entrance"), intake, timer(7), check, clear]),
  board("gallery-proof-approval", "Gallery proof", "Label the Gallery proof as Evening print, start its review, and keep that review visible when the approved Review handoff layout replaces the current screen. Record the acknowledgment only on the new layout.",
    [label("Evening print"), start, layout("review-layout"), confirm]),
  board("copy-desk-two-layouts", "Copy desk", "For Copy desk, approve the Incident handoff layout first and keep Night corrections on the board. Trial the Review handoff after that, then return to Incident handoff and verify the retained label.",
    [layout("incident-layout"), label("Night corrections"), layout("review-layout"), back("board-incident"), check]),
  board("market-rollback-keep-owner", "Market round", "Carry the Market round to the Incident handoff layout. Acknowledge Morning rain there. After the unreleased layout fails its trial, verify that the restored board still displays the acknowledgment and label.",
    [layout("incident-layout"), label("Morning rain"), confirm, layout("broken-boot"), check]),
  board("tool-crib-reopen", "Tool crib", "Tool crib needs a short hold for the west bay. Mark the West bay label first and give the desk an eleven-minute timer. Acknowledge it, then withdraw the acknowledgment and return the board to intake.",
    [label("West bay"), timer(11), confirm, withdraw, intake]),
  board("access-lane-fallback", "Access lane", "Present Access lane as the Review handoff, with its Ramp escort label intact. Check the current page separately before trying the unreleased build. Verify the fallback stays on the Review handoff.",
    [layout("review-layout"), label("Ramp escort"), check, layout("broken-boot")]),
  board("orchard-layout-preserve-timer", "Orchard dispatch", "Set the Orchard dispatch countdown to nineteen minutes and begin review. Try the Incident handoff layout. Return to the original presentation once it's proven, carrying forward both the timer and review phase.",
    [timer(19), start, layout("incident-layout"), back("board-v1")]),
  board("room-directive-label-replacement", "Room directive", "The Room directive was prepared under Annex one but the next team needs Annex two. Show the initial Annex one label, take a separate reading, then fix the label and leave it unconfirmed.",
    [label("Annex one"), check, label("Annex two"), withdraw]),
  board("receiving-triage-incident-approved", "Receiving triage", "Receiving triage starts in review. Get the Incident handoff layout working before assigning Crate backlog. Set the countdown to four minutes and verify the local board separately.",
    [start, layout("incident-layout"), label("Crate backlog"), timer(4), check]),
  board("copy-retention-missing-approved-layout", "Copy retention", "We only need a clean Copy retention read to hand over. Present the board locally and take one separate observation with no labels, timing changes, or layout trials.",
    [check]),
  board("ledger-safety-check-preserve-label", "Ledger safety check", "Retain Audit slot as the Ledger safety check label. Set a thirteen-minute timer, start review, and verify that clearing the timer does not return the board to intake.",
    [label("Audit slot"), timer(13), start, clear]),
  board("yard-shift-ack-after-repair", "Yard shift", "Try the unreleased layout for Yard shift before committing to a review. On its restored board, apply South gate and finish with an acknowledgment after the approved Review handoff layout is visible.",
    [layout("broken-boot"), label("South gate"), layout("review-layout"), confirm]),
  board("projection-room-double-update", "Projection room", "Use the Review handoff for Projection room, begin review, then switch to Incident handoff. If the latest layout is no longer useful, bring back the proven Review handoff without losing its phase.",
    [layout("review-layout"), start, layout("incident-layout"), back("board-review")]),
  board("desk-ledger-zero-no-confirmation", "Desk ledger", "Set the Desk ledger label to Handover queue and the timer to six minutes. Go to intake, clear the timer there, and take a separate reading before any other desk changes.",
    [label("Handover queue"), timer(6), intake, clear, check]),
  board("visitor-brief-ack-carrying-build", "Visitor brief", "Read and then acknowledge Visitor brief. Test the Incident handoff layout after the acknowledgment, change the label to Quiet entry, and verify the acknowledgment remains visible in the candidate.",
    [check, confirm, layout("incident-layout"), label("Quiet entry")]),
  board("early-shift-review-withdrawn", "Early shift", "For Early shift, set the label to Gate three, start its review and confirm it. The owner withdrew consent before the layout change. Clear the confirmation first and only then try the Review handoff layout.",
    [label("Gate three"), start, confirm, withdraw, layout("review-layout")]),
  board("inventory-panel-reopen-old-layout", "Inventory exchange", "We need Inventory exchange back on the original layout after trying the Review handoff. Set the transfer timer to seventeen while the candidate is active and preserve that timer across the return.",
    [layout("review-layout"), timer(17), back("board-v1")]),
  board("lobby-check-failed-build-clears-timer", "Lobby check", "Provide a Lobby check receipt even if the unreleased build won't start. Set the lobby timer to three minutes, verify the failed candidate leaves the original display, then clear the timer on it.",
    [timer(3), layout("broken-boot"), clear, check]),
  board("layout-preview-private-observation", "Layout preview", "Present Layout preview briefly in Review handoff. Take a distinct observation there, restore the ordinary screen, and verify no durable fields changed during the comparison.",
    [layout("review-layout"), check, back("board-v1")], true),
  board("storage-rain-checkpoint", "Storage rain check", "Give the Storage rain check its Cargo cover label. Start review, take an independent reading, and then try Incident handoff. On that new layout remove confirmation and clear the timer.",
    [label("Cargo cover"), start, check, layout("incident-layout"), withdraw, clear], true),
  board("outbound-brief-two-recoveries", "Outbound brief", "First put Outbound brief on the incident layout and set Departure ready. Try the unreleased build. Once the retained incident is shown again, restore the original layout and keep the departure label.",
    [layout("incident-layout"), label("Departure ready"), layout("broken-boot"), back("board-v1")], true),
  board("quiet-room-earlier-intake", "Quiet room", "Quiet room is moving to an earlier intake. Use an eight-minute timer and put it into intake, then show the Night shift label before acknowledging that single change.",
    [timer(8), intake, label("Night shift"), confirm], true),
  board("audit-window-report-confirm", "Audit window", "Start Audit window in review first. Switch to Review handoff, keep West file visible, and don't leave the previous acknowledgment active. Verify the board separately after withdrawing it.",
    [start, layout("review-layout"), label("West file"), withdraw, check], true),
  board("paper-counter-retained-failure", "Paper counter", "For Paper counter use a nine-minute review and acknowledge it. Try the unreleased version and verify the restored original still carries that timer, review, and acknowledgment.",
    [timer(9), start, confirm, layout("broken-boot"), check], true),
] satisfies LiveTendrilBoardWorld[];
