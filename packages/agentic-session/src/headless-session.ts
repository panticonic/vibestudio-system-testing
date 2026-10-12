/**
 * HeadlessSession — headless agentic session for skill code and system tests.
 *
 * A thin wrapper over the shared `ChatSession` (resident delivery): the
 * connection, transcript projection (durable events, streaming deltas, replay
 * batching), roster, debug events and title all come from the same chat core
 * the chat panel uses. On top it owns the agent lifecycle (context, entity,
 * subscription, ordered teardown) and the test helpers (waits, snapshots,
 * synthetic UI methods, `ui.feedback` observation).
 * Panel-local UI tools are not exposed by default because there is no browser
 * panel. Tests can opt into synthetic panel UI methods that publish the same
 * typed transcript events without doing browser rendering.
 *
 * Public API:
 *   - `HeadlessSession.create()` — wire up a session, no agent yet
 *   - `HeadlessSession.createWithAgent()` — full setup: connect client + subscribe DO
 *   - `send(text, opts)` — publish a user message
 *   - `waitForAgentMessage()` / `waitForIdle()` / `sendAndWait()` — test helpers
 *   - `messages`, `participants`, `connected`, `status` — getters
 *   - `snapshot()` — diagnostic snapshot
 *   - `dispose()` / `close()` — teardown
 */

import {
  type ConnectionConfig,
  type AgentSubscriptionConfig,
  type ChatParticipantMetadata,
  type ChatMessage,
  type DirtyRepoDetails,
  unwrapChatMethodResult,
  type ChatMethodResult,
} from "@workspace/agentic-core";
import { ChatSession } from "@workspace/agentic-core/chat-store";
import type {
  PubSubClient,
  Participant,
  ChannelConfig,
  MethodDefinition,
  AttachmentInput,
  AgentDebugPayload,
  IncomingEvent,
  MethodExecutionContext,
} from "@workspace/pubsub";
import {
  AGENTIC_EVENT_PAYLOAD_KIND,
  AGENTIC_PROTOCOL_VERSION,
  participantRefFromMetadata,
  type AgenticEvent,
  type ChannelViewState,
  type TurnId,
  type UiFeedbackPayload,
} from "@workspace/agentic-protocol";
import { z } from "zod";
import { agentRpcMethods } from "@workspace/agentic-do/rpc-contract";
import type { NativeInvocationSource } from "@vibestudio/service-schemas/nativeInvocation";
import {
  createHeadlessAgentContext,
  createHeadlessChannel,
  destroyHeadlessAgentContext,
  getRecommendedChannelConfig,
  retireHeadlessAgent,
  subscribeHeadlessAgent,
  unsubscribeHeadlessAgent,
} from "./channel.js";

// ===========================================================================
// Types
// ===========================================================================

export interface SessionSnapshot {
  /** Durable channel that carried this headless conversation. */
  channelId: string | null;
  /** Runtime entity created for the subscribed agent. */
  agentEntityId: string | null;
  /** Runtime relay target for the subscribed agent. */
  agentTargetId: string | null;
  /** Context used by the subscribed agent (isolated unless explicitly inherited). */
  agentContextId: string | null;
  /** Whether this session created and owns the complete agent context lifecycle tree. */
  ownsAgentContext: boolean;
  messages: readonly ChatMessage[];
  invocations: Array<{
    id: string;
    name: string;
    status: string;
    args?: unknown;
    nativeSource?: NativeInvocationSource;
    originatingInput?:
      | import("@vibestudio/service-schemas/nativeInvocation").NativeOriginatingInput
      | null;
    result?: unknown;
    consoleOutput?: string;
    error?: string;
  }>;
  tasks: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    result?: unknown;
  }>;
  debugEvents: readonly (AgentDebugPayload & { ts: number })[];
  /** Live/terminal state of the one acknowledged session teardown path. */
  cleanup: SessionCleanupState;
  cleanupErrors: readonly SessionCleanupError[];
  participants: Record<string, { name: string; type: string; handle: string; connected: boolean }>;
  localMethodNames: readonly string[];
  connected: boolean;
  duration: number;
  /** The durable channel title (null until set). */
  title: string | null;
  /** Durable provider/model requests and aggregate usage captured from the agent journal. */
  modelExecutionEvidence?: unknown;
  modelExecutionEvidenceError?: string;
  /** Payload-free orchestration timings from context creation through prompt publication. */
  hotPathTrace?: readonly SessionHotPathTrace[];
}

export interface SessionHotPathTrace {
  phase: string;
  startedAt: number;
  durationMs?: number;
}

export type SessionCleanupPhase =
  | "idle"
  | "unsubscribing-agent"
  | "capturing-model-evidence"
  | "capturing-retirement-evidence"
  | "disconnecting-client"
  | "destroying-agent-context"
  | "retiring-agent"
  | "complete";

export interface SessionCleanupState {
  phase: SessionCleanupPhase;
  phaseStartedAt: number;
  completedAt?: number;
}

export interface HeadlessSessionConfig {
  config: ConnectionConfig;
  metadata?: ChatParticipantMetadata;
  /** The resource owner observes native state after admission closes, before
   * remote retirement. Failure is retained while the full teardown still joins. */
  beforeRetirement?: (
    identity: Readonly<{
      channelId: string | null;
      contextId: string | null;
      agentTargetId: string | null;
    }>
  ) => Promise<void>;
}

