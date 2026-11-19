type Marker = [id: string, ...values: string[]];
type Log = { level: "error" | "warning" | "info"; message: string };
type Frame = { markers: Marker[]; logs: Log[] };
type Health = "healthy" | "attention" | "inconclusive";
type Outcome = Health | "recovered";
type Expected = {
  state: Health;
  markers?: string[];
  errors?: string[];
  identity?: boolean;
};

const frame = (markers: Marker[], ...logs: Log[]): Frame => ({ markers, logs });
const error = (message: string): Log => ({ level: "error", message });
const warning = (message: string): Log => ({ level: "warning", message });
const info = (message: string): Log => ({ level: "info", message });
const healthy: Expected = { state: "healthy" };
const attention = (markers: string[], errors: string[] = []): Expected => ({
  state: "attention",
  markers,
  errors,
});
const read = (
  id: string,
  goal: string,
  markers: Marker[],
  initial: Frame,
  expected: Expected,
  allowedErrors: string[] = [],
) => ({
  id,
  goal,
  markers,
  allowedErrors,
  initial,
  later: null as Frame | null,
  expected: {
    initial: expected,
    later: null as Expected | null,
    outcome: expected.state as Outcome,
  },
});
const observeChange = (
  start: ReturnType<typeof read>,
  later: Frame,
  expected: Expected,
  outcome: Outcome,
) => ({
  ...start,
  later,
  expected: { ...start.expected, later: expected, outcome },
});

