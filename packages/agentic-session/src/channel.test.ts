/**
 * Regression tests for the unified headless subscription contract.
 *
 * The point of these tests is to lock in the *unified* state: a headless
 * subscription must NOT carry a tool restriction or any other lockdown shape
 * that would diverge from the panel-hosted path. Prompt overrides are
 * optional pass-through values; the helper should not invent one by default.
 */

import { describe, it, expect, vi } from "vitest";
import { schemaRpcMock } from "@vibestudio/rpc/test-utils";
import type { RpcCaller } from "@vibestudio/rpc";
import {
  MODEL_SETTINGS_TARGET,
  workspaceAgentConfigRpcFixture,
} from "./agent-launch-rpc.test-fixture.js";
import {
  createHeadlessAgentContext,
  destroyHeadlessAgentContext,
  getRecommendedChannelConfig,
  retireHeadlessAgent,
  subscribeHeadlessAgent,
  unsubscribeHeadlessAgent,
} from "./channel.js";

function publicRpcCall(wire: (target: string, method: string, args: unknown[]) => Promise<unknown>): RpcCaller["call"] {
  return schemaRpcMock({ call: wire }).call;
}

function makeRpcCall(captured: {
  config?: Record<string, unknown>;
  createSpec?: Record<string, unknown>;
}): RpcCaller["call"] {
  return publicRpcCall(vi.fn(async (target: string, method: string, args: unknown[]) => {
    const settings = workspaceAgentConfigRpcFixture(target, method, args);
    if (settings.handled) return settings.value;
    if (target === "main" && method === "runtime.createEntity") {
      captured.createSpec = args[0] as Record<string, unknown>;
      captured.config = (
        captured.createSpec["agentInitialization"] as {
          config?: Record<string, unknown>;
        }
      ).config;
      return {
        id: "do:workers/agent-worker:AiChatWorker:obj-1",
        kind: "do",
        source: { repoPath: "workers/agent-worker", effectiveVersion: "test-version" },
        buildKey: "a".repeat(64),
        targetId: "do:workers/agent-worker:AiChatWorker:obj-1",
        contextId: (captured.createSpec?.["contextId"] as string | undefined) ?? "ctx-minted",
        agentInitialization: { ok: true, participantId: "agent-1" },
      };
    }
    throw new Error(`Unexpected RPC call ${target}.${method}`);
  }));
}