export interface HeadlessWithAgentConfig extends HeadlessSessionConfig {
  rpcCall: import("@vibestudio/rpc").RpcCaller["call"];
  source: string;
  className: string;
  objectKey?: string;
  /** Omit to allocate a fresh isolated agent context explicitly. */
  contextId?: string;
  /** Exact host-attested authority policy for the isolated system-test case. */
  testPolicy?: import("@vibestudio/shared/authority/testPolicy").AgentExecutionTestPolicySpec;
  channelId?: string;
  channelConfig?: ChannelConfig;
  methods?: Record<string, MethodDefinition>;
  /**
   * Pi-native pass-through subscription config. Common keys: `model`,
   * `thinkingLevel`, `approvalLevel`, `systemPrompt`, and
   * `systemPromptMode`.
   */
  extraConfig?: AgentSubscriptionConfig;
  /**
   * Test-only harness mode: advertise panel-local UI methods from the headless
   * client and publish their typed UI events. This exercises agent/tool
   * integration without a browser renderer.
   */
  includeSyntheticPanelUiMethods?: boolean;
  /**
   * Test-only deterministic fault seam. The advertised validation probe rejects
   * its first well-formed call and accepts later calls, proving tool recovery
   * without asking a model to defeat its own generated schema.
   */
  includeValidationRetryProbeMethod?: boolean;
}

const HEADLESS_LIFECYCLE_RPC_TIMEOUT_MS = 30_000;

export interface HeadlessWaitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const nativeRunSettlementSchema = z.object({
  channelId: z.string(),
  conversationId: z.number().int().positive(),
  taskId: z.number().int().positive().nullable().optional(),
  inputs: z
    .array(
      z.object({
        status: z.enum(["done", "unanswered"]),
        reason: z.string().optional(),
        detail: z.unknown().optional(),
      })
    )
    .min(1),
  answers: z.array(
    z.object({
      conversationId: z.number().int().positive(),
      entryId: z.number().int().positive(),
      taskId: z.number().int().positive().nullable(),
      messages: z.array(
        z.object({
          messageId: z.string(),
          outcome: z.enum(["completed", "interrupted", "tool_calls_only", "empty"]),
          text: z.string(),
          published: z.boolean(),
        })
      ),
    })
  ),
});

function invocationErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["error"] === "string") return record["error"];
    if (typeof record["message"] === "string") return record["message"];
    const details = record["details"];
    if (details && typeof details === "object") {
      const detailError = (details as Record<string, unknown>)["error"];
      if (typeof detailError === "string") return detailError;
    }
    const protocolContent = record["protocolContent"];
    if (Array.isArray(protocolContent)) {
      const text = protocolContent.find(
        (item) => item && typeof item === "object" && typeof item["text"] === "string"
      )?.["text"];
      if (typeof text === "string") return text;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return value == null ? fallback : String(value);
}

// ===========================================================================
// HeadlessSession
// ===========================================================================

const DEFAULT_METADATA: ChatParticipantMetadata = {
  name: "Headless Client",
  type: "headless",
  handle: "headless",
};

interface SessionCleanupError {
  phase: string;
  message: string;
  at: number;
}

interface MessageListener {
  (msg: ChatMessage): void;
}

/** One `ui.feedback` event observed on the session's channel. */
export interface ObservedUiFeedback {
  pubsubId?: number;
  senderId?: string;
  ts?: number;
  payload: UiFeedbackPayload;
}

export class HeadlessSession {
  private readonly _chat: ChatSession;
  private _client: PubSubClient<ChatParticipantMetadata> | null = null;
  private _channelId: string | null = null;
  private _clientId: string;
  private _createdAt = Date.now();
  private _config: HeadlessSessionConfig;
  private _agentEntityId: string | null = null;
  private _agentTargetId: string | null = null;
  private _agentContextId: string | null = null;
  private _ownsAgentContext = false;
  private _agentRpcCall: HeadlessWithAgentConfig["rpcCall"] | null = null;

  private _uiFeedback: ObservedUiFeedback[] = [];
  private _cleanupErrors: SessionCleanupError[] = [];
  private _cleanupFailureCauses: unknown[] = [];
  private _cleanupState: SessionCleanupState = {
    phase: "idle",
    phaseStartedAt: Date.now(),
  };
  private _closePromise: Promise<void> | null = null;
  private _registeredMethodNames: string[] = [];
  private _modelExecutionEvidence: unknown;
  private _modelExecutionEvidenceError: string | undefined;
  private readonly _hotPathTrace: SessionHotPathTrace[] = [];
  private _disposed = false;
  private _notifiedMessages: readonly ChatMessage[] = [];

  // Listeners
  private _messageListeners = new Set<MessageListener>();
  /** Fired on every channel event and roster change; backs `waitUntil`. */
  private _stateListeners = new Set<() => void>();
  private readonly _observationLifetime = new AbortController();
  private readonly _nativeObservations = new Set<{
    controller: AbortController;
    settled: Promise<void>;
  }>();

  private constructor(config: HeadlessSessionConfig) {
    this._config = config;
    this._hotPathTrace.push({
      phase: "session.created",
      startedAt: Date.now(),
    });
    this._clientId = config.config.clientId;

    this._chat = new ChatSession({
      config: { ...config.config, deliveryMode: "resident" },
      metadata: config.metadata ?? DEFAULT_METADATA,
      ports: {
        observeEvent: (event) => {
          this.recordUiFeedback(event);
          this.notifyStateListeners();
        },
      },
    });
    this._chat.subscribe(() => {
      this.notifyListeners();
      this.notifyStateListeners();
    });
  }

  /** The shared chat core behind this session. */
  get chat(): ChatSession {
    return this._chat;
  }

  /** Create a HeadlessSession with the given config (no agent yet). */
  static create(config: HeadlessSessionConfig): HeadlessSession {
    return new HeadlessSession(config);
  }