export const managedPanelHealthWorlds = [
  read(
    "settled-intake-status",
    "Verify the intake panel's two settled indicators.",
    [
      ["status", "Ready"],
      ["batch", "Batch 17"],
    ],
    frame(
      [
        ["status", "Ready"],
        ["batch", "Batch 17"],
      ],
      info("panel-health: intake cache synced"),
    ),
    healthy,
  ),
  read(
    "empty-settled-list",
    "Verify a completed panel with an explicitly empty work queue.",
    [["status", "Queue empty"]],
    frame([["status", "Queue empty"]]),
    healthy,
  ),
  read(
    "ordered-list-proof",
    "Check the exact processing order in the live handoff panel.",
    [["stops", "Review", "Signoff", "Archive"]],
    frame([["stops", "Review", "Signoff", "Archive"]]),
    healthy,
  ),
  read(
    "unrelated-label-is-outside-view",
    "Verify the assigned Release indicator while ignoring unrelated additional panels.",
    [["release", "Staged"]],
    frame([
      ["release", "Staged"],
      ["sidebar", "History hidden"],
    ]),
    healthy,
  ),
  read(
    "known-baseline-diagnostic",
    "Accept the explicitly known preview-only diagnostic and verify the live count still renders.",
    [["count", "12"]],
    frame(
      [["count", "12"]],
      error("panel-health: optional demo asset unavailable"),
    ),
    healthy,
    ["panel-health: optional demo asset unavailable"],
  ),
  read(
    "error-prefix-is-not-exemption",
    "Check the signed build indicator and apply the console allowance only to its exact message.",
    [["build", "Signed"]],
    frame([["build", "Signed"]], error("panel-health: optional asset")),
    attention([], ["panel-health: optional asset"]),
    ["panel-health: optional asset unavailable"],
  ),
  read(
    "warnings-and-info",
    "Verify that the ready indicator remains healthy with an informational trace and a timing warning.",
    [["ready", "Import ready"]],
    frame(
      [["ready", "Import ready"]],
      warning("panel-health: response slow"),
      info("panel-health: buffered upload"),
    ),
    healthy,
  ),
  read(
    "visible-stage-lags-store",
    "Require the expected Published state in the live preview.",
    [["status", "Published"]],
    frame([["status", "Draft"]]),
    attention(["status"]),
  ),
  read(
    "required-marker-missing",
    "Require both the visible heading and the signed authority line.",
    [
      ["heading", "Shift brief"],
      ["authority", "Approved"],
    ],
    frame([["heading", "Shift brief"]]),
    attention(["authority"]),
  ),
  read(
    "wrong-list-cardinality",
    "Require exactly two active depots in the retained display.",
    [["depots", "East", "West"]],
    frame([["depots", "East", "West", "South"]]),
    attention(["depots"]),
  ),
  read(
    "wrong-list-order",
    "Check the written release order against the rendered list.",
    [["release-order", "Pack", "Sign", "Send"]],
    frame([["release-order", "Sign", "Pack", "Send"]]),
    attention(["release-order"]),
  ),
  read(
    "ready-display-with-runtime-error",
    "Identify the unapproved browser error even when the live count looks correct.",
    [["count", "8 available"]],
    frame([["count", "8 available"]], error("panel-health: lookup failed")),
    attention([], ["panel-health: lookup failed"]),
  ),
  read(
    "multiple-independent-blockers",
    "Report any disagreement in the panel state and every new unapproved error in order.",
    [
      ["title", "Production"],
      ["state", "Reviewed"],
    ],
    frame(
      [
        ["title", "Preview"],
        ["state", "Pending"],
      ],
      error("panel-health: checksum refused"),
      error("panel-health: status transport refused"),
    ),
    attention(
      ["title", "state"],
      [
        "panel-health: checksum refused",
        "panel-health: status transport refused",
      ],
    ),
  ),
  observeChange(
    read(
      "loading-to-ready",
      "Confirm the visible job list recovers when its labels finish loading.",
      [["jobs", "Alpha", "Beta"]],
      frame([["jobs", "Loading"]]),
      attention(["jobs"]),
    ),
    frame(
      [["jobs", "Alpha", "Beta"]],
      info("panel-health: hydration completed"),
    ),
    healthy,
    "recovered",
  ),
  observeChange(
    read(
      "recovery-after-render-error",
      "Verify live recovery after the view was incomplete and the renderer logged its boot error.",
      [["summary", "Ready for review"]],
      frame(
        [["summary", "Unavailable"]],
        error("panel-health: initial transform failed"),
      ),
      attention(["summary"], ["panel-health: initial transform failed"]),
    ),
    frame(
      [["summary", "Ready for review"]],
      info("panel-health: new review committed"),
    ),
    healthy,
    "recovered",
  ),
  observeChange(
    read(
      "ready-view-still-emits-error",
      "Check whether the repaired labels arrived without a fresh browser fault.",
      [["status", "Ready"]],
      frame([["status", "Settling"]]),
      attention(["status"]),
    ),
    frame([["status", "Ready"]], error("panel-health: fresh route failure")),
    attention([], ["panel-health: fresh route failure"]),
    "attention",
  ),
  observeChange(
    read(
      "healthy-to-drift",
      "Verify the new state retains the expected label after a live refresh.",
      [["phase", "Confirmed"]],
      frame([["phase", "Confirmed"]]),
      healthy,
    ),
    frame([["phase", "Unknown"]]),
    attention(["phase"]),
    "attention",
  ),
  observeChange(
    read(
      "correct-labels-fresh-error",
      "Check the later panel for fresh errors even though both views show the same rendered value.",
      [["value", "9"]],
      frame([["value", "9"]], info("panel-health: initial read settled")),
      healthy,
    ),
    frame([["value", "9"]], error("panel-health: late sync failed")),
    attention([], ["panel-health: late sync failed"]),
    "attention",
  ),
  observeChange(
    read(
      "no-new-evidence",
      "Require a new observation before confirming that the visible snapshot is still current.",
      [["phase", "Ready"]],
      frame([["phase", "Ready"]]),
      healthy,
    ),
    frame([["phase", "Ready"]]),
    { state: "inconclusive", identity: true },
    "inconclusive",
  ),
  observeChange(
    read(
      "diagnostics-advance-with-same-label",
      "Recognize the new renderer evidence while preserving the unchanged displayed value.",
      [["phase", "Ready"]],
      frame([["phase", "Ready"]]),
      healthy,
    ),
    frame([["phase", "Ready"]], info("panel-health: preview rechecked")),
    healthy,
    "healthy",
  ),
  observeChange(
    read(
      "partially-corrected-panel",
      "Require every designated value before calling the refreshed dashboard recovered.",
      [
        ["phase", "Ready"],
        ["count", "19"],
      ],
      frame([
        ["phase", "Preparing"],
        ["count", "Unknown"],
      ]),
      attention(["phase", "count"]),
    ),
    frame([
      ["phase", "Ready"],
      ["count", "Unknown"],
    ]),
    attention(["count"]),
    "attention",
  ),
  observeChange(
    read(
      "allowlisted-noise-during-recovery",
      "Confirm the active viewport after refresh and honor the exact approved diagnostic.",
      [["selected", "North depot"]],
      frame([["selected", "No selection"]]),
      attention(["selected"]),
      ["panel-health: offline preview sample"],
    ),
    frame(
      [["selected", "North depot"]],
      error("panel-health: offline preview sample"),
    ),
    healthy,
    "recovered",
  ),
];
