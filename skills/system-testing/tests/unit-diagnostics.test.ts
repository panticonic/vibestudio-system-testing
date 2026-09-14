import { describe, expect, it } from "vitest";

import type { TestExecutionResult } from "../types.js";
import { unitDiagnosticsTests } from "./unit-diagnostics.js";

function execution(
  code: string,
  returnValue: unknown,
  final = "The workspace has 4 automations: 2 active, 1 running, and 1 failed in the last 24 hours.",
  toolName = "eval",
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
          arguments:
            toolName === "eval"
              ? { code }
              : (returnValue as Record<string, unknown>),
          result: { details: { success: true, returnValue } },
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
  (candidate) => candidate.name === "automation-overview-readonly",
)!;
const automationLaunchTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-native-launch",
)!;
const scheduledNotificationTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-scheduled-notification",
)!;
const nativeControlTest = unitDiagnosticsTests.find(
  (candidate) => candidate.name === "automation-native-control",
)!;

describe("automation overview system test validator", () => {
  const readCode =
    "const service = await workers.resolveService('vibestudio.missions.v1'); const overview = await rpc.call(service.targetId, 'overview', [{}]); return { automations: overview.stats.total, active: overview.stats.active, running: overview.stats.running, failedLast24Hours: overview.stats.failedLast24Hours };";

  it("requires the canonical read-only surface and exact bounded counts", () => {
    expect(
      automationTest.validate(
        execution(readCode, {
          automations: 4,
          active: 2,
          running: 1,
          failedLast24Hours: 1,
        }),
      ),
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
        execution(
          "return { automations: 4, active: 2, running: 1, failedLast24Hours: 1 };",
          {},
        ),
      ),
    ).toMatchObject({
      passed: false,
      reason:
        "Expected exactly one successful eval reading the automation overview",
    });
  });

  it("rejects automation mutation attempts", () => {
    expect(
      automationTest.validate(
        execution(
          `${readCode}\nawait rpc.call(service.targetId, 'runNow', ['id']);`,
          {
            automations: 4,
            active: 2,
            running: 1,
            failedLast24Hours: 1,
          },
        ),
      ),
    ).toMatchObject({
      passed: false,
      reason: "Automation inspection probe attempted a mutating operation",
    });
  });

  it("rejects raw or extra automation data", () => {
    expect(
      automationTest.validate(
        execution(readCode, {
          automations: 4,
          active: 2,
          running: 1,
          failedLast24Hours: 1,
          definitions: [{ name: "news" }],
        }),
      ),
    ).toMatchObject({
      passed: false,
      reason:
        "Automation inspection eval did not return the exact bounded overview counts",
    });
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
    operations: [{ service: "vcs", method: "status", use: "action" }],
  };

  it("needs no approval pregrant for native launch", () => {
    expect(automationLaunchTest.authorityPolicy).toEqual({ authority: [] });
  });

  it("accepts one native launch with the requested exact lightweight behavior", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "",
          launch,
          "Daily project pulse is running; use its automation pill to inspect or stop it.",
          "launch_automation",
        ),
      ),
    ).toEqual({ passed: true });
  });

  it("accepts the numeric spelling of the same Thursday schedule", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "",
          { ...launch, trigger: { ...launch.trigger, expression: "5 5 * * 4" } },
          "Daily project pulse is running; use its automation pill to inspect or stop it.",
          "launch_automation",
        ),
      ),
    ).toEqual({ passed: true });
  });

  it("still rejects a schedule that is not the requested one", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "",
          { ...launch, trigger: { ...launch.trigger, expression: "5 5 * * 3" } },
          "Daily project pulse is running; use its automation pill to inspect or stop it.",
          "launch_automation",
        ),
      ),
    ).toMatchObject({ passed: false });
  });

  it("rejects routing creation through eval", () => {
    expect(
      automationLaunchTest.validate(
        execution(
          "return rpc.call(missions.targetId, 'launch', [input]);",
          launch,
          "Daily project pulse is running and inspectable.",
        ),
      ),
    ).toMatchObject({
      passed: false,
      reason:
        "No successful native launch created the requested inline-eval automation",
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

  it("requires a terminal successful run and independently observed notification", () => {
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
      "launch_automation",
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
            : { code: "return await rpc.call(service.targetId, 'pause', [id])" },
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
    (candidate) => candidate.name === "unit-list-inspect",
  )!;
  const logsTest = unitDiagnosticsTests.find(
    (candidate) => candidate.name === "unit-diagnostics-error-buffer",
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
    errors: [
      { identity, timestamp: 3, level: "error", message: "old failure" },
    ],
    dropped: { entries: 0, errors: 0 },
    capacity: { entries: 100, errors: 50 },
  };
  const healthCode =
    "const units = await runtime.supervision.list(); const health = await runtime.supervision.health(units[0].identity, { limit: 20, errorLimit: 10 }); return health;";

  it("accepts natural prose backed by list and detail inspection evidence", () => {
    expect(
      listTest.validate(
        execution(
          "const units = await runtime.supervision.list(); const detail = await runtime.supervision.health(units[0].identity, { limit: 5, errorLimit: 2 }); return { units: units.length, detail };",
          { units: 3, detail: { status: "running" } },
          "There are 3 workspace units available; the representative unit I inspected is running.",
        ),
      ),
    ).toEqual({ passed: true });
  });

  it("rejects the same natural claim when the detail inspection was fabricated", () => {
    expect(
      listTest.validate(
        execution(
          "return { units: 3, detail: { status: 'running' } };",
          { units: 3, detail: { status: "running" } },
          "There are 3 workspace units available; the representative unit I inspected is running.",
        ),
      ),
    ).toMatchObject({ passed: false });
  });

  it("joins bounded log and error buffers to one exact supervised unit", () => {
    expect(
      logsTest.validate(
        execution(
          healthCode,
          health,
          "extensions/status has 2 recent logs and 1 entry in its separate error buffer.",
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("rejects prose that is not backed by a unit health packet", () => {
    expect(
      logsTest.validate(
        execution(
          healthCode,
          { source: "extensions/status", logs: 2, errors: 1 },
          "extensions/status has 2 logs and 1 error.",
        ),
      ),
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
          "extensions/status has 2 logs and 1 error.",
        ),
      ),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("identity-consistent"),
    });
  });

  it("rejects a report that omits one observed buffer count", () => {
    expect(
      logsTest.validate(
        execution(
          healthCode,
          health,
          "extensions/status has 2 recent logs and looks healthy.",
        ),
      ),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("exact buffer counts"),
    });
  });
});
