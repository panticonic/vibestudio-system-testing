import { describe, expect, it, vi } from "vitest";

import type { TestExecutionResult, TestOrchestrationContext } from "../types.js";
import { unitDiagnosticsTests } from "./unit-diagnostics.js";

const notificationRuntime = vi.hoisted(() => ({
  list: vi.fn(),
  overview: vi.fn(),
  resolveService: vi.fn(),
}));
vi.mock("@workspace/runtime", () => ({
  gad: { listUserNotificationsForMe: notificationRuntime.list },
  rpc: { call: notificationRuntime.overview },
  workers: { resolveService: notificationRuntime.resolveService },
}));

function execution(
  code: string,
  returnValue: unknown,
  final = "The workspace has 4 automations: 2 active, 1 running, and 1 failed in the last 24 hours.",
  toolName = "eval",
  operationJournal?: unknown
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      {
        id: "prompt",
        kind: "message",
        senderId: "user",
        complete: true,
        content: "prompt",
      },
      {
        id: "eval",
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation",
        content: "",
        invocation: {
          id: "eval-call",
          name: toolName,
          status: "complete",
          terminalOutcome: "success",
          isError: false,
          arguments: toolName === "eval" ? { code } : (returnValue as Record<string, unknown>),
          result: {
            details:
              toolName === "launch_automation"
                ? {
                    missionId: "mission:fixture",
                    state: "active",
                    name: (returnValue as Record<string, unknown>)["name"],
                    charter: {
                      trigger: (returnValue as Record<string, unknown>)["trigger"],
                      execution: {
                        kind: "agent",
                        action: (returnValue as Record<string, unknown>)["action"],
                        conversation: (returnValue as Record<string, unknown>)["conversation"],
                        operations: (returnValue as Record<string, unknown>)["operations"],
                      },
                    },
                  }
                : { success: true, returnValue, operationJournal },
          },
        },
      } as unknown as TestExecutionResult["messages"][number],
      {
        id: "final",
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content: final,
      },
    ],
  } as TestExecutionResult;
}

const automationTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-overview-readonly"
)!;
const automationLaunchTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-native-launch"
)!;
const scheduledNotificationTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-scheduled-notification"
)!;
const nativeControlTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-native-control"
)!;