describe("subscribeHeadlessAgent — unified contract", () => {
  it("does not pass a toolAllowlist (lockdown regression guard)", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    await subscribeHeadlessAgent({
      rpcCall: makeRpcCall(captured),
      source: "workers/agent-worker",
      className: "AiChatWorker",
      objectKey: "obj-1",
      channelId: "ch-1",
      contextId: "ctx-1",
    });

    expect(captured.config).toBeDefined();
    expect(captured.config!["toolAllowlist"]).toBeUndefined();
  });

  it("resolves workspace settings before creating and initializing the headless DO", async () => {
    const captured: { createSpec?: Record<string, unknown> } = {};
    const rpcCall = makeRpcCall(captured);

    const result = await subscribeHeadlessAgent({
      rpcCall,
      source: "workers/agent-worker",
      className: "AiChatWorker",
      objectKey: "obj-1",
      channelId: "ch-1",
      contextId: "ctx-1",
    });

    expect(captured.createSpec).toEqual({
      kind: "do",
      execution: {
        surface: "code",
        source: "workers/agent-worker",
      },
      className: "AiChatWorker",
      key: "obj-1",
      contextId: "ctx-1",
      // Per-agent config is seeded from creation stateArgs.
      stateArgs: { agentConfig: { approvalLevel: 2 } },
      agentInitialization: {
        channelId: "ch-1",
        config: {},
        replay: undefined,
      },
    });
    expect(vi.mocked(rpcCall).mock.calls.map(([target, method]) => [target, method])).toEqual([
      ["main", "workers.resolveService"],
      [MODEL_SETTINGS_TARGET, "getSettings"],
      ["main", "runtime.createEntity"],
    ]);
    expect(result.entityId).toBe("do:workers/agent-worker:AiChatWorker:obj-1");
    expect(result.targetId).toBe("do:workers/agent-worker:AiChatWorker:obj-1");
    expect(result.contextId).toBe("ctx-1");
  });

  it("allocates isolated headless contexts through the explicit context API", async () => {
    const rpcCall = publicRpcCall(vi.fn(async () => ({ contextId: "ctx-isolated" })));

    await expect(createHeadlessAgentContext({ rpcCall })).resolves.toBe("ctx-isolated");
    expect(vi.mocked(rpcCall)).toHaveBeenCalledWith("main", "runtime.createContext", [{}], undefined);
  });

  it("propagates initialization failure from runtime.createEntity without a second cleanup path", async () => {
    const calls: Array<{ target: string; method: string; args: unknown[] }> = [];
    const rpcCall = publicRpcCall(vi.fn(async (target: string, method: string, args: unknown[]) => {
      calls.push({ target, method, args });
      const settings = workspaceAgentConfigRpcFixture(target, method, args);
      if (settings.handled) return settings.value;
      if (method === "runtime.createEntity") {
        throw new Error("agent initialization failed");
      }
      throw new Error(`Unexpected RPC call ${target}.${method}`);
    }));

    await expect(
      subscribeHeadlessAgent({
        rpcCall,
        source: "workers/agent-worker",
        className: "AiChatWorker",
        objectKey: "obj-1",
        channelId: "ch-1",
        contextId: "ctx-1",
      })
    ).rejects.toThrow("agent initialization failed");

    expect(calls.map(({ target, method }) => [target, method])).toEqual([
      ["main", "workers.resolveService"],
      [MODEL_SETTINGS_TARGET, "getSettings"],
      ["main", "runtime.createEntity"],
    ]);
  });

  it("rejects malformed explicit context allocation results", async () => {
    const rpcCall = publicRpcCall(vi.fn(async () => ({})));

    await expect(createHeadlessAgentContext({ rpcCall })).rejects.toThrow(
      'Service "runtime" method "createContext" return value failed schema validation'
    );
  });

  it("does not pass a systemPrompt by default", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    await subscribeHeadlessAgent({
      rpcCall: makeRpcCall(captured),
      source: "workers/agent-worker",
      className: "AiChatWorker",
      objectKey: "obj-1",
      channelId: "ch-1",
      contextId: "ctx-1",
    });

    expect(captured.config!["systemPrompt"]).toBeUndefined();
    expect(captured.config!["systemPromptMode"]).toBeUndefined();
  });

  it("seeds full-auto approval into the agent's creation config (per-agent), not the subscription", async () => {
    const captured: { config?: Record<string, unknown>; createSpec?: Record<string, unknown> } = {};
    await subscribeHeadlessAgent({
      rpcCall: makeRpcCall(captured),
      source: "workers/agent-worker",
      className: "AiChatWorker",
      objectKey: "obj-1",
      channelId: "ch-1",
      contextId: "ctx-1",
    });

    const agentConfig = (
      captured.createSpec!["stateArgs"] as { agentConfig: Record<string, unknown> }
    ).agentConfig;
    expect(agentConfig["approvalLevel"]).toBe(2);
    // Settings no longer ride the (membership-only) subscription.
    expect(captured.config!["approvalLevel"]).toBeUndefined();
  });

  it("seeds extraConfig settings into the creation config, not the subscription, and no toolAllowlist", async () => {
    const captured: { config?: Record<string, unknown>; createSpec?: Record<string, unknown> } = {};
    await subscribeHeadlessAgent({
      rpcCall: makeRpcCall(captured),
      source: "workers/agent-worker",
      className: "AiChatWorker",
      objectKey: "obj-1",
      channelId: "ch-1",
      contextId: "ctx-1",
      extraConfig: { model: "anthropic:claude-opus-4-5", thinkingLevel: "high" },
    });

    const agentConfig = (
      captured.createSpec!["stateArgs"] as { agentConfig: Record<string, unknown> }
    ).agentConfig;
    expect(agentConfig["model"]).toBe("anthropic:claude-opus-4-5");
    expect(agentConfig["thinkingLevel"]).toBe("high");
    expect(captured.config!["model"]).toBeUndefined();
    expect(captured.config!["toolAllowlist"]).toBeUndefined();
    expect(agentConfig["toolAllowlist"]).toBeUndefined();
  });

  it("forwards prompt pass-through values when explicitly provided", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    await subscribeHeadlessAgent({
      rpcCall: makeRpcCall(captured),
      source: "workers/agent-worker",
      className: "AiChatWorker",
      objectKey: "obj-1",
      channelId: "ch-1",
      contextId: "ctx-1",
      extraConfig: {
        systemPrompt: "Headless prompt",
        systemPromptMode: "replace-vibestudio",
      },
    });

    expect(captured.config!["systemPrompt"]).toBe("Headless prompt");
    expect(captured.config!["systemPromptMode"]).toBe("replace-vibestudio");
  });

  it("preserves worker-specific extras on the subscription while stripping settings", async () => {
    const captured: { config?: Record<string, unknown> } = {};
    await subscribeHeadlessAgent({
      rpcCall: makeRpcCall(captured),
      source: "workers/test-agent",
      className: "TestAgentWorker",
      objectKey: "obj-1",
      channelId: "ch-1",
      contextId: "ctx-1",
      extraConfig: {
        model: "anthropic:claude-opus-4-5", // a setting — stripped
        deterministicResponse: true, // worker extras — survive
        responseText: "hi",
      },
    });

    expect(captured.config!["deterministicResponse"]).toBe(true);
    expect(captured.config!["responseText"]).toBe("hi");
    expect(captured.config!["model"]).toBeUndefined();
    expect(captured.config!["approvalLevel"]).toBeUndefined();
  });
});

