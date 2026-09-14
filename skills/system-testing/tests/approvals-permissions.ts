import type { HeadlessSession } from "@workspace/agentic-session";
import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext
} from "../types.js";
import { completedScenarioEvidence, invocationReturnValue } from "./_scenario-evidence.js";
import { getToolCalls } from "./_helpers.js";
import { savedPermissionGrantSchema } from "@vibestudio/service-schemas/permissions";
const PERMISSION_LIST_CALL =
  /\bservices\.permissions\.list\s*\(\s*\)|\brpc\.call\s*\(\s*["']main["']\s*,\s*["']permissions\.list["']\s*,\s*\[\s*\]\s*\)/u;
const PERMISSION_PROFILE_CALL =
  /\brpc\.call\s*\(\s*["']main["']\s*,\s*["']permissions\.listAgentProfiles["']\s*,\s*\[\s*\]\s*\)/u;
const PERMISSION_MUTATION_CALL =
  /\bservices\.permissions\.(?:revoke|updateAgentProfile|setWorkspaceAuthorityLock)\s*\(|\brpc\.call\s*\(\s*["']main["']\s*,\s*["']permissions\.(?:revoke|updateAgentProfile|setWorkspaceAuthorityLock)["']/u;
const SERVER_LOG_STATS_CALL =
  /\bservices\.serverLog\.stats\s*\(\s*\)|\brpc\.call\s*\(\s*["']main["']\s*,\s*["']serverLog\.stats["']\s*,\s*\[\s*\]\s*\)/u;

function validatePermissionList(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  if (
    base.evidence.calls.some((call) => {
      const code = String(call.arguments?.["code"] ?? "");
      return call.name === "eval" && PERMISSION_MUTATION_CALL.test(code);
    })
  ) {
    return {
      passed: false,
      reason: "The permission inventory task invoked a mutating permission API",
    };
  }
  const listed = base.evidence.calls.find((call) => {
    const code = String(call.arguments?.["code"] ?? "");
    return (
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true &&
      PERMISSION_LIST_CALL.test(code)
    );
  });
  const returned = listed ? invocationReturnValue(listed) : { present: false as const };
  return returned.present &&
    Array.isArray(returned.value) &&
    returned.value.every((grant) => savedPermissionGrantSchema.safeParse(grant).success)
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: "The read-only permission listing returned an invalid grant inventory",
      };
}

function successfulEvalCalls(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return null;
  return base.evidence.calls.filter(
    (call) =>
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true
  );
}

function isPermissionReadTaskRule(value: unknown): value is { id: string } {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule["id"] === "string" &&
    rule["capability"] === "permissions.read" &&
    typeof rule["action"] === "string" &&
    typeof rule["resource"] === "string" &&
    typeof rule["decidedAt"] === "number"
  );
}

function validateChatTaskGrantReuse(result: TestExecutionResult) {
  const calls = successfulEvalCalls(result);
  if (!calls) {
    return {
      passed: false,
      reason: "The two-turn session did not complete"
    };
  }
  const permissionReads = calls.filter((call) => {
    const code = String(call.arguments?.["code"] ?? "");
    return PERMISSION_LIST_CALL.test(code) || PERMISSION_PROFILE_CALL.test(code);
  });
  const evidence = result.diagnostics?.["chatTaskRuleReuse"];
  const snapshots =
    evidence && typeof evidence === "object"
      ? (evidence as Record<string, unknown>)
      : null;
  const first = snapshots?.["afterFirstTurn"];
  const second = snapshots?.["afterSecondTurn"];
  const firstRules = Array.isArray(first) ? first.filter(isPermissionReadTaskRule) : [];
  const secondRules = Array.isArray(second) ? second.filter(isPermissionReadTaskRule) : [];
  return permissionReads.length >= 2 &&
    firstRules.length === 1 &&
    secondRules.length === 1 &&
    firstRules[0]!.id === secondRules[0]!.id
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The two agent turns did not perform two protected permission reads backed by one final permissions.read task rule"
      };
}

function validateSubagentTaskGrantReuse(result: TestExecutionResult) {
  const calls = successfulEvalCalls(result);
  if (!calls) {
    return { passed: false, reason: "The parent/subagent permission session did not complete" };
  }
  const spawn = getToolCalls(result).find(
    (call) =>
      call.name === "spawn_subagent" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true
  );
  const child = spawn
    ? result.messages.find(
        (message) =>
          message.task?.id === spawn.id &&
          message.task.execution.status === "complete" &&
          message.task.execution.terminalOutcome === "success" &&
          message.task.execution.isError !== true
      )?.task
    : undefined;
  const inventories = calls.filter((call) => {
    const code = String(call.arguments?.["code"] ?? "");
    return PERMISSION_LIST_CALL.test(code);
  });
  const parentRead = calls.find((call) =>
    SERVER_LOG_STATS_CALL.test(String(call.arguments?.["code"] ?? ""))
  );
  const returned = inventories.at(-1) ? invocationReturnValue(inventories.at(-1)!) : null;
  const grants = returned?.present && Array.isArray(returned.value) ? returned.value : [];
  const matchingTaskGrants = grants.filter((value) => {
    const grant = savedPermissionGrantSchema.safeParse(value);
    return (
      grant.success &&
      grant.data.kind === "capability" &&
      grant.data.callerLabel === "This task" &&
      grant.data.resource === "server-logs.read" &&
      grant.data.duration === "For the current approved task"
    );
  });
  const childReport = JSON.stringify(child?.execution.result ?? "");
  return parentRead &&
    child &&
    spawn &&
    !Object.prototype.hasOwnProperty.call(spawn.arguments ?? {}, "config") &&
    /\byes\b/iu.test(childReport) &&
    inventories.length >= 1 &&
    matchingTaskGrants.length === 1
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The ordinary child did not inherit its parent config and reuse the parent's single server-logs.read task grant",
      };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function orchestrateChatTaskGrantReuse(
  context: TestOrchestrationContext
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session: HeadlessSession = await context.runner.spawn(undefined);
  let error: string | undefined;
  let afterFirstTurn: Awaited<ReturnType<typeof context.runner.inspectChatTaskRules>> = [];
  let afterSecondTurn: Awaited<ReturnType<typeof context.runner.inspectChatTaskRules>> = [];
  try {
    await context.sendAndWait(
      session,
      "List the workspace permissions currently granted here and summarize them. Do not change them.",
      "initial permission inventory"
    );
    const firstSnapshot = session.snapshot();
    if (!firstSnapshot.agentContextId || !firstSnapshot.channelId) {
      throw new Error("The headless chat did not expose its task coordinates after the first turn");
    }
    afterFirstTurn = await context.runner.inspectChatTaskRules({
      contextId: firstSnapshot.agentContextId,
      channelId: firstSnapshot.channelId
    });
    await context.sendAndWait(
      session,
      "List those workspace permissions again in this same conversation and tell me whether anything changed. Do not change them.",
      "follow-up permission inventory"
    );
    const secondSnapshot = session.snapshot();
    if (!secondSnapshot.agentContextId || !secondSnapshot.channelId) {
      throw new Error("The headless chat did not expose its task coordinates after the second turn");
    }
    afterSecondTurn = await context.runner.inspectChatTaskRules({
      contextId: secondSnapshot.agentContextId,
      channelId: secondSnapshot.channelId
    });
  } catch (cause) {
    error = formatError(cause);
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    diagnostics: { chatTaskRuleReuse: { afterFirstTurn, afterSecondTurn } },
    ...(error ? { error } : {})
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [`close: ${formatError(cause)}`];
  }
  return execution;
}

async function orchestrateSubagentTaskGrantReuse(
  context: TestOrchestrationContext
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session: HeadlessSession = await context.runner.spawn(undefined);
  let error: string | undefined;
  try {
    await context.sendAndWait(
      session,
      "Call the documented serverLog.stats() operation once and briefly report its result. Do not modify anything.",
      "parent protected read"
    );
    await context.sendAndWait(
      session,
      "Spawn one fresh subagent. Its only task is to call the documented serverLog.stats() operation once, report exactly yes if it was readable or no plus the error if it was not, and complete. Wait for that child and summarize its result.",
      "subagent protected read"
    );
    await context.sendAndWait(
      session,
      // "Return only entries" invited a projection, and the grant's duration —
      // the one field that proves the task-scoped reuse this measures — was
      // the field an agent dropped. Ask for the rows the surface returned.
      "Call permissions.list() once. Return, unchanged and with every field intact, only those entries whose resource is exactly server-logs.read and whose callerLabel is This task. Do not reshape or summarize the entries, and do not change permissions.",
      "final permission inventory"
    );
  } catch (cause) {
    error = formatError(cause);
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    ...(error ? { error } : {})
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [`close: ${formatError(cause)}`];
  }
  return execution;
}

export const approvalPermissionTests: TestCase[] = [
  {
    name: "permissions-list",
    description: "Inspect the canonical capability grant inventory without changing it",
    category: "approvals-permissions",
    prompt: "List the workspace permissions currently granted here. Do not change them.",
    authorityPolicy: {
      authority: [
        {
          ruleId: "list-permissions",
          capability: { kind: "exact", key: "permissions.read" },
          resource: { kind: "exact", key: "permissions.read" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    validate: validatePermissionList,
  },
  {
    name: "chat-task-permission-reuse",
    description: "A follow-up turn reuses the same chat-bound task permission",
    category: "approvals-permissions",
    prompt: "Harness-orchestrated two-turn chat permission reuse check.",
    authorityPolicy: {
      authority: [
        {
          ruleId: "chat-task-permissions-read",
          capability: { kind: "exact", key: "permissions.read" },
          resource: { kind: "exact", key: "permissions.read" },
          tier: "gated",
          decision: "task"
        }
      ]
    },
    orchestrate: orchestrateChatTaskGrantReuse,
    validation: "agent-evidence",
    validate: validateChatTaskGrantReuse
  },
  {
    name: "subagent-task-permission-reuse",
    description: "A fresh subagent reuses its parent's chat-bound task permission",
    category: "approvals-permissions",
    prompt: "Harness-orchestrated parent/subagent task permission reuse check.",
    authorityPolicy: {
      authority: [
        {
          ruleId: "subagent-task-permissions-read",
          capability: { kind: "exact", key: "server-logs.read" },
          resource: { kind: "exact", key: "server-logs.read" },
          tier: "gated",
          decision: "task"
        },
        {
          ruleId: "subagent-task-grant-inventory",
          capability: { kind: "exact", key: "permissions.read" },
          resource: { kind: "exact", key: "permissions.read" },
          tier: "gated",
          decision: "once"
        }
      ]
    },
    orchestrate: orchestrateSubagentTaskGrantReuse,
    validation: "agent-evidence",
    validate: validateSubagentTaskGrantReuse
  }
];
