import type {
  CleanupInventory,
  TestkitOutcome,
  TestkitOwnedResource,
} from "../session-test-review/types.js";

type Phase = "before" | "body" | "after";
type Cleanup =
  | "defer"
  | "unregistered"
  | "nonrecursive"
  | "report-after-release";
type Resource = {
  slot: string;
  kind: TestkitOwnedResource["kind"];
  phase: Phase;
  cleanup: Cleanup;
};
type Stop = "pass" | "assert" | "throw" | "before" | "after" | "timeout";
const scratch = (
  slot: string,
  cleanup: Cleanup = "defer",
  phase: Phase = "body",
): Resource => ({ slot, kind: "scratch", phase, cleanup });
const worker = (
  slot: string,
  cleanup: Cleanup = "defer",
  phase: Phase = "body",
): Resource => ({ slot, kind: "worker", phase, cleanup });
const panel = (slot: string, phase: Phase = "body"): Resource => ({
  slot,
  kind: "panel",
  phase,
  cleanup: "defer",
});
const page = (slot: string, phase: Phase = "body"): Resource => ({
  slot,
  kind: "page-client",
  phase,
  cleanup: "defer",
});

const terminal: Record<Stop, TestkitOutcome> = {
  pass: "passed",
  assert: "failed",
  throw: "errored",
  before: "errored",
  after: "errored",
  timeout: "timeout",
};

function world(id: string, goal: string, stop: Stop, plan: Resource[]) {
  const registered = plan.filter(({ cleanup }) => cleanup !== "unregistered");
  const failed = registered
    .filter(({ cleanup }) => cleanup !== "defer")
    .map(({ slot }) => slot);
  const leftover = plan.filter(
    ({ cleanup }) => cleanup === "nonrecursive" || cleanup === "unregistered",
  );
  const hasRegistered = leftover.some(
    ({ cleanup }) => cleanup === "nonrecursive",
  );
  const hasUnregistered = leftover.some(
    ({ cleanup }) => cleanup === "unregistered",
  );
  const inventory: CleanupInventory = hasRegistered
    ? hasUnregistered
      ? "mixed-residue"
      : "registered-residue"
    : hasUnregistered
      ? "unregistered-residue"
      : "clear";
  return {
    id,
    goal,
    stop,
    plan,
    expected: {
      outcome: terminal[stop],
      release: failed.length ? "testkit-release-failed" : "testkit-released",
      inventory,
      failed,
      remaining: leftover.map(({ slot }) => slot),
    },
  };
}

