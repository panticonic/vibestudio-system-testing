export const tendrilPanel = "panels/tendril-workflow-fixture";

type Value = string | number | boolean;
type Step =
  | { kind: "read" }
  | {
      kind: "update";
      candidate: "review-layout" | "incident-layout" | "broken-boot";
      expectedBuild: string;
    }
  | { kind: "restore"; expectedBuild: string }
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

export const tendrilCandidateBuild = {
  "review-layout": "board-review",
  "incident-layout": "board-incident",
  "broken-boot": "board-broken",
} as const;
const reviewLayout: Step = {
  kind: "update",
  candidate: "review-layout",
  expectedBuild: "board-review",
};
const incidentLayout: Step = {
  kind: "update",
  candidate: "incident-layout",
  expectedBuild: "board-incident",
};
const brokenBuild: Step = {
  kind: "update",
  candidate: "broken-boot",
  expectedBuild: "board-broken",
};
const restore = (expectedBuild: string): Step => ({
  kind: "restore",
  expectedBuild,
});

export function hasTendrilBuildSteps(request: { steps: Step[] }) {
  return request.steps.some(
    ({ kind }) => kind === "update" || kind === "restore",
  );
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
  world(
    "publish-review-layout",
    "Publish the review layout on the live handoff board, keeping the agenda and confirmation visible.",
    [write("label", "Review agenda"), confirm, reviewLayout, read],
  ),
  world(
    "retire-bad-during-intake",
    "Try the staged intake build. If it cannot boot, confirm the original board and its intake phase survived.",
    [intake, write("label", "Intake receipts"), brokenBuild, read],
  ),
  world(
    "restore-previous-layout",
    "Review the new layout, update the active timer, and go back to the previous layout while keeping the new timer.",
    [
      write("minutes", 10),
      reviewLayout,
      write("minutes", 18),
      restore("board-v1"),
      read,
    ],
  ),
  world(
    "revert-to-last-good-release",
    "Install the review layout first. If the next build fails, verify rollback to that layout and continue with the exposed acknowledge control.",
    [startReview, reviewLayout, brokenBuild, confirm],
  ),
  world(
    "recover-from-failed-candidate",
    "Try the broken candidate before deploying the incident layout. Ensure the incident label survives the failure and the later successful build.",
    [write("label", "Incident 09"), brokenBuild, incidentLayout, read],
  ),
  world(
    "undo-after-two-live-builds",
    "Install two consecutive layouts and return to the first new layout, preserving the board's confirmation and timer across the history jump.",
    [
      reviewLayout,
      confirm,
      incidentLayout,
      write("minutes", 27),
      restore("board-review"),
    ],
  ),
  world(
    "clear-after-rollback",
    "Set the incident timer, attempt the new build, and clear the timer using the control on the restored page if the build fails.",
    [incidentLayout, write("minutes", 16), brokenBuild, clearTimer, read],
  ),
  world(
    "write-after-explicit-restore",
    "Open the incident layout, restore the original page, and set the saved intake state on the restored presentation.",
    [
      incidentLayout,
      restore("board-v1"),
      intake,
      write("label", "After review"),
      read,
    ],
  ),
];
