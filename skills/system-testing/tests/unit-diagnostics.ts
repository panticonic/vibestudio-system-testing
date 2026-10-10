import {
  NativeRuntimeHealthObservationSchema,
  NativeRuntimeInventoryObservationSchema,
} from "@vibestudio/service-schemas/runtime";
import { missionOverviewStatsSchema } from "@vibestudio/service-schemas/missions";
import type { TestCase, TestExecutionResult, TestOrchestrationContext } from "../types.js";
import {
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
  successfulEvalCode,
  successfulEvalReturnValues,
} from "./_helpers.js";

function semanticUnitInspection(
  result: Parameters<typeof noIncompleteInvocations>[0],
  requiredCode: RegExp[],
  finalClaims: RegExp[]
) {
  const code = successfulEvalCode(result);
  if (!requiredCode.every((pattern) => pattern.test(code))) {
    return {
      passed: false,
      reason: "Successful eval evidence omitted a required unit diagnostic surface",
    };
  }
  const final = findLastAgentMessage(result);
  if (!finalClaims.every((pattern) => pattern.test(final))) {
    return {
      passed: false,
      reason: "Final response did not report the observed unit diagnostics semantically",
    };
  }
  return noIncompleteInvocations(result);
}

function unitListInspection(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const entries = getToolCalls(result).flatMap((call) => {
    if (
      call.name !== "eval" ||
      call.execution?.status !== "complete" ||
      call.execution.isError === true
    ) {
      return [];
    }
    const output = call.execution.result;
    const details = isRecord(output) && isRecord(output["details"]) ? output["details"] : null;
    const journal = details && isRecord(details["operationJournal"]) ? details["operationJournal"] : null;
    if (
      journal?.["protocol"] !== "workspace-operations.v1" ||
      journal["truncated"] !== false ||
      !Array.isArray(journal["entries"])
    ) {
      return [];
    }
    return journal["entries"];
  });
  const inventories = entries.flatMap((entry) => {
    if (!isRecord(entry) || entry["type"] !== "runtime.inventory") return [];
    const parsed = NativeRuntimeInventoryObservationSchema.safeParse(entry["receipt"]);
    return parsed.success ? [parsed.data] : [];
  });
  const healthObservations = entries.flatMap((entry) => {
    if (!isRecord(entry) || entry["type"] !== "runtime.health") return [];
    const parsed = NativeRuntimeHealthObservationSchema.safeParse(entry["receipt"]);
    return parsed.success ? [parsed.data] : [];
  });
  const inventory = inventories.at(-1);
  if (!inventory) {
    return {
      passed: false,
      reason: "No native workspace unit inventory observation was recorded",
    };
  }
  const detail = healthObservations.find((health) =>
    inventory.entities.some(
      (entity) =>
        entity.identity.kind === health.identity.kind &&
        entity.identity.entityId === health.identity.entityId &&
        entity.source === health.source
    )
  );
  if (!detail) {
    return {
      passed: false,
      reason: "No native unit health observation matched an entity in the observed inventory",
    };
  }
  const entity = inventory.entities.find(
    (candidate) =>
      candidate.identity.kind === detail.identity.kind &&
      candidate.identity.entityId === detail.identity.entityId &&
      candidate.source === detail.source
  );
  if (!entity) {
    return {
      passed: false,
      reason: "No native unit health observation matched an entity in the observed inventory",
    };
  }
  const final = findLastAgentMessage(result);
  const countPattern = new RegExp(
    `\\b${inventory.entities.length}\\b[^.\\n]{0,40}\\b(?:running\\s+)?(?:workspace\\s+)?(?:units?|entities)\\b|\\b(?:running\\s+)?(?:workspace\\s+)?(?:units?|entities)\\b[^.\\n]{0,40}\\b${inventory.entities.length}\\b`,
    "iu"
  );
  if (
    !countPattern.test(final) ||
    (!final.includes(entity.source) && !final.includes(entity.identity.entityId)) ||
    !final.toLocaleLowerCase().includes(entity.status.toLocaleLowerCase())
  ) {
    return {
      passed: false,
      reason: "Final response did not summarize the observed unit count and one inspected unit",
    };
  }
  return noIncompleteInvocations(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function labeledCount(final: string, label: "log" | "error", count: number): boolean {
  if (count === 0 && /both buffers (?:are )?empty/iu.test(final)) return true;
  if (
    count === 0 &&
    new RegExp(
      `\\b(?:empty[^.\\n]{0,24}\\b${label}s?\\b|\\b${label}s?\\b[^.\\n]{0,24}\\b(?:is|are|remains|remain)?\\s+empty\\b)`,
      "iu"
    ).test(final)
  ) {
    return true;
  }
  if (count === 0 && new RegExp(`\\b(?:no|zero)\\b[^.\\n]*\\b${label}(?:s| entries)?\\b`, "iu").test(final)) return true;
  if (count === 0 && new RegExp(`\\bno\\s+(?:recent\\s+)?${label}s?\\b`, "iu").test(final)) {
    return true;
  }
  return (
    new RegExp(`\\b${label}s?\\b[^\\d\\n]{0,24}\\b${count}\\b`, "iu").test(final) ||
    new RegExp(`\\b${count}\\b[^\\d\\n]{0,24}\\b${label}s?\\b`, "iu").test(final)
  );
}

function unitDiagnosticLogInspection(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const receipts = getToolCalls(result).filter((call) => call.name === "eval").flatMap((call) => {
    const output = call.execution?.result;
    const details = isRecord(output) && isRecord(output["details"]) ? output["details"] : null;
    const journal = details && isRecord(details["operationJournal"]) ? details["operationJournal"] : null;
    if (journal?.["protocol"] !== "workspace-operations.v1" || journal["truncated"] !== false || !Array.isArray(journal["entries"])) return [];
    return journal["entries"].flatMap((entry) => {
      if (!isRecord(entry) || entry["type"] !== "runtime.health") return [];
      const parsed = NativeRuntimeHealthObservationSchema.safeParse(entry["receipt"]);
      return parsed.success ? [parsed.data] : [];
    });
  });
  const packet = receipts.at(-1);
  if (!packet) return { passed: false, reason: "No native identity-consistent unit health packet with separate log/error buffers was observed" };
  if (packet.logCount > packet.limit || packet.errorCount > packet.errorLimit) {
    return {
      passed: false,
      reason: "The native unit health packet exceeded its effective log or error read bound",
    };
  }
  const final = findLastAgentMessage(result);
  if (
    (!final.includes(packet.source) && !final.includes(packet.identity.entityId)) ||
    !labeledCount(final, "log", packet.logCount) ||
    !labeledCount(final, "error", packet.errorCount)
  ) {
    return {
      passed: false,
      reason:
        "The final response did not identify the observed unit and report both exact buffer counts",
    };
  }
  return noIncompleteInvocations(result);
}

function automationInspectionChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const evalCalls = getToolCalls(result).filter((call) => call.name === "eval");
  const code = successfulEvalCode(result);
  if (
    evalCalls.length !== 1 ||
    !/\bmissions\b/u.test(code) ||
    !/\boverview\b/u.test(code)
  ) {
    return {
      passed: false,
      reason: "Expected exactly one successful eval reading the automation overview",
    };
  }
  const allEvalCode = getToolCalls(result)
    .filter((call) => call.name === "eval")
    .map((call) => (typeof call.arguments?.["code"] === "string" ? call.arguments["code"] : ""))
    .join("\n");
  if (
    /\b(?:runNow|pause|resume|retire|requestReview|createDraft|proposeDraft|edit)\b/u.test(
      allEvalCode
    )
  ) {
    return {
      passed: false,
      reason: "Automation inspection probe attempted a mutating operation",
    };
  }
  const stats = successfulEvalReturnValues(result)
    .map(missionOverviewStatsObservation)
    .find((candidate) => candidate !== null);
  if (!stats) {
    return {
      passed: false,
      reason: "Automation inspection did not return canonical aggregate counts from the overview",
    };
  }
  const final = findLastAgentMessage(result);
  const reported = automationOverviewCountClaims(final);
  if (!reported) {
    return { passed: false, reason: "Final response did not report the observed automation counts" };
  }
  const matchesObserved = (claims: number[], expected: number) =>
    claims.length > 0 && claims.every((claim) => claim === expected);
  if (
    !matchesObserved(reported.total, stats.total) ||
    !matchesObserved(reported.active, stats.active) ||
    !matchesObserved(reported.running, stats.running) ||
    !matchesObserved(reported.issuesLast24Hours, stats.issueRunsLast24Hours)
  ) {
    return { passed: false, reason: "Final response did not report the observed automation counts" };
  }
  return noIncompleteInvocations(result);
}

type AutomationCountName = "total" | "active" | "running" | "issuesLast24Hours";

/**
 * Pair each count with adjacent metric tokens in report order. This keeps
 * neighboring values from satisfying a missing count and ignores numeric time
 * windows such as "last 24 hours".
 */
function automationOverviewCountClaims(final: string): Record<AutomationCountName, number[]> | null {
  const claims: Record<AutomationCountName, number[]> = {
    total: [],
    active: [],
    running: [],
    issuesLast24Hours: [],
  };
  const fields = final.split(/[\n;]+|,(?!\d{3}\b)/u);
  for (const field of fields) {
    const numbers = [...field.matchAll(/\b\d+(?:,\d{3})*\b/gu)]
      .map((match) => ({
        kind: "count" as const,
        value: Number(match[0].replaceAll(",", "")),
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      }))
      .filter(({ end }) => {
        const following = field.slice(end);
        return !/^\s*(?:[-–]\s*)?(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\b/iu.test(
          following,
        );
      });
    const explicitLabels = [
      ...field.matchAll(/\b(?:configured|total)\b/giu),
      ...field.matchAll(/\bactive\b/giu),
      ...field.matchAll(/\brunning\b/giu),
      ...field.matchAll(/\b(?:failed|failures?|issues?)\b/giu),
    ].map((match) => {
      const text = match[0].toLocaleLowerCase();
      const name: AutomationCountName =
        text === "configured" || text === "total"
          ? "total"
          : text === "active"
            ? "active"
            : text === "running"
              ? "running"
              : "issuesLast24Hours";
      return {
        kind: "label" as const,
        name,
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      };
    });
    const genericMatches = [...field.matchAll(/\bautomations?\b/giu)];
    const genericLabels = genericMatches.map((match) => {
      const start = match.index ?? 0;
      const preceding = explicitLabels
        .filter((label) => label.start < start)
        .sort((left, right) => right.start - left.start)[0];
      const following = explicitLabels
        .filter((label) => label.start > start)
        .sort((left, right) => left.start - right.start)[0];
      const hasCountBetween = (label: (typeof explicitLabels)[number] | undefined) =>
        label !== undefined && numbers.some((number) =>
          label.start < start
            ? number.start >= label.end && number.end <= start
            : number.start >= start + match[0].length && number.end <= label.start,
        );
      const previousMetric = preceding && !hasCountBetween(preceding) && preceding.name !== "total"
        ? preceding.name
        : undefined;
      const nextMetric = following && !hasCountBetween(following) && following.name !== "total"
        ? following.name
        : undefined;
      return {
        kind: "label" as const,
        name: previousMetric && nextMetric && previousMetric !== nextMetric
          ? null
          : previousMetric ?? nextMetric ?? "total",
        start,
        end: start + match[0].length,
      };
    });
    if (genericLabels.some(({ name }) => name === null)) return null;
    const labels = [...explicitLabels, ...genericLabels] as Array<{
      kind: "label";
      name: AutomationCountName;
      start: number;
      end: number;
    }>;
    const tokens = [...numbers, ...labels].sort((left, right) => left.start - right.start);
    const collapsed: typeof tokens = [];
    for (const token of tokens) {
      const previous = collapsed.at(-1);
      if (token.kind === "label" && previous?.kind === "label" && token.name === previous.name) {
        previous.end = token.end;
        continue;
      }
      if (token.kind === "label" && previous?.kind === "label") return null;
      collapsed.push(token);
    }
    for (let index = 0; index + 1 < collapsed.length; ) {
      const first = collapsed[index]!;
      const second = collapsed[index + 1]!;
      if (first.kind === "count" && second.kind === "label") {
        claims[second.name].push(first.value);
        index += 2;
      } else if (first.kind === "label" && second.kind === "count") {
        claims[first.name].push(second.value);
        index += 2;
      } else {
        index += 1;
      }
    }
  }
  return claims;
}

/** Read the canonical aggregate counters directly or from a full overview. */
function missionOverviewStatsObservation(value: unknown) {
  const direct = missionOverviewStatsSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (!isRecord(value)) return null;

  const stats = missionOverviewStatsSchema.safeParse(value["stats"]);
  return stats.success ? stats.data : null;
}

function automationNativeLaunchChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const calls = getToolCalls(result).filter((call) => call.name === "launch_automation");
  const output = calls[0]?.execution?.result;
  const definition = isRecord(output) && isRecord(output["details"]) ? output["details"] : null;
  const charter = definition && isRecord(definition["charter"]) ? definition["charter"] : null;
  const execution = charter && isRecord(charter["execution"]) ? charter["execution"] : null;
  const retainedLaunch =
    definition && charter && execution
      ? {
          name: definition["name"],
          trigger: charter["trigger"],
          action: execution["action"],
          conversation: execution["conversation"],
          operations: execution["operations"],
        }
      : null;
  if (
    calls.length !== 1 ||
    calls[0]?.execution?.status !== "complete" ||
    calls[0]?.execution?.isError === true ||
    !isDailyProjectPulseLaunch(calls[0]?.arguments) ||
    !isDailyProjectPulseLaunch(retainedLaunch) ||
    execution?.["kind"] !== "agent" ||
    definition?.["state"] !== "active" ||
    typeof definition?.["missionId"] !== "string" ||
    !definition["missionId"]
  ) {
    return {
      passed: false,
      reason: "No successful native launch retained the requested active finite automation",
    };
  }
  if (
    getToolCalls(result).some(
      (call) =>
        call.name === "eval" &&
        /(?:launch_automation|automations\.propose|missions\.launch)/u.test(
          String(call.arguments?.["code"] ?? "")
        )
    )
  ) {
    return {
      passed: false,
      reason: "The automation launch was routed through eval instead of the native tool",
    };
  }
  const final = findLastAgentMessage(result);
  if (
    !/(?:running|started|launched|active)/iu.test(final) ||
    !/(?:pill|automation)/iu.test(final)
  ) {
    return {
      passed: false,
      reason: "Final response did not explain that the automation is running and inspectable",
    };
  }
  return noIncompleteInvocations(result);
}

const SCHEDULED_NOTIFICATION_NAME = "One-minute talk timer";
const SCHEDULED_NOTIFICATION_TEXT = "One minute has passed.";

async function scheduledNotificationProof(
  context: TestOrchestrationContext,
  actionKind: "notify" | "watch" = "notify",
): Promise<TestExecutionResult> {
  const proofName =
    actionKind === "watch"
      ? `${SCHEDULED_NOTIFICATION_NAME} watch`
      : SCHEDULED_NOTIFICATION_NAME;
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let observation: Record<string, unknown> | undefined;
  try {
    const { gad, rpc, workers } = await import("@workspace/runtime");
    await context.sendAndWait(
      session,
      actionKind === "watch"
        ? `Start an automation called “${proofName}” that checks for updates every minute without invoking AI for the check, and wakes an agent to notify me only when the check finds an update. For this offline demonstration, treat an update as available each time. Send the notification “${SCHEDULED_NOTIFICATION_TEXT}”, stop after two runs, and keep it in this conversation. Tell me where I can inspect or stop it.`
        : `I'm giving a talk. Start an automation called “${proofName}” that sends me a notification every minute saying exactly “${SCHEDULED_NOTIFICATION_TEXT}”, and stop it after two notifications. Tell me where I can inspect or stop it.`,
      "scheduled notification launch",
    );
    const launches = getToolCalls({
      messages: [...session.messages],
      duration: 0,
      snapshot: session.snapshot(),
    }).filter(
      (call) =>
        call.name === "launch_automation" &&
        call.execution?.status === "complete" &&
        call.execution?.isError !== true &&
        call.arguments?.["name"] === proofName,
    );
    const launchResult = launches[0]?.execution?.result;
    const launchDetails =
      isRecord(launchResult) && isRecord(launchResult["details"])
        ? launchResult["details"]
        : undefined;
    const missionId = launchDetails?.["missionId"];
    if (launches.length !== 1 || typeof missionId !== "string")
      throw new Error(
        "The proof automation did not return one exact durable mission identity",
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
        [{ missionId, limit: 1 }],
      );
      const item = Array.isArray(overview["items"])
        ? overview["items"].find(
            (candidate) =>
              isRecord(candidate) &&
              isRecord(candidate["automation"]) &&
              candidate["automation"]["missionId"] === missionId,
          )
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
      const stopped =
        automation?.["state"] === "completed" ||
        automation?.["state"] === "retired";
      if (
        automation?.["name"] === proofName &&
        ((automation["runCount"] === 2 && runs.length >= 2) || stopped)
      ) {
        const notificationKind =
          actionKind === "notify" ? "automation.notify" : "agent.message";
        const notifications = await gad.listUserNotificationsForMe({
          includeAcknowledged: true,
          limit: 100,
        });
        const matchingNotifications = notifications.filter(
          (candidate) =>
            candidate.kind === notificationKind &&
            candidate.message === SCHEDULED_NOTIFICATION_TEXT &&
            isRecord(candidate.data) &&
            candidate.data["channelId"] === session.channelId &&
            (actionKind !== "notify" ||
              candidate.data["missionId"] === missionId),
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
          nextRunAt: automation["nextRunAt"],
          completionReason: automation["completionReason"],
          completionResponse: automation["completionResponse"],
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
            missionId: isRecord(notification.data)
              ? notification.data["missionId"]
              : undefined,
            runId: isRecord(notification.data)
              ? notification.data["runId"]
              : undefined,
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
    // A stopped mission cannot produce another scheduled run. Its observed
    // publications can still be delivering, particularly for tool-terminated
    // answers. Join those obligations before retaining the final evidence.
    const pending = session
      .snapshot()
      .invocations.filter((invocation) =>
        ["pending", "started", "running"].includes(invocation.status),
      );
    await Promise.all(
      pending.map((invocation) =>
        session.waitForInvocation(invocation.id, { signal: context.signal }),
      ),
    );
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

function scheduledNotificationChecked(
  result: TestExecutionResult,
  actionKind: "notify" | "watch" = "notify",
) {
  const proofName =
    actionKind === "watch"
      ? `${SCHEDULED_NOTIFICATION_NAME} watch`
      : SCHEDULED_NOTIFICATION_NAME;
  if (result.error) return { passed: false, reason: result.error };
  const base = noIncompleteInvocations(result);
  if (!base.passed) return base;
  const launches = getToolCalls(result).filter(
    (call) =>
      call.name === "launch_automation" &&
      call.execution?.status === "complete" &&
      call.execution?.isError !== true &&
      call.arguments?.["name"] === proofName,
  );
  if (launches.length !== 1) {
    return {
      passed: false,
      reason: "The proof automation was not launched exactly once",
    };
  }
  if (
    (launches[0]?.arguments?.["action"] as { kind?: unknown } | undefined)
      ?.kind !== actionKind
  ) {
    return {
      passed: false,
      reason: "The notification proof launched a different executor",
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
  const launchResult = launches[0]?.execution?.result;
  const launchDetails =
    isRecord(launchResult) && isRecord(launchResult["details"])
      ? launchResult["details"]
      : undefined;
  const missionId = launchDetails?.["missionId"];
  if (
    actionKind === "notify" &&
    (typeof missionId !== "string" || missionId.length === 0)
  ) {
    return {
      passed: false,
      reason:
        "The native notification launch did not retain its durable mission identity",
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
      reason:
        `Both scheduled runs and their requested effects must succeed ` +
        `(mission state: ${String(observed["missionState"])}, run count: ${String(observed["runCount"])}): ` +
        JSON.stringify(runs),
    };
  }
  if (actionKind === "notify" && observed["missionId"] !== missionId) {
    return {
      passed: false,
      reason:
        "The observed native notifications belong to a different durable mission",
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
        "The short-cadence automation did not retain the launching conversation",
    };
  }
  const notifications = Array.isArray(observed["notifications"])
    ? observed["notifications"].filter(isRecord)
    : [];
  const expectedNotificationKind =
    actionKind === "notify" ? "automation.notify" : "agent.message";
  const runIds = new Set(
    runs.flatMap((run) =>
      typeof run["runId"] === "string" ? [run["runId"]] : [],
    ),
  );
  const notificationRunIds = new Set(
    notifications.flatMap((notification) =>
      typeof notification["runId"] === "string" ? [notification["runId"]] : [],
    ),
  );
  if (
    notifications.length !== 2 ||
    new Set(notifications.map((notification) => notification["id"])).size !==
      2 ||
    (actionKind === "notify" &&
      (runIds.size !== 2 ||
        notificationRunIds.size !== 2 ||
        [...runIds].some((runId) => !notificationRunIds.has(runId)))) ||
    notifications.some(
      (notification) =>
        notification["message"] !== SCHEDULED_NOTIFICATION_TEXT ||
        notification["kind"] !== expectedNotificationKind ||
        (actionKind === "notify" &&
          (notification["missionId"] !== missionId ||
            typeof notification["runId"] !== "string" ||
            !runIds.has(notification["runId"]) ||
            notification["id"] !==
              `automation.notify:${notification["runId"]}`)),
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
  context: TestOrchestrationContext
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
      "natural automation launch"
    );
    await context.sendAndWait(
      session,
      "Thanks for doing this — please stop now.",
      "natural automation stop"
    );
    const service = await workers.resolveService("vibestudio.missions.v1");
    if (service.kind !== "durable-object" || !service.targetId) {
      throw new Error("The automation ledger did not resolve to a Durable Object");
    }
    const overview = await rpc.call<Record<string, unknown>>(service.targetId, "overview", [
      { query: NATIVE_CONTROL_NAME, limit: 5 },
    ]);
    const item = Array.isArray(overview["items"]) ? overview["items"][0] : undefined;
    const automation =
      isRecord(item) && isRecord(item["automation"]) ? item["automation"] : undefined;
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
    execution.cleanupErrors = [`close: ${cause instanceof Error ? cause.message : String(cause)}`];
  }
  return execution;
}

function nativeAutomationControlChecked(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const base = noIncompleteInvocations(result);
  if (!base.passed) return base;
  const launches = getToolCalls(result).filter((call) => call.name === "launch_automation");
  const controls = getToolCalls(result).filter((call) => call.name === "control_automation");
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
  const conversation = record["conversation"] as Record<string, unknown> | undefined;
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
    ((action?.["kind"] === "prompt" &&
      typeof action["text"] === "string" &&
      action["text"].trim().length > 0) ||
      (action?.["kind"] === "eval" && typeof source === "string" && source.trim().length > 0)) &&
    (conversation?.["mode"] === "fresh" || conversation?.["mode"] === "continue") &&
    Array.isArray(operations) &&
    operations.every(
      (operation) =>
        operation !== null &&
        typeof operation === "object" &&
        (operation as Record<string, unknown>)["service"] === "vcs" &&
        (operation as Record<string, unknown>)["method"] === "status" &&
        (operation as Record<string, unknown>)["use"] === "action"
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
    validate: unitListInspection,
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
        [/version/iu, /active|current/iu, /\d/u]
      ),
  },
  {
    name: "automation-overview-readonly",
    description: "Inspect the canonical automation ledger without mutating it",
    category: "unit-diagnostics",
    prompt:
      "How many automations are configured, active, running, or failed/completed with errors in the last 24 hours? Inspect the automation overview, report only those counts, and do not change or run anything.",
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
      "Agent launches an active finite timezone-aware calendar automation without publishing a worker",
    category: "unit-diagnostics",
    prompt:
      "Please start an automation called ‘Daily project pulse’ that checks project status every Thursday at 5:05 a.m. America/New_York time and posts a concise update. Have it stop at midnight New York time when 2027 begins or after 12 runs, whichever comes first. Keep it offline and start it now. Tell me where I can inspect or stop it.",
    authorityPolicy: {
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
    },

    validate: automationNativeLaunchChecked,
  },
  {
    name: "automation-scheduled-notification",
    description:
      "A launched one-minute automation completes two real runs and notifies its owner twice",
    category: "unit-diagnostics",
    timeoutMs: 240_000,
    prompt: "Harness-orchestrated scheduled automation outcome proof.",
    // Continuations may finish through complete_automation. The durable runs
    // and owner notifications below are the completion contract for this proof.
    validation: "harness",
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

    orchestrate: scheduledNotificationProof,
    validate: scheduledNotificationChecked,
  },
  {
    name: "automation-default-provisioning",
    description:
      "Workspace startup provisions the member's update assistant without a chat or model turn",
    category: "unit-diagnostics",
    timeoutMs: 90000,
    prompt: "Harness-only default automation lifecycle proof.",
    authorityPolicy: {
      authority: [
        {
          ruleId: "inspect-default-automation",
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
    validation: "harness",
    orchestrate: async (context) => {
      const startedAt = Date.now();
      const { extensions } = await import("@workspace/runtime");
      let automation: unknown = null;
      const deadline = Date.now() + Math.min(context.remainingTimeMs() ?? 60000, 60000);
      while (Date.now() < deadline) {
        automation = await extensions.invoke(
          "@workspace-extensions/templates",
          "updateAssistant",
          []
        );
        if (automation) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return {
        messages: [],
        duration: Date.now() - startedAt,
        diagnostics: { automation },
      };
    },
    validate: (result) => {
      const automation = result.diagnostics?.["automation"] as
        | import("@vibestudio/automation/mission").MissionRecord
        | undefined;
      const execution = automation?.charter.execution;
      return {
        passed:
          automation?.state === "active" &&
          automation.runCount === 0 &&
          Boolean(automation.owner.userId) &&
          automation.owner.userId !== "system" &&
          automation.charter.trigger.kind === "schedule" &&
          automation.charter.trigger.everyMs === 21600000 &&
          Boolean(automation.nextRunAt) &&
          execution?.kind === "agent" &&
          execution.action.kind === "watch" &&
          execution.conversation.mode === "continue" &&
          execution.conversation.channelId.startsWith("workspace-automation:workspace-updates:"),
        reason:
          "The default must be active, user-owned, scheduled, and not require a model turn or panel to provision.",
      };
    },
  },
  {
    name: "automation-watch-notification",
    description:
      "A deterministic update check wakes an agent and delivers owner notifications without a panel",
    category: "unit-diagnostics",
    timeoutMs: 240_000,
    prompt: "Harness-orchestrated conditional automation outcome proof.",
    validation: "harness",
    authorityPolicy: {
      authority: [
        {
          ruleId: "inspect-watch-automation",
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

    orchestrate: (context) => scheduledNotificationProof(context, "watch"),
    validate: (result) => scheduledNotificationChecked(result, "watch"),
  },
  {
    name: "automation-native-control",
    description:
      "A natural follow-up stop request pauses the owner's automation without eval or redundant approval",
    category: "unit-diagnostics",
    timeoutMs: 120_000,
    prompt: "Harness-orchestrated native automation control proof.",
    authorityPolicy: { authority: [] },

    orchestrate: nativeAutomationControlProof,
    validate: nativeAutomationControlChecked,
  },
];