  /**
   * Convenience: create a channel, subscribe a DO agent, connect, all in one.
   */
  static async createWithAgent(config: HeadlessWithAgentConfig): Promise<HeadlessSession> {
    const channelId = config.channelId ?? `headless-${crypto.randomUUID()}`;
    const objectKey = config.objectKey ?? `headless-${crypto.randomUUID()}`;
    const session = new HeadlessSession(config);

    const defaultMethods = session.buildDefaultMethods();
    const syntheticPanelUiMethods = config.includeSyntheticPanelUiMethods
      ? session.buildSyntheticPanelUiMethods()
      : {};
    const validationRetryProbeMethods = config.includeValidationRetryProbeMethod
      ? session.buildValidationRetryProbeMethods()
      : {};
    const methods: Record<string, MethodDefinition> = {
      ...defaultMethods,
      ...syntheticPanelUiMethods,
      ...validationRetryProbeMethods,
      ...config.methods,
    };

    const channelConfig: ChannelConfig = {
      ...getRecommendedChannelConfig(),
      ...config.channelConfig,
    } as ChannelConfig;

    const ownsAgentContext = !config.contextId;
    const contextStartedAt = Date.now();
    const agentContextId =
      config.contextId ??
      (await createHeadlessAgentContext({
        rpcCall: config.rpcCall,
        ...(config.testPolicy ? { testPolicy: config.testPolicy } : {}),
      }));
    session._hotPathTrace.push({
      phase: config.contextId ? "context.reused" : "context.created",
      startedAt: contextStartedAt,
      durationMs: Date.now() - contextStartedAt,
    });
    try {
      const channelStartedAt = Date.now();
      const channel = await createHeadlessChannel({
        rpcCall: config.rpcCall,
        channelId,
        contextId: agentContextId,
      });
      session._hotPathTrace.push({
        phase: "channel.activated",
        startedAt: channelStartedAt,
        durationMs: Date.now() - channelStartedAt,
      });
      await session.connect(channelId, {
        channelTargetId: channel.targetId,
        channelConfig,
        contextId: agentContextId,
        methods,
      });
      const subscriptionStartedAt = Date.now();
      const subscription = await subscribeHeadlessAgent({
        rpcCall: config.rpcCall,
        source: config.source,
        className: config.className,
        objectKey,
        channelId,
        contextId: agentContextId,
        extraConfig: config.extraConfig,
      });
      session._hotPathTrace.push({
        phase: "agent.subscribed",
        startedAt: subscriptionStartedAt,
        durationMs: Date.now() - subscriptionStartedAt,
      });
      session._agentEntityId = subscription.entityId;
      session._agentTargetId = subscription.targetId;
      session._agentContextId = subscription.contextId;
      session._ownsAgentContext = ownsAgentContext;
      session._agentRpcCall = config.rpcCall;
    } catch (err) {
      const cleanupErrors: unknown[] = [];
      try {
        await session.disconnect();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      if (ownsAgentContext) {
        try {
          await destroyHeadlessAgentContext({
            rpcCall: config.rpcCall,
            contextId: agentContextId,
          });
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length)
        throw new AggregateError(
          [err, ...cleanupErrors],
          "Headless agent setup failed and its cleanup could not be completed",
          { cause: err }
        );
      throw err;
    }

    return session;
  }

  // ===========================================================================
  // Default headless methods
  // ===========================================================================

  private buildDefaultMethods(): Record<string, MethodDefinition> {
    return {};
  }

  private localActor() {
    const metadata = this._config.metadata ?? DEFAULT_METADATA;
    const id = this._client?.clientId ?? this._clientId ?? metadata.handle ?? "headless";
    return {
      ...participantRefFromMetadata(id, metadata),
      displayName: metadata.name ?? id,
      metadata: { ...metadata },
    };
  }

  /** The method caller, recorded as the requester of UI published on its behalf. */
  private callerRef(context: MethodExecutionContext) {
    return participantRefFromMetadata(
      context.callerId,
      this._client?.roster?.[context.callerId]?.metadata
    );
  }

  /** The caller's turn that issued this call, stamped on UI it published. */
  private callerTurn(context: MethodExecutionContext): { turnId?: TurnId } {
    return context.turnId ? { turnId: context.turnId as TurnId } : {};
  }

  private async publishSyntheticPanelUiEvent(
    event: AgenticEvent<"ui.inline_rendered" | "ui.action_bar.updated">,
    idempotencyKey: string
  ): Promise<number | undefined> {
    const client = this._client;
    if (!client) return undefined;
    return client.publish(AGENTIC_EVENT_PAYLOAD_KIND, event, {
      idempotencyKey,
    });
  }

  private buildSyntheticPanelUiMethods(): Record<string, MethodDefinition> {
    const methods: Record<string, MethodDefinition> = {};

    methods["inline_ui"] = {
      description:
        "Synthetic panel harness: render a persistent inline UI component in the chat transcript. Provide either TSX code or a context-relative path. Reuse a stable id to replace and bump an existing card. Publishes the same typed inline UI event as the browser panel tool, but does not mount a browser renderer.",
      parameters: z.object({
        id: z.string().trim().min(1).optional(),
        code: z.string().optional(),
        path: z.string().optional(),
        imports: z.record(z.string(), z.string()).optional(),
        props: z.record(z.unknown()).optional(),
      }),
      execute: async (args: unknown, context: MethodExecutionContext) => {
        const {
          id: requestedId,
          code,
          path,
          imports,
          props,
        } = args as {
          id?: string;
          code?: string;
          path?: string;
          imports?: Record<string, string>;
          props?: Record<string, unknown>;
        };
        const trimmedPath = path?.trim();
        if (!trimmedPath && !code)
          return context.result({ ok: false, error: "Missing code or path" }, { isError: true });

        const id = requestedId?.trim() || crypto.randomUUID();
        const source = trimmedPath
          ? { type: "file" as const, path: trimmedPath }
          : { type: "code" as const, code: code! };
        const eventPayload: AgenticEvent<"ui.inline_rendered">["payload"] = {
          protocol: AGENTIC_PROTOCOL_VERSION,
          uiType: "inline",
          requestedBy: this.callerRef(context),
          id,
          source,
        };
        if (imports !== undefined) eventPayload.imports = imports;
        if (props !== undefined) eventPayload.props = props;
        await this.publishSyntheticPanelUiEvent(
          {
            kind: "ui.inline_rendered",
            actor: this.localActor(),
            ...this.callerTurn(context),
            payload: eventPayload,
            createdAt: new Date().toISOString(),
          },
          `synthetic-ui:inline:${id}:${crypto.randomUUID()}`
        );
        return { ok: true, id };
      },
    };

    methods["load_action_bar"] = {
      description:
        "Synthetic panel harness: load, replace, or clear a compact panel action bar. Provide exactly one of inline TSX code or a context-relative TSX path unless clear is true. Publishes the same typed action-bar update event as the browser panel tool, but does not mount a browser renderer or own a panel filesystem, so inline code is published as a code source.",
      parameters: z.object({
        code: z.string().optional(),
        path: z.string().optional(),
        imports: z.record(z.string(), z.string()).optional(),
        props: z.record(z.unknown()).optional(),
        maxHeight: z.number().optional(),
        clear: z.boolean().optional(),
      }),
      execute: async (args: unknown, context: MethodExecutionContext) => {
        const { code, path, imports, props, maxHeight, clear } = args as {
          code?: string;
          path?: string;
          imports?: Record<string, string>;
          props?: Record<string, unknown>;
          maxHeight?: number;
          clear?: boolean;
        };
        if (clear) {
          await this.publishSyntheticPanelUiEvent(
            {
              kind: "ui.action_bar.updated",
              actor: this.localActor(),
            ...this.callerTurn(context),
              payload: {
                protocol: AGENTIC_PROTOCOL_VERSION,
                uiType: "action_bar",
                requestedBy: this.callerRef(context),
                cleared: true,
                result: { ok: true },
              },
              createdAt: new Date().toISOString(),
            },
            `synthetic-ui:action-bar:clear:${crypto.randomUUID()}`
          );
          return { ok: true, cleared: true };
        }

        const trimmedPath = path?.trim();
        const inlineCode = code?.trim() ? code : undefined;
        if ((inlineCode === undefined) === !trimmedPath)
          return context.result(
            { ok: false, error: "Provide exactly one of code or path" },
            { isError: true }
          );

        const id = crypto.randomUUID();
        const eventPayload: AgenticEvent<"ui.action_bar.updated">["payload"] = {
          protocol: AGENTIC_PROTOCOL_VERSION,
          uiType: "action_bar",
          requestedBy: this.callerRef(context),
          id,
          source: trimmedPath
            ? { type: "file", path: trimmedPath }
            : { type: "code", code: inlineCode! },
          result: { ok: true },
        };
        if (imports !== undefined) eventPayload.imports = imports;
        if (props !== undefined) eventPayload.props = props;
        if (maxHeight !== undefined) eventPayload.maxHeight = maxHeight;
        await this.publishSyntheticPanelUiEvent(
          {
            kind: "ui.action_bar.updated",
            actor: this.localActor(),
            ...this.callerTurn(context),
            payload: eventPayload,
            createdAt: new Date().toISOString(),
          },
          `synthetic-ui:action-bar:${id}`
        );
        return { ok: true, id };
      },
    };

    return methods;
  }

  private buildValidationRetryProbeMethods(): Record<string, MethodDefinition> {
    let rejectedFirstCall = false;
    return {
      validation_retry_probe: {
        description:
          "Deterministic validation-recovery probe. Its first well-formed call is rejected as invalid arguments; after observing that error, call the same tool again to prove a corrected request can complete.",
        parameters: z
          .object({
            value: z.string().describe("A short value to validate"),
          })
          .strict(),
        execute: async ({ value }) => {
          if (!rejectedFirstCall) {
            rejectedFirstCall = true;
            throw new Error(
              "Invalid arguments for tool validation_retry_probe: injected first-call argument rejection"
            );
          }
          return { ok: true, recovered: true, value };
        },
      },
    };
  }

  // ===========================================================================
  // Event tracking (debug events)
  // ===========================================================================

  /** `ui.feedback` targets an agent's harness and is not projected; tests observe it here. */
  private recordUiFeedback(event: IncomingEvent): void {
    if (event.type !== AGENTIC_EVENT_PAYLOAD_KIND) return;
    const agentic = (event as IncomingEvent & { payload?: AgenticEvent }).payload;
    if (agentic?.kind !== "ui.feedback") return;
    const wire = event as IncomingEvent & { pubsubId?: number; senderId?: string; ts?: number };
    this._uiFeedback.push({
      ...(wire.pubsubId !== undefined ? { pubsubId: wire.pubsubId } : {}),
      ...(wire.senderId !== undefined ? { senderId: wire.senderId } : {}),
      ...(wire.ts !== undefined ? { ts: wire.ts } : {}),
      payload: agentic.payload as UiFeedbackPayload,
    });
  }

  // ===========================================================================
  // Connection lifecycle
  // ===========================================================================

  async connect(
    channelId: string,
    options?: {
      channelTargetId?: string;
      channelConfig?: ChannelConfig;
      contextId?: string;
      methods?: Record<string, MethodDefinition>;
    }
  ): Promise<void> {
    const startedAt = Date.now();
    const methods = options?.methods ?? this.buildDefaultMethods();
    this._registeredMethodNames = Object.keys(methods).sort();

    this._client = await this._chat.connect({
      channelId,
      ...(options?.channelTargetId ? { channelTargetId: options.channelTargetId } : {}),
      methods,
      ...(options?.channelConfig ? { channelConfig: options.channelConfig } : {}),
      ...(options?.contextId ? { contextId: options.contextId } : {}),
    });
    this._channelId = channelId;

    this._hotPathTrace.push({
      phase: "channel.connected",
      startedAt,
      durationMs: Date.now() - startedAt,
    });
  }

  private notifyListeners(): void {
    const msgs = this.messages;
    if (msgs === this._notifiedMessages) return;
    this._notifiedMessages = msgs;
    if (msgs.length === 0) return;
    const latest = msgs[msgs.length - 1]!;
    for (const listener of this._messageListeners) {
      try {
        listener(latest);
      } catch (err) {
        console.error("[HeadlessSession] message listener threw:", err);
      }
    }
  }

  private notifyStateListeners(): void {
    for (const listener of [...this._stateListeners]) listener();
  }

  /**
   * Resolve with the first defined value `read` returns, re-evaluated on every
   * channel event and roster change. Settles only on that observation, a
   * thrown read, the caller's abort, or the session closing.
   */
  waitUntil<T>(read: () => T | undefined, opts?: { signal?: AbortSignal }): Promise<T> {
    const signals = [this._observationLifetime.signal, ...(opts?.signal ? [opts.signal] : [])];
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this._stateListeners.delete(evaluate);
        for (const signal of signals) signal.removeEventListener("abort", aborted);
      };
      function aborted(this: AbortSignal) {
        cleanup();
        reject(this.reason ?? new Error("Headless observation aborted"));
      }
      const evaluate = () => {
        try {
          const value = read();
          if (value === undefined) return;
          cleanup();
          resolve(value);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const abortedSignal = signals.find((signal) => signal.aborted);
      if (abortedSignal) {
        reject(abortedSignal.reason ?? new Error("Headless observation aborted"));
        return;
      }
      for (const signal of signals) signal.addEventListener("abort", aborted, { once: true });
      this._stateListeners.add(evaluate);
      evaluate();
    });
  }

  /**
   * Subscribe to message-state updates. Fires on every channel update,
   * including streaming deltas (so a renderer can show partial agent output).
   * Returns an unsubscribe function. Used by non-React renderers (e.g. the Ink
   * terminal chat) the same way the React hooks consume the message stream.
   */
  onMessage(listener: (msg: ChatMessage) => void): () => void {
    this._messageListeners.add(listener);
    return () => {
      this._messageListeners.delete(listener);
    };
  }

  async send(
    text: string,
    options?: {
      attachments?: AttachmentInput[];
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<string> {
    if (!this._client) throw new Error("Not connected");
    const startedAt = Date.now();
    const result = await this._client.send(text, options);
    this._hotPathTrace.push({
      phase: "prompt.published",
      startedAt,
      durationMs: Date.now() - startedAt,
    });
    return result.messageId;
  }

  async interrupt(
    agentId: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<void> {
    if (this._agentRpcCall && this._channelId) {
      if (options) {
        await this._agentRpcCall(agentId, agentRpcMethods["interruptChannel"], [this._channelId], options);
      } else {
        await this._agentRpcCall(agentId, agentRpcMethods["interruptChannel"], [this._channelId]);
      }
      return;
    }
    if (!this._client) return;
    const handle = this._client.callMethod(agentId, "pause", {}, options);
    unwrapChatMethodResult(await handle.result);
  }

  async callMethod(participantId: string, method: string, args: unknown): Promise<unknown> {
    if (!this._client) throw new Error("Not connected");
    const handle = this._client.callMethod(participantId, method, args);
    const result = await (handle as { result: Promise<ChatMethodResult> }).result;
    return unwrapChatMethodResult(result);
  }

  async callMethodResult(
    participantId: string,
    method: string,
    args: unknown
  ): Promise<ChatMethodResult> {
    if (!this._client) throw new Error("Not connected");
    const handle = this._client.callMethod(participantId, method, args);
    return (handle as { result: Promise<ChatMethodResult> }).result;
  }

  /**
   * Capture durable proof of the model calls this agent actually executed.
   * Unlike creation config or live settings, this reads journaled
   * message.started/message.completed descriptors and usage.
   */
  async captureModelExecutionEvidence(options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const targetId = this._agentTargetId;
    if (!targetId) throw new Error("No subscribed agent is available for model execution evidence");
    const channelId = this._channelId;
    if (!channelId) throw new Error("No channel is available for model execution evidence");
    try {
      const evidence = this._agentRpcCall
        ? await this._agentRpcCall(targetId, agentRpcMethods["getModelExecutionEvidence"], [channelId], options)
        : await this.callMethod(targetId, "getModelExecutionEvidence", {});
      this._modelExecutionEvidence = evidence;
      this._modelExecutionEvidenceError = undefined;
      return evidence;
    } catch (error) {
      this._modelExecutionEvidenceError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async loadEarlierMessages(): Promise<void> {
    /* no-op: channel replay delivers full persisted history */
  }

  async disconnect(): Promise<void> {
    await this.cancelNativeObservations(new Error("Headless session disconnected"));
    try {
      await this._chat.disconnect();
    } catch (err) {
      this.recordCleanupError("disconnect", err);
    }
    this._client = null;
    this._channelId = null;
  }

  private recordCleanupError(phase: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[HeadlessSession] ${phase} failed:`, error);
    this._cleanupErrors.push({ phase, message, at: Date.now() });
    this._cleanupFailureCauses.push(error);
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._observationLifetime.abort(new Error("Headless session disposed"));
    await this.disconnect();
    this._chat.dispose();
    this._messageListeners.clear();
  }

  close(options?: { onPhase?: (state: SessionCleanupState) => void }): Promise<void> {
    if (!this._closePromise) {
      this._observationLifetime.abort(new Error("Headless session closed"));
      this._closePromise = this.closeOnce(options);
    } else if (options?.onPhase) {
      options.onPhase({ ...this._cleanupState });
    }
    return this._closePromise;
  }

  private setCleanupPhase(
    phase: SessionCleanupPhase,
    onPhase?: (state: SessionCleanupState) => void
  ): void {
    const now = Date.now();
    this._cleanupState = {
      phase,
      phaseStartedAt: now,
      ...(phase === "complete" ? { completedAt: now } : {}),
    };
    onPhase?.({ ...this._cleanupState });
  }

  private async closeOnce(options?: {
    onPhase?: (state: SessionCleanupState) => void;
  }): Promise<void> {
    await this.cancelNativeObservations(this._observationLifetime.signal.reason);
    const firstCleanupFailure = this._cleanupFailureCauses.length;
    const entityId = this._agentEntityId;
    const targetId = this._agentTargetId;
    const contextId = this._agentContextId;
    const ownsContext = this._ownsAgentContext;
    const channelId = this._channelId;
    const rpcCall = this._agentRpcCall;
    const lifecycleRpcCall: import("@vibestudio/rpc").RpcCaller["call"] | null =
      rpcCall
        ? async (target, method, args, options) =>
            rpcCall(target, method, args, {
              ...options,
              timeoutMs: HEADLESS_LIFECYCLE_RPC_TIMEOUT_MS,
            })
        : null;

    const unsubscribe = async () => {
      if (!targetId || !channelId || !lifecycleRpcCall) return;
      await unsubscribeHeadlessAgent({
        rpcCall: lifecycleRpcCall,
        targetId,
        channelId,
      }).catch((err) => {
        this.recordCleanupError("unsubscribeHeadlessAgent", err);
      });
    };
    const cleanupRemote = async () => {
      if (!lifecycleRpcCall) return;
      // A context minted for this launch is the lifecycle unit. Destroying it
      // recursively retires the root and descendants, so it has one owner and
      // no entity-level fallback path.
      if (ownsContext && contextId) {
        await destroyHeadlessAgentContext({
          rpcCall: lifecycleRpcCall,
          contextId,
        }).catch((err) => {
          this.recordCleanupError("destroyHeadlessAgentContext", err);
        });
        return;
      }

      // In a caller-owned context, the session owns only its entity after the
      // subscription has been closed. Retirement observes the terminal result.
      if (!entityId) return;
      await retireHeadlessAgent({ rpcCall: lifecycleRpcCall, entityId }).catch((err) => {
        this.recordCleanupError("retireHeadlessAgent", err);
      });
    };
    // Stop the agent's subscription before disconnecting the headless peer.
    // A participant-left envelope is ordinary channel input; leaving the agent
    // subscribed while the client departs can schedule a fresh model turn
    // after the test has already reached its terminal result.
    this.setCleanupPhase("unsubscribing-agent", options?.onPhase);
    await unsubscribe();
    // Close the agent's effect-admission boundary before collecting optional
    // diagnostics. A final transcript message is visible slightly before its
    // durable turn is fully quiescent; probing first left that window open for
    // a queued continuation to begin just as the owning context was retired.
    if (targetId && this._client && this._modelExecutionEvidence === undefined) {
      this.setCleanupPhase("capturing-model-evidence", options?.onPhase);
      await this.captureModelExecutionEvidence({
        timeoutMs: HEADLESS_LIFECYCLE_RPC_TIMEOUT_MS,
      }).catch((error) => {
        this.recordCleanupError("captureModelExecutionEvidence", error);
      });
    }
    if (this._config.beforeRetirement) {
      this.setCleanupPhase("capturing-retirement-evidence", options?.onPhase);
      try {
        await this._config.beforeRetirement({ channelId, contextId, agentTargetId: targetId });
      } catch (error) {
        this.recordCleanupError("captureRetirementEvidence", error);
      }
    }
    this._agentEntityId = null;
    this._agentTargetId = null;
    this._agentRpcCall = null;
    this.setCleanupPhase("disconnecting-client", options?.onPhase);
    await this.dispose();
    this.setCleanupPhase(
      ownsContext && contextId ? "destroying-agent-context" : "retiring-agent",
      options?.onPhase
    );
    await cleanupRemote();
    this.setCleanupPhase("complete", options?.onPhase);
    const failures = this._cleanupFailureCauses.slice(firstCleanupFailure);
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Headless session cleanup failed in ${failures.length} phase(s)`
      );
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  // ===========================================================================
  // State getters
  // ===========================================================================

  get messages(): readonly ChatMessage[] {
    return this._chat.getSnapshot().messages;
  }

  get participants(): Readonly<Record<string, Participant<ChatParticipantMetadata>>> {
    return this._chat.getSnapshot().participants;
  }

  get allParticipants(): Readonly<Record<string, Participant<ChatParticipantMetadata>>> {
    return this._chat.getSnapshot().allParticipants;
  }

  get connected(): boolean {
    return this._chat.getSnapshot().connected;
  }

  get status(): string {
    return this._chat.getSnapshot().status;
  }

  get channelId(): string | null {
    return this._channelId;
  }

  get agentEntityId(): string | null {
    return this._agentEntityId;
  }

  get agentTargetId(): string | null {
    return this._agentTargetId;
  }

  get agentContextId(): string | null {
    return this._agentContextId;
  }

  get ownsAgentContext(): boolean {
    return this._ownsAgentContext;
  }

  /** The durable channel title projected into this report. */
  get title(): string | null {
    return this._chat.getSnapshot().channelTitle?.trim() || null;
  }

  get debugEvents(): readonly (AgentDebugPayload & { ts: number })[] {
    return this._chat.getSnapshot().debugEvents;
  }

  get dirtyRepoWarnings(): ReadonlyMap<string, DirtyRepoDetails> {
    return this._chat.getSnapshot().dirtyRepoWarnings;
  }

  /** `ui.feedback` events observed on the channel, in arrival order. */
  get uiFeedback(): readonly ObservedUiFeedback[] {
    return this._uiFeedback;
  }

  /**
   * The channel's reduced projection (turn lifecycle, action bars, ...) as of
   * the last observed event; `waitUntil` re-evaluates on every change.
   */
  get channelView(): Readonly<ChannelViewState> {
    return this._chat.feed.view;
  }

  /** Aborts (with the close reason) once the session is closed or disposed. */
  get lifetime(): AbortSignal {
    return this._observationLifetime.signal;
  }

  get isStreaming(): boolean {
    return this.messages.some((message) => !message.complete);
  }

  get client(): PubSubClient<ChatParticipantMetadata> | null {
    return this._client;
  }

  // ===========================================================================
  // Snapshot
  // ===========================================================================

  snapshot(): SessionSnapshot {
    const now = Date.now();
    const participants: SessionSnapshot["participants"] = {};
    for (const [id, p] of Object.entries(this.participants)) {
      participants[id] = {
        name: p.metadata.name,
        type: p.metadata.type,
        handle: p.metadata.handle ?? id,
        connected: true,
      };
    }
    const invocations = this.messages
      .filter((message) => message.invocation)
      .map((message) => ({
        id: message.invocation!.id,
        name: message.invocation!.name,
        status: message.invocation!.execution.status,
        args: message.invocation!.arguments,
        nativeSource: message.invocation!.nativeSource,
        originatingInput: message.invocation!.originatingInput,
        result: message.invocation!.execution.result,
        consoleOutput: message.invocation!.execution.consoleOutput,
        error: message.invocation!.execution.isError
          ? invocationErrorMessage(
              message.invocation!.execution.result,
              message.invocation!.execution.description || "Invocation failed"
            )
          : undefined,
      }));
    const tasks = this.messages
      .filter((message) => message.task)
      .map((message) => ({
        id: message.task!.id,
        type: message.task!.taskType,
        title: message.task!.title,
        status: message.task!.execution.status,
        result: message.task!.execution.result,
      }));
    return {
      channelId: this._channelId,
      agentEntityId: this._agentEntityId,
      agentTargetId: this._agentTargetId,
      agentContextId: this._agentContextId,
      ownsAgentContext: this._ownsAgentContext,
      messages: this.messages,
      invocations,
      tasks,
      debugEvents: this.debugEvents,
      cleanup: { ...this._cleanupState },
      cleanupErrors: [...this._cleanupErrors],
      participants,
      localMethodNames: this._registeredMethodNames,
      connected: this.connected,
      duration: now - this._createdAt,
      title: this.title,
      hotPathTrace: [...this._hotPathTrace],
      ...(this._modelExecutionEvidence !== undefined
        ? { modelExecutionEvidence: this._modelExecutionEvidence }
        : {}),
      ...(this._modelExecutionEvidenceError
        ? { modelExecutionEvidenceError: this._modelExecutionEvidenceError }
        : {}),
    };
  }

  // ===========================================================================
  // Headless-specific
  // ===========================================================================

  getRecommendedChannelConfig() {
    return getRecommendedChannelConfig();
  }

  /** Observe a newly completed visible response; provider attempt failures are not terminal run outcomes. */
  waitForAgentMessage(opts?: HeadlessWaitOptions): Promise<ChatMessage> {
    const baseline = new Map(
      this.messages.map((message) => [message.id, message.complete === true && !message.pending])
    );
    return this.observeNativeWork("agent message", opts, (signal) =>
      this.observeMessages(
        () =>
          [...this.messages]
            .reverse()
            .find(
              (message) =>
                message.senderId !== this._clientId &&
                message.kind === "message" &&
                message.complete === true &&
                !message.pending &&
                !message.error &&
                message.contentType !== "thinking" &&
                message.contentType !== "typing" &&
                message.contentType !== "invocation" &&
                baseline.get(message.id) !== true
            ),
        signal
      )
    );
  }

  /** Join delivery of one already-observed invocation's terminal card. This is
   * a presentation barrier, distinct from durable operation/input settlement. */
  waitForInvocation(invocationId: string, opts?: HeadlessWaitOptions): Promise<ChatMessage> {
    if (!invocationId || !this.messages.some((message) => message.invocation?.id === invocationId))
      return Promise.reject(new Error("Invocation observation requires its retained identity"));
    return this.observeNativeWork("invocation publication", opts, (signal) =>
      this.observeMessages(
        () =>
          this.messages.find(
            (message) =>
              message.invocation?.id === invocationId &&
              ["complete", "error", "failed", "cancelled", "abandoned"].includes(
                message.invocation.execution.status
              )
          ),
        signal
      )
    );
  }

  /** Join the actual original input settlement and its exact canonical answer publication. */
  waitForIdle(opts?: HeadlessWaitOptions): Promise<ChatMessage> {
    const completed = new Set(
      Object.values(this.channelView.invocations)
        .filter((invocation) =>
          ["completed", "failed", "cancelled", "abandoned"].includes(invocation.status)
        )
        .map((invocation) => invocation.invocationId)
    );
    return this.observeNativeWork("native run", opts, async (signal) => {
      const taskId = await this.observeMessages(
        () => this.latestNativeModelTask(completed),
        signal
      );
      return this.waitForNativeRun({ taskId }, signal);
    });
  }

  private latestNativeModelTask(completed: ReadonlySet<string>): number | undefined {
    if (!this._agentEntityId)
      throw new Error("Native settlement requires an authenticated agent binding");
    const candidates = Object.values(this.channelView.invocations).flatMap((invocation) => {
      if (completed.has(invocation.invocationId)) return [];
      const source = invocation.nativeSource;
      if (!source) return [];
      if (
        source.owner.runtimeId !== this._agentEntityId ||
        source.owner.channelId !== this._channelId ||
        source.operation.kind !== "model"
      )
        return [];
      return [
        {
          id: source.task.taskId,
          order: Date.parse(invocation.startedAt ?? "") || 0,
        },
      ];
    });
    return candidates.sort((a, b) => b.order - a.order || b.id - a.id)[0]?.id;
  }

  private observeMessages<T>(read: () => T | undefined, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this._messageListeners.delete(listener);
        signal.removeEventListener("abort", aborted);
      };
      const aborted = () => {
        cleanup();
        reject(signal.reason ?? new Error("Native observation aborted"));
      };
      const evaluate = () => {
        try {
          const value = read();
          if (value !== undefined) {
            cleanup();
            resolve(value);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const listener: MessageListener = () => evaluate();
      this._messageListeners.add(listener);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      else evaluate();
    });
  }

  private async observeNativeWork<T>(
    label: string,
    opts: HeadlessWaitOptions | undefined,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    let joined!: () => void;
    const owned = {
      controller,
      settled: new Promise<void>((resolve) => {
        joined = resolve;
      }),
    };
    this._nativeObservations.add(owned);
    const close = () => controller.abort(this._observationLifetime.signal.reason);
    this._observationLifetime.signal.addEventListener("abort", close, { once: true });
    if (this._observationLifetime.signal.aborted) close();
    const abort = () =>
      controller.abort(opts?.signal?.reason ?? new Error(`Waiting for ${label} aborted`));
    opts?.signal?.addEventListener("abort", abort, { once: true });
    if (opts?.signal?.aborted) abort();
    // This deadline is an explicit test-caller budget; it cancels and joins only its owned observation.
    const timer =
      opts?.timeoutMs === undefined
        ? undefined
        : setTimeout(
            () =>
              controller.abort(
                new Error(`Timed out waiting for ${label} after ${opts.timeoutMs}ms`)
              ),
            opts.timeoutMs
          );
    try {
      controller.signal.throwIfAborted();
      const result = await run(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", abort);
      this._observationLifetime.signal.removeEventListener("abort", close);
      controller.abort(new Error("Native observation released"));
      this._nativeObservations.delete(owned);
      joined();
    }
  }

  private async cancelNativeObservations(reason: unknown): Promise<void> {
    const owned = [...this._nativeObservations];
    for (const observation of owned) observation.controller.abort(reason);
    await Promise.all(owned.map((observation) => observation.settled));
  }

  private async waitForNativeRun(
    identity: { taskId?: number; inputMessageId?: string },
    signal: AbortSignal
  ): Promise<ChatMessage> {
    if (!this._agentRpcCall || !this._agentTargetId || !this._channelId || !this._agentEntityId)
      throw new Error("Native settlement requires an authenticated agent RPC binding");
    const result = nativeRunSettlementSchema.parse(
      await this._agentRpcCall(
        this._agentTargetId,
        agentRpcMethods["waitForNativeRun"],
        [{ ...identity, channelId: this._channelId }],
        { signal }
      )
    );
    if (
      result.channelId !== this._channelId ||
      (identity.taskId !== undefined && result.taskId !== identity.taskId)
    )
      throw new Error("Native settlement returned another source run");
    const unanswered = result.inputs.find((record) => record.status === "unanswered");
    if (unanswered)
      throw new Error(
        `Agent input unanswered: ${invocationErrorMessage(unanswered.detail, unanswered.reason ?? "unknown reason")}`
      );
    const completed = result.answers
      .flatMap((answer) =>
        answer.messages
          .filter((message) => message.published && message.outcome === "completed")
          .map((message) => ({ answer, message }))
      )
      .at(-1);
    if (!completed) {
      const interrupted = result.answers
        .flatMap((answer) => answer.messages)
        .find((message) => message.outcome === "interrupted");
      throw new Error(
        interrupted
          ? "Agent input finished with an interrupted answer"
          : "Agent input settled without a visible answer"
      );
    }
    return this.observeMessages(
      () =>
        this.messages.find(
          (message) =>
            message.id === completed.message.messageId &&
            message.senderId === this._agentEntityId &&
            message.native?.conversationId === completed.answer.conversationId &&
            message.native.entryId === completed.answer.entryId &&
            message.native.taskId === completed.answer.taskId &&
            message.complete === true &&
            !message.pending &&
            !message.error
        ),
      signal
    );
  }

  /** Observe one already-admitted input, including after an explicit activation
   * replacement. Transport failures never create or resubmit another input. */
  waitForInput(inputMessageId: string, opts?: HeadlessWaitOptions): Promise<ChatMessage> {
    if (!inputMessageId) throw new Error("Native input observation requires its exact message ID");
    return this.observeNativeWork("native input", opts, (signal) =>
      this.waitForNativeRun({ inputMessageId }, signal)
    );
  }

  async sendAndWait(text: string, opts?: HeadlessWaitOptions): Promise<ChatMessage> {
    return this.observeNativeWork("native input", opts, async (signal) => {
      const inputMessageId = await this.send(text);
      signal.throwIfAborted();
      return this.waitForNativeRun({ inputMessageId }, signal);
    });
  }
}
