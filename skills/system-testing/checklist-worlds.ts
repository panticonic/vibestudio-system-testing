export const checklistSource = "terminal-apps/release-checklist";
export type ItemKey = "1" | "2" | "3";
type Continuation = "none" | "reattach" | "restart";
export type ChecklistWorld = {
  id: string;
  request: { goal: string; keys: ItemKey[]; continuation: Continuation };
  expected: ItemKey[][];
};

function task(
  id: string,
  goal: string,
  keys: ItemKey[],
  continuation: Continuation,
  expected: ItemKey[][],
): ChecklistWorld {
  return { id, request: { goal, keys, continuation }, expected };
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
];
