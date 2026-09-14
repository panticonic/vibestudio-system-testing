import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";
import {
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
  successfulEvalCode,
  successfulEvalReturnValues,
} from "./_helpers.js";
import { walkRecords } from "./_scenario-evidence.js";

function semanticUnitInspection(
  result: Parameters<typeof noIncompleteInvocations>[0],
  requiredCode: RegExp[],
  finalClaims: RegExp[],
) {
  const code = successfulEvalCode(result);
  if (!requiredCode.every((pattern) => pattern.test(code))) {
    return {
      passed: false,
      reason:
        "Successful eval evidence omitted a required unit diagnostic surface",
    };
  }
  const final = findLastAgentMessage(result);
  if (!finalClaims.every((pattern) => pattern.test(final))) {
    return {
      passed: false,
      reason:
        "Final response did not report the observed unit diagnostics semantically",
    };
  }
  return noIncompleteInvocations(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameIdentity(
  value: unknown,
  expected: Record<string, unknown>,
): boolean {
  return (
    isRecord(value) &&
    value["kind"] === expected["kind"] &&
    value["entityId"] === expected["entityId"]
  );
}

function labeledCount(
  final: string,
  label: "log" | "error",
  count: number,
): boolean {
  if (
    count === 0 &&
    new RegExp(`\\bno\\s+(?:recent\\s+)?${label}s?\\b`, "iu").test(final)
  ) {
    return true;
  }
  return (
    new RegExp(`\\b${label}s?\\b[^\\d\\n]{0,24}\\b${count}\\b`, "iu").test(
      final,
    ) ||
    new RegExp(`\\b${count}\\b[^\\d\\n]{0,24}\\b${label}s?\\b`, "iu").test(
      final,
    )
  );
}

function unitDiagnosticLogInspection(
  result: Parameters<typeof noIncompleteInvocations>[0],
) {
  const code = successfulEvalCode(result);
  if (
    !/runtime\.supervision\.list/iu.test(code) ||
    !/runtime\.supervision\.health/iu.test(code) ||
    !/\blimit\s*:\s*[1-9]\d*/u.test(code) ||
    !/\berrorLimit\s*:\s*[1-9]\d*/u.test(code)
  ) {
    return {
      passed: false,
      reason:
        "The unit-log investigation did not perform one bounded exact-unit health read",
    };
  }

  const packet = walkRecords(successfulEvalReturnValues(result)).find(
    (record) => {
      const entity = record["entity"];
      const logs = record["logs"];
      const errors = record["errors"];
      const dropped = record["dropped"];
      const capacity = record["capacity"];
      if (
        !isRecord(entity) ||
        !isRecord(entity["identity"]) ||
        typeof entity["source"] !== "string" ||
        !Array.isArray(logs) ||
        !Array.isArray(errors) ||
        !isRecord(dropped) ||
        !isRecord(capacity)
      ) {
        return false;
      }
      const identity = entity["identity"];
      return (
        logs.every(
          (entry) =>
            isRecord(entry) && sameIdentity(entry["identity"], identity),
        ) &&
        errors.every(
          (entry) =>
            isRecord(entry) && sameIdentity(entry["identity"], identity),
        ) &&
        Number.isInteger(dropped["entries"]) &&
        Number.isInteger(dropped["errors"]) &&
        Number.isInteger(capacity["entries"]) &&
        Number.isInteger(capacity["errors"])
      );
    },
  );
  if (!packet) {
    return {
      passed: false,
      reason:
        "No identity-consistent unit health packet with separate log/error buffers was observed",
    };
  }

  const entity = packet["entity"] as Record<string, unknown>;
  const identity = entity["identity"] as Record<string, unknown>;
  const logs = packet["logs"] as unknown[];
  const errors = packet["errors"] as unknown[];
  const final = findLastAgentMessage(result);
  if (
    (!final.includes(String(entity["source"])) &&
      !final.includes(String(identity["entityId"]))) ||
    !labeledCount(final, "log", logs.length) ||
    !labeledCount(final, "error", errors.length)
  ) {
    return {
      passed: false,
      reason:
        "The final response did not identify the observed unit and report both exact buffer counts",
    };
  }
  return noIncompleteInvocations(result);
}

function automationInspectionChecked(
  result: Parameters<typeof noIncompleteInvocations>[0],
) {
  const evalCalls = getToolCalls(result).filter((call) => call.name === "eval");
  const code = successfulEvalCode(result);
  if (
    evalCalls.length !== 1 ||
    !code.includes("vibestudio.missions.v1") ||
    !/\boverview\b/u.test(code)
  ) {
    return {
      passed: false,
      reason:
        "Expected exactly one successful eval reading the automation overview",
    };
  }
  const allEvalCode = getToolCalls(result)
    .filter((call) => call.name === "eval")
    .map((call) =>
      typeof call.arguments?.["code"] === "string"
        ? call.arguments["code"]
        : "",
    )
    .join("\n");
  if (
    /\b(?:runNow|pause|resume|retire|requestReview|createDraft|proposeDraft|edit)\b/u.test(
      allEvalCode,
    )
  ) {
    return {
      passed: false,
      reason: "Automation inspection probe attempted a mutating operation",
    };
  }
  if (!successfulEvalReturnValues(result).some(isExactAutomationCounts)) {
    return {
      passed: false,
      reason:
        "Automation inspection eval did not return the exact bounded overview counts",
    };
  }
  const final = findLastAgentMessage(result);
  if (
    !/automation/iu.test(final) ||
    !/active/iu.test(final) ||
    !/fail/iu.test(final) ||
    !/\d/u.test(final)
  ) {
    return {
      passed: false,
      reason: "Final response did not report the observed automation counts",
    };
  }
  return noIncompleteInvocations(result);
}

function isExactAutomationCounts(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") ===
      "active,automations,failedLast24Hours,running" &&
    ["active", "automations", "failedLast24Hours", "running"].every(
      (key) =>
        Number.isSafeInteger(record[key]) && (record[key] as number) >= 0,
    )
  );
}

function automationNativeLaunchChecked(
  result: Parameters<typeof noIncompleteInvocations>[0],
) {
  const calls = getToolCalls(result).filter(
    (call) => call.name === "launch_automation",
  );
  if (
    calls.length !== 1 ||
    calls[0]?.execution?.status !== "complete" ||
    calls[0]?.execution?.isError === true ||
    !isDailyProjectPulseLaunch(calls[0]?.arguments)
  ) {
    return {
      passed: false,
      reason:
        "No successful native launch created the requested inline-eval automation",
    };
  }
  if (
    getToolCalls(result).some(
      (call) =>
        call.name === "eval" &&
        /(?:launch_automation|automations\.propose|missions\.launch)/u.test(
          String(call.arguments?.["code"] ?? ""),
        ),
    )
  ) {
    return {
      passed: false,
      reason:
        "The automation launch was routed through eval instead of the native tool",
    };
  }
  const final = findLastAgentMessage(result);
  if (
    !/(?:running|started|launched)/iu.test(final) ||
    !/(?:pill|automation)/iu.test(final)
  ) {
    return {
      passed: false,
      reason:
        "Final response did not explain that the automation is running and inspectable",
    };
  }
  return noIncompleteInvocations(result);
}

const SCHEDULED_NOTIFICATION_NAME = "One-minute talk timer";
const SCHEDULED_NOTIFICATION_TEXT = "One minute has passed.";

async function scheduledNotificationProof(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let observation: Record<string, unknown> | undefined;
  try {
    const { gad, rpc, workers } = await import("@workspace/runtime");
    await context.sendAndWait(
      session,
      `I'm giving a talk. Start an automation called “${SCHEDULED_NOTIFICATION_NAME}” that notifies me every minute saying exactly “${SCHEDULED_NOTIFICATION_TEXT}”, and stop it after two notifications. Tell me where I can inspect or stop it.`,
      "scheduled notification launch",
    );
    const service = await workers.resolveService("vibestudio.missions.v1");
    if (service.kind !== "durable-object" || !service.targetId) {
      throw new Error(
        "The automation ledger did not resolve to a Durable Object",
      );
    }
    const deadline =
      Date.now() + Math.min(190_000, context.remainingTimeMs() ?? 190_000);
    while (Date.now() < deadline) {
      const overview = await rpc.call<Record<string, unknown>>(
        service.targetId,
        "overview",
        [{ query: SCHEDULED_NOTIFICATION_NAME, limit: 5 }],
      );
      const item = Array.isArray(overview["items"])
        ? overview["items"][0]
        : undefined;
      const itemRecord = isRecord(item) ? item : undefined;
      const automation = isRecord(itemRecord?.["automation"])
        ? itemRecord?.["automation"]
        : undefined;
      const recentRuns = Array.isArray(itemRecord?.["recentRuns"])
        ? itemRecord?.["recentRuns"]
        : [];
      const runs = recentRuns.filter(
        (candidate) => isRecord(candidate) && candidate["phase"] === "terminal",
      );
      if (
        automation?.["name"] === SCHEDULED_NOTIFICATION_NAME &&
        automation["runCount"] === 2 &&
        runs.length >= 2
      ) {
        const notifications = await gad.listUserNotificationsForMe({
          includeAcknowledged: true,
          limit: 100,
        });
        const matchingNotifications = notifications.filter(
          (candidate) =>
            candidate.kind === "agent.message" &&
            candidate.message === SCHEDULED_NOTIFICATION_TEXT,
        );
        const conversation = isRecord(automation["charter"])
          ? isRecord(automation["charter"]["execution"])
            ? automation["charter"]["execution"]["conversation"]
            : undefined
          : undefined;
        observation = {
          missionId: automation["missionId"],
          missionState: automation["state"],
          runCount: automation["runCount"],
          launchChannelId: session.channelId,
          conversation,
          redundantInviteCount: notifications.filter(
            (candidate) =>
              candidate.kind === "channel.invite" &&
              isRecord(candidate.data) &&
              candidate.data["channelId"] === session.channelId,
          ).length,
          runs: runs.slice(0, 2).map((run) => ({
            runId: run["runId"],
            phase: run["phase"],
            outcome: run["outcome"],
            finalMessage: run["finalMessage"],
            failure: run["failure"],
            effectFailures: run["effectFailures"],
          })),
          notifications: matchingNotifications.map((notification) => ({
            id: notification.id,
            kind: notification.kind,
            title: notification.title,
            message: notification.message,
            channelId: isRecord(notification.data)
              ? notification.data["channelId"]
              : undefined,
          })),
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!observation)
      throw new Error("Two scheduled runs did not become terminal in time");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    diagnostics: { scheduledNotification: observation ?? null },
    ...(error ? { error } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [
      `close: ${cause instanceof Error ? cause.message : String(cause)}`,
    ];
  }
  return execution;
}

function scheduledNotificationChecked(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const base = noIncompleteInvocations(result);
  if (!base.passed) return base;
  const launches = getToolCalls(result).filter(
    (call) =>
      call.name === "launch_automation" &&
      call.execution?.status === "complete" &&
      call.execution?.isError !== true &&
      call.arguments?.["name"] === SCHEDULED_NOTIFICATION_NAME,
  );
  if (launches.length !== 1) {
    return {
      passed: false,
      reason: "The proof automation was not launched exactly once",
    };
  }
  if (
    (launches[0]?.arguments?.["action"] as { kind?: unknown } | undefined)
      ?.kind !== "prompt"
  ) {
    return {
      passed: false,
      reason: "The prompt-execution proof launched a different executor",
    };
  }
  const trigger = launches[0]?.arguments?.["trigger"];
  if (
    !isRecord(trigger) ||
    trigger["kind"] !== "schedule" ||
    trigger["everyMs"] !== 60_000 ||
    trigger["maxRuns"] !== 2
  ) {
    return {
      passed: false,
      reason:
        "The agent did not infer a one-minute automation that stops after two runs",
    };
  }
  const observed = result.diagnostics?.["scheduledNotification"];
  if (!isRecord(observed) || !Array.isArray(observed["runs"])) {
    return {
      passed: false,
      reason: "No durable scheduled-run evidence was observed",
    };
  }
  const runs = observed["runs"].filter(isRecord);
  const failedRun = runs.find(
    (run) => run["phase"] !== "terminal" || run["outcome"] !== "succeeded",
  );
  if (runs.length !== 2 || failedRun) {
    return {
      passed: false,
      reason: `Both scheduled runs and their requested effects must succeed: ${JSON.stringify(runs)}`,
    };
  }
  const conversation = observed["conversation"];
  if (
    !isRecord(conversation) ||
    conversation["mode"] !== "continue" ||
    conversation["channelId"] !== observed["launchChannelId"]
  ) {
    return {
      passed: false,
      reason:
        "The short-cadence automation did not wake the launching agent in its existing conversation",
    };
  }
  const notifications = Array.isArray(observed["notifications"])
    ? observed["notifications"].filter(isRecord)
    : [];
  if (
    notifications.length !== 2 ||
    new Set(notifications.map((notification) => notification["id"])).size !==
      2 ||
    notifications.some(
      (notification) => notification["message"] !== SCHEDULED_NOTIFICATION_TEXT,
    )
  ) {
    return {
      passed: false,
      reason:
        "The two successful runs did not produce two distinct durable user notifications",
    };
  }
  if (
    notifications.some(
      (notification) =>
        notification["channelId"] !== observed["launchChannelId"],
    )
  ) {
    return {
      passed: false,
      reason:
        "The notification did not route back to the launching conversation",
    };
  }
  if (observed["redundantInviteCount"] !== 0) {
    return {
      passed: false,
      reason:
        "The direct automation message leaked a redundant channel invitation into the inbox",
    };
  }
  return { passed: true };
}

const NATIVE_CONTROL_NAME = "Sloth facts stop proof";

async function nativeAutomationControlProof(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let observation: Record<string, unknown> | undefined;
  try {
    const { rpc, workers } = await import("@workspace/runtime");
    await context.sendAndWait(
      session,
      `Every minute, send me a fun fact about sloths. Call it “${NATIVE_CONTROL_NAME}”.`,
      "natural automation launch",
    );
    await context.sendAndWait(
      session,
      "Thanks for doing this — please stop now.",
      "natural automation stop",
    );
    const service = await workers.resolveService("vibestudio.missions.v1");
    if (service.kind !== "durable-object" || !service.targetId) {
      throw new Error(
        "The automation ledger did not resolve to a Durable Object",
      );
    }
    const overview = await rpc.call<Record<string, unknown>>(
      service.targetId,
      "overview",
      [{ query: NATIVE_CONTROL_NAME, limit: 5 }],
    );
    const item = Array.isArray(overview["items"])
      ? overview["items"][0]
      : undefined;
    const automation = isRecord(item) && isRecord(item["automation"])
      ? item["automation"]
      : undefined;
    observation = automation
      ? {
          missionId: automation["missionId"],
          name: automation["name"],
          state: automation["state"],
          runCount: automation["runCount"],
        }
      : undefined;
    if (!observation) throw new Error("The launched automation was not found");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    diagnostics: { nativeAutomationControl: observation ?? null },
    ...(error ? { error } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [
      `close: ${cause instanceof Error ? cause.message : String(cause)}`,
    ];
  }
  return execution;
}

function nativeAutomationControlChecked(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const base = noIncompleteInvocations(result);
  if (!base.passed) return base;
  const launches = getToolCalls(result).filter(
    (call) => call.name === "launch_automation",
  );
  const controls = getToolCalls(result).filter(
    (call) => call.name === "control_automation",
  );
  if (
    launches.length !== 1 ||
    launches[0]?.execution?.status !== "complete" ||
    launches[0]?.execution?.isError === true
  ) {
    return { passed: false, reason: "The automation was not launched once" };
  }
  if (
    controls.length !== 1 ||
    controls[0]?.arguments?.["action"] !== "pause" ||
    controls[0]?.execution?.status !== "complete" ||
    controls[0]?.execution?.isError === true
  ) {
    return {
      passed: false,
      reason: "The natural stop request did not complete through one native pause",
    };
  }
  if (getToolCalls(result).some((call) => call.name === "eval")) {
    return {
      passed: false,
      reason: "The stop request performed automation discovery through eval",
    };
  }
  const observed = result.diagnostics?.["nativeAutomationControl"];
  if (
    !isRecord(observed) ||
    observed["name"] !== NATIVE_CONTROL_NAME ||
    observed["state"] !== "paused"
  ) {
    return {
      passed: false,
      reason: "The canonical automation ledger did not retain the paused state",
    };
  }
  return { passed: true };
}

function isDailyProjectPulseLaunch(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const trigger = record["trigger"] as Record<string, unknown> | undefined;
  const action = record["action"] as Record<string, unknown> | undefined;
  const conversation = record["conversation"] as
    | Record<string, unknown>
    | undefined;
  const operations = record["operations"];
  const source = action?.["code"];
  return (
    record["name"] === "Daily project pulse" &&
    trigger?.["kind"] === "cron" &&
    // Thursday has two canonical cron spellings and the platform accepts
    // both. Grading one of them grades transcription, not whether the agent
    // scheduled the automation the request asked for.
    /^5\s+5\s+\*\s+\*\s+(?:4|THU)$/iu.test(String(trigger["expression"] ?? "")) &&
    trigger["timezone"] === "America/New_York" &&
    trigger["untilAt"] === Date.UTC(2027, 0, 1, 5) &&
    trigger["maxRuns"] === 12 &&
    action?.["kind"] === "eval" &&
    typeof source === "string" &&
    /vcs\.status/u.test(source) &&
    /automation-completion\.v1/u.test(source) &&
    conversation?.["mode"] === "fresh" &&
    Array.isArray(operations) &&
    operations.some(
      (operation) =>
        operation !== null &&
        typeof operation === "object" &&
        (operation as Record<string, unknown>)["service"] === "vcs" &&
        (operation as Record<string, unknown>)["method"] === "status" &&
        (operation as Record<string, unknown>)["use"] === "action",
    ) &&
    record["permissions"] === undefined &&
    record["toolExposure"] === undefined &&
    record["declaredLineageClasses"] === undefined
  );
}

export const unitDiagnosticsTests: TestCase[] = [
  {
    name: "unit-list-inspect",
    description: "List running workspace units and inspect one of them",
    category: "unit-diagnostics",
    prompt:
      "Which workspace units are currently running? Inspect one representative unit in more detail and summarize what you observed.",
    validate: (result) =>
      semanticUnitInspection(
        result,
        [
          /runtime\.supervision\.list/iu,
          /runtime\.supervision\.(?:describe|health)/iu,
        ],
        [/unit/iu, /running|available|status/iu, /\d/u],
      ),
  },
  {
    name: "unit-diagnostics-error-buffer",
    description: "Read a unit's persisted logs and its separate error buffer",
    category: "unit-diagnostics",
    prompt:
      "For one running workspace unit, summarize a bounded slice of its recent persisted logs and its separate error buffer.",
    validate: unitDiagnosticLogInspection,
  },
  {
    name: "unit-versions",
    description: "Report the version history of a workspace unit",
    category: "unit-diagnostics",
    prompt:
      "Pick a workspace app and tell me how many retained versions it has and whether any version is currently active. If one is active, identify it.",
    validate: (result) =>
      semanticUnitInspection(
        result,
        [/build\.listUnits/iu, /runtime\.supervision\.versions/iu],
        [/version/iu, /active|current/iu, /\d/u],
      ),
  },
  {
    name: "automation-overview-readonly",
    description: "Inspect the canonical automation ledger without mutating it",
    category: "unit-diagnostics",
    prompt:
      "How many automations are configured, active, running, or failed in the last 24 hours? Inspect the automation overview, report only those counts, and do not change or run anything.",
    authorityPolicy: {
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
    },
    validate: automationInspectionChecked,
  },
  {
    name: "automation-native-launch",
    description:
      "Agent immediately launches a finite timezone-aware calendar eval without publishing a worker",
    category: "unit-diagnostics",
    prompt:
      "Please launch an automation named ‘Daily project pulse’ for every Thursday at 5:05 a.m. America/New_York time. Stop it at midnight New York time when 2027 begins or after 12 admitted runs, whichever happens first. It should use a lightweight inline script—not a new code project or a model call—to inspect current project status and publish a concise status event into that run's conversation. When the status proves the recurring goal is finished, have the eval return the documented automation completion response. Keep it offline and isolate each run in a fresh conversation. Start it immediately and tell me where I can inspect or stop it.",
    authorityPolicy: { authority: [] },
    validation: "agent-evidence",
    validate: automationNativeLaunchChecked,
  },
  {
    name: "automation-scheduled-notification",
    description:
      "A launched one-minute automation completes two real runs and notifies its owner twice",
    category: "unit-diagnostics",
    timeoutMs: 240_000,
    prompt: "Harness-orchestrated scheduled automation outcome proof.",
    authorityPolicy: {
      authority: [
        {
          ruleId: "inspect-scheduled-automation",
          capability: { kind: "exact", key: "workspace-service:missions" },
          resource: {
            kind: "prefix",
            prefix: "do:workers/missions:MissionsDO:",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    validation: "agent-evidence",
    orchestrate: scheduledNotificationProof,
    validate: scheduledNotificationChecked,
  },
  {
    name: "automation-native-control",
    description:
      "A natural follow-up stop request pauses the owner's automation without eval or redundant approval",
    category: "unit-diagnostics",
    timeoutMs: 120_000,
    prompt: "Harness-orchestrated native automation control proof.",
    authorityPolicy: { authority: [] },
    validation: "agent-evidence",
    orchestrate: nativeAutomationControlProof,
    validate: nativeAutomationControlChecked,
  },
];
