/**
 * Headless channel helpers — create channels and subscribe DOs with headless defaults.
 *
 * "Headless" here means "no chat panel attached" — the same agent worker, prompt,
 * and tool surface as the panel-hosted path. The only thing this layer adds is
 * full-auto approval (since there's no user to approve tool calls interactively).
 * UI-only tools (inline_ui, feedback_form, etc.) are filtered out naturally
 * because no panel is connected to advertise them.
 */

import type { AgentSubscriptionConfig, AgentLaunchSource } from "@workspace/agentic-core";
import { launchAgentIntoChannel, retireAgentEntity, unsubscribeAgentFromChannel } from "@workspace/agentic-core";
import type { ChannelConfig } from "@workspace/pubsub";
import type { AgentExecutionTestPolicySpec } from "@vibestudio/shared/authority/testPolicy";
import { runtimeMethods } from "@vibestudio/service-schemas/runtime";

const CHANNEL_SOURCE = "workers/pubsub-channel";
const CHANNEL_CLASS = "PubSubChannel";

/** Recommended channel config for headless sessions: full-auto approval (level 2). */
export function getRecommendedChannelConfig(): Partial<ChannelConfig> {
  return {
    approvalLevel: 2,  // Full Auto
  };
}

export interface SubscribeHeadlessAgentOptions {
  serviceSource: AgentLaunchSource;
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
    opts.serviceSource,
    {
      source: opts.source,
      className: opts.className,
      key: opts.objectKey,
      channelId: opts.channelId,
      contextId: opts.contextId,
      config: subscriptionConfig,
      retireEntityOnSubscribeFailure: true,
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
  serviceSource: AgentLaunchSource;
  testPolicy?: AgentExecutionTestPolicySpec;
}): Promise<string> {
  const runtime = (await opts.serviceSource.selectService("runtime", runtimeMethods)).binding;
  const value = await runtime.createContext(opts.testPolicy ? { testPolicy: opts.testPolicy } : {});
  const contextId =
    value && typeof value === "object" && typeof (value as { contextId?: unknown }).contextId === "string"
      ? (value as { contextId: string }).contextId
      : "";
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
  serviceSource: AgentLaunchSource;
  channelId: string;
  contextId: string;
}): Promise<{ id: string; targetId: string; contextId: string }> {
  const runtime = (await opts.serviceSource.selectService("runtime", runtimeMethods)).binding;
  const value = await runtime.createEntity(
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
  );
  const handle = value as {
    id?: unknown;
    targetId?: unknown;
    contextId?: unknown;
  } | null;
  if (
    !handle ||
    typeof handle.id !== "string" ||
    typeof handle.targetId !== "string" ||
    handle.contextId !== opts.contextId
  ) {
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
  serviceSource: AgentLaunchSource;
  entityId: string;
}): Promise<void> {
  await retireAgentEntity(opts.serviceSource, opts.entityId);
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
  serviceSource: AgentLaunchSource;
  contextId: string;
}): Promise<void> {
  const runtime = (await opts.serviceSource.selectService("runtime", runtimeMethods)).binding;
  await runtime.destroyContext({ contextId: opts.contextId, recursive: true });
}

export async function unsubscribeHeadlessAgent(opts: {
  serviceSource: AgentLaunchSource;
  source: string;
  className: string;
  objectKey: string;
  channelId: string;
}): Promise<void> {
  await unsubscribeAgentFromChannel(opts.serviceSource, {
    source: opts.source,
    className: opts.className,
    key: opts.objectKey,
    channelId: opts.channelId,
  });
}
