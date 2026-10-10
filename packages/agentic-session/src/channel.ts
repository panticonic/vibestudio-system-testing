/**
 * Headless channel helpers — create channels and subscribe DOs with headless defaults.
 *
 * "Headless" here means "no chat panel attached" — the same agent worker, prompt,
 * and tool surface as the panel-hosted path. The only thing this layer adds is
 * full-auto approval (since there's no user to approve tool calls interactively).
 * UI-only tools (inline_ui, feedback_form, etc.) are filtered out naturally
 * because no panel is connected to advertise them.
 */

import type { AgentSubscriptionConfig, AgentLaunchRpc } from "@workspace/agentic-core";
import { launchAgentIntoChannel, retireAgentEntity } from "@workspace/agentic-core";
import type { ChannelConfig } from "@workspace/pubsub";
import type { AgentExecutionTestPolicySpec } from "@vibestudio/shared/authority/testPolicy";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { agentRpcMethods } from "@workspace/agentic-do/rpc-contract";

const CHANNEL_SOURCE = "workers/pubsub-channel";
const CHANNEL_CLASS = "PubSubChannel";

/** Recommended channel config for headless sessions: full-auto approval (level 2). */
export function getRecommendedChannelConfig(): Partial<ChannelConfig> {
  return {
    approvalLevel: 2,  // Full Auto
  };
}

export interface SubscribeHeadlessAgentOptions {
  /** RPC call function for reaching the platform */
  rpcCall: AgentLaunchRpc["call"];
  /** Worker source (e.g., "workers/agent-worker") */
  source: string;
  /** DO class name (e.g., "AiChatWorker") */
  className: string;
  /** DO object key (unique per instance) */
  objectKey: string;
  /** Channel ID to subscribe to */
  channelId: string;
  /** Explicit context owned by the caller for the spawned agent. */
  contextId: string;
  /**
   * Pi-native pass-through config. Common keys are `model`,
   * `thinkingLevel`, `approvalLevel`, `systemPrompt`, and
   * `systemPromptMode`.
   */
  extraConfig?: AgentSubscriptionConfig;
}

export interface HeadlessAgentSubscription {
  ok: boolean;
  participantId?: string;
  entityId: string;
  targetId: string;
  contextId: string;
}

/**
 * Subscribe a DO agent to a channel with headless defaults.
 *
 * Sets full-auto approval on the channel and forwards any extra subscription
 * config to the worker. The worker uses the same harness config and system
 * prompt as it does for panel-hosted sessions; only the runtime environment
 * differs (no panel → no UI tools advertised → naturally absent from discovery).
 */
export async function subscribeHeadlessAgent(
  opts: SubscribeHeadlessAgentOptions,
): Promise<HeadlessAgentSubscription> {
  const channelConfig = getRecommendedChannelConfig();

  const subscriptionConfig: AgentSubscriptionConfig = {
    ...channelConfig,
    ...opts.extraConfig,
  };

  const { handle, subscription, contextId } = await launchAgentIntoChannel(
    { call: opts.rpcCall },
    {
      source: opts.source,
      className: opts.className,
      key: opts.objectKey,
      channelId: opts.channelId,
      contextId: opts.contextId,
      config: subscriptionConfig,
      missingContextErrorMessage:
        "runtime.createEntity did not return a contextId for headless agent subscription",
    },
  );
  return {
    ...subscription,
    entityId: handle.id ?? handle.targetId,
    targetId: handle.targetId,
    contextId,
  };
}

/**
 * Allocate the lifecycle boundary for an isolated headless session.
 *
 * Runtime entity creation inherits the verified caller context when no
 * context is supplied. Isolation is therefore an explicit context operation,
 * not an overloaded meaning of an omitted createEntity field.
 */
export async function createHeadlessAgentContext(opts: {
  rpcCall: AgentLaunchRpc["call"];
  testPolicy?: AgentExecutionTestPolicySpec;
}): Promise<string> {
  const value = await opts.rpcCall("main", mainRpcMethods["runtime.createContext"], [
    opts.testPolicy ? { testPolicy: opts.testPolicy } : {},
  ]);
  const contextId = value.contextId;
  if (!contextId) {
    throw new Error("runtime.createContext did not return a contextId for headless isolation");
  }
  return contextId;
}

/**
 * Bind the channel's runtime lifecycle to the same context as its agent.
 *
 * Service discovery only resolves an address; it cannot infer ownership from
 * later subscribe metadata. Creating the concrete channel entity first makes
 * context teardown retire both sides of an isolated conversation.
 */
export async function createHeadlessChannel(opts: {
  rpcCall: AgentLaunchRpc["call"];
  channelId: string;
  contextId: string;
}): Promise<{ id: string; targetId: string; contextId: string }> {
  const value = await opts.rpcCall("main", mainRpcMethods["runtime.createEntity"], [
    {
      kind: "do",
      execution: {
        surface: "code",
        source: CHANNEL_SOURCE,
      },
      className: CHANNEL_CLASS,
      key: opts.channelId,
      contextId: opts.contextId,
    },
  ]);
  const handle = value;
  if (handle.contextId !== opts.contextId) {
    throw new Error(
      `Headless channel ${opts.channelId} was not activated in context ${opts.contextId}`
    );
  }
  return {
    id: handle.id,
    targetId: handle.targetId,
    contextId: opts.contextId,
  };
}

export async function retireHeadlessAgent(opts: {
  rpcCall: AgentLaunchRpc["call"];
  entityId: string;
}): Promise<void> {
  await retireAgentEntity({ call: opts.rpcCall }, opts.entityId);
}

/**
 * Release an isolated headless launch as one lifecycle unit.
 *
 * Headless agents may create child-agent and tool contexts. Retiring only the
 * root entity leaves those descendants (and their durable storage/VCS state)
 * behind, so an isolated launch must be reclaimed through the context API.
 * Callers that supplied a shared context must use `retireHeadlessAgent` instead.
 */
export async function destroyHeadlessAgentContext(opts: {
  rpcCall: AgentLaunchRpc["call"];
  contextId: string;
}): Promise<void> {
  await opts.rpcCall("main", mainRpcMethods["runtime.destroyContext"], [
    { contextId: opts.contextId, recursive: true },
  ]);
}

export async function unsubscribeHeadlessAgent(opts: {
  rpcCall: AgentLaunchRpc["call"];
  targetId: string;
  channelId: string;
}): Promise<void> {
  await opts.rpcCall(opts.targetId, agentRpcMethods["unsubscribeChannel"], [opts.channelId]);
}
