import type {
  Continuation,
  Dispatch,
  Seed,
  SessionRelease,
  SessionReview,
  SessionReviewRequest,
  TestkitRelease,
  VerifyResult,
} from "../session-test-review/types.ts";

export type SessionTestReviewWorld = {
  id: string;
  sourceGroup: string;
  request: SessionReviewRequest;
  expected: SessionReview;
};

type Finding = [SessionReview["decision"], string];

function outcome(
  id: string,
  goal: string,
  request: SessionReviewRequest,
  finding: Finding,
  receipt: string | null,
  family: string,
): SessionTestReviewWorld {
  return {
    id,
    sourceGroup: `vibestudio:system-testing:${family}`,
    request: { ...request, goal },
    expected: {
      decision: finding[0],
      finding: finding[1],
      evidenceIds: receipt ? [receipt] : [],
    },
  };
}

const seedEvidence: Seed = {
  kind: "seed",
  receipt: "session-seed",
  runtimeSelf: "runner-runtime",
  participant: "runner-runtime",
  requestedContext: "episode",
  agentContext: "episode",
  behavior: "creation-state",
  durableChannel: "episode-channel",
};
function seed(
  id: string,
  goal: string,
  overrides: Partial<Seed>,
  finding: Finding,
) {
  const evidence = { ...seedEvidence, ...overrides, receipt: `${id}-record` };
  return outcome(
    id,
    goal,
    { kind: "session", goal, evidence },
    finding,
    evidence.receipt,
    "headless-session-seed",
  );
}

const replayEvidence: Continuation = {
  kind: "continuation",
  receipt: "session-replay",
  originalChannel: "episode-channel",
  replayChannel: "episode-channel",
  originalKey: "step-3",
  retryKey: "step-3",
  originalMessage: "message-3",
  replayedMessages: ["message-1", "message-2", "message-3"],
  retryMessage: "message-3",
};
function replay(
  id: string,
  goal: string,
  overrides: Partial<Continuation>,
  finding: Finding,
) {
  const evidence = { ...replayEvidence, ...overrides, receipt: `${id}-record` };
  return outcome(
    id,
    goal,
    { kind: "session", goal, evidence },
    finding,
    evidence.receipt,
    "headless-session-continuation",
  );
}

function dispatch(
  id: string,
  goal: string,
  overrides: Partial<Dispatch>,
  finding: Finding,
) {
  const evidence: Dispatch = {
    kind: "dispatch",
    receipt: `${id}-record`,
    declaredRuntime: "native",
    adapterRuntime: "native",
    entry: "verify",
    nativeAdmissionRequested: true,
    ...overrides,
  };
  return outcome(
    id,
    goal,
    { kind: "verification", goal, evidence },
    finding,
    evidence.receipt,
    "declared-suite-dispatch",
  );
}

const suiteEvidence: VerifyResult = {
  kind: "result",
  target: "packages/agentic-session",
  suite: "headless",
  runtime: "workerd",
  context: "session-review",
  revision: "source-b",
  receipt: {
    id: "session-suite",
    operation: "test",
    target: "packages/agentic-session",
    suite: "headless",
    runtime: "workerd",
    contextId: "session-review",
    ref: "ctx:session-review",
    stateHash: "source-b",
    status: "passed",
  },
};
function result(
  id: string,
  goal: string,
  receipt: VerifyResult["receipt"],
  finding: Finding,
) {
  return outcome(
    id,
    goal,
    { kind: "verification", goal, evidence: { ...suiteEvidence, receipt } },
    finding,
    receipt?.id ?? null,
    "exact-suite-receipt",
  );
}
const suiteReceipt = suiteEvidence.receipt!;

const sessionClose: SessionRelease = {
  kind: "session-close",
  receipt: "session-release",
  ownsContext: false,
  detached: false,
  phase: "complete",
  completedAt: 125,
  terminals: ["unsubscribe", "retire-agent"],
  errors: [],
};
function close(
  id: string,
  goal: string,
  overrides: Partial<SessionRelease>,
  finding: Finding,
) {
  const evidence = { ...sessionClose, ...overrides, receipt: `${id}-record` };
  return outcome(
    id,
    goal,
    { kind: "release", goal, evidence },
    finding,
    evidence.receipt,
    "headless-session-close",
  );
}

const resources = [
  { id: "owned-panel", kind: "panel" },
  { id: "owned-page-client", kind: "page-client" },
  { id: "owned-worker", kind: "worker" },
  { id: "owned-supervisor", kind: "supervisor" },
  { id: "owned-scratch", kind: "scratch" },
] satisfies TestkitRelease["resources"];
const releases = [...resources]
  .reverse()
  .map((resource) => ({ ...resource, acknowledgement: "released" as const }));
function testkit(
  id: string,
  goal: string,
  released: TestkitRelease["released"],
  finding: Finding,
) {
  const evidence: TestkitRelease = {
    kind: "testkit",
    receipt: `${id}-record`,
    resources,
    released,
  };
  return outcome(
    id,
    goal,
    { kind: "release", goal, evidence },
    finding,
    evidence.receipt,
    "testkit-owned-release",
  );
}