describe("automation overview system test validator", () => {
  const readCode =
    "const service = await workers.resolveService('vibestudio.missions.v1'); const overview = await rpc.call(service.targetId, 'overview', [{}]); return overview.stats;";

  it("requires the canonical read-only surface and exact bounded counts", () => {
    expect(
      automationTest.validate(
        execution(readCode, {
          total: 4,
          active: 2,
          running: 1,
          issueRunsLast24Hours: 1,
          completed: 1,
        })
      )
    ).toEqual({ passed: true });
  });

  it("pregrants only the canonical automation service read", () => {
    expect(automationTest.authorityPolicy).toEqual({
      authority: [
        {
          ruleId: "read-automation-overview",
          capability: { kind: "exact", key: "workspace-service:missions" },
          resource: {
            kind: "prefix",
            prefix: "do:workers/missions:MissionsDO:",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    });
  });

  it("rejects prose-only automation claims", () => {
    expect(
      automationTest.validate(
        execution("return { total: 4, active: 2, running: 1, failedLast24Hours: 1 };", {})
      )
    ).toMatchObject({
      passed: false,
      reason: "Expected exactly one successful eval reading the automation overview",
    });
  });

  it("rejects automation mutation attempts", () => {
    expect(
      automationTest.validate(
        execution(`${readCode}\nawait rpc.call(service.targetId, 'runNow', ['id']);`, {
          total: 4,
          active: 2,
          running: 1,
          issueRunsLast24Hours: 1,
          completed: 1,
        })
      )
    ).toMatchObject({
      passed: false,
      reason: "Automation inspection probe attempted a mutating operation",
    });
  });

  it("rejects raw or extra automation data", () => {
    expect(
      automationTest.validate(
        execution(readCode, {
          total: 4,
          active: 2,
          running: 1,
          issueRunsLast24Hours: 1,
          completed: 1,
          definitions: [{ name: "news" }],
        })
      )
    ).toMatchObject({
      passed: false,
      reason: "Automation inspection did not return canonical aggregate counts without raw records",
    });
  });
});

describe("canonical automation count presentation", () => {
  const code = "const service = await workers.resolveService('vibestudio.missions.v1'); return await rpc.call(service.targetId, 'overview', [{}]);";
  const stats = { total: 4, active: 2, running: 1, issueRunsLast24Hours: 1, completed: 1 };
  it("accepts canonical counts inside a numeric presentation wrapper", () => {
    expect(automationTest.validate(execution(code, { stats, issueRunsLast24Hours: 1 }))).toEqual({ passed: true });
  });
  it("rejects a final report that contradicts the observed counts", () => {
    expect(automationTest.validate(execution(code, stats, "Configured: 7; Active: 2; Running: 1; Failed: 1"))).toMatchObject({ passed: false });
  });
  it("rejects deriving whole-ledger statistics from a bounded item page", () => {
    expect(automationTest.validate(execution(code, { total: 4, active: 2, running: 1, failedLast24Hours: 1 }))).toMatchObject({ passed: false });
  });
});

describe("automation native launch system test validator", () => {
  const launch = {
    name: "Daily project pulse",
    summary: "Publish the project pulse every Thursday.",
    trigger: {
      kind: "cron",
      expression: "5 5 * * THU",
      timezone: "America/New_York",
      untilAt: Date.UTC(2027, 0, 1, 5),
      maxRuns: 12,
    },
    action: {
      kind: "eval",
      code: "const status = await vcs.status(); return status.clean ? { protocol: 'automation-completion.v1', response: 'The project is clean.' } : status;",
    },
    conversation: { mode: "fresh" },
    operations: [
      {
        service: "vcs",
        method: "status",
        args: [{ contextId: "project-status-context" }],
        use: "action",
      },
    ],
  };

  it("authorizes only the requested immediate run through the declared mission gate", () => {
    expect(automationLaunchTest.authorityPolicy).toEqual({
      authority: [
        {
          ruleId: "run-requested-automation-now",
          capability: {
            kind: "prefix",
            prefix: "userland:workers/missions/missions.run#",
          },
          resource: {
            kind: "exact",
            key: "mission:do:workers/missions:MissionsDO:workspace-missions",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    });
  });

  it("accepts one native launch with the requested exact lightweight behavior", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "",
          launch,
          "Daily project pulse is running; use its automation pill to inspect or stop it.",
          "launch_automation"
        )
      )
    ).toEqual({ passed: true });
  });

  it("accepts the numeric spelling of the same Thursday schedule", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "",
          {
            ...launch,
            trigger: { ...launch.trigger, expression: "5 5 * * 4" },
          },
          "Daily project pulse is running; use its automation pill to inspect or stop it.",
          "launch_automation"
        )
      )
    ).toEqual({ passed: true });
  });

  it("accepts reasoning in the original conversation and requires the committed active definition", () => {
    const result = execution(
      "",
      {
        ...launch,
        action: { kind: "prompt", text: "Check project status and post a concise update." },
        conversation: { mode: "continue" },
        operations: [],
      },
      "Daily project pulse is active; its automation pill lets you inspect or stop it.",
      "launch_automation"
    );
    expect(automationLaunchTest.validate(result).passed).toBe(true);
    const call = (
      result.messages[1] as unknown as {
        invocation: { result: { details: Record<string, unknown> } };
      }
    ).invocation;
    call.result.details["state"] = "paused";
    expect(automationLaunchTest.validate(result).passed).toBe(false);
    call.result.details["state"] = "active";
    delete call.result.details["missionId"];
    expect(automationLaunchTest.validate(result).passed).toBe(false);
  });

  it("still rejects a schedule that is not the requested one", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "",
          {
            ...launch,
            trigger: { ...launch.trigger, expression: "5 5 * * 3" },
          },
          "Daily project pulse is running; use its automation pill to inspect or stop it.",
          "launch_automation"
        )
      )
    ).toMatchObject({ passed: false });
  });

  it("rejects routing creation through eval", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "return rpc.call(missions.targetId, 'launch', [input]);",
          launch,
          "Daily project pulse is running and inspectable."
        )
      )
    ).toMatchObject({
      passed: false,
      reason: "No successful native launch retained the requested active finite automation",
    });
  });
});

