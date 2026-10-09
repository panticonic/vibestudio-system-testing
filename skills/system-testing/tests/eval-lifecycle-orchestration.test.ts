import { describe, expect, it, vi } from "vitest";
import type { TestOrchestrationContext } from "../types.js";
import { evalLifecycleTests } from "./eval-lifecycle.js";

const replay = evalLifecycleTests.find((test) => test.name === "eval-agent-replay")!;

function replayFixture() {
  const controller = new AbortController();
  const listeners = new Set<() => void>();
  let invocations = [{ id: "model-1", name: "model.generation", status: "pending" }];
  let activeObservations = 0;
  let settleInput!: () => void;
  let faulted = false;
  const observe = <T>(read: () => T | undefined, signal: AbortSignal) => {
    activeObservations += 1;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        listeners.delete(evaluate);
        signal.removeEventListener("abort", aborted);
      };
      const aborted = () => {
        cleanup();
        reject(signal.reason);
      };
      const evaluate = () => {
        const result = read();
        if (result !== undefined) {
          cleanup();
          resolve(result);
        }
      };
      signal.addEventListener("abort", aborted, { once: true });
      listeners.add(evaluate);
      if (signal.aborted) aborted();
      else evaluate();
    }).finally(() => {
      activeObservations -= 1;
    });
  };
  const session = {
    agentTargetId: "do:workers/agent-worker:AiChatWorker:replay",
    messages: [],
    send: vi.fn().mockResolvedValue("input-1"),
    snapshot: () => ({ invocations }),
    waitUntil: vi.fn((read: () => unknown, options: { signal: AbortSignal }) =>
      observe(read, options.signal)
    ),
    waitForInput: vi.fn((_input: string, options: { signal: AbortSignal }) => {
      if (faulted) return Promise.resolve({ id: "original-answer" });
      let settled = false;
      settleInput = () => {
        settled = true;
        for (const listener of [...listeners]) listener();
      };
      return observe(() => settled ? { id: "original-answer" } : undefined, options.signal);
    }),
    close: vi.fn(async () => {
      expect(activeObservations).toBe(0);
      expect(listeners.size).toBe(0);
    }),
  };
  const fault = vi.fn(async (targetId: string) => {
    expect(targetId).toBe(session.agentTargetId);
    expect(activeObservations).toBe(0);
    faulted = true;
    return { targetId, aborted: true };
  });
  const context = {
    runner: { spawn: async () => session, faultAbortAgentVesselForReplayProbe: fault },
    signal: controller.signal,
    remainingTimeMs: () => 120_000,
  } as unknown as TestOrchestrationContext;
  return {
    controller,
    session,
    fault,
    context,
    settleInput: () => settleInput(),
    publishEval: () => {
      invocations = [...invocations, { id: "eval-original", name: "eval", status: "running" }];
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("eval agent replay orchestration readiness", () => {
  it("waits through slow generation, faults once at a live eval, and observes the same admitted input", async () => {
    vi.useFakeTimers();
    try {
      const { context, session, fault, publishEval } = replayFixture();
      const running = replay.orchestrate!(context);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(session.waitUntil).toHaveBeenCalledTimes(1);
      expect(fault).not.toHaveBeenCalled();
      expect(session.close).not.toHaveBeenCalled();
      publishEval();
      const result = await running;
      expect(result.error).toBeUndefined();
      expect(fault).toHaveBeenCalledTimes(1);
      expect(session.send).toHaveBeenCalledTimes(1);
      expect(session.waitForInput.mock.calls.map(([id]) => id)).toEqual(["input-1", "input-1"]);
      expect(session.waitForInput.mock.calls[1]?.[1]).toEqual({ signal: context.signal });
      expect(result.diagnostics?.["evalAgentReplay"]).toMatchObject({
        invocationId: "eval-original",
        inputMessageId: "input-1",
        statusBeforeAbort: "running",
        aborted: true,
      });
      expect(session.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an input that actually settles without a live eval and joins the remaining observer", async () => {
    const { context, session, fault, settleInput } = replayFixture();
    const running = replay.orchestrate!(context);
    await vi.waitFor(() => expect(session.waitForInput).toHaveBeenCalledTimes(1));
    settleInput();
    const result = await running;
    expect(result.error).toBe("The admitted input settled without an observed live eval invocation");
    expect(fault).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(result.cleanupErrors).toBeUndefined();
  });

  it("propagates cancellation and joins both readiness observers before closing the session", async () => {
    const { context, session, fault, controller } = replayFixture();
    const running = replay.orchestrate!(context);
    await vi.waitFor(() => expect(session.waitForInput).toHaveBeenCalledTimes(1));
    controller.abort(new Error("Test execution cancelled"));
    const result = await running;
    expect(result.error).toBe("Test execution cancelled");
    expect(fault).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(result.cleanupErrors).toBeUndefined();
  });
});
