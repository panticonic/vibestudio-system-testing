import {
  nativeInvocationId,
  type NativeInvocationSource,
} from "@vibestudio/service-schemas/nativeInvocation";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@workspace/agentic-core";
import type { TestExecutionResult } from "../types.js";
import { harnessResilienceTests } from "./harness-resilience.js";

const thrownRecovery = harnessResilienceTests.find(
  (test) => test.name === "eval-thrown-error-then-continues",
)!;
const invalidArgsRecovery = harnessResilienceTests.find(
  (test) => test.name === "invalid-tool-args-visible-retry",
)!;
const postToolFollowup = harnessResilienceTests.find(
  (test) => test.name === "post-tool-followup-turn",
)!;

describe("harness resilience validation", () => {
  it("requires the intentional thrown eval to precede its successful recovery", () => {
    expect(
      thrownRecovery.validate(
        execution([
          invocation("eval", "error", true, "intentional failure"),
          invocation("eval", "complete", false, { recovered: true }),
          finalMessage(
            "The deliberate error was visible, and the later evaluation succeeded.",
          ),
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });

    expect(
      thrownRecovery.validate(
        execution([
          invocation("eval", "complete", false, { recovered: true }),
          invocation("eval", "error", true, "intentional failure"),
          finalMessage(
            "The deliberate error was visible, but no later evaluation succeeded.",
          ),
        ]),
      ).passed,
    ).toBe(false);
  });

  it("requires an invalid tool call to be followed by a successful tool call", () => {
    expect(
      invalidArgsRecovery.validate(
        execution([
          invocation(
            "vcs",
            "error",
            true,
            "arguments failed schema validation",
          ),
          invocation("vcs", "complete", false, { ok: true }),
          finalMessage(
            "The invalid request was rejected and the corrected request succeeded.",
          ),
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });

    expect(
      invalidArgsRecovery.validate(
        execution([
          invocation(
            "vcs",
            "error",
            true,
            "arguments failed schema validation",
          ),
          finalMessage("The invalid request was rejected."),
        ]),
      ).passed,
    ).toBe(false);
  });

  it("accepts argument rejection and recovery for any schema-validated tool", () => {
    expect(
      invalidArgsRecovery.validate(
        execution([
          invocation(
            "grep",
            "error",
            true,
            "Invalid arguments for tool grep: expected string",
          ),
          invocation("grep", "complete", false, {
            matches: ["meta/AGENTS.md"],
          }),
          finalMessage(
            "The malformed grep was rejected and the corrected grep succeeded.",
          ),
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("counts one canonical receiver rejection propagated to its native task and requires later recovery", () => {
    const source: NativeInvocationSource = {
      owner: {
        runtimeId: "do:workers/agent-worker:AiChatWorker:test",
        authoritySessionId: "authority:test",
        contextId: "context:test",
        incarnation: "storage:test",
        channelId: "channel:test",
        source: "workers/agent-worker",
        effectiveVersion: "version:test",
        className: "AiChatWorker",
        objectKey: "test",
        executionDigest: "a".repeat(64),
      },
      task: { taskId: 1, conversationId: 1, kind: "pi.tool", version: 2 },
      operation: {
        kind: "tool",
        assistantEntryId: 1,
        callId: "call:test",
        name: "validation_retry_probe",
        argumentsDigest: "b".repeat(64),
      },
    };
    const parentId = nativeInvocationId(source);
    const remote = invocation(
      "validation_retry_probe",
      "error",
      true,
      "Invalid arguments for tool validation_retry_probe: injected first-call argument rejection",
    );
    remote.invocation!.id = "transport:test";
    const parent = invocation("validation_retry_probe", "error", true, {
      message:
        "Invalid arguments for tool validation_retry_probe: injected first-call argument rejection",
      details: {
        protocol: "native-channel-method-outcome.v1",
        invocationId: "transport:test",
        transportCallId: "call:test",
        eventId: 1,
        kind: "invocation.failed",
        value: "injected first-call argument rejection",
      },
    });
    parent.invocation!.id = parentId;
    const result = execution([
      remote,
      parent,
      invocation("validation_retry_probe", "complete", false, {
        recovered: true,
      }),
      finalMessage(
        "The receiver rejected once and the corrected call succeeded.",
      ),
    ]);
    result.snapshot = {
      invocations: [
        {
          id: parentId,
          name: "validation_retry_probe",
          status: "error",
          nativeSource: source,
        },
      ],
    } as NonNullable<TestExecutionResult["snapshot"]>;
    expect(invalidArgsRecovery.validate(result).passed).toBe(true);
    const mismatch = structuredClone(result);
    mismatch.messages[1]!.invocation!.arguments = { different: true };
    expect(invalidArgsRecovery.validate(mismatch).passed).toBe(false);
    const stranded = structuredClone(result);
    stranded.messages.splice(3, 1);
    expect(invalidArgsRecovery.validate(stranded).passed).toBe(false);
    const unrelated = structuredClone(result);
    unrelated.messages.splice(
      3,
      0,
      invocation("vcs", "error", true, "unrelated execution failure"),
    );
    expect(invalidArgsRecovery.validate(unrelated).passed).toBe(false);
  });

  it("validates orchestrated follow-up turns by their exact completed response identities", () => {
    const first = finalMessage("First tool-backed answer.", "answer:first");
    const second = finalMessage("Fresh follow-up answer.", "answer:second");
    const result = execution([
      invocation("read", "complete", false, { content: "small observation" }),
      first,
      second,
    ]);
    // Headless transcripts intentionally need not echo locally authored user
    // prompts. The orchestrator supplies the actual phase boundaries.
    result.messages = result.messages.filter(
      (message) => message.senderId !== "user",
    );
    result.diagnostics = {
      followupTurn: {
        initialResponseId: first.id,
        followupResponseId: second.id,
      },
    };

    expect(postToolFollowup.validate(result)).toEqual({
      passed: true,
      reason: undefined,
    });
    result.diagnostics["followupTurn"] = {
      initialResponseId: first.id,
      followupResponseId: first.id,
    };
    expect(postToolFollowup.validate(result).passed).toBe(false);
  });
});

function invocation(
  name: string,
  status: "complete" | "error",
  isError: boolean,
  result: unknown,
): ChatMessage {
  const arguments_ =
    name === "eval" && status === "error"
      ? { code: 'throw new Error("intentional failure")' }
      : name === "eval"
        ? { code: "return { recovered: true };" }
        : undefined;
  const execution = {
    status,
    terminalOutcome: isError ? ("tool_error" as const) : ("success" as const),
    description: "",
    isError,
    result:
      name === "eval" && status === "complete"
        ? { details: { returnValue: result } }
        : result,
  };
  const invocationPayload = {
    id: `call-${name}-${status}-${String(isError)}`,
    name,
    arguments: arguments_ ?? {},
    execution,
  };
  return {
    id: `${name}-${status}-${String(isError)}`,
    kind: "message",
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    contentType: "invocation",
    content: JSON.stringify(invocationPayload),
    invocation: invocationPayload,
  };
}

function finalMessage(
  content: string,
  id = "final-agent-message",
): ChatMessage {
  return {
    id,
    kind: "message",
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    content,
  };
}

function execution(messages: ChatMessage[]): TestExecutionResult {
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
      ...messages,
    ],
  } as TestExecutionResult;
}
