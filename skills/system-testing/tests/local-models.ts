import {
  CONTENT_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
} from "../types.js";
import { rpc } from "@workspace/runtime";
import { closedChildModelReports, readRetainedChannelReplay } from "./_subagent-evidence.js";
import type { ServerLogEvent } from "@workspace/pubsub";
import { systemTestFailure } from "../structured-error.js";
import {
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
  successfulEvalCode,
} from "./_helpers.js";

const FIXTURE_HEADING = /\bsystem-test-local-model-download-and-task-[a-z0-9]{8}\b/iu;
const LOCAL_MODEL_RUNTIME_AUTHORITY = {
  ruleId: "run-bundled-local-model",
  capability: { kind: "exact" as const, key: "internal-model-runtime.use" },
  resource: { kind: "exact" as const, key: "local-models" },
  tier: "gated" as const,
  decision: "once" as const,
};
interface CompletedLocalModelTask {
  model: string;
  report: string;
  runId: string;
}

function localModelRef(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const model = (value as Record<string, unknown>)["model"];
  return typeof model === "string" && model.startsWith("local:") ? model : null;
}

interface ChildEvidence {
  runId: string;
  taskChannelId: string;
  childParticipantId: string;
  events: ServerLogEvent[];
  modelExecutionEvidence: unknown;
}

function lifecycleInspectionFailure(result: TestExecutionResult): string | null {
  const code = successfulEvalCode(result);
  if (
    !/extensions\.invoke[\s\S]*["']status["']/u.test(code) ||
    !/extensions\.invoke[\s\S]*["']listModels["']/u.test(code)
  ) {
    return "The trajectory did not inspect the bundled local-model lifecycle";
  }
  return null;
}

function completedLocalModelTasks(result: TestExecutionResult): CompletedLocalModelTask[] {
  const localLaunches = getToolCalls(result).flatMap((call) => {
    if (
      call.name !== "spawn_subagent" ||
      call.execution?.status !== "complete" ||
      call.execution.isError === true
    ) {
      return [];
    }
    const argumentConfig = call.arguments?.["config"];
    const model = localModelRef(argumentConfig) ?? localModelRef(call.subagent?.launchConfig);
    return model ? [{ runId: call.id, model }] : [];
  });
  const retained = result.diagnostics?.["subagentEvidence"];
  const evidence = Array.isArray(retained) ? retained as ChildEvidence[] : [];
  return localLaunches.flatMap((launch) => {
    const task = result.messages.find(
      (message) =>
        message.task?.id === launch.runId &&
        message.task.execution.isError !== true &&
        localModelRef(message.task.subagent?.launchConfig) === launch.model
    )?.task;
    if (!task) return [];
    const child = task.subagent;
    const exact = evidence.find((entry) => entry.runId === launch.runId &&
      entry.taskChannelId === child?.taskChannelId &&
      entry.childParticipantId === child?.childParticipantId);
    if (!exact) return [];
    return closedChildModelReports(exact.events, exact.childParticipantId,
      exact.modelExecutionEvidence).filter((report) => report.model === launch.model)
      .map((report) => ({ ...launch, report: report.text }));
  });
}

function requireLocalModelTask(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const lifecycleFailure = lifecycleInspectionFailure(result);
  if (lifecycleFailure) return { passed: false, reason: lifecycleFailure };
  const completed = completedLocalModelTasks(result).flatMap((task) => {
    const heading = task.report.match(FIXTURE_HEADING)?.[0];
    return heading ? [{ heading }] : [];
  });
  if (completed.length === 0) {
    return {
      passed: false,
      reason:
        "The local-model subagent did not complete successfully with the disposable README heading",
    };
  }
  const final = findLastAgentMessage(result);
  if (!completed.some(({ heading }) => final.toLowerCase().includes(heading.toLowerCase()))) {
    return {
      passed: false,
      reason: "The parent response did not report the heading observed by the local-model child",
    };
  }
  return noIncompleteInvocations(result);
}

async function orchestrateLocalModelTask(context: TestOrchestrationContext): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn(undefined);
  const evidence: ChildEvidence[] = [];
  let failure: ReturnType<typeof systemTestFailure> | undefined;
  try {
    await context.sendAndWait(session, LOCAL_MODEL_PROMPT, "local-model README task");
    const messages = [...session.messages];
    for (const launch of getToolCalls({ messages, duration: 0 })) {
      if (launch.name !== "spawn_subagent" || launch.execution?.status !== "complete" ||
          launch.execution.isError === true) continue;
      const child = messages.find((message) => message.task?.id === launch.id)?.task?.subagent;
      if (!child?.taskChannelId || !child.childParticipantId || !child.childEntityId)
        throw new Error("Subagent launch did not retain its exact child coordinates");
      const events = await readRetainedChannelReplay(rpc, child.taskChannelId);
      const modelExecutionEvidence = await rpc.call(child.childEntityId,
        "getModelExecutionEvidence", [child.taskChannelId]);
      evidence.push({ runId: launch.id, taskChannelId: child.taskChannelId,
        childParticipantId: child.childParticipantId, events, modelExecutionEvidence });
    }
  } catch (cause) {
    failure = systemTestFailure("local-model-task-evidence", cause);
  }
  const result: TestExecutionResult = {
    messages: [...session.messages], duration: Date.now() - startedAt,
    snapshot: session.snapshot(), diagnostics: { subagentEvidence: evidence },
    ...(failure ? { failure, error: failure.error.message } : {}),
  };
  try { await session.close(); }
  catch (cause) {
    const cleanup = systemTestFailure("local-model-task-close", cause);
    result.cleanupFailures = [cleanup];
    result.cleanupErrors = [cleanup.error.message];
  }
  return result;
}

const LOCAL_MODEL_PROMPT =
  "Please use the bundled local model—not your current one—to read the disposable project's README and tell me its heading.";

export const localModelTests: TestCase[] = [
  {
    name: "local-model-download-and-task",
    description: "Prepare the bundled local model and use it for a real workspace task",
    category: "local-models",
    timeoutMs: 30 * 60_000,
    resources: ["profile:local-models"],
    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: {
      authority: [LOCAL_MODEL_RUNTIME_AUTHORITY],
    },
    prompt: LOCAL_MODEL_PROMPT,
    orchestrate: orchestrateLocalModelTask,

    validate: requireLocalModelTask,
  },
];
