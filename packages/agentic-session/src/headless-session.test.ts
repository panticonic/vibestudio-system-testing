import { describe, it, expect, vi } from "vitest";
import { HeadlessSession } from "./headless-session.js";
import type { ChatMessage, ConnectionConfig } from "@workspace/agentic-core";
import {
  AGENTIC_EVENT_PAYLOAD_KIND,
  AGENTIC_PROTOCOL_VERSION,
  brandId,
  type TurnId,
} from "@workspace/agentic-protocol";
import type { MethodDefinition } from "@workspace/pubsub";
import { systemTestFailure } from "../../../skills/system-testing/structured-error.js";

function createConfig(): ConnectionConfig {
  return {
    clientId: "headless-test",
    rpc: {
      selfId: "headless-test",
      call: vi.fn(),
      stream: vi.fn(async () => new Response()),
      on: vi.fn(() => vi.fn()),
    },
  };
}

describe("HeadlessSession", () => {
  it("preserves original setup and every cleanup failure through the runner diagnostic packet", async () => {
    const setup = Object.assign(
      new Error("Native owner requires its trusted loaded-image descriptor"),
      { code: "SchemaImageMissing" }
    );
    const disconnect = new Error("Headless disconnect failed");
    const reclaim = new Error("Isolated context reclaim failed");
    const methods: string[] = [];
    const rpcCall = vi.fn(async (_target: string, method: string) => {
      methods.push(method);
      if (method === "runtime.createContext") return { contextId: "original-context" };
      if (method === "runtime.createEntity") throw setup;
      if (method === "runtime.destroyContext") throw reclaim;
      throw new Error(`Unexpected RPC ${method}`);
    });
    const disconnectSpy = vi
      .spyOn(HeadlessSession.prototype, "disconnect")
      .mockRejectedValue(disconnect);
    try {
      const failure = await HeadlessSession.createWithAgent({
        config: createConfig(),
        rpcCall,
        source: "workers/agent-worker",
        className: "AiChatWorker",
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).cause).toBe(setup);
      expect((failure as AggregateError).errors).toEqual([setup, disconnect, reclaim]);
      expect(methods).toEqual([
        "runtime.createContext",
        "runtime.createEntity",
        "runtime.destroyContext",
      ]);
      const packet = systemTestFailure("setup", failure);
      expect(packet.error.cause).toMatchObject({
        message: setup.message,
        code: "SchemaImageMissing",
      });
      expect(packet.error.errors?.map((error) => error.message)).toEqual([
        setup.message,
        disconnect.message,
        reclaim.message,
      ]);
    } finally {
      disconnectSpy.mockRestore();
    }
  });

  it("rethrows the exact original setup failure after successful owned cleanup", async () => {
    const setup = new Error("Original setup failure");
    const rpcCall = vi.fn(async (_target: string, method: string) => {
      if (method === "runtime.createContext") return { contextId: "original-context" };
      if (method === "runtime.createEntity") throw setup;
      if (method === "runtime.destroyContext") return undefined;
      throw new Error(`Unexpected RPC ${method}`);
    });
    await expect(
      HeadlessSession.createWithAgent({
        config: createConfig(),
        rpcCall,
        source: "workers/agent-worker",
        className: "AiChatWorker",
      })
    ).rejects.toBe(setup);
    expect(rpcCall).toHaveBeenLastCalledWith("main", "runtime.destroyContext", [
      { contextId: "original-context", recursive: true },
    ]);
  });

  it("constructs without connecting", () => {
    const session = HeadlessSession.create({
      config: createConfig(),
    });

    expect(session.connected).toBe(false);
    expect(session.channelId).toBe(null);
    expect(session.messages).toEqual([]);
  });

  it("snapshot returns initial state for an unconnected session", () => {
    const session = HeadlessSession.create({
      config: createConfig(),
    });

    const snap = session.snapshot();
    expect(snap.connected).toBe(false);
    expect(snap.messages).toEqual([]);
    expect(snap.invocations).toEqual([]);
    expect(snap.cleanup).toMatchObject({ phase: "idle" });
    expect(snap.cleanupErrors).toEqual([]);
    expect(snap.participants).toEqual({});
  });

  it("projects agentic events delivered by the recovery-aware connection callback", () => {
    const session = HeadlessSession.create({ config: createConfig() });
    (session as any)._channelId = "headless-1";
    const actor = { kind: "agent", id: "agent-1" };
    const turnId = brandId<TurnId>("turn-1");
    const base = {
      type: AGENTIC_EVENT_PAYLOAD_KIND,
      senderId: "agent-1",
      senderMetadata: { name: "Agent", type: "agent", handle: "agent" },
      contentClass: "internal",
      externalKeys: [],
    };

    (session as any).handleEvent({
      ...base,
      pubsubId: 1,
      payload: {
        kind: "message.started",
        actor,
        turnId,
        causality: { messageId: "message-1" },
        payload: {
          protocol: AGENTIC_PROTOCOL_VERSION,
          role: "assistant",
          blocks: [],
        },
        createdAt: "2026-08-09T00:00:00.000Z",
      },
    });
    (session as any).handleEvent({
      ...base,
      pubsubId: 2,
      payload: {
        kind: "message.completed",
        actor,
        turnId,
        causality: { messageId: "message-1" },
        payload: {
          protocol: AGENTIC_PROTOCOL_VERSION,
          role: "assistant",
          blocks: [{ blockId: "message-1:block:0", type: "text", content: "ready" }],
          outcome: "completed",
        },
        createdAt: "2026-08-09T00:00:01.000Z",
      },
    });

    expect(session.messages).toEqual([
      expect.objectContaining({
        senderId: "agent-1",
        content: "ready",
        complete: true,
      }),
    ]);
  });

  it("records channel ui.feedback events and resolves waitUntil on their arrival", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    (session as any)._channelId = "headless-1";
    const abort = new AbortController();
    const arrived = session.waitUntil(
      () => session.uiFeedback.find((event) => event.payload.occurrenceKey === "k1"),
      { signal: abort.signal }
    );
    (session as any).handleEvent({
      type: AGENTIC_EVENT_PAYLOAD_KIND,
      senderId: "panel-1",
      senderMetadata: { name: "Chat", type: "panel" },
      contentClass: "internal",
      externalKeys: [],
      pubsubId: 7,
      payload: {
        kind: "ui.feedback",
        actor: { kind: "panel", id: "chat" },
        payload: {
          protocol: AGENTIC_PROTOCOL_VERSION,
          target: { kind: "agent", id: "agent-1", participantId: "agent-1" },
          category: "compile_failed",
          refs: { inlineUiId: "ui-1" },
          error: { message: "boom" },
          occurrenceKey: "k1",
        },
        createdAt: "2026-08-09T00:00:00.000Z",
      },
    });
    await expect(arrived).resolves.toMatchObject({
      pubsubId: 7,
      senderId: "panel-1",
      payload: { category: "compile_failed", refs: { inlineUiId: "ui-1" } },
    });
    expect(session.messages).toEqual([]);

    const never = session.waitUntil(() => undefined, { signal: abort.signal });
    abort.abort(new Error("stop"));
    await expect(never).rejects.toThrow("stop");
  });

  it("snapshot exposes transcript messages, invocation diagnostics, debug events, and participants", () => {
    const session = HeadlessSession.create({
      config: createConfig(),
    });
    const invocationMessage: ChatMessage = {
      id: "invocation:call-1",
      senderId: "agent-1",
      content: "",
      kind: "message",
      contentType: "invocation",
      complete: true,
      invocation: {
        id: "call-1",
        name: "read_file",
        arguments: { path: "README.md" },
        execution: {
          status: "complete",
          description: "",
          result: "contents",
          consoleOutput: "read README.md",
          isError: false,
        },
      },
    };
    const internals = session as unknown as {
      _chatMessages: Map<string, ChatMessage>;
      _chatMessageOrder: string[];
    };
    internals._chatMessages = new Map([[invocationMessage.id, invocationMessage]]);
    internals._chatMessageOrder = [invocationMessage.id];
    (session as any)._participants = {
      "agent-1": {
        id: "agent-1",
        metadata: { name: "Agent", type: "agent", handle: "agent" },
      },
    };
    (session as any)._debugEvents = [
      {
        debugType: "log",
        agentId: "agent-1",
        handle: "agent",
        level: "info",
        message: "started",
        ts: 1,
      },
    ];

    const snap = session.snapshot();
    expect(snap.messages).toEqual([invocationMessage]);
    expect(snap.invocations).toEqual([
      {
        id: "call-1",
        name: "read_file",
        status: "complete",
        args: { path: "README.md" },
        result: "contents",
        consoleOutput: "read README.md",
        error: undefined,
      },
    ]);
    expect(snap.participants).toEqual({
      "agent-1": {
        name: "Agent",
        type: "agent",
        handle: "agent",
        connected: true,
      },
    });
    expect(snap.debugEvents).toEqual([
      {
        debugType: "log",
        agentId: "agent-1",
        handle: "agent",
        level: "info",
        message: "started",
        ts: 1,
      },
    ]);
  });

  it("preserves a useful message from structured invocation errors", () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const invocationMessage: ChatMessage = {
      id: "invocation:call-error",
      senderId: "agent-1",
      content: "",
      kind: "message",
      contentType: "invocation",
      complete: true,
      invocation: {
        id: "call-error",
        name: "eval",
        arguments: { code: "throw new Error('boom')" },
        execution: {
          status: "error",
          description: "tool failed",
          result: {
            protocolContent: [{ type: "text", text: "[eval] Error: boom" }],
            details: { success: false, error: "boom" },
          },
          isError: true,
        },
      },
    };
    const internals = session as unknown as {
      _chatMessages: Map<string, ChatMessage>;
      _chatMessageOrder: string[];
    };
    internals._chatMessages = new Map([[invocationMessage.id, invocationMessage]]);
    internals._chatMessageOrder = [invocationMessage.id];

    expect(session.snapshot().invocations[0]?.error).toBe("boom");
  });

  it("has no consumer-owned set_title method", () => {
    const session = HeadlessSession.create({ config: createConfig() });
    expect((session as any).buildDefaultMethods()).toEqual({});
  });

  it("provides a deterministic one-rejection validation recovery seam", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const methods = (session as any).buildValidationRetryProbeMethods() as Record<
      string,
      { execute: (args: unknown) => Promise<unknown> }
    >;
    const probe = methods["validation_retry_probe"]!;

    await expect(probe.execute({ value: "first" })).rejects.toThrow(
      "Invalid arguments for tool validation_retry_probe"
    );
    await expect(probe.execute({ value: "corrected" })).resolves.toEqual({
      ok: true,
      recovered: true,
      value: "corrected",
    });
  });

  it("dispose is idempotent", async () => {
    const session = HeadlessSession.create({
      config: createConfig(),
    });

    await expect(session.dispose()).resolves.toBeUndefined();
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("awaits the agent pause terminal before interrupt returns", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    let settle!: (value: { result: unknown }) => void;
    const result = new Promise<{ result: unknown }>((resolve) => (settle = resolve));
    const callMethod = vi.fn(() => ({ result }));
    (session as any)._client = { callMethod };

    let completed = false;
    const interrupt = session
      .interrupt("agent-1", { timeoutMs: 10_000 })
      .then(() => (completed = true));
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(callMethod).toHaveBeenCalledWith("agent-1", "pause", {}, { timeoutMs: 10_000 });

    settle({ result: { paused: true } });
    await interrupt;
    expect(completed).toBe(true);
  });

  it("uses the direct agent lifecycle barrier when a headless RPC route is available", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const rpcCall = vi.fn(async () => ({ interrupted: true }));
    (session as any)._agentRpcCall = rpcCall;
    (session as any)._channelId = "ch-direct";
    (session as any)._client = { callMethod: vi.fn() };

    await session.interrupt("agent-direct");

    expect(rpcCall).toHaveBeenCalledWith("agent-direct", "interruptChannel", ["ch-direct"]);
    expect((session as any)._client.callMethod).not.toHaveBeenCalled();
  });

  it("propagates direct interruption cancellation options to the RPC boundary", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const rpcCall = vi.fn(async () => ({ interrupted: true }));
    const signal = new AbortController().signal;
    (session as any)._agentRpcCall = rpcCall;
    (session as any)._channelId = "ch-direct";

    await session.interrupt("agent-direct", { timeoutMs: 2_000, signal });

    expect(rpcCall).toHaveBeenCalledWith("agent-direct", "interruptChannel", ["ch-direct"], {
      timeoutMs: 2_000,
      signal,
    });
  });

  it("finishes shared-context unsubscribe before retiring the agent entity", async () => {
    const session = HeadlessSession.create({
      config: createConfig(),
    });
    const calls: Array<{ target: string; method: string; args: unknown[] }> = [];
    let finishUnsubscribe!: () => void;
    const unsubscribeFinished = new Promise<void>((resolve) => (finishUnsubscribe = resolve));
    (session as any)._agentEntityId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._agentTargetId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._channelId = "ch-1";
    (session as any)._agentRpcCall = vi.fn(
      async (target: string, method: string, args: unknown[]) => {
        calls.push({ target, method, args });
        if (method === "unsubscribeChannel") await unsubscribeFinished;
        return undefined;
      }
    );

    const phases: string[] = [];
    const close = session.close({
      onPhase: (state) => phases.push(state.phase),
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      target: "do:workers/agent-worker:AiChatWorker:obj-1",
      method: "unsubscribeChannel",
      args: ["ch-1"],
    });

    finishUnsubscribe();
    await close;

    expect(calls).toEqual([
      {
        target: "do:workers/agent-worker:AiChatWorker:obj-1",
        method: "unsubscribeChannel",
        args: ["ch-1"],
      },
      {
        target: "main",
        method: "runtime.retireEntity",
        args: [{ id: "do:workers/agent-worker:AiChatWorker:obj-1" }],
      },
    ]);
    expect(phases).toEqual([
      "unsubscribing-agent",
      "disconnecting-client",
      "retiring-agent",
      "complete",
    ]);
    expect(session.snapshot().cleanup).toMatchObject({
      phase: "complete",
      completedAt: expect.any(Number),
    });
  });

  it("shares one acknowledged remote teardown across concurrent close callers", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const rpcCall = vi.fn(async (_target: string, method: string) => {
      if (method === "unsubscribeChannel") await blocked;
      return undefined;
    });
    (session as any)._agentEntityId = "entity-1";
    (session as any)._agentTargetId = "agent-target";
    (session as any)._channelId = "ch-1";
    (session as any)._agentRpcCall = rpcCall;

    const first = session.close();
    const second = session.close();
    expect(first).toBe(second);
    release();
    await Promise.all([first, second]);

    expect(rpcCall.mock.calls.map((call) => call[1])).toEqual([
      "unsubscribeChannel",
      "runtime.retireEntity",
    ]);
  });

  it("unsubscribes before recursively destroying an isolated headless context", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const calls: Array<{ target: string; method: string; args: unknown[] }> = [];
    (session as any)._agentEntityId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._agentTargetId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._agentContextId = "ctx-isolated";
    (session as any)._ownsAgentContext = true;
    (session as any)._channelId = "ch-1";
    (session as any)._agentRpcCall = vi.fn(
      async (target: string, method: string, args: unknown[]) => {
        calls.push({ target, method, args });
        return undefined;
      }
    );

    await session.close();

    expect(calls).toEqual([
      {
        target: "do:workers/agent-worker:AiChatWorker:obj-1",
        method: "unsubscribeChannel",
        args: ["ch-1"],
      },
      {
        target: "main",
        method: "runtime.destroyContext",
        args: [{ contextId: "ctx-isolated", recursive: true }],
      },
    ]);
  });

  it("unsubscribes the agent before disconnecting the headless participant", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const order: string[] = [];
    (session as any)._agentEntityId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._agentTargetId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._channelId = "ch-1";
    (session as any)._agentRpcCall = vi.fn(async (_target: string, method: string) => {
      order.push(method);
      return undefined;
    });
    vi.spyOn(session, "disconnect").mockImplementation(async () => {
      order.push("disconnect");
    });

    await session.close();

    expect(order).toEqual(["unsubscribeChannel", "disconnect", "runtime.retireEntity"]);
  });

  it("closes effect admission before collecting terminal model evidence", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const order: string[] = [];
    (session as any)._agentEntityId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._agentTargetId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._channelId = "ch-1";
    (session as any)._client = {};
    (session as any)._agentRpcCall = vi.fn(async (_target: string, method: string) => {
      order.push(method);
      if (method === "getModelExecutionEvidence") return { totalCalls: 1 };
      return undefined;
    });
    vi.spyOn(session, "disconnect").mockResolvedValue();

    await session.close();

    expect(order).toEqual([
      "unsubscribeChannel",
      "getModelExecutionEvidence",
      "runtime.retireEntity",
    ]);
  });

  it("joins retirement evidence after admission closes and before disconnect or destruction", async () => {
    const order: string[] = [];
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const beforeRetirement = vi.fn(async (identity) => {
      expect(identity).toEqual({
        channelId: "ch-1",
        contextId: "ctx-1",
        agentTargetId: "target-1",
      });
      order.push("observe");
      entered();
      await held;
    });
    const session = HeadlessSession.create({ config: createConfig(), beforeRetirement });
    Object.assign(session, {
      _agentEntityId: "entity-1",
      _agentTargetId: "target-1",
      _agentContextId: "ctx-1",
      _ownsAgentContext: true,
      _channelId: "ch-1",
      _agentRpcCall: vi.fn(async (_target: string, method: string) => {
        order.push(method);
      }),
    });
    vi.spyOn(session, "disconnect").mockImplementation(async () => {
      order.push("disconnect");
    });
    const closing = session.close();
    await enteredPromise;
    expect(order).toEqual(["unsubscribeChannel", "observe"]);
    expect(session.close()).toBe(closing);
    release();
    await closing;
    expect(order).toEqual([
      "unsubscribeChannel",
      "observe",
      "disconnect",
      "runtime.destroyContext",
    ]);
    expect(beforeRetirement).toHaveBeenCalledTimes(1);
  });

  it.each(["sync", "async"])(
    "preserves %s retirement-observer failure and joins owned teardown",
    async (mode) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const failure = new Error("diagnostic source disconnected");
      const session = HeadlessSession.create({
        config: createConfig(),
        beforeRetirement: () => {
          if (mode === "sync") throw failure;
          return Promise.reject(failure);
        },
      });
      const calls: string[] = [];
      Object.assign(session, {
        _agentEntityId: "entity-1",
        _agentTargetId: "target-1",
        _agentContextId: "ctx-1",
        _ownsAgentContext: true,
        _channelId: "ch-1",
        _agentRpcCall: vi.fn(async (_target: string, method: string) => {
          calls.push(method);
        }),
      });
      const error = await session.close().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(failure);
      expect(calls).toEqual(["unsubscribeChannel", "runtime.destroyContext"]);
      expect(session.snapshot().cleanupErrors).toContainEqual(
        expect.objectContaining({
          phase: "captureRetirementEvidence",
          message: failure.message,
        })
      );
    }
  );

  it("reports isolated context cleanup failure without creating a second cleanup owner", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const session = HeadlessSession.create({ config: createConfig() });
    const calls: Array<{ target: string; method: string }> = [];
    (session as any)._agentEntityId = "entity-1";
    (session as any)._agentTargetId = "agent-target";
    (session as any)._agentContextId = "ctx-isolated";
    (session as any)._ownsAgentContext = true;
    (session as any)._channelId = "ch-1";
    (session as any)._agentRpcCall = vi.fn(async (target: string, method: string) => {
      calls.push({ target, method });
      if (method === "runtime.destroyContext") throw new Error("destroy failed");
      return undefined;
    });

    await expect(session.close()).rejects.toThrow(/Headless session cleanup failed in 1 phase/);

    expect(session.snapshot().cleanupErrors).toEqual([
      expect.objectContaining({
        phase: "destroyHeadlessAgentContext",
        message: "destroy failed",
      }),
    ]);
    expect(calls).toEqual([
      { target: "agent-target", method: "unsubscribeChannel" },
      { target: "main", method: "runtime.destroyContext" },
    ]);
    warn.mockRestore();
  });

  it("does not detach local session state from remote cleanup", async () => {
    const session = HeadlessSession.create({
      config: createConfig(),
    });
    const calls: Array<{ target: string; method: string; args: unknown[] }> = [];
    let releaseUnsubscribe: (() => void) | undefined;
    (session as any)._agentEntityId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._agentTargetId = "do:workers/agent-worker:AiChatWorker:obj-1";
    (session as any)._channelId = "ch-1";
    (session as any)._agentRpcCall = vi.fn(
      async (target: string, method: string, args: unknown[]) => {
        calls.push({ target, method, args });
        if (method === "unsubscribeChannel") {
          await new Promise<void>((resolve) => {
            releaseUnsubscribe = resolve;
          });
        }
        return undefined;
      }
    );

    let settled = false;
    const closing = session.close().then(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(calls).toEqual([
        {
          target: "do:workers/agent-worker:AiChatWorker:obj-1",
          method: "unsubscribeChannel",
          args: ["ch-1"],
        },
      ])
    );
    expect(settled).toBe(false);

    releaseUnsubscribe?.();
    await closing;

    expect(session.channelId).toBe(null);
    expect(calls).toEqual([
      {
        target: "do:workers/agent-worker:AiChatWorker:obj-1",
        method: "unsubscribeChannel",
        args: ["ch-1"],
      },
      {
        target: "main",
        method: "runtime.retireEntity",
        args: [{ id: "do:workers/agent-worker:AiChatWorker:obj-1" }],
      },
    ]);
  });

  it("waits for owned-context unsubscription before destroying the context", async () => {
    const session = HeadlessSession.create({ config: createConfig() });
    const calls: string[] = [];
    (session as any)._agentEntityId = "do:workers/agent-worker:AiChatWorker:obj-owned";
    (session as any)._agentTargetId = "do:workers/agent-worker:AiChatWorker:obj-owned";
    (session as any)._agentContextId = "ctx-owned";
    (session as any)._ownsAgentContext = true;
    (session as any)._channelId = "ch-owned";
    const rpcCall = vi.fn(async (_target: string, method: string, _args: unknown[]) => {
      calls.push(method);
      return undefined;
    });
    (session as any)._agentRpcCall = rpcCall;

    await expect(session.close()).resolves.toBeUndefined();

    expect(calls).toEqual(["unsubscribeChannel", "runtime.destroyContext"]);
    expect(rpcCall).toHaveBeenNthCalledWith(
      1,
      "do:workers/agent-worker:AiChatWorker:obj-owned",
      "unsubscribeChannel",
      ["ch-owned"],
      { timeoutMs: 30_000 }
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      2,
      "main",
      "runtime.destroyContext",
      [{ contextId: "ctx-owned", recursive: true }],
      { timeoutMs: 30_000 }
    );
    expect(session.snapshot().cleanupErrors).toEqual([]);
  });

  it("reports every cleanup error after attempting the full headless agent teardown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const session = HeadlessSession.create({
      config: createConfig(),
    });
    (session as any)._agentEntityId = "entity-1";
    (session as any)._agentTargetId = "agent-target";
    (session as any)._channelId = "ch-1";
    (session as any)._agentRpcCall = vi.fn(async (_target: string, method: string) => {
      if (method === "unsubscribeChannel") throw new Error("unsubscribe failed");
      if (method === "runtime.retireEntity") throw new Error("retire failed");
      return undefined;
    });

    const cleanupError = await session.close().catch((error: unknown) => error);
    expect(cleanupError).toBeInstanceOf(AggregateError);
    expect((cleanupError as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "unsubscribe failed" }),
      expect.objectContaining({ message: "retire failed" }),
    ]);

    expect(session.snapshot().cleanupErrors).toEqual([
      expect.objectContaining({
        phase: "unsubscribeHeadlessAgent",
        message: "unsubscribe failed",
      }),
      expect.objectContaining({
        phase: "retireHeadlessAgent",
        message: "retire failed",
      }),
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[HeadlessSession] unsubscribeHeadlessAgent failed:",
      expect.any(Error)
    );
    expect(warn).toHaveBeenCalledWith(
      "[HeadlessSession] retireHeadlessAgent failed:",
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it("connects the headless client methods before subscribing the agent", async () => {
    const order: string[] = [];
    const originalConnect = HeadlessSession.prototype.connect;
    const connect = vi
      .spyOn(HeadlessSession.prototype, "connect")
      .mockImplementation(async function (
        this: HeadlessSession,
        channelId: string,
        options?: Parameters<HeadlessSession["connect"]>[1]
      ) {
        order.push(
          `connect:${channelId}:${Object.keys(options?.methods ?? {})
            .sort()
            .join(",")}`
        );
        (this as unknown as { _channelId: string; _client: unknown })._channelId = channelId;
        (this as unknown as { _client: unknown })._client = { close: vi.fn() };
      });
    const rpcCall = vi.fn(async (target: string, method: string, args: unknown[]) => {
      order.push(`rpc:${target}:${method}`);
      if (target === "main" && method === "runtime.createEntity") {
        if (
          (args[0] as { execution?: { source?: string } }).execution?.source ===
          "workers/pubsub-channel"
        ) {
          return {
            id: "channel-entity",
            targetId: "channel-target",
            contextId: "ctx-1",
          };
        }
        return {
          id: "entity-1",
          targetId: "agent-target",
          contextId: "ctx-1",
        };
      }
      if (target === "agent-target" && method === "subscribeChannel") {
        return { ok: true, participantId: "do:agent" };
      }
      throw new Error(`unexpected RPC ${target}.${method}`);
    });

    let session: HeadlessSession | undefined;
    try {
      session = await HeadlessSession.createWithAgent({
        config: createConfig(),
        rpcCall,
        source: "workers/agent-worker",
        className: "AiChatWorker",
        objectKey: "agent-1",
        contextId: "ctx-1",
        channelId: "headless-1",
      });
    } finally {
      connect.mockRestore();
      HeadlessSession.prototype.connect = originalConnect;
    }

    expect(order).toEqual([
      "rpc:main:runtime.createEntity",
      "connect:headless-1:",
      "rpc:main:runtime.createEntity",
      "rpc:agent-target:subscribeChannel",
    ]);
    expect(session?.snapshot()).toMatchObject({
      channelId: "headless-1",
      agentEntityId: "entity-1",
      agentTargetId: "agent-target",
      agentContextId: "ctx-1",
      ownsAgentContext: false,
    });
  });

  it("can opt into synthetic panel UI methods that publish typed UI events", async () => {
    let registeredMethods: Record<string, MethodDefinition> = {};
    const publish = vi.fn(async () => 1);
    const originalConnect = HeadlessSession.prototype.connect;
    const connect = vi
      .spyOn(HeadlessSession.prototype, "connect")
      .mockImplementation(async function (
        this: HeadlessSession,
        channelId: string,
        options?: Parameters<HeadlessSession["connect"]>[1]
      ) {
        registeredMethods = options?.methods ?? {};
        (this as unknown as { _channelId: string; _client: unknown })._channelId = channelId;
        (this as unknown as { _client: unknown })._client = {
          clientId: "headless-panel",
          publish,
        };
      });
    const rpcCall = vi.fn(async (target: string, method: string) => {
      if (target === "main" && method === "runtime.createEntity") {
        return { id: "entity-1", targetId: "agent-target", contextId: "ctx-1" };
      }
      if (target === "agent-target" && method === "subscribeChannel") {
        return { ok: true, participantId: "do:agent" };
      }
      throw new Error(`unexpected RPC ${target}.${method}`);
    });

    try {
      await HeadlessSession.createWithAgent({
        config: createConfig(),
        rpcCall,
        source: "workers/agent-worker",
        className: "AiChatWorker",
        objectKey: "agent-1",
        contextId: "ctx-1",
        channelId: "headless-1",
        includeSyntheticPanelUiMethods: true,
      });

      expect(Object.keys(registeredMethods).sort()).toEqual(["inline_ui", "load_action_bar"]);
      const result = vi.fn((content, options) => ({ content, ...options }));
      const methodContext = { result, callerId: "do:requester" } as never;

      await expect(
        registeredMethods["inline_ui"]!.execute({}, methodContext)
      ).resolves.toMatchObject({
        content: { ok: false, error: "Missing code or path" },
        isError: true,
      });
      await expect(
        registeredMethods["load_action_bar"]!.execute({}, methodContext)
      ).resolves.toMatchObject({
        content: { ok: false, error: "Missing path" },
        isError: true,
      });
      expect(result).toHaveBeenCalledTimes(2);

      await registeredMethods["inline_ui"]!.execute(
        {
          id: "setup-overview",
          code: "export default function App() { return null; }",
        },
        methodContext
      );
      await registeredMethods["load_action_bar"]!.execute(
        {
          path: "skills/test/ActionBar.tsx",
        },
        methodContext
      );
      await registeredMethods["load_action_bar"]!.execute({ clear: true }, methodContext);
    } finally {
      connect.mockRestore();
      HeadlessSession.prototype.connect = originalConnect;
    }

    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls[0]).toEqual([
      AGENTIC_EVENT_PAYLOAD_KIND,
      expect.objectContaining({
        kind: "ui.inline_rendered",
        payload: expect.objectContaining({
          uiType: "inline",
          id: "setup-overview",
          requestedBy: expect.objectContaining({ kind: "agent", id: "do:requester" }),
          source: {
            type: "code",
            code: "export default function App() { return null; }",
          },
        }),
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("synthetic-ui:inline:setup-overview:"),
      }),
    ]);
    expect(publish.mock.calls[1]).toEqual([
      AGENTIC_EVENT_PAYLOAD_KIND,
      expect.objectContaining({
        kind: "ui.action_bar.updated",
        payload: expect.objectContaining({
          uiType: "action_bar",
          source: { type: "file", path: "skills/test/ActionBar.tsx" },
        }),
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("synthetic-ui:action-bar:"),
      }),
    ]);
    expect(publish.mock.calls[2]).toEqual([
      AGENTIC_EVENT_PAYLOAD_KIND,
      expect.objectContaining({
        kind: "ui.action_bar.updated",
        payload: expect.objectContaining({
          uiType: "action_bar",
          requestedBy: expect.objectContaining({ kind: "agent", id: "do:requester" }),
          cleared: true,
          result: { ok: true },
        }),
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("synthetic-ui:action-bar:clear:"),
      }),
    ]);
  });

  it("creates an explicit isolated context before connecting or launching an agent", async () => {
    const originalConnect = HeadlessSession.prototype.connect;
    const order: string[] = [];
    const connect = vi
      .spyOn(HeadlessSession.prototype, "connect")
      .mockImplementation(async function (
        this: HeadlessSession,
        channelId: string,
        options?: { contextId?: string; methods?: Record<string, unknown> }
      ) {
        order.push(`connect:${channelId}:${options?.contextId ?? "missing"}`);
        (this as unknown as { _channelId: string; _client: unknown })._channelId = channelId;
        (this as unknown as { _client: unknown })._client = { close: vi.fn() };
      });
    const rpcCall = vi.fn(async (target: string, method: string, args: unknown[]) => {
      order.push(`rpc:${target}:${method}`);
      if (target === "main" && method === "runtime.createContext") {
        return { contextId: "ctx-isolated" };
      }
      if (target === "main" && method === "runtime.createEntity") {
        expect(args[0]).toHaveProperty("contextId", "ctx-isolated");
        if (
          (args[0] as { execution?: { source?: string } }).execution?.source ===
          "workers/pubsub-channel"
        ) {
          expect(args[0]).toMatchObject({
            kind: "do",
            execution: {
              surface: "code",
              source: "workers/pubsub-channel",
            },
            className: "PubSubChannel",
            key: "headless-1",
          });
          return {
            id: "channel-entity",
            targetId: "channel-target",
            contextId: "ctx-isolated",
          };
        }
        return {
          id: "entity-1",
          targetId: "agent-target",
          contextId: "ctx-isolated",
        };
      }
      if (target === "agent-target" && method === "subscribeChannel") {
        expect(args[0]).toMatchObject({
          channelId: "headless-1",
          contextId: "ctx-isolated",
        });
        return { ok: true, participantId: "do:agent" };
      }
      throw new Error(`unexpected RPC ${target}.${method}`);
    });

    let session: HeadlessSession | undefined;
    try {
      session = await HeadlessSession.createWithAgent({
        config: createConfig(),
        rpcCall,
        source: "workers/agent-worker",
        className: "AiChatWorker",
        objectKey: "agent-1",
        channelId: "headless-1",
      });
    } finally {
      connect.mockRestore();
      HeadlessSession.prototype.connect = originalConnect;
    }

    expect(order).toEqual([
      "rpc:main:runtime.createContext",
      "rpc:main:runtime.createEntity",
      "connect:headless-1:ctx-isolated",
      "rpc:main:runtime.createEntity",
      "rpc:agent-target:subscribeChannel",
    ]);
    expect(session?.snapshot()).toMatchObject({
      agentContextId: "ctx-isolated",
      ownsAgentContext: true,
    });
  });

  it("callMethod returns the provider payload and callMethodResult returns the full envelope", async () => {
    const session = HeadlessSession.create({
      config: createConfig(),
    });
    const envelope = {
      content: { ok: true },
      contentType: "application/json",
    };
    (session as any)._client = {
      callMethod: vi.fn(() => ({ result: Promise.resolve(envelope) })),
    };

    await expect(session.callMethod("agent-1", "work", {})).resolves.toEqual({
      ok: true,
    });
    await expect(session.callMethodResult("agent-1", "work", {})).resolves.toEqual(envelope);
  });

  function nativeFixture() {
    const session = HeadlessSession.create({ config: createConfig() });
    const internal = session as any;
    internal._channelId = "ch-1";
    internal._agentEntityId = "agent-1";
    internal._agentTargetId = "agent-target";
    const message = {
      id: "native:3:11:0",
      senderId: "agent-1",
      content: "done",
      kind: "message",
      complete: true,
      native: { conversationId: 3, taskId: 7, entryId: 11 },
    } satisfies ChatMessage;
    const result = {
      channelId: "ch-1",
      conversationId: 3,
      taskId: 7,
      inputs: [{ status: "done" }],
      answers: [
        {
          conversationId: 3,
          entryId: 11,
          taskId: 7,
          messages: [
            {
              messageId: message.id,
              text: "done",
              outcome: "completed",
              published: true,
            },
          ],
        },
      ],
    };
    const show = (value: ChatMessage) => {
      internal._chatMessages.set(value.id, value);
      if (!internal._chatMessageOrder.includes(value.id)) internal._chatMessageOrder.push(value.id);
      internal.notifyListeners();
    };
    const source = (runtimeId = "agent-1", taskId = 7) => ({
      invocationId: `source:${runtimeId}:${taskId}`,
      actor: { kind: "agent", id: runtimeId },
      status: "running",
      outputs: [],
      progress: [],
      nativeSource: {
        owner: {
          runtimeId,
          channelId: "ch-1",
          authoritySessionId: "authority-session",
          contextId: "context",
          incarnation: "incarnation",
          source: "workers/test-agent",
          effectiveVersion: "version",
          className: "TestAgent",
          objectKey: runtimeId,
          executionDigest: "a".repeat(64),
        },
        task: { taskId, conversationId: 3, kind: "pi.generation", version: 1 },
        operation: {
          kind: "model" as const,
          purpose: "generation" as const,
          attempt: 0,
          cutoff: 11,
          requestDigest: "b".repeat(64),
        },
      },
    });
    return { session, internal, message, result, show, source };
  }

  function invocationMessage(
    id: string,
    status: "pending" | "complete" | "cancelled"
  ): ChatMessage {
    return {
      id,
      kind: "message",
      senderId: "agent-1",
      complete: status !== "pending",
      content: "",
      contentType: "invocation",
      invocation: {
        id,
        name: "model.generation",
        arguments: {},
        execution: { status, isError: false, description: "Native model call" },
      },
    };
  }

  it("joins the exact retained terminal card without accepting another invocation", async () => {
    const f = nativeFixture();
    f.show(invocationMessage("invocation:owned", "pending"));
    let done = false;
    const waiting = f.session.waitForInvocation("invocation:owned").then((message) => {
      done = true;
      return message;
    });
    f.show(invocationMessage("invocation:other", "complete"));
    await Promise.resolve();
    expect(done).toBe(false);
    const terminal = invocationMessage("invocation:owned", "cancelled");
    f.show(terminal);
    await expect(waiting).resolves.toBe(terminal);
    expect(f.internal._messageListeners.size).toBe(0);
    expect(f.internal._nativeObservations.size).toBe(0);
    await expect(f.session.waitForInvocation("invocation:unknown")).rejects.toThrow(
      "retained identity"
    );
  });

  it("explicit disconnect cancels and joins pending terminal-card observation", async () => {
    const f = nativeFixture();
    f.show(invocationMessage("invocation:owned", "pending"));
    const waiting = f.session
      .waitForInvocation("invocation:owned")
      .catch((error: unknown) => error);
    await f.session.disconnect();
    expect(await waiting).toEqual(new Error("Headless session disconnected"));
    expect(f.internal._messageListeners.size).toBe(0);
    expect(f.internal._nativeObservations.size).toBe(0);
  });

  it("close cancels and joins the native RPC observation before remote retirement", async () => {
    const f = nativeFixture();
    let released = false;
    f.session.send = vi.fn(async () => "original-input");
    f.internal._agentRpcCall = vi.fn(
      async (
        _target: string,
        method: string,
        _args: unknown[],
        options?: { signal?: AbortSignal }
      ) => {
        if (method !== "waitForNativeRun") {
          expect(released).toBe(true);
          return undefined;
        }
        return new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () =>
              queueMicrotask(() => {
                released = true;
                reject(options!.signal!.reason);
              }),
            { once: true }
          );
        });
      }
    );
    const waiting = f.session.sendAndWait("hello").catch((error: unknown) => error);
    await vi.waitFor(() => expect(f.internal._agentRpcCall).toHaveBeenCalled());
    await f.session.close();
    expect(await waiting).toEqual(new Error("Headless session closed"));
    expect(released).toBe(true);
    expect(f.internal._messageListeners.size).toBe(0);
    expect(f.internal._nativeObservations.size).toBe(0);
  });

  it("retains canonical card attribution after the channel view is retired", () => {
    const f = nativeFixture();
    const source = f.source();
    f.internal._channelView.invocations[source.invocationId] = source;
    f.show({
      id: source.invocationId,
      senderId: "agent-1",
      kind: "message",
      complete: false,
      content: "",
      contentType: "invocation",
      invocation: {
        id: source.invocationId,
        name: "model_call",
        nativeSource: source.nativeSource,
        originatingInput: null,
        arguments: {},
        execution: {
          status: "running",
          isError: false,
          description: "Native model call",
        },
      },
    });
    const capturedMessages = [...f.session.messages];
    delete f.internal._channelView.invocations[source.invocationId];
    expect(capturedMessages[0]?.invocation?.nativeSource).toEqual(source.nativeSource);
    expect(f.session.snapshot().invocations[0]?.nativeSource).toEqual(source.nativeSource);
  });

  it("does not recover native attribution from a legacy nested request", () => {
    const f = nativeFixture();
    const { nativeSource, ...view } = f.source();
    f.internal._channelView.invocations.legacy = {
      ...view,
      request: { nativeSource },
    };
    expect(f.internal.latestNativeModelTask(new Set())).toBeUndefined();
  });

  it("sendAndWait observes the exact published input even when its accepted answer arrives during send", async () => {
    const f = nativeFixture();
    f.session.send = vi.fn(async () => {
      f.show(f.message);
      return "original-input";
    });
    f.internal._agentRpcCall = vi.fn(async () => f.result);
    await expect(f.session.sendAndWait("hello")).resolves.toBe(f.message);
    expect(f.internal._agentRpcCall).toHaveBeenCalledWith(
      "agent-target",
      "waitForNativeRun",
      [{ channelId: "ch-1", inputMessageId: "original-input" }],
      { signal: expect.any(AbortSignal) }
    );
  });
  it("observes the same admitted input after an explicit activation replacement without sending it again", async () => {
    const f = nativeFixture();
    f.session.send = vi.fn(() => {
      throw new Error("Already-admitted input must not be sent again");
    });
    f.show(f.message);
    f.internal._agentRpcCall = vi.fn(async () => f.result);
    await expect(f.session.waitForInput("original-input")).resolves.toBe(f.message);
    expect(f.session.send).not.toHaveBeenCalled();
    expect(f.internal._agentRpcCall).toHaveBeenCalledWith(
      "agent-target",
      "waitForNativeRun",
      [{ channelId: "ch-1", inputMessageId: "original-input" }],
      { signal: expect.any(AbortSignal) }
    );
  });
  it("waitForIdle joins real original input settlement despite provider task completion and visible text", async () => {
    const f = nativeFixture();
    let settle!: (value: typeof f.result) => void;
    f.internal._channelView.invocations.parent = f.source();
    f.internal._agentRpcCall = vi.fn(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );
    let done = false;
    const wait = f.session.waitForIdle().then((value) => {
      done = true;
      return value;
    });
    await Promise.resolve();
    f.show(f.message);
    await Promise.resolve();
    expect(done).toBe(false);
    settle(f.result);
    await expect(wait).resolves.toBe(f.message);
  });
  it("filters background child source coordinates even when native task IDs collide", async () => {
    const f = nativeFixture();
    f.internal._channelView.invocations.parent = f.source();
    f.internal._channelView.invocations.child = {
      ...f.source("child-agent", 7),
      startedAt: "2099-01-01T00:00:00Z",
    };
    f.internal._agentRpcCall = vi.fn(async () => f.result);
    f.show(f.message);
    await expect(f.session.waitForIdle()).resolves.toBe(f.message);
    expect(f.internal._agentRpcCall.mock.calls[0][2]).toEqual([{ channelId: "ch-1", taskId: 7 }]);
  });
  it("retains an actual blocked input until explicit observation cancellation and joins its RPC observer", async () => {
    const f = nativeFixture();
    const controller = new AbortController();
    const original = new Error("test explicitly cancelled observation");
    let joined = false;
    f.session.send = vi.fn(async () => "input");
    f.internal._agentRpcCall = vi.fn(async (_target, _method, _args, { signal }) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true })
      );
      joined = true;
      throw signal.reason;
    });
    const wait = f.session.sendAndWait("hello", { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(original);
    await expect(wait).rejects.toBe(original);
    expect(joined).toBe(true);
    expect(f.internal._messageListeners.size).toBe(0);
  });
  it("propagates the original authenticated settlement or publication failure", async () => {
    const f = nativeFixture();
    const original = new Error("canonical answer publication failed");
    f.session.send = vi.fn(async () => "input");
    f.internal._agentRpcCall = vi.fn(async () => {
      throw original;
    });
    await expect(f.session.sendAndWait("hello")).rejects.toBe(original);
    expect(f.internal._messageListeners.size).toBe(0);
  });
  it("does not confuse a failed provider attempt with terminal input failure before actual fallback settles", async () => {
    const f = nativeFixture();
    let settle!: (value: typeof f.result) => void;
    f.session.send = vi.fn(async () => "input");
    f.internal._agentRpcCall = vi.fn(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );
    const wait = f.session.sendAndWait("hello");
    await Promise.resolve();
    await Promise.resolve();
    f.show({
      id: "failure",
      senderId: "agent-1",
      kind: "system",
      complete: true,
      content: "primary failed",
      error: "primary failed",
    });
    f.show(f.message);
    settle(f.result);
    await expect(wait).resolves.toBe(f.message);
  });
  it("reports actual empty settled answers without awaiting a nonexistent chat row", async () => {
    const f = nativeFixture();
    f.session.send = vi.fn(async () => "input");
    f.internal._agentRpcCall = vi.fn(async () => ({
      ...f.result,
      answers: [
        {
          ...f.result.answers[0],
          messages: [
            {
              messageId: f.message.id,
              text: "",
              outcome: "empty",
              published: true,
            },
          ],
        },
      ],
    }));
    await expect(f.session.sendAndWait("hello")).rejects.toThrow(
      "settled without a visible answer"
    );
    expect(f.internal._messageListeners.size).toBe(0);
  });
  it("rejects actual unanswered input and foreign canonical settlement coordinates", async () => {
    const f = nativeFixture();
    f.session.send = vi.fn(async () => "input");
    f.internal._agentRpcCall = vi.fn(async () => ({
      ...f.result,
      inputs: [
        {
          status: "unanswered",
          reason: "cancelled",
          detail: "target destroyed",
        },
      ],
    }));
    await expect(f.session.sendAndWait("hello")).rejects.toThrow("target destroyed");
    f.internal._agentRpcCall = vi.fn(async () => ({
      ...f.result,
      channelId: "foreign",
    }));
    await expect(f.session.sendAndWait("hello")).rejects.toThrow("another source run");
  });
  it("observes an in-place streaming completion and ignores recoverable failure diagnostics", async () => {
    const f = nativeFixture();
    f.show({ ...f.message, complete: false });
    const wait = f.session.waitForAgentMessage();
    f.show({
      id: "diagnostic",
      senderId: "agent-1",
      kind: "system",
      complete: true,
      content: "attempt failed",
      error: "attempt failed",
    });
    f.show(f.message);
    await expect(wait).resolves.toBe(f.message);
  });
});
