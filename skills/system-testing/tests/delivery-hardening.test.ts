import {
  nativeInvocationId,
  type NativeInvocationSource,
} from "@vibestudio/service-schemas/nativeInvocation";
import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { deliveryHardeningTests } from "./delivery-hardening.js";

function agentMessage(content = "Completed successfully.") {
  return {
    id: crypto.randomUUID(),
    kind: "message",
    contentType: "text",
    content,
    complete: true,
    senderMetadata: { type: "agent", name: "Agent", handle: "agent" },
  } as never;
}

function invocation(name: string, id = `invocation:${name}`) {
  return {
    id,
    kind: "message",
    contentType: "invocation",
    complete: true,
    senderMetadata: { type: "agent", name: "Agent", handle: "agent" },
    invocation: {
      id,
      name,
      execution: { status: "complete", isError: false, result: { ok: true } },
    },
  } as never;
}

function execution(
  diagnostics: Record<string, unknown>,
  tool?: string,
): TestExecutionResult {
  return {
    messages: [...(tool ? [invocation(tool)] : []), agentMessage()],
    duration: 1,
    diagnostics,
  };
}

function test(name: string) {
  return deliveryHardeningTests.find((candidate) => candidate.name === name)!;
}

describe("delivery hardening scenario validators", () => {
  it("requires an injected first-subscription failure and a recovered ready surface", () => {
    const result = execution({
      firstConnectRecovery: {
        connectedAfterRecovery: true,
        faults: [{ method: "join", injected: true }],
      },
    });
    expect(test("delivery-first-connect-recovery").validate(result)).toEqual({
      passed: true,
    });
  });

  it("requires one provider execution after a transient claim failure", () => {
    const result = execution(
      {
        transientClaimRecovery: {
          executionCount: 1,
          faults: [{ method: "claimMethodCall", injected: true }],
        },
      },
      "delivery_probe",
    );
    expect(test("delivery-transient-claim-recovery").validate(result)).toEqual({
      passed: true,
    });
  });

  it("counts one causally linked method execution while requiring both owner and receiver to settle", () => {
    const source: NativeInvocationSource = {
      owner: {
        runtimeId: "do:workers/agent:Agent:one",
        authoritySessionId: "lifetime",
        contextId: "context",
        incarnation: "storage",
        channelId: "channel",
        source: "workers/agent",
        effectiveVersion: "state",
        className: "Agent",
        objectKey: "one",
        executionDigest: "a".repeat(64),
      },
      task: { conversationId: 4, taskId: 38, kind: "pi.tool", version: 2 },
      operation: {
        kind: "tool",
        assistantEntryId: 37,
        callId: "call:original",
        name: "delivery_probe",
        argumentsDigest: "b".repeat(64),
      },
    };
    const ownerId = nativeInvocationId(source);
    const call = (id: string, extra: Record<string, unknown> = {}) => ({
      ...(invocation("delivery_probe", id) as object),
      invocation: {
        id,
        name: "delivery_probe",
        arguments: {},
        execution: {
          status: "complete",
          terminalOutcome: "success",
          isError: false,
          result: { ok: true },
        },
        ...extra,
      },
    });
    const result = execution({
      transientClaimRecovery: {
        executionCount: 1,
        faults: [{ method: "claimMethodCall", injected: true }],
      },
    });
    result.messages.unshift(
      call("call:physical") as never,
      call(ownerId, {
        nativeSource: source,
        execution: {
          status: "complete",
          terminalOutcome: "success",
          result: {
            details: {
              protocol: "native-channel-method-outcome.v1",
              invocationId: "call:physical",
              transportCallId: "transport:original",
              eventId: 5,
              kind: "invocation.completed",
              value: { ok: true },
            },
          },
        },
      }) as never,
    );
    expect(test("delivery-transient-claim-recovery").validate(result)).toEqual({
      passed: true,
    });
    const unrelated = structuredClone(result);
    (
      unrelated.messages[1] as any
    ).invocation.execution.result.details.invocationId = "different-call";
    expect(
      test("delivery-transient-claim-recovery").validate(unrelated).passed,
    ).toBe(false);
    const stranded = structuredClone(result);
    (stranded.messages[0] as any).invocation.execution.status = "pending";
    delete (stranded.messages[0] as any).invocation.execution.terminalOutcome;
    expect(
      test("delivery-transient-claim-recovery").validate(stranded).passed,
    ).toBe(false);
  });

  it("requires one terminal identity and one execution across the vessel abort", () => {
    const result = execution(
      { terminalAfterVesselRestart: { aborted: true, executionCount: 1 } },
      "delayed_delivery_probe",
    );
    expect(
      test("delivery-terminal-after-vessel-restart").validate(result),
    ).toEqual({
      passed: true,
    });
  });

  it("rejects per-mailbox context copies after wake", () => {
    const passing = execution({
      contextStorageAfterWake: {
        aborted: true,
        before: {
          envelopeCount: 10,
          eventRows: 6,
          mailboxRows: 12,
          mailboxContextCopies: 0,
        },
        after: {
          envelopeCount: 14,
          eventRows: 9,
          mailboxRows: 18,
          mailboxContextCopies: 0,
        },
      },
    });
    expect(
      test("delivery-context-storage-after-wake").validate(passing),
    ).toEqual({
      passed: true,
    });

    const copied = structuredClone(passing);
    (
      copied.diagnostics!["contextStorageAfterWake"] as {
        after: { mailboxContextCopies: number };
      }
    ).after.mailboxContextCopies = 1;
    expect(
      test("delivery-context-storage-after-wake").validate(copied).passed,
    ).toBe(false);
  });
});
