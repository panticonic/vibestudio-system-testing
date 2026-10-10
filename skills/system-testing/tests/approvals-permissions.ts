import { appendSystemTestCleanupFailure } from "../structured-error.js";
import { agentRpcMethods } from "@workspace/agentic-do/rpc-contract";
import { NativeServerLogObservationSchema } from "@vibestudio/service-schemas/serverLog";
import { walkRecords } from "./_scenario-evidence.js";
import { rpc } from "@workspace/runtime";
import type { ServerLogEvent } from "@workspace/pubsub";
import {
  completedChildModelReports,
  completedChildToolResults,
  readRetainedChannelReplay,
} from "./_subagent-evidence.js";
import type { HeadlessSession } from "@workspace/agentic-session";
import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";
import {
  completedScenarioEvidence,
} from "./_scenario-evidence.js";
import { getToolCalls } from "./_helpers.js";
import { NativePermissionInventoryObservationSchema } from "@vibestudio/service-schemas/permissions";
const PERMISSION_LIST_CALL =
  /\bservices\.permissions\.list\s*\(\s*\)|\brpc\.call\s*\(\s*["']main["']\s*,\s*["']permissions\.list["']\s*,\s*\[\s*\]\s*\)/u;
const PERMISSION_PROFILE_CALL =
  /\brpc\.call\s*\(\s*["']main["']\s*,\s*["']permissions\.listAgentProfiles["']\s*,\s*\[\s*\]\s*\)/u;
const PERMISSION_MUTATION_CALL =
  /\bservices\.permissions\.(?:revoke|updateAgentProfile|setWorkspaceAuthorityLock)\s*\(|\brpc\.call\s*\(\s*["']main["']\s*,\s*["']permissions\.(?:revoke|updateAgentProfile|setWorkspaceAuthorityLock)["']/u;


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
  const observed = base.evidence.calls.some((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError === true) return false;
    const returned = call.execution.result;
    if (!returned || typeof returned !== "object" || Array.isArray(returned)) return false;
    const details = (returned as Record<string, unknown>)["details"];
    if (!details || typeof details !== "object" || Array.isArray(details)) return false;
    const journal = (details as Record<string, unknown>)["operationJournal"];
    if (!journal || typeof journal !== "object" || Array.isArray(journal)) return false;
    const native = journal as Record<string, unknown>;
    if (native["protocol"] !== "workspace-operations.v1" || native["truncated"] !== false || !Array.isArray(native["entries"])) return false;
    return native["entries"].some((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const observation = entry as Record<string, unknown>;
      return observation["type"] === "permissions.inventory" &&
        NativePermissionInventoryObservationSchema.safeParse(observation["receipt"]).success;
    });
  });
  return observed ? { passed: true, reason: undefined } : {
    passed: false,
    reason: "No native completed permission inventory observation was captured",
  };
}

function successfulEvalCalls(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return null;
  return base.evidence.calls.filter(
    (call) =>
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
}

function isReadTaskRule(value: unknown, capability: string): value is { id: string } {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule["id"] === "string" &&
    rule["capability"] === capability &&
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
      reason: "The two-turn session did not complete",
    };
  }
  const permissionReads = calls.filter((call) => {
    const code = String(call.arguments?.["code"] ?? "");
    return (
      PERMISSION_LIST_CALL.test(code) || PERMISSION_PROFILE_CALL.test(code)
    );
  });
  const evidence = result.diagnostics?.["chatTaskRuleReuse"];
  const snapshots =
    evidence && typeof evidence === "object"
      ? (evidence as Record<string, unknown>)
      : null;
  const first = snapshots?.["afterFirstTurn"];
  const second = snapshots?.["afterSecondTurn"];
  const firstRules = Array.isArray(first)
    ? first.filter((rule) => isReadTaskRule(rule, "permissions.read"))
    : [];
  const secondRules = Array.isArray(second)
    ? second.filter((rule) => isReadTaskRule(rule, "permissions.read"))
    : [];
  return permissionReads.length >= 2 &&
    firstRules.length === 1 &&
    secondRules.length === 1 &&
    firstRules[0]!.id === secondRules[0]!.id
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The two agent turns did not perform two protected permission reads backed by one final permissions.read task rule",
      };
}

function validateSubagentTaskGrantReuse(result: TestExecutionResult) {
  const calls = successfulEvalCalls(result);
  if (!calls) {
    return {
      passed: false,
      reason: "The parent/subagent permission session did not complete",
    };
  }
  const spawn = getToolCalls(result).find(
    (call) =>
      call.name === "spawn_subagent" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
  const child = spawn
    ? result.messages.find((message) => message.task?.id === spawn.id)?.task
        ?.subagent
    : undefined;
  const replay = result.diagnostics?.["childReplay"];
  const events = Array.isArray(replay) ? (replay as ServerLogEvent[]) : [];
  const report =
    child &&
    completedChildModelReports(
      events,
      child.childParticipantId,
      result.diagnostics?.["childModelExecutionEvidence"],
    ).find((report) => /^yes[.!]?$/iu.test(report.text.trim()));
  const parentRead = calls.find((call) => walkRecords([call.execution?.result]).some((value) =>
    value["type"] === "server-log.observation" && NativeServerLogObservationSchema.safeParse(value["receipt"]).success
  ));
  const evidence = result.diagnostics?.["subagentTaskRuleReuse"];
  const snapshots = evidence && typeof evidence === "object" ? evidence as Record<string, unknown> : null;
  const first = snapshots?.["afterParentRead"];
  const second = snapshots?.["afterChildRead"];
  const firstRules = Array.isArray(first) ? first.filter((rule) => isReadTaskRule(rule, "server-logs.read")) : [];
  const secondRules = Array.isArray(second) ? second.filter((rule) => isReadTaskRule(rule, "server-logs.read")) : [];
  const childRead = child && typeof child.childEntityId === "string" && walkRecords(completedChildToolResults(events, {
    childParticipantId: child.childParticipantId, childEntityId: child.childEntityId,
  }, "eval")).some((value) =>
    value["type"] === "server-log.observation" && NativeServerLogObservationSchema.safeParse(value["receipt"]).success
  );
  return parentRead && child && spawn && report && childRead &&
    !Object.prototype.hasOwnProperty.call(spawn.arguments ?? {}, "config") &&
    firstRules.length === 1 && secondRules.length === 1 && firstRules[0]!.id === secondRules[0]!.id
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
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session: HeadlessSession = await context.runner.spawn(undefined);
  let error: string | undefined;
  let afterFirstTurn: Awaited<
    ReturnType<typeof context.runner.inspectChatTaskRules>
  > = [];
  let afterSecondTurn: Awaited<
    ReturnType<typeof context.runner.inspectChatTaskRules>
  > = [];
  try {
    await context.sendAndWait(
      session,
      "List the workspace permissions currently granted here and summarize them. Do not change them.",
      "initial permission inventory",
    );
    const firstSnapshot = session.snapshot();
    if (!firstSnapshot.agentContextId || !firstSnapshot.channelId) {
      throw new Error(
        "The headless chat did not expose its task coordinates after the first turn",
      );
    }
    afterFirstTurn = await context.runner.inspectChatTaskRules({
      contextId: firstSnapshot.agentContextId,
      channelId: firstSnapshot.channelId,
    });
    await context.sendAndWait(
      session,
      "List those workspace permissions again in this same conversation and tell me whether anything changed. Do not change them.",
      "follow-up permission inventory",
    );
    const secondSnapshot = session.snapshot();
    if (!secondSnapshot.agentContextId || !secondSnapshot.channelId) {
      throw new Error(
        "The headless chat did not expose its task coordinates after the second turn",
      );
    }
    afterSecondTurn = await context.runner.inspectChatTaskRules({
      contextId: secondSnapshot.agentContextId,
      channelId: secondSnapshot.channelId,
    });
  } catch (cause) {
    error = formatError(cause);
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    diagnostics: { chatTaskRuleReuse: { afterFirstTurn, afterSecondTurn } },
    ...(error ? { error } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    appendSystemTestCleanupFailure(execution, "close", cause);
  }
  return execution;
}

async function orchestrateSubagentTaskGrantReuse(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session: HeadlessSession = await context.runner.spawn(undefined);
  let error: string | undefined;
  const childReplay: ServerLogEvent[] = [];
  let childModelExecutionEvidence: unknown;
  let afterParentRead: Awaited<ReturnType<typeof context.runner.inspectChatTaskRules>> = [];
  let afterChildRead: typeof afterParentRead = [];
  try {
    await context.sendAndWait(
      session,
      "Give me a brief read-only summary of the recent server logs.",
      "parent protected read",
    );
    const parent = session.snapshot();
    if (!parent.agentContextId || !parent.channelId) throw new Error("Parent task coordinates are unavailable");
    const coordinates = { contextId: parent.agentContextId, channelId: parent.channelId };
    afterParentRead = await context.runner.inspectChatTaskRules(coordinates);
    await context.sendAndWait(
      session,
      "Ask a fresh collaborator to check whether the recent server logs are readable. Have them reply exactly yes if readable, or no with the error if not. Wait for their reply and summarize it.",
      "subagent protected read",
    );
    const messages = [...session.messages];
    const spawn = getToolCalls({ messages, duration: 0 }).find(
      (call) => call.name === "spawn_subagent",
    );
    const child = messages.find((message) => message.task?.id === spawn?.id)
      ?.task?.subagent;
    if (!child?.taskChannelId || !child.childEntityId)
      throw new Error(
        "The child launch did not retain its canonical task coordinates",
      );
    childReplay.push(
      ...(await readRetainedChannelReplay(rpc, child.taskChannelId)),
    );
    childModelExecutionEvidence = await rpc.call(
      child.childEntityId,
      agentRpcMethods["getModelExecutionEvidence"],
      [child.taskChannelId],
    );
    afterChildRead = await context.runner.inspectChatTaskRules(coordinates);
  } catch (cause) {
    error = formatError(cause);
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    diagnostics: { childReplay, childModelExecutionEvidence, subagentTaskRuleReuse: { afterParentRead, afterChildRead } },
    ...(error ? { error } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    appendSystemTestCleanupFailure(execution, "close", cause);
  }
  return execution;
}

export const approvalPermissionTests: TestCase[] = [
  {
    name: "permissions-list",
    description:
      "Inspect the canonical capability grant inventory without changing it",
    category: "approvals-permissions",
    prompt:
      "List the workspace permissions currently granted here. Do not change them.",
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
          decision: "task",
        },
      ],
    },
    orchestrate: orchestrateChatTaskGrantReuse,

    validate: validateChatTaskGrantReuse,
  },
  {
    name: "subagent-task-permission-reuse",
    description:
      "A fresh subagent reuses its parent's chat-bound task permission",
    category: "approvals-permissions",
    prompt: "Harness-orchestrated parent/subagent task permission reuse check.",
    authorityPolicy: {
      authority: [
        {
          ruleId: "subagent-task-permissions-read",
          capability: { kind: "exact", key: "server-logs.read" },
          resource: { kind: "exact", key: "server-logs.read" },
          tier: "gated",
          decision: "task",
        },
      ],
    },
    orchestrate: orchestrateSubagentTaskGrantReuse,

    validate: validateSubagentTaskGrantReuse,
  },
];
