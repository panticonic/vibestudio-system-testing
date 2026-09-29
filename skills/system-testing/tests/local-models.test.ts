import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { localModelTests } from "./local-models.js";

const taskTest = localModelTests[0]!;

function execution(
  model: string,
  options: {
    taskStatus?: "running" | "complete";
    terminalOutcome?: "success" | "tool_error";
    childHeading?: string;
    finalHeading?: string;
    executedModel?: string;
    childClosed?: boolean;
    retainEvidence?: boolean;
  } = {}
): TestExecutionResult {
  const runId = "spawn-local-model";
  const heading = options.childHeading ?? "system-test-local-model-download-and-task-a1b2c3d4";
  const invocation = (
    name: string,
    arguments_: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ) => ({
    id: `${name}-call`,
    senderId: "agent",
    kind: "message" as const,
    contentType: "invocation" as const,
    complete: true,
    content: "",
    invocation: {
      id: name === "spawn_subagent" ? runId : `${name}-call`,
      name,
      arguments: arguments_,
      ...extra,
      execution: { status: "complete", isError: false, result: { details: {} } },
    },
  });
  return {
    duration: 1,
    messages: [
      invocation("eval", {
        code: `
          const extension = "@workspace-extensions/local-models";
          const status = await services.extensions.invoke(extension, "status", []);
          const models = await services.extensions.invoke(extension, "listModels", []);
          return { status, models };
        `,
      }),
      invocation(
        "spawn_subagent",
        { prompt: "Read the README heading", config: { model } },
        { subagent: { launchConfig: { model } } }
      ),
      {
        id: runId,
        senderId: "agent",
        kind: "message" as const,
        contentType: "task",
        complete: options.taskStatus !== "running",
        content: "",
        task: {
          id: runId,
          taskType: "subagent",
          title: "Read the README heading",
          execution: {
            status: options.taskStatus ?? "complete",
            terminalOutcome: options.terminalOutcome ?? "success",
            description: "",
            result: { protocolContent: [{ type: "text", text: `# ${heading}` }] },
          },
          subagent: { launchConfig: { model }, taskChannelId: "child-channel",
            childParticipantId: "child", childEntityId: "child-entity" },
        },
      },
      {
        id: "final",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        kind: "message" as const,
        complete: true,
        content: `The README heading is ${options.finalHeading ?? heading}.`,
      },
    ],
    diagnostics: options.retainEvidence === false ? {} : {
      subagentEvidence: [{ runId, taskChannelId: "child-channel", childParticipantId: "child",
        modelExecutionEvidence: { calls: [{ messageId: "child-message",
          ref: options.executedModel ?? model,
          outcome: options.terminalOutcome === "tool_error" ? "failed" : "completed" }] },
        events: [{ id: 1, senderId: "child", payload: {
          kind: "message.completed", turnId: "child-turn", causality: { messageId: "child-message" },
          payload: { outcome: "completed", blocks: [{ type: "text", content: `# ${heading}` }] },
        } }, ...(options.childClosed === false ? [] : [{ id: 2, senderId: "child",
          payload: { kind: "turn.closed", turnId: "child-turn", payload: {} } }])],
      }],
    },
  } as unknown as TestExecutionResult;
}

describe("local model task evidence", () => {
  it("requires lifecycle inspection and an exact local-model child", () => {
    expect(taskTest.validation).toBeUndefined();
    expect(taskTest.validate(execution("local:lfm2.5-2.6b"))).toEqual({
      passed: true,
      reason: undefined,
    });
  });

  it("rejects a child launched on a hosted model", () => {
    expect(taskTest.validate(execution("openai-codex:gpt-5.6-luna"))).toMatchObject({
      passed: false,
    });
  });

  it("accepts a closed local assignment without retiring its retained collaborator", () => {
    expect(
      taskTest.validate(execution("local:lfm2.5-2.6b", { taskStatus: "running" }))
    ).toMatchObject({ passed: true });
  });

  it("rejects an unclosed or failed local-model execution", () => {
    expect(taskTest.validate(execution("local:lfm2.5-2.6b", { childClosed: false })))
      .toMatchObject({ passed: false });
    expect(
      taskTest.validate(execution("local:lfm2.5-2.6b", { terminalOutcome: "tool_error" }))
    ).toMatchObject({ passed: false });
  });

  it("rejects a completion card without native execution and transcript evidence", () => {
    expect(taskTest.validate(execution("local:lfm2.5-2.6b", { retainEvidence: false })))
      .toMatchObject({ passed: false });
  });

  it("rejects a requested local model whose report was actually produced by a hosted model", () => {
    expect(taskTest.validate(execution("local:lfm2.5-2.6b", { executedModel: "openai-codex:gpt-6-luna" })))
      .toMatchObject({ passed: false });
  });

  it("requires the parent to report the local child's observed heading", () => {
    expect(
      taskTest.validate(
        execution("local:lfm2.5-2.6b", {
          finalHeading: "system-test-local-model-download-and-task-deadbeef",
        })
      )
    ).toMatchObject({ passed: false });
  });
});
