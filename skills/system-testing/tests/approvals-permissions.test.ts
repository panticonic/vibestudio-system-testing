import { childLogReadReplay, taskRuleSnapshots, serverLogReadJournal } from "./_authority-evidence-fixtures.js";
import { describe, expect, it } from "vitest";
import type { ServerLogEvent } from "@workspace/pubsub";
import type { TestExecutionResult } from "../types.js";
import { approvalPermissionTests } from "./approvals-permissions.js";

const test = approvalPermissionTests.find(
  (test) => test.name === "subagent-task-permission-reuse",
)!;

function execution(
  options: {
    status?: string;
    answer?: number;
    taskId?: number;
    conversationId?: number;
    senderId?: string;
    grantCount?: number;
    explicitConfig?: boolean;
    legacyClosureOnly?: boolean;
    missingChildRead?: boolean;
    changedGrant?: boolean;
    changedInheritedSetting?: "model" | "thinkingLevel" | "fastMode" | "fallbackModel" | "fallbackThinkingLevel" | "fallbackOn" | "fallbackScope" | "approvalLevel";
    missingLaunchConfig?: boolean;
  } = {},
): TestExecutionResult {
  const parentSettings = {
    model: "openai-codex:gpt-6-luna",
    thinkingLevel: "medium",
    fastMode: false,
    fallbackModel: "openai-codex:gpt-6-sol",
    fallbackThinkingLevel: "low",
    fallbackOn: ["usage_limit_terminal"],
    fallbackScope: "unattended",
    approvalLevel: 1,
    respondPolicy: "mentioned-strict",
    respondFrom: [],
  };
  const childLaunchConfig: Record<string, unknown> = {
    model: parentSettings.model,
    thinkingLevel: parentSettings.thinkingLevel,
    fastMode: parentSettings.fastMode,
    fallbackModel: parentSettings.fallbackModel,
    fallbackThinkingLevel: parentSettings.fallbackThinkingLevel,
    fallbackOn: parentSettings.fallbackOn,
    fallbackScope: parentSettings.fallbackScope,
    approvalLevel: parentSettings.approvalLevel,
    respondPolicy: "all",
  };
  const changedKey = options.changedInheritedSetting;
  if (changedKey) {
    const value = childLaunchConfig[changedKey];
    childLaunchConfig[changedKey] = Array.isArray(value)
      ? [...value, "changed"]
      : typeof value === "boolean"
        ? !value
        : typeof value === "number"
          ? value + 1
          : `${String(value)}-changed`;
  }
  const grant = {
    id: "parent-task-grant",
    kind: "capability",
    callerLabel: "This task",
    scopeLabel: "This task",
    resource: "server-logs.read",
    why: "Read server logs",
    approvedBy: "User",
    duration: "This task",
    revokeEffect: "Future requests ask again",
    authority: {
      effect: "allow",
      provenance: "user",
      scope: "task",
      subject: "parent-task",
      capability: "server-logs.read",
      resource: { kind: "exact", key: "server-logs.read" },
    },
  };
  const invocation = (
    id: string,
    name: string,
    args: Record<string, unknown>,
    returnValue: unknown,
  ) => ({
    id,
    senderId: "parent",
    kind: "message" as const,
    contentType: "invocation" as const,
    complete: true,
    content: "",
    invocation: {
      id,
      name,
      arguments: args,
      execution: {
        status: "complete" as const,
        isError: false,
        description: "Completed protected operation",
        result: { details: {
          returnValue,
          ...(id === "parent-read" ? { operationJournal: serverLogReadJournal() } : {}),
          ...(id === "spawn" && !options.missingLaunchConfig ? { launchConfig: childLaunchConfig } : {}),
        } },
      },
    },
  });
  const report: ServerLogEvent = {
    id: 4,
    messageId: "published-child-answer",
    ts: 4,
    type: "agentic.trajectory.v1/event",
    senderId: options.senderId ?? "child",
    payload: {
      kind: "message.completed",
      causality: { messageId: "native:3:11:0" },
      payload: {
        outcome: "completed",
        metadata: {
          nativeTaskId: 7,
          nativeConversationId: 3,
          nativeEntryId: 11,
        },
        blocks: [{ type: "text", content: "yes" }],
      },
    },
  };
  return {
    duration: 1,
    messages: [
      invocation(
        "parent-read",
        "eval",
        { code: "return services.serverLog.stats();" },
        {},
      ),
      invocation(
        "spawn",
        "spawn_subagent",
        {
          prompt: "Check server logs",
          config: options.explicitConfig
            ? { model: "openai-codex:gpt-6-sol", respondPolicy: "all" }
            : { respondPolicy: "all" },
        },
        {},
      ),
      {
        id: "spawn",
        senderId: "parent",
        kind: "message",
        contentType: "task",
        complete: true,
        content: "",
        task: {
          id: "spawn",
          taskType: "subagent",
          title: "Check server logs",
          execution: {
            status: "complete",
            terminalOutcome: "success",
            description: "",
            result: {},
          },
          subagent: {
            taskChannelId: "child-channel",
            childParticipantId: "child",
            childEntityId: "child-entity",
          },
        },
      },
      invocation(
        "inventory",
        "eval",
        { code: "return services.permissions.list();" },
        Array.from({ length: options.grantCount ?? 1 }, () => grant),
      ),
      {
        id: "final",
        senderId: "parent",
        senderMetadata: { type: "agent" },
        kind: "message",
        complete: true,
        content:
          "The child confirmed the logs are readable and used the existing task grant.",
      },
    ],
    diagnostics: {
      subagentTaskRuleReuse: { ...taskRuleSnapshots(options.grantCount), ...(options.changedGrant ? { afterChildRead: [{ ...taskRuleSnapshots().afterChildRead[0], id: "replacement-grant" }] } : {}) },
      subagentSettingsInheritance: { parentSettings, childLaunchConfig: options.missingLaunchConfig ? undefined : childLaunchConfig },
      childReplay: options.legacyClosureOnly
        ? [report, { ...report, id: 5, payload: { kind: "turn.closed" } }]
        : [...(options.missingChildRead ? [] : childLogReadReplay()), report],
      ...(options.legacyClosureOnly
        ? {}
        : {
            childModelExecutionEvidence: {
              calls: [
                {
                  native: {
                    taskId: options.taskId ?? 7,
                    conversationId: options.conversationId ?? 3,
                  },
                  entryId: 11,
                  outcome: "completed",
                  ref: "openai-codex:gpt-6-luna",
                  task: { status: "terminal", outcome: "completed" },
                  inputs: [
                    {
                      id: 5,
                      conversationId: 3,
                      type: "input",
                      status: options.status ?? "done",
                      answer: options.answer ?? 11,
                    },
                  ],
                },
              ],
            },
          }),
    },
  };
}

