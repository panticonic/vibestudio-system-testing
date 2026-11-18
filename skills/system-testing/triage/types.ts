/**
 * The part of one failed test's diagnostic that triage reads. `systemTests.inspect(runnerTargetId, runId, testName)`
 * returns it for one test; a whole run's packet lists them under `diagnostics.failures`. Fields not listed are ignored.
 */
export type Failure = {
  name: string;
  /** What the validator said was missing or wrong. */
  validationReason: string | null;
  /** The error the session itself ended with. */
  sessionError: string | null;
  /** The primary structured failure: the phase it happened in and the error. */
  failure: {
    phase: string;
    error: { name: string; message: string; code?: string };
  } | null;
  /** Present when the validator itself threw; `validator` says whose validator. */
  validationFailure: { validator: "harness" | "agent-outcome" } | null;
  /** The agent's last message to the user. */
  finalAgentMessage: string | null;
  invocations: {
    name: string;
    status: string;
    terminalOutcome?: string;
    terminalReasonCode?: string;
    error?: string;
    isError?: boolean;
  }[];
  /** Failed tool invocations the scenario did not declare. */
  toolFailures: {
    name: string;
    terminalReasonCode?: string;
    /** user-code: the agent's own code failed; infrastructure: the platform failed; cancelled. */
    failureKind?: "user-code" | "infrastructure" | "cancelled";
    classification?:
      | "argument-rejection"
      | "domain-rejection"
      | "guest-code-failure";
    failureCode?: string;
    error?: string;
  }[];
  cleanupErrors: string[];
  cleanupFailures: {
    phase: string;
    error: { name: string; message: string };
  }[];
  /** Delivery-latency violations of the run, when it recorded any. */
  channelDeliveryLatency: { violations: string[] } | null;
  /** The fixture's repository-delivery assessment. */
  workspaceRepoFixture: { creationScopeError: string | null } | null;
  /** Evidence the scenario recorded for itself. */
  orchestration: Record<string, string> | null;
  /** A heuristic label the diagnostics assign from the same fields. */
  likelyIssue: string;
};

/** The run-level packet `inspect` returns without a test name. */
export type RunPacket = {
  runId: string;
  failedTests: string[];
  diagnostics?: { failures: Failure[] };
};

export type FailureClass =
  | "infrastructure"
  | "documentation"
  | "harness"
  | "validator";

/** Where in the failure record a signal was read. */
export type SignalSource =
  | "validator-error"
  | "validation"
  | "phase"
  | "session-error"
  | "tool-failure"
  | "incomplete-invocation"
  | "cleanup"
  | "fixture"
  | "latency"
  | "orchestration"
  | "heuristic"
  | "final-message";

/** One fact read from the failure record, redacted and bounded. */
export type Signal = {
  source: SignalSource;
  text: string;
};

export type Triage = {
  class: FailureClass;
  /** The signals that support the class, most decisive first, quoted from the record. */
  evidence: Signal[];
};

export type TestPacketInput = {
  kind: "run";
  goal: string;
  attemptId: string;
  readiness: "ready" | "failed" | "pending";
  terminal: "pending" | "passed" | "failed" | "cancelled" | "timed-out";
  cleanup: "released" | "outstanding" | "unknown";
  retained: "summary" | "full" | "missing";
  failure: Failure | null;
};
export type TestAuthorInput = {
  kind: "scenario";
  goal: string;
  fixture: "isolated" | "shared" | "missing";
  resourcesOwned: boolean;
  prompt: "user-goal" | "leaks-api" | "leaks-oracle";
  proof: "effect" | "dispatch-only" | "prose-only" | "unjoined-receipt";
  liveData: boolean;
  explicitOnly: boolean;
};
export type TestMobileInput = {
  kind: "mobile";
  goal: string;
  currentWorkspace: string;
  toolingWorkspace: string | null;
  attachedDriver: "paired" | "absent" | "stale";
  deviceRequested: boolean;
  foreground: boolean;
  unitReady: boolean;
  observedPostcondition: boolean;
};
export type TestReviewRequest =
  | { kind: "triage"; goal: string; failure: Failure }
  | {
      kind: "read-run";
      goal: string;
      target: string;
      runId: string;
      testName: string;
    }
  | TestPacketInput
  | TestAuthorInput
  | TestMobileInput;
export type RunReview = {
  kind: "run";
  next:
    | "resolve-infrastructure"
    | "wait-owned-run"
    | "join-cleanup"
    | "obtain-failure-packet"
    | "triage-retained"
    | "verified";
  basis: string;
};
export type TestReviewReport =
  | { kind: "triage"; class: FailureClass; evidence: Signal[] }
  | { kind: "read-run"; runId: string; retained: boolean }
  | RunReview
  | { kind: "scenario"; ready: boolean; blockers: string[] }
  | {
      kind: "mobile";
      next:
        | "open-tooling-workspace"
        | "build-unit"
        | "attach-driver"
        | "foreground-only"
        | "exercise-postcondition"
        | "verified";
      basis: string | null;
    };
