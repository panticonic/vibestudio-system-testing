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
export type TestkitResourceKind = "panel" | "page-client" | "worker" | "supervisor" | "scratch";
export type TestkitRelease = {
  kind: "testkit";
  receipt: string;
  // Resources in the order their release was registered with defer.
  resources: {
    id: string;
    kind: TestkitResourceKind;
  }[];
  released: {
    id: string;
    kind: TestkitResourceKind;
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

export type ReplayMessage = { id: string; text: string; senderId: string };
export type ReplayOperation = { key: string; text: string; messageId: string };
export type ReplayCheckpoint = {
  receipt: string;
  originalChannel: string;
  replayChannel: string;
  original: ReplayOperation;
  retry: ReplayOperation | null;
  originBefore: ReplayMessage[];
  before: ReplayMessage[];
  after: ReplayMessage[];
};
export type LiveReplayRequest = { goal: string; checkpoints: string[] };
export type ReplayDisposition =
  | "confirmed-retry"
  | "original-payload-kept"
  | "distinct-message"
  | "retry-pending"
  | "wrong-channel"
  | "inconsistent-replay";
export type LiveReplayFinding = {
  receipt: string;
  disposition: ReplayDisposition;
  originalId: string;
  retryId: string | null;
  retainedIds: string[];
};
export type LiveReplayReport = { findings: LiveReplayFinding[] };

export type TestkitOwnedResource = { id: string; kind: TestkitResourceKind };
export type TestkitOutcome = "passed" | "failed" | "errored" | "timeout";
export type CleanupInventory = "clear" | "registered-residue" | "unregistered-residue" | "mixed-residue";
export type LiveCleanupEvidence = {
  receipt: string;
  outcome: TestkitOutcome;
  error: string | null;
  logs: string[];
  acquired: TestkitOwnedResource[];
  release: TestkitRelease;
  remaining: TestkitOwnedResource[];
  protectedUnchanged: boolean;
};
export type LiveCleanupRequest = { goal: string; receipt: string };
export type LiveCleanupReport = {
  receipt: string;
  testOutcome: TestkitOutcome;
  release: SessionReview;
  inventory: CleanupInventory;
  remainingIds: string[];
};

export type TranscriptCursor = { channelId: string; seq: number };

export type TranscriptRow = {
  envelopeId: string;
  seq: number;
  messageId: string;
  role: "user" | "assistant";
  preview: string;
};

export type TranscriptPage = {
  after: number;
  through: number;
  nextAfter: number;
  envelopeCount: number;
  hasMore: boolean;
  messages: TranscriptRow[];
};

export type TranscriptStart = {
  channelId: string;
  saved: TranscriptCursor;
  maxPages: number;
  first: TranscriptPage | null;
};

export type TranscriptRequest = { goal: string; operationId: string };

export type TranscriptReview = {
  pages: TranscriptPage[];
  usable: boolean;
};

export type TranscriptReport = {
  start: TranscriptStart;
  pages: TranscriptPage[];
  messages: TranscriptRow[];
  outcome: "complete" | "continue" | "caught-up" | "foreign-channel" | "future-cursor" | "hold";
  next: TranscriptCursor | null;
};
