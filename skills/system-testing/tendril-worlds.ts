export const tendrilPanel = "panels/tendril-workflow-fixture";

type Value = string | number | boolean;
type Step =
  | { kind: "read" }
  | { kind: "write"; field: { key: string; value: Value } }
  | { kind: "invoke"; name: string; expected: { key: string; value: Value } };

const read: Step = { kind: "read" };
const write = (key: string, value: Value): Step => ({
  kind: "write",
  field: { key, value },
});
const invoke = (name: string, key: string, value: Value): Step => ({
  kind: "invoke",
  name,
  expected: { key, value },
});
const confirm = invoke("acknowledge", "confirmed", true);
const unconfirm = invoke("clearReview", "confirmed", false);
const startReview = invoke("startReview", "phase", "review");
const intake = invoke("returnToIntake", "phase", "intake");
const clearTimer = invoke("clearTimer", "minutes", 0);

function world(id: string, goal: string, steps: Step[]) {
  return {
    id,
    request: {
      goal,
      platforms: ["headless" as const],
      allowPending: false,
      steps,
    },
  };
}

export const managedTendrilWorlds = [
  world(
    "timer-to-review",
    "Set a five-minute timer on the live board and start its review. Verify both changes together.",
    [write("minutes", 5), startReview, read],
  ),
  world(
    "timer-clear",
    "Set a ten-minute timer, then use the page's Clear timer control. Confirm the visible and stored timer are zero.",
    [write("minutes", 10), clearTimer],
  ),
  world(
    "intake-ready",
    "Start in intake and attach today's receipt label. Confirm the board stays in intake when acknowledging the receipt.",
    [intake, write("label", "Delivery receipts"), confirm, read],
  ),
  world(
    "correction-withdrawal",
    "Mark the review confirmed, then withdraw confirmation after a discrepancy. Retain the original review phase.",
    [startReview, confirm, unconfirm, read],
  ),
  world(
    "correct-batch-label",
    "Correct a mistaken batch label and retain its owner confirmation on the same panel.",
    [
      write("label", "North queue"),
      confirm,
      write("label", "South queue"),
      read,
    ],
  ),
  world(
    "acknowledge-two-revisions",
    "Acknowledge the first handoff. Update the label and clear its confirmation, then acknowledge the new handoff.",
    [
      write("label", "Draft handoff"),
      confirm,
      write("label", "Final handoff"),
      unconfirm,
      confirm,
    ],
  ),
  world(
    "move-back-to-intake",
    "Move a staged incident handoff into review, then return it to intake. Keep the incident label visible throughout.",
    [write("label", "Incident 17"), startReview, intake, read],
  ),
  world(
    "zero-timer-is-valid",
    "Clear a timer that is already zero and leave a visible receipt of the page action.",
    [write("minutes", 0), clearTimer, read],
  ),
  world(
    "read-between-control-effects",
    "Inspect the board before and after beginning review, then use its exposed confirmation control.",
    [read, startReview, read, confirm],
  ),
  world(
    "reopen-with-timer-cleared",
    "Withdraw confirmation, clear the prior meeting timer, and put the board back in intake for the next operator.",
    [confirm, write("minutes", 25), unconfirm, clearTimer, intake],
  ),
  world(
    "handoff-note-only",
    "Add the prepared agenda label to a fresh panel and check the board twice without running review controls.",
    [write("label", "Quarterly agenda"), read, read],
  ),
  world(
    "inspect-without-changes",
    "Present the empty board and verify the initial screen without editing shared state or invoking a control.",
    [read],
  ),
];
