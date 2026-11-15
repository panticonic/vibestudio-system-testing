import {
  BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
} from "../types.js";
import type { ConversationForkProbe } from "../runner.js";
import { systemTestFailure, type SystemTestFailure } from "../structured-error.js";
import { invocationReturnValue, walkRecords } from "./_scenario-evidence.js";
import { PANEL_AUTOMATION_RESOURCE } from "../panel-authority.js";
import { orchestratePanelGoal } from "./_panel-tree-invariant.js";
import {
  failedToolCalls,
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
  responseContains,
} from "./_helpers.js";

/** The eval exercised the capability and returned its observation; what the report says is the test's report claims. */
function semanticEval(
  result: Parameters<typeof noIncompleteInvocations>[0],
  codePatterns: RegExp[],
  evidencePatterns: RegExp[] = [],
) {
  const calls = getToolCalls(result).filter(
    (call) =>
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
  const code = calls
    .map((call) => String(call.arguments?.["code"] ?? ""))
    .join("\n");
  if (
    calls.length === 0 ||
    !codePatterns.every((pattern) => pattern.test(code))
  ) {
    return {
      passed: false,
      reason:
        "Canonical eval arguments did not exercise the required runtime capability",
    };
  }
  const evidence = calls
    .map((call) => JSON.stringify(call.execution?.result ?? null))
    .join("\n");
  if (!evidencePatterns.every((pattern) => pattern.test(evidence))) {
    return {
      passed: false,
      reason: "Canonical eval results omitted the required runtime observation",
    };
  }
  return noIncompleteInvocations(result);
}

function statusMetricsReported(
  result: Parameters<typeof findLastAgentMessage>[0],
) {
  const final = findLastAgentMessage(result).replaceAll(",", "");
  const observed = getToolCalls(result).some((call) => {
    if (
      call.name !== "eval" ||
      call.execution?.status !== "complete" ||
      call.execution.isError
    )
      return false;
    const code = String(call.arguments?.["code"] ?? "");
    const statusCall =
      /gad\.status\s*\(/u.test(code) ||
      (/workers\.resolveService\([\s\S]*["']vibestudio\.workspace-source\.v1["']/u.test(
        code,
      ) &&
        /import\s*\{\s*gadRpcMethods\s*\}\s*from\s*["']@vibestudio\/service-schemas\/clients\/gadServiceClient["']/u.test(
          code,
        ) &&
        /rpc\.call\([\s\S]*gadRpcMethods\.getStatus\b/u.test(code));
    if (!statusCall) return false;
    const returned = invocationReturnValue(call);
    if (!returned.present) return false;
    return walkRecords([returned.value]).some(({ metric, value }) => {
      if (
        typeof metric !== "string" ||
        !metric.trim() ||
        typeof value !== "number" ||
        !Number.isFinite(value)
      )
        return false;
      const number = String(value)
        .replaceAll(".", "[.]")
        .replaceAll("+", "[+]");
      return (
        responseContains(result, metric) &&
        new RegExp(`(?<![0-9.+-])${number}(?![0-9]|[.][0-9])`, "u").test(final)
      );
    });
  });
  return observed
    ? noIncompleteInvocations(result)
    : {
        passed: false,
        reason:
          "No reported metric/value pair matched a completed runtime status observation",
      };
}

function channelInspectionIsBounded(
  result: Parameters<typeof findLastAgentMessage>[0],
) {
  const message = findLastAgentMessage(result);
  const boundedCall = getToolCalls(result).some((call) => {
    if (
      call.name !== "eval" ||
      call.execution?.status !== "complete" ||
      call.execution.isError
    ) {
      return false;
    }
    const code =
      typeof call.arguments?.["code"] === "string"
        ? call.arguments["code"]
        : "";
    const boundedChannelInspector =
      /inspectChannelEnvelopes/.test(code) || /inspectAgentHealth/.test(code);
    const positiveLimit = /\b(?:envelopeLimit|limit)\s*:\s*[1-9]\d*\b/.test(
      code,
    );
    return boundedChannelInspector && positiveLimit;
  });
  if (!boundedCall) {
    return {
      passed: false,
      reason:
        "Canonical eval arguments did not contain a positive channel-inspection limit",
    };
  }
  if (
    !/channel/iu.test(message) ||
    !/(envelope|histor|message|none|empty|found|result)/iu.test(message)
  ) {
    return {
      passed: false,
      reason:
        "Final response did not report the bounded channel-inspection outcome",
    };
  }
  return noIncompleteInvocations(result);
}

function runtimeVcsIsUsable(
  result: Parameters<typeof findLastAgentMessage>[0],
) {
  const directVcsCall = getToolCalls(result).some(
    (call) =>
      call.name === "vcs" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
  if (!directVcsCall) {
    return semanticEval(result, [/\bvcs\b/iu]);
  }
  return noIncompleteInvocations(result);
}

function scopedTestVerification(
  result: Parameters<typeof findLastAgentMessage>[0],
) {
  const verification = getToolCalls(result).find(
    (call) =>
      call.name === "verify" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true &&
      call.arguments?.["operation"] === "test" &&
      call.arguments?.["target"] === "extensions/test-runner" &&
      call.arguments?.["file"] === "index.test.ts",
  );
  const evidence = JSON.stringify(verification?.execution?.result ?? null);
  if (
    !verification ||
    !/"status":"passed"/u.test(evidence) ||
    !/"passed":[1-9]\d*/u.test(evidence) ||
    !/"failed":0/u.test(evidence) ||
    !/"total":[1-9]\d*/u.test(evidence) ||
    !/"contextId":"[^"]+"/u.test(evidence)
  ) {
    return {
      passed: false,
      reason:
        "First-class verification did not return a passing scoped test report",
    };
  }
  const failed = failedToolCalls(result);
  if (failed.length > 0) {
    return {
      passed: false,
      reason: `Expected no failed tools, got ${failed.map((call) => call.name).join(", ")}`,
    };
  }
  return noIncompleteInvocations(result);
}

const STATE_ARGS_IMMEDIATE_PROMPT =
  "Use a disposable Help panel to check whether a small change to its launch state becomes observable immediately. Keep the investigation out of the way and summarize the before-and-after state you actually see.";

function atomicPatchBuildVerification(
  result: Parameters<typeof findLastAgentMessage>[0],
) {
  const patch = getToolCalls(result).find((call) => {
    if (
      call.name !== "apply_patch" ||
      call.execution?.status !== "complete" ||
      call.execution.isError === true
    ) {
      return false;
    }
    const operations = call.arguments?.["operations"];
    if (!Array.isArray(operations) || operations.length !== 2) return false;
    const records = operations.filter(
      (operation): operation is Record<string, unknown> =>
        Boolean(
          operation &&
          typeof operation === "object" &&
          !Array.isArray(operation),
        ),
    );
    const source = records.find(
      (operation) =>
        operation["kind"] === "replace" &&
        typeof operation["path"] === "string" &&
        operation["path"].endsWith("/src/index.ts") &&
        JSON.stringify(operation["replacements"] ?? []).includes(
          "atomic-system-test",
        ),
    );
    const readme = records.find(
      (operation) =>
        operation["kind"] === "write" &&
        typeof operation["path"] === "string" &&
        operation["path"].endsWith("/README.md") &&
        typeof operation["content"] === "string" &&
        operation["content"].includes("atomic-system-test"),
    );
    if (records.length !== 2) return false;
    const repoOf = (operation: Record<string, unknown> | undefined) =>
      typeof operation?.["path"] === "string"
        ? operation["path"].split("/").slice(0, 2).join("/")
        : null;
    return Boolean(source && readme && repoOf(source) === repoOf(readme));
  });
  const operations = patch?.arguments?.["operations"];
  const sourcePath = Array.isArray(operations)
    ? operations
        .map((operation) =>
          operation &&
          typeof operation === "object" &&
          !Array.isArray(operation)
            ? (operation as Record<string, unknown>)["path"]
            : undefined,
        )
        .find(
          (path): path is string =>
            typeof path === "string" && path.endsWith("/src/index.ts"),
        )
    : undefined;
  const repoPath = sourcePath?.split("/").slice(0, 2).join("/");
  const verification = getToolCalls(result).find(
    (call) =>
      call.name === "verify" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true &&
      call.arguments?.["operation"] === "build" &&
      call.arguments?.["target"] === repoPath &&
      /"status":"ok"/u.test(JSON.stringify(call.execution.result ?? null)),
  );
  if (!patch || !repoPath || !verification) {
    return {
      passed: false,
      reason:
        "One atomic two-file patch was not joined to a successful build of the same fixture",
    };
  }
  const failed = failedToolCalls(result);
  if (failed.length > 0) {
    return {
      passed: false,
      reason: `Expected no failed tools, got ${failed.map((call) => call.name).join(", ")}`,
    };
  }
  return noIncompleteInvocations(result);
}

async function orchestrateConversationFork(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let failure: SystemTestFailure | undefined;
  let probe: ConversationForkProbe | undefined;
  try {
    await context.sendAndWait(
      session,
      "Reply with exactly the single word MARIGOLD and nothing else. Do not call any tool.",
      "answer before the fork",
    );
    probe = await context.runner.probeConversationFork(session);
  } catch (cause) {
    failure = systemTestFailure("conversation-fork", cause);
    error = failure.error.message;
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    diagnostics: { ...(probe ? { conversationFork: probe } : {}) },
    ...(error ? { error } : {}),
    ...(failure ? { failure } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [`close: ${String(cause)}`];
    execution.cleanupFailures = [systemTestFailure("conversation-fork-close", cause)];
  }
  return execution;
}

function validateConversationFork(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const probe = result.diagnostics?.["conversationFork"] as ConversationForkProbe | undefined;
  if (!probe) return { passed: false, reason: "The harness recorded no conversation fork evidence" };
  if (probe.fork.clonedAgentCount !== 1)
    return { passed: false, reason: `Expected the fork to clone one agent; it cloned ${probe.fork.clonedAgentCount}` };
  const canFork = probe.adopted.canFork as { ok?: unknown } | undefined;
  if (canFork?.ok !== true)
    return { passed: false, reason: `The cloned agent did not adopt the fork channel: ${JSON.stringify(probe.adopted.canFork)}` };
  if (!probe.adopted.modelMatches)
    return { passed: false, reason: "The cloned agent did not keep its source's settings" };
  if (!probe.forkReplayText.includes("MARIGOLD"))
    return { passed: false, reason: "The fork channel does not hold the answer given before the fork" };
  return { passed: true, reason: undefined };
}

export const agenticRuntimeTests: TestCase[] = [
  {
    name: "conversation-fork-adopts-agent-cell",
    description:
      "The product's conversation fork forks the agent's cell: the cloned agent adopts the fork channel with its source's settings",
    category: "agentic-runtime",
    prompt: "Harness-orchestrated conversation fork check.",
    orchestrate: orchestrateConversationFork,
    validation: "harness",
    validate: validateConversationFork,
  },
  {
    name: "state-args-immediate-snapshot",
    description: "Panel state changes are immediately observable",
    category: "agentic-runtime",
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: {
      authority: [
        {
          ruleId: "manage-panel-state",
          capability: { kind: "exact", key: "workspace.runtime-state.manage" },
          resource: { kind: "exact", key: "workspace.runtime-state.manage" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt: STATE_ARGS_IMMEDIATE_PROMPT,
    orchestrate: (context) =>
      orchestratePanelGoal(
        context,
        STATE_ARGS_IMMEDIATE_PROMPT,
        "inspect immediate panel launch-state visibility",
      ),
    validate: (result) =>
      semanticEval(
        result,
        [/stateArgs/iu, /(?:patch|update|change)/iu],
      ),
    reportClaims: [
      { id: "state", claim: "The answer reports the panel's launch state.", match: /state/iu },
      { id: "visible", claim: "The changed state was visible to the panel immediately.", match: /immediate|visible|observed/iu },
    ],
  },
  {
    name: "runtime-vcs-client-helper",
    description: "Workspace VCS operations are usable from the runtime context",
    category: "agentic-runtime",
    prompt:
      "Is the workspace version-control client available in this runtime context? Check and report what you observe.",
    validate: runtimeVcsIsUsable,
    reportClaims: [
      { id: "vcs", claim: "The answer is about the workspace version-control client.", match: /version.control|\bvcs\b/iu },
      { id: "available", claim: "The version-control client is available and usable here.", match: /available|usable|present|exposed/iu },
    ],
  },
  {
    name: "gad-status-summary",
    description:
      "GAD status metrics are readable through the typed runtime client",
    category: "agentic-runtime",
    prompt:
      "Read the graph-and-data store's compact status metrics through its typed runtime client and summarize one returned metric.",
    validate: statusMetricsReported,
  },
  {
    name: "channel-envelope-inspection-bounded",
    description: "Channel history inspection stays usable",
    category: "agentic-runtime",
    prompt:
      "Check a harmless nonexistent channel's history without making an unbounded request, and tell me what is there.",
    validate: channelInspectionIsBounded,
  },
  {
    name: "large-eval-result-terminal",
    description:
      "Large eval results complete visibly without leaving an invocation spinner pending",
    category: "agentic-runtime",
    prompt:
      "Create a temporary value containing two thousand items, but report only a concise summary rather than dumping the value.",
    validate: (result) =>
      semanticEval(
        result,
        [/2000|2_000/u],
      ),
    reportClaims: [
      { id: "count", claim: "The value holds two thousand items.", match: /(?:2000|2[,\s]000|two thousand)/iu },
      { id: "summary", claim: "The answer summarizes the items instead of listing them.", match: /summar|items?|entries|values/iu },
    ],
  },
  {
    name: "agent-debug-state-method",
    description: "Agent debug state is inspectable",
    category: "agentic-runtime",
    prompt:
      "Inspect this chat agent’s own advertised debug-state interface. Report what you actually observe, or establish that the capability is unavailable.",
    validate: (result) =>
      semanticEval(
        result,
        [/(?:debugState|getDebugState|debug state|agent\.describe)/iu],
      ),
    reportClaims: [
      { id: "debug", claim: "The answer is about the agent's debug-state interface.", match: /debug/iu },
      {
        id: "availability",
        claim: "The answer says whether that interface is available.",
        match: /available|unavailable|exposed|not exposed/iu,
      },
    ],
  },
  {
    name: "turn-no-silent-stall-after-tool",
    description:
      "A normal tool-using turn ends with a visible assistant response and no pending invocation",
    category: "agentic-runtime",
    prompt:
      "Use an appropriate read-only tool for a trivial check, then give me a visible final response.",
    validate: (result) => {
      const completed = getToolCalls(result).some(
        (call) =>
          call.execution?.status === "complete" &&
          call.execution.isError !== true,
      );
      if (!completed)
        return {
          passed: false,
          reason: "No successful tool invocation preceded the final response",
        };
      if (findLastAgentMessage(result).trim().length < 8)
        return {
          passed: false,
          reason: "No substantive visible final response",
        };
      return noIncompleteInvocations(result);
    },
  },
  {
    name: "workspace-test-runner-extension",
    description:
      "Agent runs workspace unit tests through the scoped test-runner extension",
    category: "agentic-runtime",
    authorityPolicy: {
      authority: [
        {
          ruleId: "workspace-test-runner-execution",
          capability: {
            kind: "prefix",
            prefix:
              "userland:extensions/test-runner/native.code.execute-tests#",
          },
          resource: {
            kind: "exact",
            key: "native.code.tests:extension:@workspace-extensions/test-runner",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "Run the focused tests for the test-runner extension and summarize the result and where they ran.",
    validation: "harness",
    validate: scopedTestVerification,
  },
  {
    name: "atomic-multifile-patch-build",
    description:
      "Agent applies one coherent multi-file patch and builds that exact workspace state",
    category: "agentic-runtime",
    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      'In the disposable package, change the exported fixture value to "atomic-system-test" and explain it in the README. Make the related edits together, confirm the package still builds, and leave the change unpublished.',
    validation: "harness",
    validate: atomicPatchBuildVerification,
  },
];