describe("getRecommendedChannelConfig", () => {
  it("returns full-auto approval and nothing else", () => {
    const config = getRecommendedChannelConfig();
    expect(config).toEqual({ approvalLevel: 2 });
  });
});

describe("retireHeadlessAgent", () => {
  it("retires the registered runtime entity", async () => {
    const rpcCall = publicRpcCall(vi.fn(async () => undefined));

    await retireHeadlessAgent({ rpcCall, entityId: "do:workers/agent-worker:AiChatWorker:obj-1" });

    expect(vi.mocked(rpcCall)).toHaveBeenCalledWith("main", "runtime.retireEntity", [
      { id: "do:workers/agent-worker:AiChatWorker:obj-1" },
    ], undefined);
  });
});

describe("destroyHeadlessAgentContext", () => {
  it("recursively destroys the complete isolated lifecycle tree", async () => {
    const rpcCall = publicRpcCall(vi.fn(async () => undefined));

    await destroyHeadlessAgentContext({ rpcCall, contextId: "ctx-headless" });

    expect(vi.mocked(rpcCall)).toHaveBeenCalledWith("main", "runtime.destroyContext", [
      { contextId: "ctx-headless", recursive: true },
    ], undefined);
  });
});

describe("unsubscribeHeadlessAgent", () => {
  it("asks the registered agent DO to leave the channel before retirement", async () => {
    const rpcCall = publicRpcCall(vi.fn(async () => undefined));

    await unsubscribeHeadlessAgent({
      rpcCall,
      targetId: "do:workers/agent-worker:AiChatWorker:obj-1",
      channelId: "ch-1",
    });

    expect(rpcCall).toHaveBeenCalledWith(
      "do:workers/agent-worker:AiChatWorker:obj-1",
      "unsubscribeChannel",
      ["ch-1"],
      undefined,
    );
  });
});
