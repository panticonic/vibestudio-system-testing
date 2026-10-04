import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";
import {
  agentMessageHasAll,
  completedToolNames,
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
} from "./_helpers.js";
import { z } from "zod";
import {
  completedScenarioEvidence,
  requireCodeOperations,
} from "./_scenario-evidence.js";

function requireCompletedTools(
  result: Parameters<typeof completedToolNames>[0],
  names: string[],
) {
  const completed = completedToolNames(result);
  const missing = names.filter((name) => !completed.has(name));
  if (missing.length > 0) {
    return {
      passed: false,
      reason: `Missing completed tool calls for ${missing.join(", ")}. Completed: ${
        [...completed].join(", ") || "(none)"
      }`,
    };
  }
  return noIncompleteInvocations(result);
}

function completedNamedToolCalls(result: TestExecutionResult, name: string) {
  return getToolCalls(result).filter(
    (call) =>
      call.name === name &&
      call.execution?.status === "complete" &&
      !call.execution?.isError,
  );
}

function nativeChannelMethodValue(
  call: ReturnType<typeof getToolCalls>[number],
) {
  const details = (
    call.execution?.result as
      | { details?: { protocol?: string; value?: Record<string, unknown> } }
      | undefined
  )?.details;
  return details?.protocol === "native-channel-method-outcome.v1"
    ? details.value
    : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runWithSyntheticPanelUi(
  context: TestOrchestrationContext,
  prompt: string,
  phase: string,
): Promise<TestExecutionResult> {
  const start = Date.now();
  const session = await context.runner.spawn({ syntheticPanelUiTools: true });
  let sendError: unknown;

  try {
    await context.sendAndWait(session, prompt, phase);
  } catch (error) {
    sendError = error;
  }

  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - start,
    snapshot: session.snapshot(),
    ...(sendError ? { error: formatError(sendError) } : {}),
  };

  try {
    await session.close();
  } catch (error) {
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      `close: ${formatError(error)}`,
    ];
  }

  const cleanupErrors = session
    .snapshot()
    .cleanupErrors.map((error) => `${error.phase}: ${error.message}`);
  if (cleanupErrors.length > 0) {
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      ...cleanupErrors,
    ];
    execution.error ??= `Headless cleanup failed: ${cleanupErrors.join("; ")}`;
  }

  return execution;
}

async function runOnboardingOpening(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const start = Date.now();
  const session = await context.runner.spawn({
    syntheticPanelUiTools: true,
  });
  let sendError: unknown;
  try {
    await context.sendAndWait(
      session,
      "I just opened this workspace for the first time. Show me the setup overview.",
      "onboarding opening",
    );
  } catch (error) {
    sendError = error;
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - start,
    snapshot: session.snapshot(),
    ...(sendError ? { error: formatError(sendError) } : {}),
  };
  try {
    await session.close();
  } catch (error) {
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      `close: ${formatError(error)}`,
    ];
  }
  return execution;
}

async function runOnboardingStableIdRoute(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const start = Date.now();
  const session = await context.runner.spawn({
    methods: {
      client_eval: {
        description:
          "Execute TypeScript in the synthetic panel which initiated this turn. Static workspace imports resolve in that client context.",
        parameters: z
          .object({
            code: z.string(),
            syntax: z
              .enum(["javascript", "typescript", "jsx", "tsx"])
              .optional(),
          })
          .strict(),
        execute: async (args: unknown) => ({
          handled: true,
          received: args,
        }),
      },
    },
  });
  let sendError: unknown;
  try {
    const remainingTimeMs = context.remainingTimeMs();
    const wait = session.waitForIdle(
      remainingTimeMs === undefined
        ? undefined
        : { timeoutMs: remainingTimeMs },
    );
    await session.send("Use the selected setup action.", {
      metadata: {
        interaction: {
          source: "onboarding-setup-hub",
          kind: "onboarding-capability",
          action: "setup",
          targetId: "connection.github",
        },
      },
    });
    await wait;
  } catch (error) {
    sendError = error;
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - start,
    snapshot: session.snapshot(),
    ...(sendError ? { error: formatError(sendError) } : {}),
  };
  try {
    await session.close();
  } catch (error) {
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      `close: ${formatError(error)}`,
    ];
  }
  return execution;
}