type ExecutionOptions = NonNullable<Parameters<typeof execution>[0]>;

describe("canonical child task grant reuse", () => {
  it("accepts a settled native child answer and one parent task grant without a synthetic closure", () => {
    expect(test.validate(execution()).passed).toBe(true);
  });
  it("accepts a canonical native log read independently of the chosen stats/query/tail method", () => {
    const result = execution();
    const message = result.messages[0] as unknown as { invocation: { arguments: Record<string, unknown> } };
    message.invocation.arguments = { code: "return await services.serverLog.tail(80);" };
    expect(test.validate(result).passed).toBe(true);
  });
  it.each([
    { status: "placed" },
    { answer: 12 },
    { taskId: 8 },
    { conversationId: 9 },
    { senderId: "another-child" },
    { grantCount: 2 },
    { explicitConfig: true, changedInheritedSetting: "model" },
    { changedInheritedSetting: "model" },
    { missingLaunchConfig: true },
    { legacyClosureOnly: true },
    { missingChildRead: true },
    { changedGrant: true },
  ] satisfies ExecutionOptions[])("rejects unrelated or incomplete evidence %j", (options) => {
    expect(test.validate(execution(options)).passed).toBe(false);
  });
  it.each([
    "model",
    "thinkingLevel",
    "fastMode",
    "fallbackModel",
    "fallbackThinkingLevel",
    "fallbackOn",
    "fallbackScope",
    "approvalLevel",
  ] satisfies NonNullable<ExecutionOptions["changedInheritedSetting"]>[])("rejects a child that changes inherited %s", (changedInheritedSetting) => {
    expect(test.validate(execution({ changedInheritedSetting })).passed).toBe(false);
  });
});
