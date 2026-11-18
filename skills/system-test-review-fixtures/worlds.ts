import type {
  TestAuthorInput,
  TestMobileInput,
  TestPacketInput,
  TestReviewReport,
  TestReviewRequest,
} from "../system-testing/triage/types.js";

function task(
  id: string,
  family: string,
  request: TestReviewRequest,
  expected: TestReviewReport,
) {
  return {
    id: `test-review-${id}`,
    sourceGroup: `vibestudio:system-testing:${family}`,
    request,
    expected,
  };
}
function run(
  id: string,
  goal: string,
  patch: Partial<TestPacketInput>,
  next: Extract<TestReviewReport, { kind: "run" }>["next"],
) {
  const request: TestPacketInput = {
    kind: "run",
    goal,
    attemptId: `run-${id}`,
    readiness: "ready",
    terminal: "passed",
    cleanup: "released",
    retained: "summary",
    failure: null,
    ...patch,
  };
  return task(id, "owned-run", request, {
    kind: "run",
    next,
    basis: request.attemptId,
  });
}
function design(
  id: string,
  goal: string,
  patch: Partial<TestAuthorInput>,
  blockers: string[],
) {
  const request: TestAuthorInput = {
    kind: "scenario",
    goal,
    fixture: "isolated",
    resourcesOwned: true,
    prompt: "user-goal",
    proof: "effect",
    liveData: false,
    explicitOnly: false,
    ...patch,
  };
  return task(id, "scenario-authoring", request, {
    kind: "scenario",
    ready: blockers.length === 0,
    blockers,
  });
}
function mobile(
  id: string,
  goal: string,
  patch: Partial<TestMobileInput>,
  next: Extract<TestReviewReport, { kind: "mobile" }>["next"],
) {
  const request: TestMobileInput = {
    kind: "mobile",
    goal,
    currentWorkspace: "android-lab",
    toolingWorkspace: "android-lab",
    attachedDriver: "paired",
    deviceRequested: true,
    foreground: true,
    unitReady: true,
    observedPostcondition: true,
    ...patch,
  };
  return task(id, "mobile-admission", request, {
    kind: "mobile",
    next,
    basis: request.toolingWorkspace,
  });
}

export const systemTestReviewWorlds = [
  run(
    "failed-doctor-cannot-score",
    "Investigate the source installation fault printed before any case started.",
    {
      readiness: "failed",
      terminal: "failed",
      cleanup: "unknown",
      retained: "missing",
    },
    "resolve-infrastructure",
  ),
  run(
    "bootstrap-still-running",
    "Check if the currently starting owned instance has a result ready yet.",
    {
      readiness: "pending",
      terminal: "pending",
      cleanup: "unknown",
      retained: "missing",
    },
    "wait-owned-run",
  ),
  run(
    "detached-test-unresolved",
    "The instance is reachable and the long run is still operating. Report what the evidence supports.",
    { terminal: "pending" },
    "wait-owned-run",
  ),
  run(
    "green-but-workers-left",
    "The scenario passed its outward checks, but the run still holds a device driver. Is the final result ready?",
    { cleanup: "outstanding" },
    "join-cleanup",
  ),
  run(
    "cancelled-cleanup-unknown",
    "The consumed run was cancelled, and its cleanup proof is missing. Determine what must be inspected first.",
    { terminal: "cancelled", cleanup: "unknown" },
    "join-cleanup",
  ),
  run(
    "timed-out-without-packet",
    "The run ended at the time limit and all leases were joined. How can we recover the failure evidence?",
    { terminal: "timed-out", retained: "missing" },
    "obtain-failure-packet",
  ),
  run(
    "verified-owned-result",
    "Confirm the completed isolated scenario is ready to report after checking release evidence.",
    {},
    "verified",
  ),
  design(
    "shared-data-dependency",
    "Review a local scenario that changes an existing shared output repository during the run.",
    { fixture: "shared", resourcesOwned: false },
    ["fixture", "ownership"],
  ),
  design(
    "prompt-contains-verifier-token",
    "Assess an authored prompt that tells the agent the exact receipt it must put in a response.",
    { prompt: "leaks-oracle" },
    ["prompt"],
  ),
  design(
    "prompt-sequence-reveals-method",
    "Assess a scenario that lists ordered remote methods instead of the user-level goal.",
    { prompt: "leaks-api" },
    ["prompt"],
  ),
  design(
    "dispatch-without-effect",
    "The validator checks a sent click, but no application state changed in the observation. Is it ready?",
    { proof: "dispatch-only" },
    ["evidence"],
  ),
  design(
    "result-prose-gate-is-insufficient",
    "Assess a workflow whose only pass condition is the last message containing the word completed.",
    { proof: "prose-only" },
    ["evidence"],
  ),
  design(
    "cross-generation-order-unproved",
    "The observed effects came from different Eval owner generations. Should the validator infer global ordering?",
    { proof: "unjoined-receipt" },
    ["evidence"],
  ),
  design(
    "live-data-not-default",
    "Assess a migration case that reads existing account data and currently runs in every default scenario selection.",
    { liveData: true },
    ["explicit-only"],
  ),
  design(
    "live-data-named-only",
    "The explicitly selected case uses approved live data. Review the source ownership and actual output check.",
    { liveData: true, explicitOnly: true },
    [],
  ),
  design(
    "all-scoped-state",
    "Review a user-level automated test with an isolated fixture and an independently observed effect.",
    {},
    [],
  ),
  mobile(
    "other-workspace-not-installed",
    "I launched a test from the general workspace but the Android tooling lives in a different one.",
    { currentWorkspace: "personal" },
    "open-tooling-workspace",
  ),
  mobile(
    "missing-tooling-owner",
    "Find the prerequisite for the handset test where no mobile workspace has been configured.",
    { toolingWorkspace: null, attachedDriver: "absent" },
    "open-tooling-workspace",
  ),
  mobile(
    "tooling-unit-not-built",
    "The Android workspace exists, but its test capability has no built owner. What should happen first?",
    { unitReady: false },
    "build-unit",
  ),
  mobile(
    "requested-device-absent",
    "Review the exact handset UI scenario whose driver has not yet been attached.",
    { attachedDriver: "absent" },
    "attach-driver",
  ),
  mobile(
    "requested-device-stale",
    "Evaluate the stale driver record for a re-paired phone before interpreting the panel failure.",
    { attachedDriver: "stale" },
    "attach-driver",
  ),
  mobile(
    "device-cannot-detach",
    "Is a detached mobile run appropriate while the launcher must own the attached handset driver?",
    { foreground: false },
    "foreground-only",
  ),
  mobile(
    "successful-tap-no-visible-effect",
    "Review a mounted Android UI test that dispatched the action without observing the expected result.",
    { observedPostcondition: false },
    "exercise-postcondition",
  ),
  mobile(
    "mobile-service-no-device",
    "The test exercises a server-only Android extension capability. Check its observed result without requiring a test phone.",
    { deviceRequested: false, attachedDriver: "absent", foreground: false },
    "verified",
  ),
  mobile(
    "verified-device-effect",
    "Confirm readiness from the dedicated Android workspace, fresh driver and actual postcondition.",
    {},
    "verified",
  ),
];
export type TestReviewWorld = (typeof systemTestReviewWorlds)[number];
