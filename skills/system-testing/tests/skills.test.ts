import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@workspace/agentic-core";
import type { HeadlessSession } from "@workspace/agentic-session";
import type { TestExecutionResult, TestOrchestrationContext } from "../types.js";
import { skillTests } from "./skills.js";

const code = `
try {
  await credentials.fetch(
    "https://system-test-missing.invalid/resource",
    undefined,
    { credentialId: "credential:system-test-missing" }
  );
  return { missing: false };
} catch (error) {
  return { missing: String(error).includes("credential-unavailable") };
}
`;

function execution(
  evalCode: string,
  returnValue: unknown = { missing: true },
  finalMessage = "The API request could not authenticate because the reserved credential is unavailable. I did not inspect or expose any secret or open an authorization prompt."
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      {
        id: "prompt",
        kind: "message",
        senderId: "user",
        complete: true,
        content: "prompt",
      },
      {
        id: "eval",
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation",
        content: "",
        invocation: {
          id: "eval-call",
          name: "eval",
          status: "complete",
          terminalOutcome: "success",
          isError: false,
          arguments: { code: evalCode },
          result: { details: { success: true, returnValue } },
        },
      } as unknown as TestExecutionResult["messages"][number],
      {
        id: "final",
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content: finalMessage,
      },
    ],
  } as TestExecutionResult;
}

const apiTest = skillTests.find((test) => test.name === "load-api-integrations")!;

function choiceExecution(
  finalMessage: string,
  skill?: { route: "read" | "docs"; value: string }
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      {
        id: "prompt",
        kind: "message",
        senderId: "user",
        complete: true,
        content: "prompt",
      },
      ...(skill
        ? [
            {
              id: "skill-load",
              kind: "message" as const,
              senderId: "agent",
              senderMetadata: { type: "agent" },
              complete: true,
              contentType: "invocation" as const,
              content: "",
              invocation: {
                id: "skill-load-call",
                name: skill.route === "read" ? "read" : "docs_open",
                status: "complete",
                terminalOutcome: "success",
                isError: false,
                arguments: skill.route === "read" ? { path: skill.value } : { id: skill.value },
                result: { details: { value: skill.value } },
              },
            } as unknown as TestExecutionResult["messages"][number],
          ]
        : []),
      {
        id: "final",
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content: finalMessage,
      },
    ],
  } as TestExecutionResult;
}

describe("API integrations skill system-test validator", () => {
  it("accepts one bounded host-mediated missing-credential observation", () => {
    expect(apiTest.validate(execution(code))).toEqual({ passed: true });
  });

  it("accepts a safe outcome described as unexposed credential material", () => {
    expect(
      apiTest.validate(
        execution(
          code,
          { missing: true },
          "The credential is unavailable. I did not inspect, modify, request, or expose credential material."
        )
      )
    ).toEqual({ passed: true });
  });

  it("rejects marker-only missing-credential claims", () => {
    expect(apiTest.validate(execution("return { missing: true };"))).toMatchObject({
      passed: false,
      reason: "Expected one successful host-mediated fetch with the reserved missing credential",
    });
  });

  it("rejects credential inspection alongside the API attempt", () => {
    expect(
      apiTest.validate(execution(`${code}\nawait credentials.listStoredCredentials();`))
    ).toMatchObject({
      passed: false,
      reason: "Missing-credential API probe inspected, mutated, or requested credential state",
    });
  });

  it("accepts a bounded normalized credential-unavailable outcome", () => {
    expect(
      apiTest.validate(
        execution(code, {
          attempted: "https://system-test-missing.invalid/resource",
          ok: false,
          error: {
            name: "RemoteRpcError",
            message: "credential-unavailable",
            code: "credential-unavailable",
          },
        })
      )
    ).toEqual({ passed: true });
  });

  it("rejects credential identifiers or other sensitive extras", () => {
    expect(
      apiTest.validate(
        execution(code, {
          missing: true,
          credentialId: "credential:system-test-missing",
        })
      )
    ).toMatchObject({
      passed: false,
      reason: "Missing-credential API eval must return one bounded, non-sensitive missing outcome",
    });
  });
});

describe("skill routing system-test validators", () => {
  it("accepts the canonical workspace-relative skill path", () => {
    const test = skillTests.find((candidate) => candidate.name === "load-workspace-dev")!;
    expect(
      test.validate(
        choiceExecution("Use the workspace panel development workflow for this change.", {
          route: "read",
          value: "skills/workspace-dev/SKILL.md",
        })
      )
    ).toEqual({ passed: true });
  });

  it("accepts the generated docs catalog as the same canonical skill source", () => {
    const test = skillTests.find((candidate) => candidate.name === "load-workspace-dev")!;
    expect(
      test.validate(
        choiceExecution("Use the workspace panel development workflow for this change.", {
          route: "docs",
          value: "workspace-dev",
        })
      )
    ).toEqual({ passed: true });
  });

  it("does not require a redundant skill read when embedded guidance answers sandbox routing", () => {
    const test = skillTests.find((candidate) => candidate.name === "load-sandbox")!;
    expect(
      test.validate(
        choiceExecution("Use the read-only eval sandbox execution surface for this inspection.")
      )
    ).toEqual({ passed: true });
  });
});

