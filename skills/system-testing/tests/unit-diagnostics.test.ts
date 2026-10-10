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
const watchNotificationTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-watch-notification"
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

  it("accepts the runtime missions client", () => {
    expect(
      automationTest.validate(
        execution(
          "import { missions } from '@workspace/runtime'; const overview = await missions.overview(); return overview.stats;",
          { total: 4, active: 2, running: 1, issueRunsLast24Hours: 1, completed: 1 }
        )
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

  it("requires canonical stats in the successful overview result", () => {
    for (const value of [
      { total: 4, active: 2, running: 1, issueRunsLast24Hours: 1 },
      { stats: { total: 4, active: 2, running: -1, issueRunsLast24Hours: 1, completed: 1 } },
    ]) {
      expect(
        automationTest.validate(
          execution(readCode, value, "Configured: 4; Active: 2; Running: 1; Failed: 1")
        )
      ).toMatchObject({ passed: false });
    }
  });
});

describe("canonical automation count presentation", () => {
  const code = "const service = await workers.resolveService('vibestudio.missions.v1'); const overview = await rpc.call(service.targetId, 'overview', [{}]); return { stats: overview.stats, itemCount: overview.items.length, nextCursor: overview.nextCursor ?? null, generatedAt: overview.generatedAt };";
  const fullOverviewCode = "const service = await workers.resolveService('vibestudio.missions.v1'); const overview = await rpc.call(service.targetId, 'overview', [{}]); return overview;";
  const stats = { total: 4, active: 2, running: 1, issueRunsLast24Hours: 1, completed: 1 };
  it("accepts canonical counts with the overview's safe summary metadata", () => {
    expect(automationTest.validate(execution(code, {
      stats,
      itemCount: 1,
      nextCursor: null,
      generatedAt: 1_791_535_180_253,
    }, "Configured: 4; Active: 2; Running: 1; Failed: 1"))).toEqual({ passed: true });
  });
  it("accepts the observed overview counts in separate rows", () => {
    expect(automationTest.validate(execution(code, {
      stats: { total: 1, active: 1, running: 0, issueRunsLast24Hours: 0, completed: 0 },
      itemCount: 1,
      nextCursor: null,
      generatedAt: 1_791_535_180_253,
    }, "Configured: 1\nActive: 1\nRunning: 0\nFailed/completed with errors in the last 24 hours: 0"))).toEqual({ passed: true });
  });
  it("binds inline counts to their own labels and ignores duration quantities", () => {
    const observed = {
      stats: { total: 1, active: 1, running: 0, issueRunsLast24Hours: 0, completed: 0 },
      itemCount: 1,
      nextCursor: null,
      generatedAt: 1_791_535_180_253,
    };
    for (const final of [
      "Configured: 1; Active: 1; Running: 0; Failed/completed with errors in the last 24 hours: 0",
      "1 configured, 1 active, 0 running, 0 failures over the last 24 hours",
      "Configured: 1 and Active: 1 and Running: 0 and Failed in last 24 hours: 0",
      "Configured 1 Active 1 Running 0 Failed 0",
      "1 configured automations, 1 active automations, 0 running automations, 0 failed automations in the last 24 hours",
      "Configured automations: 1\nActive automations: 1\nRunning automations: 0\nFailed automations in the last 24 hours: 0",
      "| Configured automations | 1 |\n| Active | 1 |\n| Running | 0 |\n| Failed in last 24 hours | 0 |",
    ]) {
      expect(automationTest.validate(execution(code, observed, final))).toEqual({ passed: true });
    }
  });
  it("does not borrow a neighboring count or treat a duration as the failed count", () => {
    const observed = {
      stats: { total: 1, active: 1, running: 0, issueRunsLast24Hours: 0, completed: 0 },
      itemCount: 1,
      nextCursor: null,
      generatedAt: 1_791_535_180_253,
    };
    for (const final of [
      "Configured: 1; Active: 1; Running: 0; Failed/completed with errors in the last 24 hours",
      "Configured: 1; Active: 1; Running: 0; Failed/completed with errors in the last 24 hours: 1",
      "Configured: 1; Active: 1; Running: 0; Failed/completed with errors in the last 24 hours: 24",
      "Configured: 1; Active: 1; Running: 0; Failed in the last 12 hours",
      "Configured: 1 Active: 1 Running: 0 Failed in the last 24 hours",
    ]) {
      expect(automationTest.validate(execution(code, observed, final))).toMatchObject({ passed: false });
    }
  });
  it("rejects contradictory repeated claims across separate fields", () => {
    const observed = {
      stats: { total: 1, active: 1, running: 0, issueRunsLast24Hours: 0, completed: 0 },
      itemCount: 1,
      nextCursor: null,
      generatedAt: 1_791_535_180_253,
    };
    expect(
      automationTest.validate(
        execution(code, observed, "Configured: 1; Active: 1; Running: 0; Running: 1; Failed: 0"),
      ),
    ).toMatchObject({ passed: false });
  });
  it("accepts a valid canonical continuation cursor", () => {
    expect(automationTest.validate(execution(code, {
      stats,
      itemCount: 50,
      nextCursor: { updatedAt: 123, missionId: "mission:next" },
      generatedAt: 456,
    }, "Configured: 4; Active: 2; Running: 1; Failed: 1"))).toEqual({ passed: true });
  });
  it("accepts the complete canonical overview result", () => {
    expect(automationTest.validate(execution(fullOverviewCode, {
      generatedAt: 456,
      stats,
      items: [{ automation: { missionId: "mission:private" }, recentRuns: [] }],
      attention: [{ missionId: "mission:private" }],
    }, "Configured: 4; Active: 2; Running: 1; Failed: 1"))).toEqual({ passed: true });
  });
  it("rejects malformed or missing overview stats", () => {
    for (const value of [
      { stats: { ...stats, running: -1 }, itemCount: 1, nextCursor: null, generatedAt: 456 },
      { itemCount: 1, nextCursor: null, generatedAt: 456 },
    ]) {
      expect(automationTest.validate(execution(code, value, "Configured: 4; Active: 2; Running: 1; Failed: 1"))).toMatchObject({ passed: false });
    }
  });
  it("rejects a final report that contradicts the observed counts", () => {
    expect(automationTest.validate(execution(code, stats, "Configured: 7; Active: 2; Running: 1; Failed: 1"))).toMatchObject({ passed: false });
  });
  it("rejects deriving whole-ledger statistics from a bounded item page", () => {
    expect(automationTest.validate(execution(code, { total: 4, active: 2, running: 1, failedLast24Hours: 1 }))).toMatchObject({ passed: false });
  });
  it("rejects contradictory total claims when a generic noun is independently counted", () => {
    const observed = {
      stats: { total: 1, active: 1, running: 0, issueRunsLast24Hours: 0, completed: 0 },
      itemCount: 1,
      nextCursor: null,
      generatedAt: 1_791_535_180_253,
    };
    expect(
      automationTest.validate(
        execution(code, observed, "Configured automations: 1; automations: 0; Active: 1; Running: 0; Failed: 0"),
      ),
    ).toMatchObject({ passed: false });
  });
  it("rejects an ambiguous field that joins different metrics without a count boundary", () => {
    const observed = {
      stats: { total: 1, active: 1, running: 0, issueRunsLast24Hours: 0, completed: 0 },
      itemCount: 1,
      nextCursor: null,
      generatedAt: 1_791_535_180_253,
    };
    expect(
      automationTest.validate(
        execution(code, observed, "Configured Active: 1; Running: 0; Failed: 0"),
      ),
    ).toMatchObject({ passed: false });
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
      kind: "notify",
      text: "One minute has passed.",
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
        missionId: "mission:fixture",
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
            id: "automation.notify:run-1",
            kind: "automation.notify",
            missionId: "mission:fixture",
            runId: "run-1",
            title: "Talk timer",
            message: "One minute has passed.",
            channelId: "headless-proof",
          },
          {
            id: "automation.notify:run-2",
            kind: "automation.notify",
            missionId: "mission:fixture",
            runId: "run-2",
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

  it("binds native fixed-text notifications to each run of the launched mission", () => {
    const result = execution("", scheduledLaunch, "", "launch_automation");
    result.diagnostics = {
      scheduledNotification: {
        missionId: "mission:fixture",
        launchChannelId: "headless-proof",
        conversation: { mode: "continue", channelId: "headless-proof" },
        redundantInviteCount: 0,
        runs: [
          { runId: "run-1", phase: "terminal", outcome: "succeeded" },
          { runId: "run-2", phase: "terminal", outcome: "succeeded" },
        ],
        notifications: [
          {
            id: "automation.notify:run-1",
            kind: "automation.notify",
            missionId: "mission:fixture",
            runId: "run-1",
            message: "One minute has passed.",
            channelId: "headless-proof",
          },
          {
            id: "automation.notify:run-2",
            kind: "automation.notify",
            missionId: "mission:fixture",
            runId: "run-2",
            message: "One minute has passed.",
            channelId: "headless-proof",
          },
        ],
      },
    };
    expect(scheduledNotificationTest.validate(result)).toEqual({
      passed: true,
    });

    const wrongIdentity = structuredClone(result);
    const observed = wrongIdentity.diagnostics![
      "scheduledNotification"
    ] as Record<string, unknown>;
    const notifications = observed["notifications"] as Array<
      Record<string, unknown>
    >;
    notifications[0] = { ...notifications[0]!, missionId: "another-mission" };
    expect(scheduledNotificationTest.validate(wrongIdentity)).toMatchObject({
      passed: false,
    });

    const wrongMessage = structuredClone(result);
    const wrongMessageObserved = wrongMessage.diagnostics![
      "scheduledNotification"
    ] as Record<string, unknown>;
    const wrongMessageNotifications = wrongMessageObserved[
      "notifications"
    ] as Array<Record<string, unknown>>;
    wrongMessageNotifications[0] = {
      ...wrongMessageNotifications[0]!,
      message: "A different reminder",
    };
    expect(scheduledNotificationTest.validate(wrongMessage)).toMatchObject({
      passed: false,
    });

    const wrongMission = structuredClone(result);
    const wrongMissionObserved = wrongMission.diagnostics![
      "scheduledNotification"
    ] as Record<string, unknown>;
    wrongMissionObserved["missionId"] = "another-mission";
    expect(scheduledNotificationTest.validate(wrongMission)).toMatchObject({
      passed: false,
    });

    const launchWithoutIdentity = structuredClone(result);
    const launchInvocation = launchWithoutIdentity.messages.find(
      (message) => message.contentType === "invocation",
    )!.invocation as unknown as {
      result: { details: Record<string, unknown> };
    };
    launchInvocation.result.details["missionId"] = "";
    expect(
      scheduledNotificationTest.validate(launchWithoutIdentity),
    ).toMatchObject({
      passed: false,
    });
  });

  it("keeps conditional watch delivery on the agent-message notification path", () => {
    const watchLaunch = {
      ...scheduledLaunch,
      name: "One-minute talk timer watch",
      action: {
        kind: "watch",
        text: "Notify the owner when an update is found.",
      },
    };
    const result = execution("", watchLaunch, "", "launch_automation");
    result.diagnostics = {
      scheduledNotification: {
        launchChannelId: "headless-proof",
        conversation: { mode: "continue", channelId: "headless-proof" },
        redundantInviteCount: 0,
        runs: [
          { runId: "watch-run-1", phase: "terminal", outcome: "succeeded" },
          { runId: "watch-run-2", phase: "terminal", outcome: "succeeded" },
        ],
        notifications: [
          {
            id: "watch-notification-1",
            kind: "agent.message",
            message: "One minute has passed.",
            channelId: "headless-proof",
          },
          {
            id: "watch-notification-2",
            kind: "agent.message",
            message: "One minute has passed.",
            channelId: "headless-proof",
          },
        ],
      },
    };
    expect(watchNotificationTest.validate(result)).toEqual({ passed: true });
    expect(scheduledNotificationTest.validate(result)).toMatchObject({
      passed: false,
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
      Array.from({ length: count }, (_, i) => {
        const runId = `${channel === channelId ? "" : "other-"}run-${i + 1}`;
        return {
          id: `automation.notify:${runId}`,
          kind: "automation.notify",
          message: "One minute has passed.",
          data: {
            channelId: channel,
            missionId: "mission-proof",
            runId,
          },
        };
      });
    let pending = true;
    let deliverTerminal!: () => void;
    const session = {
      channelId,
      messages: execution(
        "",
        scheduledLaunch,
        "Running and inspectable.",
        "launch_automation",
      ).messages,
      snapshot: () => ({
        invocations: pending
          ? [{ id: "invocation:completion", status: "pending" }]
          : [],
      }),
      waitForInvocation: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          deliverTerminal = resolve;
        });
        pending = false;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const launchMessage = session.messages.find(
      (message) => message.contentType === "invocation",
    )!;
    (
      launchMessage.invocation as unknown as { result: { details: unknown } }
    ).result.details = {
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
        expect(session.waitForInvocation).toHaveBeenCalledWith(
          "invocation:completion",
          {
            signal: context.signal,
          },
        ),
      );
      expect(session.close).not.toHaveBeenCalled();
      deliverTerminal();
      const result = await running;
      expect(result.snapshot?.invocations).toEqual([]);
      expect(scheduledNotificationTest.validate(result).passed).toBe(
        count === 2,
      );
      expect(
        (
          result.diagnostics!["scheduledNotification"] as Record<
            string,
            unknown
          >
        )["notifications"],
      ).toHaveLength(count);
    }
  });

  function scheduledProofFixture(actionKind: "notify" | "watch" = "notify") {
    const channelId = "headless-proof";
    const proofName =
      actionKind === "watch"
        ? "One-minute talk timer watch"
        : scheduledLaunch.name;
    const launch =
      actionKind === "watch"
        ? {
            ...scheduledLaunch,
            name: proofName,
            action: {
              kind: "watch",
              text: "Notify the owner when an update is found.",
            },
          }
        : scheduledLaunch;
    const messages = execution(
      "",
      launch,
      "Running and inspectable.",
      "launch_automation",
    ).messages;
    const launchMessage = messages.find(
      (message) => message.contentType === "invocation",
    )!;
    (
      launchMessage.invocation as unknown as { result: { details: unknown } }
    ).result.details = {
      missionId: "mission-proof",
    };
    const session = {
      channelId,
      messages,
      snapshot: () => ({ invocations: [] as { id: string; status: string }[] }),
      waitForInvocation: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = {
      runner: { spawn: async () => session },
      sendAndWait: vi.fn(async () => undefined),
      signal: new AbortController().signal,
      remainingTimeMs: () => 190_000,
    } as unknown as TestOrchestrationContext;
    const overview = (state: string, runCount: number) => ({
      items: [
        {
          automation: {
            name: proofName,
            missionId: "mission-proof",
            state,
            runCount,
            ...(state === "completed"
              ? {
                  completionReason: "response",
                  completionResponse: "Goal finished.",
                }
              : {}),
            charter: {
              execution: { conversation: { mode: "continue", channelId } },
            },
          },
          recentRuns: Array.from({ length: runCount }, (_, i) => ({
            runId: `run-${i + 1}`,
            phase: "terminal",
            outcome: "succeeded",
          })),
        },
      ],
    });
    const notifications = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const runId = `run-${i + 1}`;
        return {
          id:
            actionKind === "notify"
              ? `automation.notify:${runId}`
              : `agent.message:${i + 1}`,
          kind: actionKind === "notify" ? "automation.notify" : "agent.message",
          message: "One minute has passed.",
          data: {
            channelId,
            ...(actionKind === "notify"
              ? { missionId: "mission-proof", runId }
              : {}),
          },
        };
      });
    notificationRuntime.resolveService.mockResolvedValue({
      kind: "durable-object",
      targetId: "missions",
    });
    notificationRuntime.overview.mockReset();
    notificationRuntime.list.mockReset();
    return { context, session, overview, notifications };
  }

  it("collects conditional watch notifications from agent messages", async () => {
    const { context, overview, notifications } = scheduledProofFixture("watch");
    notificationRuntime.overview.mockResolvedValue(overview("completed", 2));
    notificationRuntime.list.mockResolvedValue(notifications(2));

    const result = await watchNotificationTest.orchestrate!(context);

    expect(notificationRuntime.list).toHaveBeenCalledTimes(1);
    expect(watchNotificationTest.validate(result)).toEqual({ passed: true });
    expect(context.sendAndWait).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("checks for updates every minute"),
      "scheduled notification launch",
    );
  });

  it.each(["completed", "retired"])(
    "retains an early %s mission and joins publication before reporting the unmet goal",
    async (state) => {
      const { context, session, overview, notifications } =
        scheduledProofFixture();
      notificationRuntime.overview.mockResolvedValue(overview(state, 1));
      notificationRuntime.list.mockResolvedValue(notifications(1));
      let pending = true;
      let publish!: () => void;
      session.snapshot = () => ({
        invocations: pending
          ? [{ id: "invocation:completion", status: "pending" }]
          : [],
      });
      session.waitForInvocation.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          publish = resolve;
        });
        pending = false;
      });
      const running = scheduledNotificationTest.orchestrate!(context);
      await vi.waitFor(() =>
        expect(session.waitForInvocation).toHaveBeenCalledWith(
          "invocation:completion",
          {
            signal: context.signal,
          },
        ),
      );
      expect(notificationRuntime.overview).toHaveBeenCalledTimes(1);
      expect(session.close).not.toHaveBeenCalled();
      publish();
      const result = await running;
      expect(result.error).toBeUndefined();
      expect(result.diagnostics!["scheduledNotification"]).toMatchObject({
        missionState: state,
        runCount: 1,
        runs: [{ runId: "run-1", outcome: "succeeded" }],
        notifications: [{ id: "automation.notify:run-1" }],
        ...(state === "completed"
          ? {
              completionReason: "response",
              completionResponse: "Goal finished.",
            }
          : {}),
      });
      expect(scheduledNotificationTest.validate(result)).toMatchObject({
        passed: false,
        reason: expect.stringContaining(
          `mission state: ${state}, run count: 1`,
        ),
      });
      expect(session.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["active", "paused"])(
    "keeps observing a %s mission until both requested runs become terminal",
    async (state) => {
      vi.useFakeTimers();
      try {
        const { context, session, overview, notifications } =
          scheduledProofFixture();
        notificationRuntime.overview
          .mockResolvedValueOnce(overview(state, 1))
          .mockResolvedValue(overview("completed", 2));
        notificationRuntime.list.mockResolvedValue(notifications(2));
        const running = scheduledNotificationTest.orchestrate!(context);
        await vi.advanceTimersByTimeAsync(0);
        expect(notificationRuntime.overview).toHaveBeenCalledTimes(1);
        expect(notificationRuntime.list).not.toHaveBeenCalled();
        expect(session.close).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        const result = await running;
        expect(notificationRuntime.overview).toHaveBeenCalledTimes(2);
        expect(result.error).toBeUndefined();
        expect(scheduledNotificationTest.validate(result)).toEqual({
          passed: true,
        });
        expect(session.close).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("rejects launch-only evidence without the promised outcome", () => {
    expect(
      scheduledNotificationTest.validate(
        execution(
          "",
          scheduledLaunch,
          "Running and inspectable.",
          "launch_automation",
        ),
      ),
    ).toMatchObject({
      passed: false,
      reason: "No durable scheduled-run evidence was observed",
    });
  });

  it("rejects a completed turn whose requested notification effect failed", () => {
    const result = execution(
      "",
      scheduledLaunch,
      "Running and inspectable.",
      "launch_automation",
    );
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
  const defaultHealthCode =
    "const units = await runtime.supervision.list(); const health = await runtime.supervision.health(units[0].identity); return health;";

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

  it("accepts default bounded health reads and an empty separate error buffer", () => {
    const gitBridgeIdentity = {
      kind: "extension" as const,
      entityId: "@workspace-extensions/git-bridge",
    };
    const observation = {
      ...nativeHealth,
      entries: [
        {
          ...nativeHealth.entries[0]!,
          receipt: {
            ...nativeHealth.entries[0]!.receipt,
            identity: gitBridgeIdentity,
            source: "extensions/git-bridge",
            logCount: 7,
            errorCount: 0,
          },
        },
      ],
    };
    const gitBridgeHealth = {
      ...health,
      entity: { ...health.entity, identity: gitBridgeIdentity, source: "extensions/git-bridge" },
      logs: Array.from({ length: 7 }, (_, index) => ({
        ...health.logs[0]!,
        identity: gitBridgeIdentity,
        timestamp: index + 1,
      })),
      errors: [],
    };
    expect(
      logsTest.validate(
        execution(
          defaultHealthCode,
          gitBridgeHealth,
          "Git Bridge (@workspace-extensions/git-bridge) is running and healthy. Its persisted log buffer contains 7 records. The separate error buffer is empty.",
          "eval",
          observation
        )
      )
    ).toEqual({ passed: true, reason: undefined });
  });

  it("rejects missing, malformed, or overrun native health bounds", () => {
    const malformed = {
      ...nativeHealth,
      entries: [
        {
          ...nativeHealth.entries[0]!,
          receipt: {
            protocol: "runtime-health-observation.v1",
            identity,
            source: "extensions/status",
            logCount: 2,
            errorCount: 1,
            dropped: { entries: 0, errors: 0 },
            capacity: { entries: 100, errors: 50 },
          },
        },
      ],
    };
    const overrun = {
      ...nativeHealth,
      entries: [
        {
          ...nativeHealth.entries[0]!,
          receipt: { ...nativeHealth.entries[0]!.receipt, logCount: 21 },
        },
      ],
    };
    for (const journal of [undefined, malformed, overrun]) {
      expect(
        logsTest.validate(
          execution(defaultHealthCode, health, "extensions/status has 2 logs and 1 error.", "eval", journal)
        )
      ).toMatchObject({ passed: false });
    }
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