export const sessionTestReviewWorlds: SessionTestReviewWorld[] = [
  seed(
    "exact-session-seed",
    "Check a worker's seeded headless session from its creation and channel records.",
    {},
    ["confirmed", "headless-seed-verified"],
  ),
  seed(
    "subscriber-id-is-display-label",
    "Check the caller identity when the worker subscribed under a display label.",
    { participant: "Documentation runner" },
    ["revise", "participant-scope"],
  ),
  seed(
    "behavior-only-in-channel",
    "Check whether the headless launch persisted behavior across later subscriptions.",
    { behavior: "subscription-only" },
    ["revise", "behavior-not-seeded"],
  ),
  seed(
    "neighbor-agent-context",
    "Check which context contains the new agent when its durable channel belongs to the requested test.",
    { agentContext: "session-preview" },
    ["revise", "seed-context"],
  ),
  replay(
    "stable-retry-message",
    "Verify the interrupted prompt resumed with a single durable message identity after channel replay.",
    {},
    ["confirmed", "continuation-stable"],
  ),
  replay(
    "retry-rekeyed-on-reconnect",
    "Check whether the reconnect preserved the pending send identity.",
    { retryKey: "step-3-new-connection" },
    ["revise", "retry-key-changed"],
  ),
  replay(
    "neighbor-channel-replayed",
    "Check whether a replay from the sibling episode can confirm the original prompt.",
    { replayChannel: "preview-episode-channel" },
    ["unobserved", "replay-channel-mismatch"],
  ),
  replay(
    "retry-created-second-message",
    "Check whether a repeated send generated a second message despite carrying the original key.",
    {
      retryMessage: "message-4",
      replayedMessages: ["message-1", "message-2", "message-3", "message-4"],
    },
    ["revise", "duplicate-message"],
  ),
  replay(
    "pending-retry-acknowledgement",
    "Check the resume evidence after finding the original prompt and before receiving the retry terminal.",
    { retryMessage: null },
    ["waiting", "retry-terminal-unobserved"],
  ),
  dispatch(
    "native-suite-explicitly-dispatched",
    "Review the declared native suite routed from verify with its admission request.",
    {},
    ["confirmed", "verify-dispatch-scoped"],
  ),
  dispatch(
    "direct-native-adapter-entry",
    "Check the proposed test run that calls the adapter directly instead of routing the declared suite.",
    { entry: "direct-adapter" },
    ["revise", "verify-entry-required"],
  ),
  dispatch(
    "browser-build-failure-falls-through",
    "Read the dispatch after a browser build failure was routed to the native adapter.",
    { declaredRuntime: "browser" },
    ["revise", "runtime-route-mismatch"],
  ),
  dispatch(
    "workerd-native-admission-requested",
    "Check the requested approval for a suite that declares and uses workerd.",
    { declaredRuntime: "workerd", adapterRuntime: "workerd" },
    ["revise", "runtime-admission-mismatch"],
  ),
  result(
    "successful-exact-suite",
    "Check the scoped terminal for the focused headless suite build state.",
    suiteReceipt,
    ["confirmed", "suite-passed"],
  ),
  result(
    "previous-state-success-receipt",
    "Check whether the preceding semantic state's passing suite covers the current revision.",
    { ...suiteReceipt, id: "previous-session-suite", stateHash: "source-a" },
    ["unobserved", "verify-receipt-mismatch"],
  ),
  result(
    "exact-suite-found-no-tests",
    "Review the exact focused suite whose filter found no tests.",
    { ...suiteReceipt, id: "empty-session-suite", status: "no-tests" },
    ["revise", "suite-check-incomplete"],
  ),
  result(
    "verify-child-startup-failed",
    "Review the suite after an infrastructure error prevented a result.",
    {
      ...suiteReceipt,
      id: "infrastructure-session-suite",
      status: "infrastructure-error",
    },
    ["unobserved", "verify-infrastructure-unconfirmed"],
  ),
  close(
    "shared-context-agent-retired",
    "Check the acknowledged inherited-session shutdown while keeping the caller's context.",
    {},
    ["confirmed", "session-released"],
  ),
  close(
    "isolated-context-single-release",
    "Check the isolated headless session whose owned context recursively retired its descendants.",
    { ownsContext: true, terminals: ["unsubscribe", "destroy-context"] },
    ["confirmed", "session-released"],
  ),
  close(
    "detached-close-awaits-remote",
    "Check cleanup after a detached client returned while its remote unsubscribe was pending.",
    {
      detached: true,
      phase: "unsubscribing-agent",
      completedAt: null,
      terminals: [],
    },
    ["waiting", "detached-cleanup-pending"],
  ),
  close(
    "inherited-retire-started-too-soon",
    "Review the inherited-session receipt where agent retirement preceded unsubscribe.",
    { terminals: ["retire-agent", "unsubscribe"] },
    ["revise", "cleanup-owner-order"],
  ),
  close(
    "terminal-with-destroy-error",
    "Check a complete isolated teardown that recorded a failed context destroy.",
    {
      ownsContext: true,
      terminals: ["unsubscribe", "destroy-context"],
      errors: ["destroyHeadlessAgentContext"],
    },
    ["revise", "close-errors"],
  ),
  testkit(
    "case-defers-release-after-failure",
    "Review deferred release of all owned resources after an assertion failed.",
    releases,
    ["confirmed", "testkit-released"],
  ),
  testkit(
    "page-client-release-still-missing",
    "Check the test teardown while awaiting the CDP page client's close acknowledgement.",
    releases.filter((release) => release.kind !== "page-client"),
    ["waiting", "testkit-release-unobserved"],
  ),
  testkit(
    "worker-release-picked-foreign-runtime",
    "Check a test teardown that used a sibling worker instead of its owned runtime identity.",
    releases.map((release) =>
      release.kind === "worker"
        ? { ...release, id: "neighbor-worker" }
        : release,
    ),
    ["revise", "cleanup-foreign-resource"],
  ),
  testkit(
    "registered-order-used-for-release",
    "Review a test cleanup that released each resource in registration order.",
    [...releases].reverse(),
    ["revise", "testkit-release-order"],
  ),
];
