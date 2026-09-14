import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@workspace/agentic-core";
import { summarizeEntry, summarizeFailures } from "./diagnostics.js";
import type { TestSuiteResultEntry } from "./types.js";

function entryWithMessages(messages: ChatMessage[]): TestSuiteResultEntry {
  return {
    test: {
      name: "typed-transcript",
      category: "smoke",
      description: "captures typed transcript rows",
      prompt: "exercise typed transcript",
    },
    result: { passed: false, reason: "validation failed" },
    execution: {
      messages,
      duration: 123,
    },
  };
}

function passingEntryWithToolFailure(messages: ChatMessage[]): TestSuiteResultEntry {
  return {
    ...entryWithMessages(messages),
    result: { passed: true },
    execution: {
      messages,
      duration: 123,
      toolFailures: [
        {
          id: "call-1",
          name: "eval",
          status: "error",
          error: "ReferenceError: missingVar is not defined",
          source: "message",
        },
      ],
    },
  };
}

describe("system-testing diagnostics", () => {
  it("uses participant authorship when the finite mailbox omits the local prompt", () => {
    const messages: ChatMessage[] = [
      {
        id: "answer-1",
        senderId: "agent",
        senderMetadata: { name: "Agent", type: "agent", handle: "agent" },
        kind: "message",
        contentType: "text",
        complete: true,
        content: "Reviewed the retained result without integrating it.",
      },
    ];

    const diagnostic = summarizeEntry(entryWithMessages(messages));

    expect(diagnostic.finalAgentMessage).toBe(
      "Reviewed the retained result without integrating it."
    );
    expect(diagnostic.conversation[0]).toMatchObject({ who: "agent" });
    expect(diagnostic.likelyIssue).toBe("validation-mismatch");
  });

  it("preserves structured invocation payloads for stage report drill-down", () => {
    const invocation = {
      id: "call-1",
      transportCallId: "transport-1",
      name: "read",
      arguments: { path: "README.md" },
      execution: {
        status: "complete" as const,
        terminalOutcome: "success" as const,
        description: "Read README.md",
        result: { bytes: 42, preview: "hello" },
        isError: false,
      },
    };
    const messages: ChatMessage[] = [
      {
        id: "prompt-1",
        senderId: "headless",
        kind: "message",
        complete: true,
        content: "prompt",
      },
      {
        id: "invocation:call-1",
        senderId: "agent",
        kind: "message",
        contentType: "invocation",
        complete: true,
        content: JSON.stringify(invocation),
        invocation,
        senderMetadata: { name: "Agent", type: "agent", handle: "agent" },
      },
    ];

    const diagnostic = summarizeEntry(entryWithMessages(messages), {
      messages: 10,
      invocations: 10,
      text: 120,
    });

    expect(diagnostic.conversation[1]).toMatchObject({
      uiType: "invocation",
      text: "Read README.md",
      invocation: {
        id: "call-1",
        transportCallId: "transport-1",
        name: "read",
        status: "complete",
        terminalOutcome: "success",
        arguments: { path: "README.md" },
        result: { bytes: 42, preview: "hello" },
      },
    });
    expect(diagnostic.conversation[1]!.rawContent).toContain('"name":"read"');
    expect(diagnostic.invocations).toHaveLength(1);
    expect(diagnostic.invocations[0]).toMatchObject({
      name: "read",
      status: "complete",
      arguments: { path: "README.md" },
      result: { bytes: 42, preview: "hello" },
    });
  });

  it("summarizes non-message transcript payload types", () => {
    const messages: ChatMessage[] = [
      {
        id: "prompt-1",
        senderId: "headless",
        kind: "message",
        complete: true,
        content: "prompt",
      },
      {
        id: "diag-1",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        kind: "system",
        complete: true,
        content: "",
        diagnostic: {
          severity: "error",
          title: "Model retry limit reached",
          detail:
            "Model retry limit reached for t:chan-1:env-1: 3 consecutive model failures occurred.",
          code: "model_retry_limit_exceeded",
        },
      },
    ];

    const diagnostic = summarizeEntry(entryWithMessages(messages));

    expect(diagnostic.conversation[1]).toMatchObject({
      uiType: "diagnostic",
      type: "system",
      text: "Model retry limit reached\nModel retry limit reached for t:chan-1:env-1: 3 consecutive model failures occurred.",
      diagnostic: {
        severity: "error",
        code: "model_retry_limit_exceeded",
        title: "Model retry limit reached",
      },
    });
  });

  it("classifies passing tests with tool failures as investigation items", () => {
    const messages: ChatMessage[] = [
      {
        id: "prompt-1",
        senderId: "headless",
        kind: "message",
        complete: true,
        content: "prompt",
      },
      {
        id: "answer-1",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        kind: "message",
        complete: true,
        content: "Recovered.",
      },
    ];

    const diagnostic = summarizeEntry(passingEntryWithToolFailure(messages));

    expect(diagnostic.passed).toBe(true);
    expect(diagnostic.likelyIssue).toBe("tool-failure-observed:eval");
    expect(diagnostic.toolFailures).toEqual([
      expect.objectContaining({
        name: "eval",
        status: "error",
      }),
    ]);
  });

  it("includes passing tests with tool failures in bounded failure summaries", () => {
    const messages: ChatMessage[] = [
      {
        id: "prompt-1",
        senderId: "headless",
        kind: "message",
        complete: true,
        content: "prompt",
      },
    ];
    const suite = {
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      skipped: 0,
      duration: 123,
      results: [passingEntryWithToolFailure(messages)],
    };

    const report = summarizeFailures(suite);

    expect(report.failureCount).toBe(1);
    expect(report.failures[0]).toMatchObject({
      name: "typed-transcript",
      passed: true,
      likelyIssue: "tool-failure-observed:eval",
    });
  });

  it("does not diagnose a deliberately exercised tool failure as a system defect", () => {
    const messages: ChatMessage[] = [
      {
        id: "prompt-1",
        senderId: "headless",
        kind: "message",
        complete: true,
        content: "prompt",
      },
    ];
    const entry = passingEntryWithToolFailure(messages);
    entry.execution.toolFailures![0]!.expected = true;

    expect(summarizeEntry(entry).likelyIssue).toBe("passed");
    expect(
      summarizeFailures({
        total: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        skipped: 0,
        duration: 1,
        results: [entry],
      }).failureCount
    ).toBe(0);
  });

  it("classifies a thrown validator separately from a session failure", () => {
    const entry = entryWithMessages([]);
    entry.result = {
      passed: false,
      reason: "Error: Cannot read properties of undefined (reading 'includes')",
    };
    entry.execution.error = "Cannot read properties of undefined (reading 'includes')";
    entry.execution.failure = {
      phase: "validation",
      error: {
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'includes')",
      },
    };
    entry.execution.validationFailure = {
      testName: "typed-transcript",
      validator: "harness",
      phase: "validation",
      stack: "TypeError: missing values\n    at validate (validator.ts:12:3)",
      inputProjection: {
        messageCount: 0,
        invocations: [],
      },
    };

    expect(summarizeEntry(entry)).toMatchObject({
      likelyIssue: "validator-error",
      sessionError: "Cannot read properties of undefined (reading 'includes')",
      failure: {
        phase: "validation",
        error: { name: "TypeError" },
      },
      validationFailure: {
        testName: "typed-transcript",
        stack: expect.stringContaining("validator.ts:12:3"),
        inputProjection: { messageCount: 0 },
      },
    });
  });

  it("retains the histogram behind a channel delivery latency verdict and blames delivery", () => {
    // Reproduces the bounded packet an investigator gets when the latency gate
    // overrides an otherwise passing scenario: without the histogram the stated
    // reason has no supporting evidence, and the classification ladder blames
    // the agent's own transcript instead.
    const entry = entryWithMessages([]);
    entry.result = {
      passed: false,
      reason:
        "Channel delivery latency regression: publish-to-recipient-execution: 34778ms exceeds 30000ms baseline",
    };
    entry.execution.diagnostics = {
      channelDelivery: {
        deliveryLifecycle: {
          latencyHistogram: [
            {
              metric: "publish-to-recipient-execution",
              upper_bound_ms: 2147483647,
              samples: 1,
              total_ms: 34778,
              maximum_ms: 34778,
            },
            {
              metric: "publish-to-recipient-execution",
              upper_bound_ms: 1000,
              samples: 4,
              total_ms: 2400,
              maximum_ms: 900,
            },
            {
              metric: "call-to-provider-execution",
              upper_bound_ms: 500,
              samples: 2,
              total_ms: 700,
              maximum_ms: 420,
            },
          ],
        },
      },
    };

    const diagnostic = summarizeEntry(entry);
    expect(diagnostic.likelyIssue).toBe("channel-delivery-latency");
    expect(diagnostic.channelDeliveryLatency).toEqual({
      violations: [
        "publish-to-recipient-execution: 34778ms exceeds 30000ms baseline",
      ],
      metrics: [
        {
          metric: "call-to-provider-execution",
          baselineMs: 30000,
          budgetMs: 30000,
          maximumMs: 420,
          samples: 2,
          overBudget: false,
          overBaseline: false,
          buckets: [{ upperBoundMs: 500, samples: 2, maximumMs: 420 }],
        },
        {
          metric: "publish-to-recipient-execution",
          baselineMs: 30000,
          budgetMs: 30000,
          maximumMs: 34778,
          samples: 5,
          overBudget: true,
          overBaseline: true,
          buckets: [
            { upperBoundMs: 1000, samples: 4, maximumMs: 900 },
            { upperBoundMs: 2147483647, samples: 1, maximumMs: 34778 },
          ],
        },
      ],
      // This test measured one agent's spans, so the isolated ceiling applies.
      concurrentTestAgents: 1,
    });
  });

  it("keeps a concrete scenario fault ahead of a within-budget delivery histogram", () => {
    const entry = entryWithMessages([]);
    entry.execution.cleanupErrors = ["unsubscribeHeadlessAgent: relay failed"];
    entry.execution.diagnostics = {
      channelDelivery: {
        deliveryLifecycle: {
          latencyHistogram: [
            {
              metric: "publish-to-recipient-execution",
              upper_bound_ms: 1000,
              samples: 3,
              total_ms: 1200,
              maximum_ms: 600,
            },
          ],
        },
      },
    };

    const diagnostic = summarizeEntry(entry);
    expect(diagnostic.likelyIssue).toBe("cleanup-error");
    expect(diagnostic.channelDeliveryLatency?.violations).toEqual([]);
    expect(diagnostic.channelDeliveryLatency?.metrics[0]?.overBudget).toBe(false);
  });

  it("omits the latency projection when channel delivery was never collected", () => {
    expect(summarizeEntry(entryWithMessages([])).channelDeliveryLatency).toBeNull();
  });

  it("keeps both ends of a long tool error so the diagnosis survives", () => {
    const entry = entryWithMessages([]);
    // The real shape: a shared preamble, a long absolute path, then the one
    // part that differs between two build failures.
    const error =
      "[tool.verify:execute] unknown_tool_failure: [build.getTestArtifact] Build failed with 1 error:\n" +
      "/tmp/vibestudio-selfdev/workspaces/system-ws/state/build-sources/".padEnd(600, "x") +
      "/index.tsx:12:4: ERROR: Could not resolve \"./missing-module\"";
    entry.execution.toolFailures = [
      { id: "call-1", name: "verify", status: "error", error, source: "message" },
    ] as never;

    const [summary] = summarizeEntry(entry).toolFailures;
    expect(summary?.error).toContain("Build failed with 1 error");
    expect(summary?.error).toContain('Could not resolve "./missing-module"');
    expect(summary?.error).toMatch(/chars elided/u);
  });

  it("leaves a tool error shorter than the limit untouched", () => {
    const entry = entryWithMessages([]);
    entry.execution.toolFailures = [
      { id: "call-1", name: "verify", status: "error", error: "short", source: "message" },
    ] as never;
    expect(summarizeEntry(entry).toolFailures[0]?.error).toBe("short");
  });

  it("carries an orchestrated scenario's own evidence into the failure report", () => {
    const entry = entryWithMessages([]);
    entry.execution.diagnostics = {
      chatTaskRuleReuse: {
        afterFirstTurn: [{ id: "rule-1" }],
        afterSecondTurn: [{ id: "rule-2" }],
      },
      // Keys with a dedicated projection are not repeated here.
      workspaceRepoFixture: { testName: "fixture-test" },
    };

    const orchestration = summarizeEntry(entry).orchestration;
    expect(Object.keys(orchestration ?? {})).toEqual(["chatTaskRuleReuse"]);
    expect(orchestration?.["chatTaskRuleReuse"]).toContain("rule-2");
  });

  it("keeps the tail of a long orchestration record, where the verdict often sits", () => {
    const entry = entryWithMessages([]);
    entry.execution.diagnostics = {
      scheduledNotification: {
        runs: Array.from({ length: 40 }, (_, index) => ({ runId: `run-${index}`.padEnd(40, "x") })),
        // The field the validator actually grades, last in the record.
        notifications: [{ id: "notify-1" }, { id: "notify-2" }],
      },
    };

    const carried = summarizeEntry(entry).orchestration?.["scheduledNotification"] ?? "";
    expect(carried).toContain("runs");
    expect(carried).toContain("notify-2");
    expect(carried).toMatch(/chars elided/u);
  });

  it("omits the orchestration projection when a scenario recorded nothing", () => {
    expect(summarizeEntry(entryWithMessages([])).orchestration).toBeNull();
  });

  it("includes bounded workspace repo fixture teardown diagnostics", () => {
    const entry = entryWithMessages([]);
    entry.execution.diagnostics = {
      workspaceRepoFixture: {
        testName: "fixture-test",
        contextId: "context:fixture-test",
        kind: "buildable-package",
        section: "packages",
        repoName: "system-test-fixture-test-1234",
        repositoryId: "repository:fixture-test-1234",
        repoPath: "packages/system-test-fixture-test-1234",
        seedFilePaths: ["package.json", "src/index.ts"],
        importWorkUnitId: "work:import",
        taskBaseEventId: "event:main",
        importChangeIds: ["change:repository-create", "change:file-create"],
        publishedFixtureRemoved: {
          repositoryId: "repository:fixture-test-1234",
          repoPath: "packages/system-test-fixture-test-1234",
        },
        unexpectedPublishedRepositoriesRemoved: [
          { repositoryId: "repository:escaped", repoPath: "projects/outside-fixture" },
        ],
        counteractedChangeIds: ["change:repository-create", "change:file-create"],
      },
    };

    expect(summarizeEntry(entry).workspaceRepoFixture).toEqual({
      testName: "fixture-test",
      contextId: "context:fixture-test",
      kind: "buildable-package",
      section: "packages",
      repoName: "system-test-fixture-test-1234",
      repositoryId: "repository:fixture-test-1234",
      repoPath: "packages/system-test-fixture-test-1234",
      seedFilePaths: ["package.json", "src/index.ts"],
      importWorkUnitId: "work:import",
      taskBaseEventId: "event:main",
      importChangeCount: 2,
      publishedFixtureRemoved: {
        repositoryId: "repository:fixture-test-1234",
        repoPath: "packages/system-test-fixture-test-1234",
      },
      unexpectedPublishedRepositoriesRemoved: [
        { repositoryId: "repository:escaped", repoPath: "projects/outside-fixture" },
      ],
      counteractedChangeCount: 2,
    });
  });

  it("reports normalized session cleanup once when the raw snapshot retains it", () => {
    const entry = entryWithMessages([]);
    entry.execution.cleanupErrors = ["unsubscribeHeadlessAgent: relay failed"];
    entry.execution.snapshot = {
      channelId: "channel-cleanup",
      agentEntityId: "agent-cleanup",
      agentTargetId: "agent-cleanup",
      agentContextId: "context-cleanup",
      ownsAgentContext: false,
      messages: [],
      invocations: [],
      tasks: [],
      debugEvents: [],
      cleanup: {
        phase: "complete",
        phaseStartedAt: 1,
        completedAt: 1,
      },
      cleanupErrors: [
        {
          phase: "unsubscribeHeadlessAgent",
          message: "relay failed",
          at: 1,
        },
      ],
      participants: {},
      localMethodNames: [],
      connected: false,
      duration: 1,
      title: null,
    };

    expect(summarizeEntry(entry).cleanupErrors).toEqual(["unsubscribeHeadlessAgent: relay failed"]);
  });

  it("keeps structured failures and handles in bounded diagnostics", () => {
    const entry = entryWithMessages([]);
    entry.execution.error = "fixture setup failed";
    entry.execution.failure = {
      phase: "workspace-fixture-setup",
      error: {
        name: "RemoteRpcError",
        message: "fixture setup failed",
        code: "InternalFailure",
        errorKind: "application",
        errorData: { code: "InternalFailure", handle: "diagnostic:vcs:setup" },
        diagnosticHandles: ["diagnostic:vcs:setup"],
      },
    };
    entry.execution.cleanupFailures = [
      {
        phase: "workspace-fixture-cleanup",
        error: {
          name: "RemoteRpcError",
          message: "fixture cleanup failed",
          code: "InternalFailure",
          errorData: { handle: "diagnostic:vcs:cleanup" },
          diagnosticHandles: ["diagnostic:vcs:cleanup"],
        },
      },
    ];

    const diagnostic = summarizeEntry(entry);

    expect(diagnostic.failure).toEqual(entry.execution.failure);
    expect(diagnostic.cleanupFailures).toEqual(entry.execution.cleanupFailures);
    expect(JSON.stringify(diagnostic)).toContain("diagnostic:vcs:setup");
    expect(JSON.stringify(diagnostic)).toContain("diagnostic:vcs:cleanup");
  });
});