describe("scheduled automation notification system test validator", () => {
  const scheduledLaunch = {
    name: "One-minute talk timer",
    summary: "Notify after one minute.",
    action: {
      kind: "prompt",
      text: "Notify the owner with One minute has passed.",
    },
    trigger: { kind: "schedule", everyMs: 60_000, maxRuns: 2 },
    conversation: {
      mode: "continue",
      channelId: "headless-proof",
      contextId: "ctx-proof",
      executorId: "do:workers/agent-worker:AiChatWorker:headless-proof",
    },
    operations: [],
  };

  it("requires successful durable runs and owner notifications even without a final chat report", () => {
    expect(scheduledNotificationTest.validation).toBe("harness");
    const result = execution("", scheduledLaunch, "", "launch_automation");
    result.diagnostics = {
      scheduledNotification: {
        launchChannelId: "headless-proof",
        conversation: {
          mode: "continue",
          channelId: "headless-proof",
          contextId: "ctx-proof",
          executorId: "do:workers/agent-worker:AiChatWorker:headless-proof",
        },
        redundantInviteCount: 0,
        runs: [
          { runId: "run-1", phase: "terminal", outcome: "succeeded" },
          { runId: "run-2", phase: "terminal", outcome: "succeeded" },
        ],
        notifications: [
          {
            id: "notification-1",
            kind: "agent.message",
            title: "Talk timer",
            message: "One minute has passed.",
            channelId: "headless-proof",
          },
          {
            id: "notification-2",
            kind: "agent.message",
            title: "Talk timer",
            message: "One minute has passed.",
            channelId: "headless-proof",
          },
        ],
      },
    };
    expect(scheduledNotificationTest.validate(result)).toEqual({
      passed: true,
    });
  });

  it("isolates durable notification evidence by the launching conversation", async () => {
    const channelId = "headless-proof";
    notificationRuntime.resolveService.mockResolvedValue({
      kind: "durable-object",
      targetId: "missions",
    });
    notificationRuntime.overview.mockResolvedValue({
      items: [
        {
          automation: {
            name: "One-minute talk timer",
            missionId: "mission-proof",
            runCount: 2,
            state: "completed",
            charter: {
              execution: { conversation: { mode: "continue", channelId } },
            },
          },
          recentRuns: [1, 2].map((id) => ({
            runId: `run-${id}`,
            phase: "terminal",
            outcome: "succeeded",
          })),
        },
      ],
    });
    const notifications = (channel: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${channel}-${i}`,
        kind: "agent.message",
        message: "One minute has passed.",
        data: { channelId: channel },
      }));
    let pending = true;
    let deliverTerminal!: () => void;
    const session = {
      channelId,
      messages: execution("", scheduledLaunch, "Running and inspectable.", "launch_automation")
        .messages,
      snapshot: () => ({
        invocations: pending ? [{ id: "invocation:completion", status: "pending" }] : [],
      }),
      waitForInvocation: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          deliverTerminal = resolve;
        });
        pending = false;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const launchMessage = session.messages.find((message) => message.contentType === "invocation")!;
    (launchMessage.invocation as unknown as { result: { details: unknown } }).result.details = {
      missionId: "mission-proof",
    };
    const context = {
      runner: { spawn: async () => session },
      sendAndWait: async () => undefined,
      signal: new AbortController().signal,
      remainingTimeMs: () => 1000,
    } as unknown as TestOrchestrationContext;
    for (const count of [2, 0, 3]) {
      notificationRuntime.list.mockResolvedValue([
        ...notifications(channelId, count),
        ...notifications("another-conversation", 2),
      ]);
      pending = true;
      session.waitForInvocation.mockClear();
      session.close.mockClear();
      const running = scheduledNotificationTest.orchestrate!(context);
      await vi.waitFor(() =>
        expect(session.waitForInvocation).toHaveBeenCalledWith("invocation:completion", {
          signal: context.signal,
        })
      );
      expect(session.close).not.toHaveBeenCalled();
      deliverTerminal();
      const result = await running;
      expect(result.snapshot?.invocations).toEqual([]);
      expect(scheduledNotificationTest.validate(result).passed).toBe(count === 2);
      expect(
        (result.diagnostics!["scheduledNotification"] as Record<string, unknown>)["notifications"]
      ).toHaveLength(count);
    }
  });

  it("rejects launch-only evidence without the promised outcome", () => {
    expect(
      scheduledNotificationTest.validate(
        execution("", scheduledLaunch, "Running and inspectable.", "launch_automation")
      )
    ).toMatchObject({
      passed: false,
      reason: "No durable scheduled-run evidence was observed",
    });
  });

  it("rejects a completed turn whose requested notification effect failed", () => {
    const result = execution("", scheduledLaunch, "Running and inspectable.", "launch_automation");
    result.diagnostics = {
      scheduledNotification: {
        launchChannelId: "headless-proof",
        conversation: {
          mode: "continue",
          channelId: "headless-proof",
          contextId: "ctx-proof",
          executorId: "do:workers/agent-worker:AiChatWorker:headless-proof",
        },
        redundantInviteCount: 0,
        runs: [
          { runId: "run-1", phase: "terminal", outcome: "succeeded" },
          {
            runId: "run-2",
            phase: "terminal",
            outcome: "completed-with-errors",
            effectFailures: [
              {
                invocationId: "notify-call",
                name: "notify",
                outcome: "tool_error",
                code: "EDELIVERY",
                message: "Live inbox invalidation failed",
              },
            ],
          },
        ],
        notifications: [],
      },
    };
    expect(scheduledNotificationTest.validate(result)).toMatchObject({
      passed: false,
      reason: expect.stringContaining("Live inbox invalidation failed"),
    });
  });
});

describe("native automation control system test validator", () => {
  function resultWithControl(toolName = "control_automation") {
    const result = execution(
      "",
      {
        name: "Sloth facts stop proof",
        summary: "Send a sloth fact every minute.",
        action: { kind: "prompt", text: "Send a sloth fact." },
        trigger: { kind: "schedule", everyMs: 60_000 },
      },
      "Sloth facts stop proof is paused.",
      "launch_automation"
    );
    result.messages.splice(-1, 0, {
      id: "control",
      kind: "message",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      content: "",
      invocation: {
        id: "control-call",
        name: toolName,
        status: "complete",
        terminalOutcome: "success",
        isError: false,
        arguments:
          toolName === "control_automation"
            ? { action: "pause", name: "Sloth facts stop proof" }
            : {
                code: "return await rpc.call(service.targetId, 'pause', [id])",
              },
        result: { details: { state: "paused" } },
      },
    } as unknown as TestExecutionResult["messages"][number]);
    result.diagnostics = {
      nativeAutomationControl: {
        missionId: "mission-sloths",
        name: "Sloth facts stop proof",
        state: "paused",
        runCount: 0,
      },
    };
    return result;
  }

  it("accepts one native pause and canonical paused state", () => {
    expect(nativeControlTest.authorityPolicy).toEqual({ authority: [] });
    expect(nativeControlTest.validate(resultWithControl())).toEqual({
      passed: true,
    });
  });

  it("rejects eval-based stop discovery", () => {
    expect(nativeControlTest.validate(resultWithControl("eval"))).toMatchObject({
      passed: false,
      reason: expect.stringContaining("native pause"),
    });
  });
});

describe("workspace unit diagnostics semantic validators", () => {
  const listTest = unitDiagnosticsTests.find(
    (candidate) => candidate.name === "unit-list-inspect"
  )!;
  const logsTest = unitDiagnosticsTests.find(
    (candidate) => candidate.name === "unit-diagnostics-error-buffer"
  )!;

  const identity = { kind: "extension", entityId: "extension:status:1" };
  const health = {
    entity: {
      identity,
      source: "extensions/status",
      status: "running",
    },
    state: "healthy",
    summary: "ready",
    logs: [
      { identity, timestamp: 1, level: "info", message: "ready" },
      { identity, timestamp: 2, level: "warn", message: "slow poll" },
    ],
    errors: [{ identity, timestamp: 3, level: "error", message: "old failure" }],
    dropped: { entries: 0, errors: 0 },
    capacity: { entries: 100, errors: 50 },
  };
  const nativeHealth = {
    protocol: "workspace-operations.v1", truncated: false,
    entries: [{ type: "runtime.health", receipt: {
      protocol: "runtime-health-observation.v1", identity, source: "extensions/status",
      logCount: 2, errorCount: 1, limit: 20, errorLimit: 10,
      dropped: { entries: 0, errors: 0 }, capacity: { entries: 100, errors: 50 },
    } }],
  };
  const healthCode =
    "const units = await runtime.supervision.list(); const health = await runtime.supervision.health(units[0].identity, { limit: 20, errorLimit: 10 }); return health;";

  it("accepts natural prose backed by list and detail inspection evidence", () => {
    expect(
      listTest.validate(
        execution(
          "const units = await runtime.supervision.list(); const detail = await runtime.supervision.health(units[0].identity, { limit: 5, errorLimit: 2 }); return { units: units.length, detail };",
          { units: 3, detail: { status: "running" } },
          "There are 3 workspace units available; the representative unit I inspected is running."
        )
      )
    ).toEqual({ passed: true });
  });

  it("rejects the same natural claim when the detail inspection was fabricated", () => {
    expect(
      listTest.validate(
        execution(
          "return { units: 3, detail: { status: 'running' } };",
          { units: 3, detail: { status: "running" } },
          "There are 3 workspace units available; the representative unit I inspected is running."
        )
      )
    ).toMatchObject({ passed: false });
  });

  it("joins bounded log and error buffers to one exact supervised unit", () => {
    expect(
      logsTest.validate(
        execution(
          healthCode,
          health,
          "extensions/status has 2 recent logs and 1 entry in its separate error buffer.", "eval", nativeHealth
        )
      )
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts a guest summary independently of the native health packet", () => {
    expect(logsTest.validate(execution(healthCode, { compact: true },
      "extensions/status has 2 recent logs and 1 error in its separate buffer.", "eval", nativeHealth))).toEqual({ passed: true });
  });

  it("accepts a shared zero quantifier across both empty native buffers", () => {
    const empty = { ...nativeHealth, entries: [{ ...nativeHealth.entries[0]!, receipt: {
      ...nativeHealth.entries[0]!.receipt, logCount: 0, errorCount: 0,
    } }] };
    expect(logsTest.validate(execution(healthCode, { compact: true },
      "extensions/status is running. There were no persisted log entries or separate-buffer errors; nothing was dropped.", "eval", empty))).toEqual({ passed: true });
  });

  it("rejects prose that is not backed by a unit health packet", () => {
    expect(
      logsTest.validate(
        execution(
          healthCode,
          { source: "extensions/status", logs: 2, errors: 1 },
          "extensions/status has 2 logs and 1 error."
        )
      )
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("health packet"),
    });
  });

  it("rejects diagnostic records from a different unit identity", () => {
    expect(
      logsTest.validate(
        execution(
          healthCode,
          {
            ...health,
            errors: [
              {
                identity: { kind: "extension", entityId: "extension:other:1" },
                timestamp: 3,
                level: "error",
                message: "foreign failure",
              },
            ],
          },
          "extensions/status has 2 logs and 1 error."
        )
      )
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("identity-consistent"),
    });
  });

  it("rejects a report that omits one observed buffer count", () => {
    expect(
      logsTest.validate(
        execution(healthCode, health, "extensions/status has 2 recent logs and looks healthy.", "eval", nativeHealth)
      )
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("exact buffer counts"),
    });
  });
});