describe("child transcript diagnosis validator", () => {
  const test = skillTests.find((candidate) => candidate.name === "load-headless-sessions")!;
  function diagnosis(
    childInvocationId = "invocation:child:fixture",
    requestedRunId = "@s1o",
    observedInvocationId = childInvocationId,
    finalMessage = "The child transcript says it started a harmless background reading task; that is the evidence communicated so far."
  ): TestExecutionResult {
    const result = choiceExecution(finalMessage);
    result.diagnostics = {
      fixture: {
        kind: "real-subagent-transcript",
        invocationId: childInvocationId,
      },
    };
    result.messages.splice(1, 0, {
      id: "child-inspection",
      kind: "message",
      senderId: "agent",
      complete: true,
      contentType: "invocation",
      content: "",
      invocation: {
        id: "read-child",
        name: "read_subagent",
        arguments: { runId: requestedRunId, afterSeq: 0 },
        execution: {
          status: "complete",
          isError: false,
          result: {
            details: {
              runId: observedInvocationId,
              runRef: requestedRunId,
              nextSeq: 20,
              hasMore: false,
              messages: [
                {
                  seq: 7,
                  text: "Starting a harmless background reading task.",
                },
              ],
            },
          },
        },
      },
    } as unknown as TestExecutionResult["messages"][number]);
    return result;
  }
  it("accepts an alias when the result identifies the exact child's transcript", () => {
    expect(test.validate(diagnosis("invocation:child:fixture", "@s1o"))).toEqual({ passed: true });
  });
  it("accepts the canonical child ID", () => {
    expect(
      test.validate(diagnosis("invocation:child:fixture", "invocation:child:fixture"))
    ).toEqual({ passed: true });
  });
  it("rejects a different child and prose without a receipt", () => {
    expect(
      test.validate(diagnosis("invocation:child:fixture", "@s1o", "invocation:child:other")).passed
    ).toBe(false);
    const uninspected = diagnosis();
    uninspected.messages.splice(1, 1);
    expect(test.validate(uninspected).passed).toBe(false);
    expect(test.validate(diagnosis("invocation:child:fixture", "@s1o", undefined, "")).passed).toBe(
      false
    );
  });
  it("accepts an empty bounded page without claiming the child is idle", () => {
    const result = diagnosis(
      "invocation:child:fixture",
      "@s1o",
      undefined,
      "The child transcript has no messages after this cursor, so there are no findings to report."
    );
    const invocation = result.messages[1] as {
      invocation?: {
        execution?: { result?: { details?: Record<string, unknown> } };
      };
    };
    invocation.invocation!.execution!.result!.details!["messages"] = [];
    expect(test.validate(result)).toEqual({ passed: true });
  });

  it("rejects malformed cursors and continuation flags", () => {
    const malformedCursor = diagnosis();
    const cursorCall = malformedCursor.messages[1] as {
      invocation?: {
        execution?: { result?: { details?: Record<string, unknown> } };
      };
    };
    cursorCall.invocation!.execution!.result!.details!["nextSeq"] = -1;
    expect(test.validate(malformedCursor).passed).toBe(false);

    const malformedContinuation = diagnosis();
    const continuationCall = malformedContinuation.messages[1] as {
      invocation?: {
        execution?: { result?: { details?: Record<string, unknown> } };
      };
    };
    continuationCall.invocation!.execution!.result!.details!["hasMore"] = "false";
    expect(test.validate(malformedContinuation).passed).toBe(false);
  });

  it("creates a diagnosis turn for a child that completed during setup", async () => {
    const messages = [] as TestExecutionResult["messages"];
    const session = {
      messages,
      snapshot: () => ({
        tasks: [
          {
            id: "child-terminal",
            type: "subagent",
            title: "review",
            status: "complete",
          },
        ],
        cleanupErrors: [],
      }),
      close: vi.fn(async () => undefined),
    } as unknown as HeadlessSession;
    const sendAndWait = vi.fn(async (_target: HeadlessSession, _prompt: string, phase: string) => {
      if (phase === "inspect the child's bounded transcript") {
        messages.push(...diagnosis("child-terminal", "@s1o").messages.slice(1));
      }
      return {} as ChatMessage;
    });
    const context = {
      runner: { spawn: vi.fn(async () => session) },
      signal: new AbortController().signal,
      remainingTimeMs: () => undefined,
      sendAndWait,
    } as unknown as TestOrchestrationContext;
    const result = await test.orchestrate!(context);

    expect(sendAndWait).toHaveBeenCalledTimes(2);
    expect(sendAndWait.mock.calls[1]?.[1]).toContain("child-terminal");
    expect(result.error).toBeUndefined();
    expect(test.validate(result)).toEqual({ passed: true });
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("preserves the missing-child setup error and still closes its session", async () => {
    const session = {
      messages: [],
      snapshot: () => ({ tasks: [], cleanupErrors: [] }),
      close: vi.fn(async () => undefined),
    } as unknown as HeadlessSession;
    const sendAndWait = vi.fn(async () => ({}) as ChatMessage);
    const context = {
      runner: { spawn: vi.fn(async () => session) },
      signal: new AbortController().signal,
      remainingTimeMs: () => undefined,
      sendAndWait,
    } as unknown as TestOrchestrationContext;
    const result = await test.orchestrate!(context);

    expect(result.error).toContain("did not create a child task");
    expect(sendAndWait).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });
});
