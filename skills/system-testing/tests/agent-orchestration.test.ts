import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";

import { agentGoalPromptFindings } from "../prompt-contract.js";
import { agentOrchestrationTests } from "./agent-orchestration.js";

describe("agent orchestration scenarios", () => {
  it("state user goals without embedding the subagent API or runtime configuration", () => {
    for (const test of agentOrchestrationTests) {
      expect(agentGoalPromptFindings(test.prompt), test.name).toEqual([]);
      expect(test.validation, test.name).toBeUndefined();
    }
  });

  it("joins the reviewed context commit to the exact merge source without a completion record", () => {
    const test = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-diff-inspection",
    )!;
    const runId = "spawn-run-with-a-long-canonical-identity";
    const runHandle = "@s1";
    const sourceEventId = "workspace-event:child-commit";
    const invocation = (
      name: string,
      id: string,
      arguments_: Record<string, unknown>,
      details: Record<string, unknown>,
      protocolText = "",
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
            protocolContent: protocolText
              ? [{ type: "text", text: protocolText }]
              : [],
            details,
          },
        },
      },
    });
    const execution = (
      inspectedSource = sourceEventId,
      integrationState = "unattempted",
      inspectedRun = runHandle,
    ): TestExecutionResult =>
      ({
        duration: 1,
        messages: [
          invocation(
            "spawn_subagent",
            runId,
            { mode: "fresh", task: "Add an export" },
            { runId, runRef: runHandle },
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
              runId: inspectedRun === runHandle ? runId : inspectedRun,
              query: "diff",
              semanticIntegration: {
                state: integrationState,
                sourceEventId: inspectedSource,
              },
            },
            `Source ${sourceEventId}: 1 adopt\nCoordinate: file:typed-export · adopt · add deterministic export\nChild source is committed and clean.`,
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
      ({ name }) => name === "subagent-followup-after-report",
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
        {},
      ),
      invocation(
        "inspect_subagent",
        "inspect-followup",
        { runId: runHandle, query: "diff" },
        {
          runId,
          runRef: runHandle,
          semanticIntegration: {
            state: "unattempted",
            sourceEventId: secondEvent,
          },
        },
      ),
      invocation(
        "merge_subagent",
        "merge-followup",
        { runId: runHandle },
        {
          runId,
          runRef: runHandle,
          sourceEventId: secondEvent,
          review: {
            resolution: {
              complete: true,
              concluded: true,
              remainingCoordinateCount: 0,
            },
          },
        },
      ),
    );
    expect(followupTest.validate(continued).passed).toBe(true);
    const checkedAfterMerge = structuredClone(continued);
    checkedAfterMerge.messages.splice(
      -1,
      0,
      invocation(
        "inspect_subagent",
        "inspect-after-merge",
        { runId: runHandle, query: "diff" },
        {
          runId,
          runRef: runHandle,
          semanticIntegration: {
            state: "complete",
            source: { kind: "event", eventId: secondEvent },
            concluded: true,
            remainingCoordinateCount: 0,
          },
        },
      ),
    );
    expect(followupTest.validate(checkedAfterMerge).passed).toBe(true);
    const integratedFirst = structuredClone(continued);
    integratedFirst.messages.splice(
      3,
      0,
      invocation(
        "merge_subagent",
        "integrated-too-early",
        { runId: runHandle },
        {
          runId,
          runRef: runHandle,
          sourceEventId,
          review: {
            resolution: {
              complete: true,
              concluded: true,
              remainingCoordinateCount: 0,
            },
          },
        },
      ),
    );
    expect(followupTest.validate(integratedFirst).passed).toBe(false);
    const missingFollowup = {
      ...continued,
      messages: continued.messages.filter(
        (message) => message.id !== "followup",
      ),
    };
    expect(followupTest.validate(missingFollowup).passed).toBe(false);
    expect(followupTest.validate(execution()).passed).toBe(false);
    const newCollaborator = {
      ...continued,
      messages: [
        ...continued.messages,
        invocation(
          "spawn_subagent",
          "replacement",
          {},
          { runId: "another-run" },
        ),
      ],
    };
    expect(followupTest.validate(newCollaborator).passed).toBe(false);

    expect(test.validate(execution())).toEqual({
      passed: true,
      reason: undefined,
    });
    expect(
      test.validate(execution(sourceEventId, "unattempted", "@s")).passed,
    ).toBe(false);
    expect(
      test.validate(execution(sourceEventId, "unattempted", "@s2")).passed,
    ).toBe(false);
    const foreignInspection = execution();
    const foreignInspectionReceipt = foreignInspection.messages.find(
      (message) => message.id === "inspect-child",
    )! as ReturnType<typeof invocation>;
    foreignInspectionReceipt.invocation.execution.result.details["runId"] =
      "another-run";
    expect(test.validate(foreignInspection).passed).toBe(false);
    const mergeTest = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-reviewed-merge",
    )!;
    const mergedExecution = (
      event = sourceEventId,
      concluded = true,
      remaining = 0,
    ) => {
      const result = execution();
      result.messages.splice(
        -1,
        0,
        invocation(
          "merge_subagent",
          "merge-child",
          { runId: runHandle },
          {
            runId,
            runRef: runHandle,
            sourceEventId: event,
            protocol: "vibestudio.subagent-merge.v1",
            merges: [{ incorporatedChangeCount: 1 }],
            review: {
              resolution: {
                complete: true,
                concluded,
                remainingCoordinateCount: remaining,
              },
            },
          },
        ),
      );
      return result;
    };
    expect(mergeTest.validate(mergedExecution()).passed).toBe(true);
    expect(mergeTest.validate(execution()).passed).toBe(false);
    expect(
      mergeTest.validate(mergedExecution("workspace-event:other")).passed,
    ).toBe(false);
    expect(
      mergeTest.validate(mergedExecution(sourceEventId, false)).passed,
    ).toBe(false);
    expect(
      mergeTest.validate(mergedExecution(sourceEventId, true, 1)).passed,
    ).toBe(false);
    expect(test.validate(mergedExecution()).passed).toBe(false);
    const prematureMerge = mergedExecution();
    const [merge] = prematureMerge.messages.splice(3, 1);
    prematureMerge.messages.splice(2, 0, merge!);
    // Direct canonical integration is allowed without a separate diff preflight.
    expect(mergeTest.validate(prematureMerge).passed).toBe(true);
    const directMerge = mergedExecution();
    directMerge.messages = directMerge.messages.filter(
      (message) => message.id !== "inspect-child",
    );
    expect(mergeTest.validate(directMerge).passed).toBe(true);
    const emptyMerge = structuredClone(directMerge);
    const emptyReceipt = emptyMerge.messages.find(
      (message) => message.id === "merge-child",
    )! as ReturnType<typeof invocation>;
    emptyReceipt.invocation.execution.result.details["merges"] = [
      { incorporatedChangeCount: 0 },
    ];
    expect(mergeTest.validate(emptyMerge).passed).toBe(false);
    const foreignMerge = structuredClone(directMerge);
    const foreignReceipt = foreignMerge.messages.find(
      (message) => message.id === "merge-child",
    )! as ReturnType<typeof invocation>;
    foreignReceipt.invocation.execution.result.details["runId"] = "another-run";
    expect(mergeTest.validate(foreignMerge).passed).toBe(false);
    const resolvedMerge = mergedExecution();
    resolvedMerge.messages.splice(
      3,
      0,
      invocation(
        "merge_subagent",
        "partial-merge",
        { runId: runHandle },
        {
          runId,
          runRef: runHandle,
          sourceEventId,
          review: {
            resolution: {
              complete: false,
              concluded: false,
              remainingCoordinateCount: 1,
            },
          },
        },
      ),
    );
    expect(mergeTest.validate(resolvedMerge).passed).toBe(true);

    expect(test.validate(execution("workspace-event:other")).passed).toBe(
      false,
    );
    expect(test.validate(execution(sourceEventId, "complete")).passed).toBe(
      false,
    );
    expect(
      test.validate(execution(sourceEventId, "unattempted", "another-run"))
        .passed,
    ).toBe(false);
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
      } as TestExecutionResult).passed,
    ).toBe(false);
  });

  it("keeps model selection out of scenario prose", () => {
    for (const test of agentOrchestrationTests) {
      expect(test.prompt, test.name).not.toMatch(
        /gpt-|claude-\d|thinkingLevel|launchConfig/u,
      );
    }
  });

  it("keeps the delegated design synthesis independent of workspace fixtures", () => {
    const synthesis = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-design-synthesis",
    );
    expect(synthesis?.authorityPolicy).toBeUndefined();
    expect(synthesis?.workspaceRepoFixture).toBeUndefined();
    expect(synthesis?.prompt).toMatch(/hypothetical|no existing codebase/iu);
    expect(synthesis?.prompt).toContain("two independent");
    expect(synthesis?.prompt).toContain("simple data model");
    expect(synthesis?.prompt).toContain("provenance and debuggability");
    expect(synthesis?.prompt).toMatch(
      /summarize.*tradeoffs and disagreements/iu,
    );
    expect(synthesis?.prompt).not.toContain("finish supervising");
  });

  it("keeps delegation quality in trajectory review rather than stale task-card validation", () => {
    const synthesis = agentOrchestrationTests.find(
      ({ name }) => name === "subagent-design-synthesis",
    );
    expect(synthesis?.validation).toBeUndefined();
    expect(synthesis?.validate).toBeDefined();
  });
});
