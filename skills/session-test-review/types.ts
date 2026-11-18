export type Seed = {
  kind: "seed";
  receipt: string;
  runtimeSelf: string;
  participant: string;
  requestedContext: string;
  agentContext: string;
  behavior: "creation-state" | "subscription-only";
  durableChannel: string | null;
};
export type Continuation = {
  kind: "continuation";
  receipt: string;
  originalChannel: string;
  replayChannel: string;
  originalKey: string;
  retryKey: string;
  originalMessage: string;
  replayedMessages: string[];
  retryMessage: string | null;
};
export type Runtime = "native" | "browser" | "workerd";
export type Dispatch = {
  kind: "dispatch";
  receipt: string;
  declaredRuntime: Runtime | null;
  adapterRuntime: Runtime;
  entry: "verify" | "direct-adapter";
  nativeAdmissionRequested: boolean;
};
export type VerifyResult = {
  kind: "result";
  target: string;
  suite: string;
  runtime: Runtime;
  context: string;
  revision: string;
  receipt: null | {
    id: string;
    operation: "build" | "test";
    target: string;
    suite: string;
    runtime: Runtime;
    contextId: string;
    ref: string;
    stateHash: string;
    status: string;
  };
};
export type SessionRelease = {
  kind: "session-close";
  receipt: string;
  ownsContext: boolean;
  detached: boolean;
  phase:
    | "unsubscribing-agent"
    | "disconnecting-client"
    | "destroying-agent-context"
    | "retiring-agent"
    | "complete";
  completedAt: number | null;
  terminals: ("unsubscribe" | "retire-agent" | "destroy-context")[];
  errors: string[];
};
export type TestkitRelease = {
  kind: "testkit";
  receipt: string;
  // Resources in the order their release was registered with defer.
  resources: {
    id: string;
    kind: "panel" | "page-client" | "worker" | "supervisor" | "scratch";
  }[];
  released: {
    id: string;
    kind: "panel" | "page-client" | "worker" | "supervisor" | "scratch";
    acknowledgement: "released" | "failed";
  }[];
};
export type SessionReviewRequest =
  | { kind: "session"; goal: string; evidence: Seed | Continuation }
  | { kind: "verification"; goal: string; evidence: Dispatch | VerifyResult }
  | {
      kind: "release";
      goal: string;
      evidence: SessionRelease | TestkitRelease;
    };
export type SessionReview = {
  decision: "confirmed" | "waiting" | "revise" | "unobserved";
  finding: string;
  evidenceIds: string[];
};
