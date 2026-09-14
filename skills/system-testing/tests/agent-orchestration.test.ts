import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";

import { agentGoalPromptFindings } from "../prompt-contract.js";
import { agentOrchestrationTests } from "./agent-orchestration.js";

describe("agent orchestration scenarios", () => {
  it("state user goals without embedding the subagent API or runtime configuration", () => {
    for (const test of agentOrchestrationTests) {
      expect(agentGoalPromptFindings(test.prompt), test.name).toEqual([]);
      expect(test.validation, test.name).toBe(
        [
          "subagent-diff-inspection",
          "subagent-reviewed-merge",
          "subagent-followup-after-report",
        ].includes(test.name)
          ? "agent-evidence"
          : undefined
      );
    }
  });

  it("joins the reviewed context commit to the exact merge source without a completion record", () => {
    const test = agentOrchestrationTests.find(({ name }) => name === "subagent-diff-inspection")!;
    const runId = "spawn-run-with-a-long-canonical-identity";
    const runHandle = "spawn-run-with-a-long-ca…";
    const sourceEventId = "workspace-event:child-commit";
    const invocation = (
      name: string,
      id: string,
      arguments_: Record<string, unknown>,
      details: Record<string, unknown>,
      protocolText = ""
    ) => ({
      id,
      content: "",
      kind: "message" as const,
      senderId: "agent",
      complete: true,
      contentType: "invocation" as const,
      invocation: {
        id,
        name,
        arguments: arguments_,
        execution: {
          status: "complete" as const,
          description: "",
          isError: false,
          result: {
            protocolContent: protocolText ? [{ type: "text", text: protocolText }] : [],
            details,
          },
        },
      },
    });
    const execution = (
      inspectedSource = sourceEventId,
      integrationState = "unattempted",
      inspectedRun = runHandle
    ): TestExecutionResult =>
      ({
        duration: 1,
        messages: [
          invocation(
            "spawn_subagent",
            runId,
            { mode: "fresh", task: "Add an export" },
            { runId: runHandle }
          ),
          {
            kind: "message",
            senderId: "agent",
            complete: true,
            content: "The typed export is committed and ready for review.",
          },
          invocation(
            "inspect_subagent",
            "inspect-child",
            { runId: inspectedRun, query: "diff" },
            {
              runId: inspectedRun,
              query: "diff",
              semanticIntegration: {
                state: integrationState,
                sourceEventId: inspectedSource,
              },
            },
            `Source ${sourceEventId}: 1 adopt\nCoordinate: file:typed-export · adopt · add deterministic export\nChild source is committed and clean.`
          ),
          {
            kind: "message",
            senderId: "agent",
            senderMetadata: { type: "agent" },
            complete: true,
            content:
              "The committed typed export is a one-coordinate diff and remains unintegrated.",
          },
        ],
      }) as TestExecutionResult;

    const followupTest = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-followup-after-report"
    )!;
    const continued = execution();
    const secondEvent = "workspace-event:followup-commit";
    continued.messages.splice(
      -1,
      0,
      invocation(
        "notify",
        "followup",
        { to: [`run:${runHandle}`], content: "Add secondValue" },
        {}
      ),
      invocation(
        "inspect_subagent",
        "inspect-followup",
        { runId: runHandle, query: "diff" },
        {
          runId: runHandle,
          semanticIntegration: {
            state: "unattempted",
            sourceEventId: secondEvent,
          },
        }
      ),
      invocation(
        "merge_subagent",
        "merge-followup",
        { runId: runHandle },
        {
          runId: runHandle,
          sourceEventId: secondEvent,
          review: {
            resolution: {
              complete: true,
              concluded: true,
              remainingCoordinateCount: 0,
            },
          },
        }
      )
    );
    expect(followupTest.validate(continued).passed).toBe(true);
    const missingFollowup = {
      ...continued,
      messages: continued.messages.filter((message) => message.id !== "followup"),
    };
    expect(followupTest.validate(missingFollowup).passed).toBe(false);
    expect(followupTest.validate(execution()).passed).toBe(false);
    const newCollaborator = {
      ...continued,
      messages: [
        ...continued.messages,
        invocation("spawn_subagent", "replacement", {}, { runId: "another-run" }),
      ],
    };
    expect(followupTest.validate(newCollaborator).passed).toBe(false);

    expect(test.validate(execution())).toEqual({
      passed: true,
      reason: undefined,
    });
    const mergeTest = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-reviewed-merge"
    )!;
    const mergedExecution = (event = sourceEventId, concluded = true, remaining = 0) => {
      const result = execution();
      result.messages.splice(
        -1,
        0,
        invocation(
          "merge_subagent",
          "merge-child",
          { runId: runHandle },
          {
            runId: runHandle,
            sourceEventId: event,
            review: {
              resolution: {
                complete: true,
                concluded,
                remainingCoordinateCount: remaining,
              },
            },
          }
        )
      );
      return result;
    };
    expect(mergeTest.validate(mergedExecution()).passed).toBe(true);
    expect(mergeTest.validate(execution()).passed).toBe(false);
    expect(mergeTest.validate(mergedExecution("workspace-event:other")).passed).toBe(false);
    expect(mergeTest.validate(mergedExecution(sourceEventId, false)).passed).toBe(false);
    expect(mergeTest.validate(mergedExecution(sourceEventId, true, 1)).passed).toBe(false);
    expect(test.validate(mergedExecution()).passed).toBe(false);
    const prematureMerge = mergedExecution();
    const [merge] = prematureMerge.messages.splice(3, 1);
    prematureMerge.messages.splice(2, 0, merge!);
    expect(mergeTest.validate(prematureMerge).passed).toBe(false);
    const resolvedMerge = mergedExecution();
    resolvedMerge.messages.splice(
      3,
      0,
      invocation(
        "merge_subagent",
        "partial-merge",
        { runId: runHandle },
        {
          runId: runHandle,
          sourceEventId,
          review: {
            resolution: {
              complete: false,
              concluded: false,
              remainingCoordinateCount: 1,
            },
          },
        }
      )
    );
    expect(mergeTest.validate(resolvedMerge).passed).toBe(true);

    expect(test.validate(execution("workspace-event:other")).passed).toBe(false);
    expect(test.validate(execution(sourceEventId, "complete")).passed).toBe(false);
    expect(test.validate(execution(sourceEventId, "unattempted", "another-run")).passed).toBe(
      false
    );
    expect(
      test.validate({
        duration: 1,
        messages: [
          {
            kind: "message",
            senderId: "agent",
            senderMetadata: { type: "agent" },
            complete: true,
            content: "The committed typed export remains unintegrated.",
          },
        ],
      } as TestExecutionResult).passed
    ).toBe(false);
  });

  it("keeps model selection out of scenario prose", () => {
    for (const test of agentOrchestrationTests) {
      expect(test.prompt, test.name).not.toMatch(/gpt-|claude-\d|thinkingLevel|launchConfig/u);
    }
  });

  it("keeps the delegated design synthesis independent of workspace fixtures", () => {
    const synthesis = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-design-synthesis"
    );
    expect(synthesis?.authorityPolicy).toBeUndefined();
    expect(synthesis?.workspaceRepoFixture).toBeUndefined();
    expect(synthesis?.prompt).toContain("There is no existing codebase");
    expect(synthesis?.prompt).toContain(
      "Delegate two independent reviews concurrently to subagents"
    );
    expect(synthesis?.prompt).toContain("at most five bullets");
    expect(synthesis?.prompt).toContain("both replies are in the conversation");
    expect(synthesis?.prompt).toContain("one synthesis under 500 words");
    expect(synthesis?.prompt).not.toContain("finish supervising");
  });

  it("keeps delegation quality in trajectory review rather than stale task-card validation", () => {
    const synthesis = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-design-synthesis"
    );
    expect(synthesis?.validation).toBeUndefined();
    expect(synthesis?.validate).toBeDefined();
  });
});
