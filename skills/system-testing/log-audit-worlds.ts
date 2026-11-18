export const systemInvestigationSkill = "skills/system-investigation";
export const hostWorkerdLogTag = "WorkerdManager";
const missingTag = "NatlangMissingTestSubsystem";

type Window = {
  title: string;
  cursor: number | null;
  tag: string;
  oldBoot?: boolean;
  status: "ready" | "blocked" | "attention" | "inconclusive";
  code: string;
  evidence: number[];
};
const window = (
  title: string,
  status: Window["status"],
  code: string,
  evidence: number[],
  options: Pick<Partial<Window>, "cursor" | "tag" | "oldBoot"> = {},
): Window => ({
  title,
  status,
  code,
  evidence,
  cursor: null,
  tag: hostWorkerdLogTag,
  ...options,
});

const recovered = (failed: number, fixed: number) =>
  window(
    "Inspect the complete operation history",
    "attention",
    "log-recovered",
    [failed, fixed],
  );
const unresolved = (failed: number) =>
  window("Inspect the unresolved operation", "blocked", "log-unresolved", [
    failed,
  ]);
const routine = (row: number, cursor?: number) =>
  window(
    "Inspect routine activity after the assigned cursor",
    "ready",
    "log-routine",
    [row],
    { cursor: cursor ?? null },
  );
const empty = (cursor: number) =>
  window(
    "Look for entries strictly after this sequence",
    "inconclusive",
    "log-no-observations",
    [],
    { cursor },
  );
const previous = () =>
  window(
    "Check the saved cursor from a previous server boot",
    "inconclusive",
    "log-boot-changed",
    [],
    { oldBoot: true },
  );

function audit(id: string, goal: string, lines: string[], windows: Window[]) {
  return { id, goal, lines, windows };
}

export const managedLogAuditWorlds = [
  audit(
    "indexing-recovery",
    "Review the indexing interruption and explain whether there is anything after the recovery receipt.",
    [
      "Index rebuild ticket alpha failed while saving the index.",
      "Index rebuild ticket alpha recovered and completed successfully.",
    ],
    [recovered(0, 1), empty(1)],
  ),
  audit(
    "heartbeat-is-not-recovery",
    "An importer failed. Check whether the regular health line establishes recovery, then check just the recent activity.",
    [
      "Import ticket blue failed: the input was unavailable.",
      "Routine health heartbeat for the workspace completed normally.",
    ],
    [unresolved(0), routine(1, 0)],
  ),
  audit(
    "different-operation-recovered",
    "Trace the failed thumbnail rebuild and disambiguate it from a different job's later recovery.",
    [
      "Thumbnail rebuild ticket pine failed: input unavailable.",
      "Export retry ticket fir recovered successfully.",
    ],
    [unresolved(0)],
  ),
  audit(
    "recovery-precedes-failure",
    "The timeline has a successful compaction followed by a new failure. Determine whether the later failure is resolved.",
    [
      "Compaction ticket c recovered and completed successfully.",
      "Compaction ticket c failed again: a new write could not start.",
    ],
    [
      unresolved(1),
      {
        ...unresolved(1),
        title: "Read only after the earlier recovery",
        cursor: 0,
      },
    ],
  ),
  audit(
    "cursor-excludes-failure",
    "Tell the operator what the full refresh incident proves, then what the recovery-only window can establish by itself.",
    [
      "Search refresh ticket violet failed: the new index was missing.",
      "Search refresh ticket violet recovered and published its index successfully.",
    ],
    [recovered(0, 1), routine(1, 0)],
  ),
  audit(
    "stale-boot-cursor",
    "Decide whether a cursor from a previous server boot can support a claim about the current build, then inspect the current boot.",
    ["Routine build check completed normally with no changes."],
    [previous(), routine(0)],
  ),
  audit(
    "wrong-subsystem",
    "A handoff attributes the invoice import failure to a different subsystem. Check that subsystem first and then the worker log.",
    ["Invoice import ticket amber failed: the fixture reader was unavailable."],
    [
      window(
        "Check the requested subsystem",
        "inconclusive",
        "log-no-observations",
        [],
        { tag: missingTag },
      ),
      unresolved(0),
    ],
  ),
  audit(
    "no-new-entries",
    "The operator already saw the failure and its recovery. Check for new records after the recovery, then summarize the known recovery.",
    [
      "Preview generation ticket rose failed: render input unavailable.",
      "Preview generation ticket rose recovered and served its result successfully.",
    ],
    [empty(1), recovered(0, 1)],
  ),
  audit(
    "warning-after-restart",
    "Check the old incident bookmark before evaluating the actual warning from the current host.",
    ["Background cache flush ticket gray failed before saving its manifest."],
    [previous(), unresolved(0)],
  ),
  audit(
    "routine-before-failure",
    "Distinguish the initial routine log from the later failure. Report the issue using the full window and the cursor from the routine entry.",
    [
      "Routine workspace snapshot reached its scheduled checkpoint.",
      "Snapshot verification ticket teal failed: a required read did not finish.",
    ],
    [
      unresolved(1),
      {
        ...unresolved(1),
        title: "Review only after the checkpoint",
        cursor: 0,
      },
    ],
  ),
  audit(
    "recovery-across-progress",
    "Verify whether the publication mirror finished recovery across an intermediate progress line.",
    [
      "Mirror sync ticket delta failed to obtain its source.",
      "Routine heartbeat: another batch is in progress.",
      "Mirror sync ticket delta recovered and committed the new head successfully.",
    ],
    [recovered(0, 2), routine(2, 1)],
  ),
  audit(
    "two-empty-windows",
    "Verify that a missing subsystem and a fully consumed cursor provide no evidence of a new incident.",
    ["Routine cache monitor checkpoint completed."],
    [
      window(
        "Check the empty subsystem",
        "inconclusive",
        "log-no-observations",
        [],
        { tag: missingTag },
      ),
      empty(0),
    ],
  ),
];