export const interactionSurfaceTests: TestCase[] = [
  {
    name: "onboarding-opening-overview",
    requiresUnits: ["skills/onboarding"],
    description:
      "Publish the self-materializing setup overview inside the inviting panel",
    category: "interaction-surfaces",
    prompt:
      "I just opened this workspace for the first time. Show me the setup overview.",
    orchestrate: runOnboardingOpening,
    validate: (result) => {
      const tools = requireCompletedTools(result, ["read", "inline_ui"]);
      if (!tools.passed) return tools;
      const skillRead = completedNamedToolCalls(result, "read").find(
        (call) => call.arguments?.["path"] === "skills/onboarding/SKILL.md",
      );
      if (!skillRead) {
        return {
          passed: false,
          reason:
            "Opening onboarding did not successfully read skills/onboarding/SKILL.md",
        };
      }
      if (
        completedNamedToolCalls(result, "eval").length > 0 ||
        completedNamedToolCalls(result, "client_eval").length > 0
      ) {
        return {
          passed: false,
          reason:
            "Opening onboarding ran an eval before rendering the self-materializing card",
        };
      }
      const inlineCall = completedNamedToolCalls(result, "inline_ui").find(
        (call) =>
          call.arguments?.["path"] === "skills/onboarding/SetupHub.tsx" &&
          call.arguments?.["id"] === "onboarding-setup-overview" &&
          nativeChannelMethodValue(call) !== undefined,
      );
      const props = inlineCall?.arguments?.["props"];
      const hasSnapshotProps =
        props !== undefined &&
        (props === null ||
          typeof props !== "object" ||
          Array.isArray(props) ||
          Object.keys(props).length > 0);
      if (!inlineCall || hasSnapshotProps) {
        return {
          passed: false,
          reason:
            "SetupHub.tsx was not rendered with the stable onboarding ID and no snapshot props",
        };
      }
      if (completedNamedToolCalls(result, "load_action_bar").length > 0) {
        return {
          passed: false,
          reason:
            "Opening onboarding published an action bar instead of staying inline",
        };
      }
      const outcome = nativeChannelMethodValue(inlineCall);
      return outcome?.["ok"] === true &&
        outcome["id"] === "onboarding-setup-overview"
        ? { passed: true, reason: undefined }
        : {
            passed: false,
            reason:
              "No native acknowledgement of the stable onboarding card was observed",
          };
    },
  },
  {
    name: "onboarding-stable-id-routing",
    requiresUnits: ["skills/onboarding"],
    description:
      "Route an onboarding selection from structured interaction metadata",
    category: "interaction-surfaces",
    prompt: "Use the selected setup action.",
    orchestrate: runOnboardingStableIdRoute,
    validate: (result) => {
      const tools = requireCompletedTools(result, ["client_eval"]);
      if (!tools.passed) return tools;
      if (completedNamedToolCalls(result, "eval").length > 0) {
        return {
          passed: false,
          reason:
            "Onboarding routing used server-side eval instead of inviting-panel client_eval",
        };
      }
      const route = completedNamedToolCalls(result, "client_eval").find(
        (call) => nativeChannelMethodValue(call) !== undefined,
      );
      const code = route?.arguments?.["code"];
      if (
        typeof code !== "string" ||
        !code.includes("@workspace-skills/onboarding") ||
        !code.includes("executeOnboardingSelection") ||
        !code.includes("connection.github") ||
        !code.includes("setup")
      ) {
        return {
          passed: false,
          reason: `Expected stable GitHub setup through client_eval; received ${JSON.stringify(
            route?.arguments ?? null,
          )}`,
        };
      }
      const outcome = route && nativeChannelMethodValue(route);
      const received = outcome?.["received"] as { code?: unknown } | undefined;
      return outcome?.["handled"] === true && received?.code === code
        ? { passed: true, reason: undefined }
        : {
            passed: false,
            reason:
              "The synthetic inviting-panel receiver did not acknowledge the exact selection request",
          };
    },
  },
  {
    name: "mdx-action-button-message",
    description: "Send a clickable follow-up action",
    category: "interaction-surfaces",
    prompt: "Send me a clickable follow-up action in the message.",
    validation: "harness",
    validate: (result) => agentMessageHasAll(result, ["ActionButton"]),
  },
  {
    name: "inline-ui-transcript-event",
    description:
      "Publish an inline UI transcript event from a headless session",
    category: "interaction-surfaces",
    prompt: "Show a small useful inline UI in this conversation.",
    orchestrate: (context) =>
      runWithSyntheticPanelUi(
        context,
        "Show a small useful inline UI in this conversation.",
        "inline UI",
      ),
    validate: (result) => {
      const tools = requireCompletedTools(result, ["inline_ui"]);
      if (!tools.passed) return tools;
      const base = completedScenarioEvidence(result, []);
      if (!base.passed) return base;
      const delivered = completedNamedToolCalls(result, "inline_ui").some(
        (call) => {
          const receipt = nativeChannelMethodValue(call);
          return (
            receipt?.["ok"] === true &&
            typeof receipt["id"] === "string" &&
            result.messages.some(
              (message) =>
                message.contentType === "inline_ui" &&
                message.inlineUi?.id === receipt["id"],
            )
          );
        },
      );
      return delivered
        ? { passed: true }
        : {
            passed: false,
            reason:
              "No canonical inline UI transcript card matched its completed publication receipt",
          };
    },
  },
  {
    name: "load-action-bar-transcript-event",
    description:
      "Publish and clear action-bar transcript events from a headless session",
    category: "interaction-surfaces",
    prompt: "Show a small action bar for this conversation, then clear it.",
    orchestrate: (context) =>
      runWithSyntheticPanelUi(
        context,
        "Show a small action bar for this conversation, then clear it.",
        "action bar",
      ),
    validate: (result) => {
      const tools = requireCompletedTools(result, ["load_action_bar"]);
      if (!tools.passed) return tools;
      const actionBarCalls = completedNamedToolCalls(result, "load_action_bar");
      if (
        !actionBarCalls.some((call) => {
          const toolPath = call.arguments?.["path"];
          return typeof toolPath === "string" && toolPath.length > 0;
        })
      ) {
        return {
          passed: false,
          reason:
            "load_action_bar completed but no load call with a path was observed",
        };
      }
      if (!actionBarCalls.some((call) => call.arguments?.["clear"] === true)) {
        return {
          passed: false,
          reason:
            "load_action_bar completed but no clear:true call was observed",
        };
      }
      const base = completedScenarioEvidence(result, []);
      if (!base.passed) return base;
      const loaded = actionBarCalls.some(
        (call) =>
          typeof call.arguments?.["path"] === "string" &&
          nativeChannelMethodValue(call)?.["ok"] === true &&
          typeof nativeChannelMethodValue(call)?.["id"] === "string",
      );
      const cleared = actionBarCalls.some(
        (call) =>
          call.arguments?.["clear"] === true &&
          nativeChannelMethodValue(call)?.["ok"] === true &&
          nativeChannelMethodValue(call)?.["cleared"] === true,
      );
      return loaded && cleared
        ? { passed: true }
        : {
            passed: false,
            reason:
              "Action-bar load and clear did not return successful canonical outcomes",
          };
    },
  },
  {
    name: "set-title",
    description: "Set the conversation title through the supported surface",
    category: "interaction-surfaces",
    prompt:
      "Give this conversation a short descriptive title and confirm it took effect.",
    validate: (result) => {
      const base = completedScenarioEvidence(result, []);
      if (!base.passed) return base;
      const applied = completedNamedToolCalls(result, "set_title").find(
        (call) => {
          const title = call.arguments?.["title"];
          const details = (
            call.execution?.result as
              | { details?: { title?: unknown } }
              | undefined
          )?.details;
          return (
            typeof title === "string" &&
            title.trim().length > 0 &&
            details?.title === title
          );
        },
      );
      return applied
        ? { passed: true }
        : {
            passed: false,
            reason: "No completed title operation returned the requested title",
          };
    },
  },
  {
    name: "automatic-conversation-title",
    description: "Give an ordinary new conversation a concise semantic title",
    category: "interaction-surfaces",
    prompt:
      "Help me plan a small herb garden for a sunny apartment windowsill. I have room for three pots.",
    validate: (result) => {
      const pending = noIncompleteInvocations(result);
      if (!pending.passed) return pending;
      const titleCalls = completedNamedToolCalls(result, "set_title");
      if (titleCalls.length !== 1) {
        return {
          passed: false,
          reason: `Expected exactly one completed set_title call for an ordinary new conversation; observed ${titleCalls.length}`,
        };
      }
      const title = titleCalls[0]?.arguments?.["title"];
      if (
        typeof title !== "string" ||
        title.trim().length < 3 ||
        title.length > 60
      ) {
        return {
          passed: false,
          reason: `Expected a concise semantic title, received ${JSON.stringify(title)}`,
        };
      }
      const receipt = titleCalls[0]?.execution?.result as
        | { details?: { title?: unknown } }
        | undefined;
      if (
        receipt?.details?.title !== title ||
        result.snapshot?.title !== title
      ) {
        return {
          passed: false,
          reason: "Title operation was not joined to the applied durable title",
        };
      }
      const final = findLastAgentMessage(result);
      return /\b(?:herbs?|basil|thyme|chives|mint|parsley|rosemary|oregano|cilantro)\b/iu.test(
        final,
      ) && /water|soil|pots?|drainage|sun|window/iu.test(final)
        ? pending
        : {
            passed: false,
            reason:
              "Final response did not give relevant windowsill growing advice",
          };
    },
  },
  {
    name: "custom-message-update-clear",
    description: "Update a published custom message in place",
    category: "interaction-surfaces",
    prompt:
      "Try updating one small custom chat message in place. If this context cannot do that, explain why.",
    validate: (result) => {
      const base = completedScenarioEvidence(result);
      if (!base.passed) return base;
      const operations = requireCodeOperations(base.evidence.evalCode, [
        ["chat.publishCustomMessage", "chat.updateCustomMessage"],
      ]);
      if (!operations.passed) return operations;
      const updated = result.messages.some(
        (message) =>
          message.contentType === "custom" &&
          typeof message.custom?.messageId === "string" &&
          message.custom.updates.length > 0,
      );
      return updated
        ? { passed: true }
        : {
            passed: false,
            reason:
              "No published custom message received a canonical state update",
          };
    },
  },
  {
    name: "custom-message-publish",
    description: "Publish a custom chat message",
    category: "interaction-surfaces",
    prompt: "Publish a small custom chat message if this context supports it.",
    validate: (result) => {
      const base = completedScenarioEvidence(result);
      if (!base.passed) return base;
      const operations = requireCodeOperations(base.evidence.evalCode, [
        ["chat.registerMessageType", "chat.publishCustomMessage"],
      ]);
      if (!operations.passed) return operations;
      const published = result.messages.some(
        (message) =>
          message.contentType === "custom" &&
          typeof message.custom?.messageId === "string" &&
          typeof message.custom.typeId === "string",
      );
      return published
        ? { passed: true }
        : {
            passed: false,
            reason: "No canonical custom transcript message was published",
          };
    },
  },
];
