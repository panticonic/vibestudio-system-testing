import { describe, expect, it } from "vitest";
import classify from "./triageFailure/classify.js";
import evidence from "./triageFailure/evidence.js";
import signals from "./triageFailure/signals.js";
import type { Failure } from "./types.js";

const failure = (over: Partial<Failure>): Failure => ({
  name: "t",
  validationReason: null,
  sessionError: null,
  failure: null,
  validationFailure: null,
  finalAgentMessage: null,
  invocations: [],
  toolFailures: [],
  cleanupErrors: [],
  cleanupFailures: [],
  channelDeliveryLatency: null,
  workspaceRepoFixture: null,
  orchestration: null,
  likelyIssue: "validation-mismatch",
  ...over,
});

describe("signals", () => {
  it("reads the typed fields of a record in a fixed order and redacts what must not travel", () => {
    const read = signals(
      failure({
        sessionError:
          "ENOENT /home/alice/.config/vibestudio/x with Bearer abcdefghijklmnop0123 and sk-abcdefghijklmnopqrstuv",
        toolFailures: [
          {
            name: "vcs",
            classification: "argument-rejection",
            failureCode: "invalid-input",
            error: "Invalid arguments",
          },
        ],
        validationReason: "missing marker",
      }),
    );
    expect(read.map((signal) => signal.source)).toEqual([
      "session-error",
      "tool-failure",
      "validation",
      "heuristic",
    ]);
    expect(read[0]!.text).toBe(
      "ENOENT ~/.config/vibestudio/x with Bearer [redacted] and [redacted]",
    );
    expect(read[1]!.text).toBe(
      "vcs [argument-rejection, invalid-input]: Invalid arguments",
    );
  });

  it("names only unfinished invocations, bounds every signal and caps the list", () => {
    const many = failure({
      invocations: [
        { name: "eval", status: "complete" },
        { name: "verify", status: "running" },
      ],
      cleanupErrors: Array.from({ length: 20 }, (_, index) => `leak ${index}`),
      finalAgentMessage: "x".repeat(2000),
    });
    const read = signals(many);
    expect(read).toHaveLength(10);
    expect(
      read.some(
        (signal) =>
          signal.source === "incomplete-invocation" &&
          signal.text === "verify is running",
      ),
    ).toBe(true);
    expect(read.every((signal) => signal.text.length <= 300)).toBe(true);
  });
});

describe("evidence", () => {
  it("puts the signals that decide a class first and keeps three", () => {
    const read = signals(
      failure({
        validationFailure: { validator: "harness" },
        validationReason: "threw",
        finalAgentMessage: "done",
      }),
    );
    expect(evidence("validator", read).map((signal) => signal.source)).toEqual([
      "validator-error",
      "validation",
      "final-message",
    ]);
    expect(evidence("harness", read)).toHaveLength(3);
  });
});

describe("retained orchestration context", () => {
  it("keeps the failing phase ahead of diagnostic counters and never treats run coordinates as a cause", () => {
    const bookkeeping = {
      generatedAt: "now",
      contextId: "owned",
      channelId: "chat",
      buildProvenance: "base",
      durableWork: "operations",
      agentHealth: "inactive",
      diagnosticCollectionFailure: "collector unavailable",
    };
    const record = failure({
      failure: {
        phase: "orchestration",
        error: { name: "Error", message: "Assigned mount refused" },
      },
      orchestration: {
        ...bookkeeping,
        stage: "opening mount",
        state: "stopped",
        resource: "assigned",
      },
    });
    expect(classify(record)).toBe("harness");
    expect(evidence("harness", signals(record))[0]).toEqual({
      source: "phase",
      text: "orchestration: Error: Assigned mount refused",
    });
    const contextOnly = failure({ orchestration: bookkeeping });
    expect(classify(contextOnly)).toBeNull();
    expect(
      signals(contextOnly).every((signal) => signal.source !== "orchestration"),
    ).toBe(true);
  });
});