export const managedTestkitCleanupWorlds = [
  world(
    "scratch-and-worker",
    "Verify the closeout order and remaining inventory for a passing test with an owned worker and scratch export.",
    "pass",
    [scratch("export"), worker("preview-worker")],
  ),
  world(
    "assertion-panel-page",
    "An assertion failed after opening an editor and a CDP client. Report the assertion outcome and whether both handles were released.",
    "assert",
    [panel("editor"), page("inspection-client"), scratch("receipt")],
  ),
  world(
    "exception-keeps-cleanup-active",
    "The body throws after allocating a staging area and a worker. Check the teardown and terminal result independently.",
    "throw",
    [scratch("staging"), worker("transform-worker"), scratch("worker-output")],
  ),
  world(
    "setup-throws-before-body",
    "Verify that resources registered by setup were cleaned after setup threw.",
    "before",
    [
      scratch("setup", "defer", "before"),
      worker("setup-worker", "defer", "before"),
    ],
  ),
  world(
    "after-hook-error",
    "Review resources added in teardown along with the result of an after hook that threw.",
    "after",
    [
      scratch("body-output"),
      worker("late-worker", "defer", "after"),
      scratch("after-output", "defer", "after"),
    ],
  ),
  world(
    "timeout-with-deferred-scratch",
    "Check that the timeout still results in reverse release of two scratch allocations.",
    "timeout",
    [scratch("checkpoint", "defer", "before"), scratch("new-output")],
  ),
  world(
    "nonrecursive-cleanup",
    "Identify the scratch directory still present after its callback attempted nonrecursive removal, even though the test body passed.",
    "pass",
    [scratch("full-directory", "nonrecursive"), worker("observer")],
  ),
  world(
    "error-after-actual-removal",
    "Distinguish a callback error after deleting a file tree from an actual leftover resource.",
    "pass",
    [
      scratch("deleted-before-error", "report-after-release"),
      scratch("second-directory"),
    ],
  ),
  world(
    "unregistered-body-directory",
    "Check the registered release trace and identify a separate scratch allocation that never entered the callback stack.",
    "pass",
    [
      scratch("unregistered-output", "unregistered"),
      scratch("registered-output"),
    ],
  ),
  world(
    "mixed-residue",
    "Identify both a failed registered removal and a different directory whose release was never registered.",
    "pass",
    [
      scratch("never-registered", "unregistered"),
      scratch("failed-remove", "nonrecursive"),
      worker("temporary-observer"),
    ],
  ),
  world(
    "first-cleanup-failure-does-not-stop-lifo",
    "Review whether Testkit still processed older callbacks after the last allocation's removal failed.",
    "throw",
    [
      worker("first-worker"),
      scratch("second-output"),
      scratch("last-output", "nonrecursive"),
    ],
  ),
  world(
    "two-failed-release-callbacks",
    "Check which callback errors correspond to a retained resource when one failure happened after an acknowledged removal.",
    "assert",
    [
      scratch("retained", "nonrecursive"),
      scratch("already-removed", "report-after-release"),
      worker("assertion-worker"),
    ],
  ),
  world(
    "two-panels-and-cdp-clients",
    "Verify LIFO release of two panels, their separate CDP clients and an allocated receipt.",
    "pass",
    [
      panel("source-editor"),
      page("source-read"),
      panel("destination-editor"),
      page("destination-read"),
      scratch("audit"),
    ],
  ),
  world(
    "cdp-before-panel-retirement",
    "Verify the browser client was closed before the panel it inspected after the test body threw.",
    "throw",
    [
      scratch("workspace-index"),
      panel("workspace-panel"),
      page("browser-reader"),
    ],
  ),
  world(
    "setup-panel-without-body",
    "Verify Testkit cleaned up the panel and client allocated by a setup hook that failed before the body ran.",
    "before",
    [
      panel("setup-panel", "before"),
      page("setup-client", "before"),
      scratch("setup-note", "defer", "before"),
    ],
  ),
  world(
    "after-hook-panel-and-worker",
    "Review a passing body followed by a failing after hook that allocated a panel and a worker.",
    "after",
    [
      scratch("body-note"),
      panel("late-panel", "after"),
      page("late-reader", "after"),
      worker("late-worker", "defer", "after"),
    ],
  ),
  world(
    "unregistered-worker",
    "Check whether the unregistered worker survived Testkit while the registered scratch output was removed.",
    "pass",
    [worker("unregistered-worker", "unregistered"), scratch("run-note")],
  ),
  world(
    "retirement-error-after-worker-gone",
    "The worker release callback failed after retiring its worker. Check the independent inventory and the cleanup acknowledgement.",
    "assert",
    [scratch("event-log"), worker("released-worker", "report-after-release")],
  ),
  world(
    "body-timeout-with-unregistered-item",
    "The test timed out with scratch state in two places. Check that only the registered one was removed.",
    "timeout",
    [
      scratch("registered-temp", "defer", "before"),
      scratch("untouched-temp", "unregistered"),
    ],
  ),
  world(
    "failed-setup-mixed-inventory",
    "Classify setup failure separately from its failed removal and its unregistered allocation.",
    "before",
    [
      scratch("setup-undisposed", "unregistered", "before"),
      scratch("setup-remove-failed", "nonrecursive", "before"),
    ],
  ),
  world(
    "panel-cdp-with-scratch-error",
    "Determine whether a scratch callback error prevented the earlier browser client and panel from closing.",
    "pass",
    [
      panel("records-panel"),
      page("record-reader"),
      scratch("temporary-records", "nonrecursive"),
    ],
  ),
  world(
    "late-cleanup-error-early-unregistered",
    "Check the after-hook failure, callback error after removal, and previously unregistered scratch allocation as distinct observations.",
    "after",
    [
      worker("body-worker"),
      scratch("unregistered-summary", "unregistered"),
      scratch("late-output", "report-after-release", "after"),
    ],
  ),
];

export const multiPhaseTestkitCleanupWorlds = [
  world(
    "after-hook-mixed-residue-across-phases",
    "The test completed its body, but the after hook threw. Review cleanup across setup, body and the after hook. Distinguish the two resources still present from the directory removed before its callback reported an error.",
    "after",
    [
      scratch("setup-evidence", "nonrecursive", "before"),
      worker("body-reader", "unregistered"),
      scratch("body-output"),
      scratch("after-audit", "report-after-release", "after"),
    ],
  ),
  world(
    "browser-setup-and-after-hook-residue",
    "An editor and its inspection client were opened in setup. The after hook threw after allocating scratch output. Check whether the browser resources were still closed and identify only the scratch output left behind.",
    "after",
    [
      panel("setup-editor", "before"),
      page("setup-inspection", "before"),
      scratch("body-output"),
      scratch("after-output", "nonrecursive", "after"),
    ],
  ),
];

managedTestkitCleanupWorlds.push(...multiPhaseTestkitCleanupWorlds);
