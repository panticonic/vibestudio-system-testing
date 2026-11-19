export const checklistSource = "terminal-apps/release-checklist";
export type ItemKey = "1" | "2" | "3";
type Continuation = "none" | "reattach" | "restart";
type Target = { checked: ItemKey[]; unchecked: ItemKey[] };
export type ChecklistWorld = {
  id: string;
  request: { goal: string; continuation: Continuation } & (
    | { keys: ItemKey[] }
    | { target: Target }
  );
  setup: ItemKey[];
  keys: ItemKey[];
  expected: ItemKey[][];
};

function task(
  id: string,
  goal: string,
  keys: ItemKey[],
  continuation: Continuation,
  expected: ItemKey[][],
): ChecklistWorld {
  return {
    id,
    request: { goal, keys, continuation },
    setup: [],
    keys,
    expected,
  };
}

function targetTask(
  id: string,
  goal: string,
  setup: ItemKey[],
  target: Target,
  keys: ItemKey[],
  continuation: Continuation,
): ChecklistWorld {
  const checked = new Set(setup);
  const expected = [[...checked].sort()];
  for (const key of keys) {
    if (!checked.delete(key)) checked.add(key);
    expected.push([...checked].sort());
  }
  if (continuation !== "none") expected.push([...checked].sort());
  return { id, request: { goal, target, continuation }, setup, keys, expected };
}
export const managedChecklistWorlds = [
  task(
    "initial-view",
    "Inspect the empty checklist without toggling any item.",
    [],
    "none",
    [[]],
  ),
  task(
    "prepare-build",
    "Mark build prepared and verify the other items remain untouched.",
    ["1"],
    "none",
    [[], ["1"]],
  ),
  task(
    "review-and-rollback",
    "Complete review then rollback verification, retaining both screen readbacks.",
    ["2", "3"],
    "none",
    [[], ["2"], ["2", "3"]],
  ),
  task(
    "undo-toggle",
    "Toggle the build item twice and verify the second key restores its initial state.",
    ["1", "1"],
    "none",
    [[], ["1"], []],
  ),
  task(
    "reattach-resize",
    "Mark rollback verified, then reattach at the smaller viewport while keeping the same running PTY.",
    ["3"],
    "reattach",
    [[], ["3"], ["3"]],
  ),
  task(
    "restart-state",
    "Mark review complete and restart the app. Confirm the checklist retains the saved state in a new PTY.",
    ["2"],
    "restart",
    [[], ["2"], ["2"]],
  ),
  task(
    "restart-edited-state",
    "Toggle three items through successive edits, undo the first one, then confirm the exact final state after restart.",
    ["1", "2", "3", "1"],
    "restart",
    [[], ["1"], ["1", "2"], ["1", "2", "3"], ["2", "3"], ["2", "3"]],
  ),
  targetTask(
    "complete-existing-review",
    "Mark review complete on the prepared build. Preserve its existing readiness and leave rollback untouched, then reattach to check the smaller screen.",
    ["1"],
    { checked: ["1", "2"], unchecked: [] },
    ["2"],
    "reattach",
  ),
  targetTask(
    "withdraw-stale-review",
    "Withdraw an obsolete review approval while preserving the prepared build and any rollback confirmation. Restart to verify the withdrawal persists.",
    ["1", "2", "3"],
    { checked: [], unchecked: ["2"] },
    ["2"],
    "restart",
  ),
  targetTask(
    "renew-review-after-invalid-build",
    "Clear the stale build preparation before marking review complete. Preserve the existing rollback confirmation and verify the new state after restart.",
    ["1", "3"],
    { checked: ["2"], unchecked: ["1"] },
    ["1", "2"],
    "restart",
  ),
  targetTask(
    "confirm-fallback-before-withdrawal",
    "Confirm rollback before clearing build prepared, so a recovery option stays recorded throughout the handoff. Keep review checked.",
    ["1", "2"],
    { checked: ["3"], unchecked: ["1"] },
    ["3", "1"],
    "none",
  ),
  targetTask(
    "invalidate-review-before-fallback",
    "Withdraw the stale review approval before marking rollback confirmed. Keep build preparation recorded, then reattach for a final read.",
    ["1", "2"],
    { checked: ["3"], unchecked: ["2"] },
    ["2", "3"],
    "reattach",
  ),
  targetTask(
    "confirm-and-clear-review-after-restart",
    "Confirm rollback first, then clear the review approval without changing build preparation. Restart and verify the durable result.",
    ["1", "2"],
    { checked: ["3"], unchecked: ["2"] },
    ["3", "2"],
    "restart",
  ),
  targetTask(
    "clear-two-stale-approvals",
    "Clear review complete and rollback confirmed because their evidence expired. Preserve build preparation and verify the result in the same PTY after resizing.",
    ["1", "2", "3"],
    { checked: ["1"], unchecked: ["2", "3"] },
    ["2", "3"],
    "reattach",
  ),
  targetTask(
    "reset-all-after-release-failure",
    "Clear the active checklist at closeout. Remove rollback confirmation first, then review, then build preparation, and verify the empty state after restart.",
    ["1", "2", "3"],
    { checked: [], unchecked: ["1", "2", "3"] },
    ["3", "2", "1"],
    "restart",
  ),
  targetTask(
    "retain-approved-state-on-restart",
    "Ensure build prepared and rollback confirmed remain checked, and review stays clear. Restart and verify without sending any toggles that are already satisfied.",
    ["1", "3"],
    { checked: ["1", "3"], unchecked: ["2"] },
    [],
    "restart",
  ),
  targetTask(
    "retain-review-on-reattach",
    "Keep review complete checked and leave every other item as observed. Verify the existing review on the same PTY after reattaching.",
    ["2"],
    { checked: ["2"], unchecked: [] },
    [],
    "reattach",
  ),
  targetTask(
    "fill-in-build-and-rollback",
    "Complete the missing checks for build and rollback while retaining the existing review approval. Record rollback before build, then restart for final verification.",
    ["2"],
    { checked: ["1", "2", "3"], unchecked: [] },
    ["3", "1"],
    "restart",
  ),
  targetTask(
    "rollback-only-after-rejected-release",
    "Clear expired release approvals, build first and review second. Record rollback confirmation only after both approvals have been withdrawn.",
    ["1", "2"],
    { checked: ["3"], unchecked: ["1", "2"] },
    ["1", "2", "3"],
    "none",
  ),
  targetTask(
    "mark-success-without-old-rollback",
    "Clear superseded rollback confirmation, then record build preparation and review in that order. Verify after reattachment.",
    ["3"],
    { checked: ["1", "2"], unchecked: ["3"] },
    ["3", "1", "2"],
    "reattach",
  ),
  targetTask(
    "build-only-handoff-after-stale-review",
    "Withdraw review completion before marking the build prepared for its next operator. Leave rollback unchecked and verify after restart.",
    ["2"],
    { checked: ["1"], unchecked: ["2", "3"] },
    ["2", "1"],
    "restart",
  ),
  targetTask(
    "rollback-remains-available",
    "Keep the recorded rollback and add review approval without enabling build preparation. Verify the final state after restart.",
    ["3"],
    { checked: ["2", "3"], unchecked: ["1"] },
    ["2"],
    "restart",
  ),
  targetTask(
    "certify-review-before-preparation",
    "Record review complete first, then mark build prepared. Leave the observed rollback state as it is.",
    ["3"],
    { checked: ["1", "2"], unchecked: [] },
    ["2", "1"],
    "none",
  ),
];
