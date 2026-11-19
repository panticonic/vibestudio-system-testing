import { managedPanelHealthMethods } from "./panel-health-contract.js";
import { managedPanelHealthWorlds } from "./panel-health-worlds.js";
import { managedChannelRosterMethods } from "./channel-roster-contract.js";
import { managedChannelRosterWorlds } from "./channel-roster-worlds.js";
import { managedMissionPlanningMethods } from "./mission-planning-contract.js";
import { managedMissionPlanningWorlds } from "./mission-planning-worlds.js";
import { managedBrowserHandoffMethods } from "./browser-handoff-contract.js";
import { managedBrowserHandoffWorlds } from "./browser-handoff-worlds.js";
import { managedBrowserLibraryMethods } from "./browser-library-contract.js";
import { managedBrowserLibraryWorlds } from "./browser-library-worlds.js";
import { managedCollectionMethods } from "./collection-contract.js";
import { managedCollectionWorlds } from "./collection-worlds.js";
import { managedTendrilMethods } from "./tendril-contract.js";
import { managedTendrilWorlds } from "./tendril-worlds.js";
import { managedProvenanceHistoryMethods } from "./provenance-history-contract.js";
import { managedRuntimeProgramMethods } from "./runtime-program-contract.js";
import { managedIncidentContinuationMethods } from "./incident-continuation-contract.js";
import { incidentContinuationWorlds } from "./incident-continuation-worlds.js";
import { managedLogAuditMethods } from "./log-audit-contract.js";
import { managedLogAuditWorlds } from "./log-audit-worlds.js";
import { managedLocalComparisonMethods } from "./local-model-comparison-contract.js";
import { localModelComparisonWorlds } from "./local-model-comparison-worlds.js";
import { managedGoogleSetupMethods } from "./google-setup-contract.js";
import { managedGoogleSetupWorlds, googleSetupPanel } from "./google-setup-worlds.js";
import { managedNewsMethods } from "./news-contract.js";
import { managedNewsWorlds, newsPanel, newsWorker } from "./news-worlds.js";
import { launchAgentIntoChannel } from "@workspace/agentic-core";
import { managedSpectroliteMethods } from "./spectrolite-contract.js";
import { managedSpectroliteWorlds, spectrolitePanel, spectroliteVault } from "./spectrolite-worlds.js";
import { managedGrimoireMethods } from "./grimoire-contract.js";
import { grimoirePanel, managedGrimoireWorlds } from "./grimoire-worlds.js";
import { managedChecklistMethods } from "./checklist-contract.js";
import { managedSetupMethods } from "./onboarding-contract.js";
import { managedMemoryMethods } from "./verified-memory-contract.js";
import { managedAuthoringMethods } from "./authoring-contract.js";
import { managedPresentationMethods } from "./presentation-contract.js";
import { managedPresentationWorlds } from "./presentation-worlds.js";
import { checkPresentation, observePresentation, referencePresentation } from "./presentation-managed.js";
import { managedPdfMethods } from "./pdf-intake-contract.js";
import { managedPublicationMethods } from "./publication-preflight-contract.js";
import { managedAutomationMethods } from "./automation-lifecycle-contract.js";
import { integrationHandoffMethods } from "./integration-handoff-contract.js";
import { integrationHandoffWorlds } from "./integration-handoff-worlds.js";
import { scratchHandoffRpcMethods } from "./scratch-handoff-contract.js";
import {localMessagingRpcMethods,type LocalMessagingInput} from "./local-messaging/contract.js";
import {ownedOperationsRpcMethods, type OwnedOperationsInput} from "./owned-operations-contract.js";
import {contentProjectRpcMethods, type ContentProjectInput} from "./content-project-contract.js";
import { resolveDurableObjectService } from "@vibestudio/service-schemas/clients/durableObjectServiceClient";
import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { developmentBuiltinMethods } from "@vibestudio/service-schemas/development";
import { integrationFixtureRpcMethods } from "./vcs-integration-fixture-contract.js";
import { systemTestRunnerRpcMethods } from "@vibestudio/service-schemas/systemTestRunner";
import { createRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { RpcCaller } from "@vibestudio/rpc";
import { createRpcMethodCaller, type RpcMethodArgs, type RpcMethodResult } from "@vibestudio/shared/rpcMethods";
import {
  HeadlessSession,
  type HeadlessWithAgentConfig,
  type SessionSnapshot,
} from "@workspace/agentic-session";
import type { ChatMessage, ConnectionConfig } from "@workspace/agentic-core";
import type { PanelHandle } from "@workspace/runtime";
import {
  blobstore,
  extensions,
  gad,
  openPanel,
  panelTree,
  rpc,
  vcs,
  workers,
} from "@workspace/runtime";
import {
  SYSTEM_TEST_AGENT_MODEL,
  systemTestModelRoute,
  type SystemTestThinkingLevel,
} from "./config.js";
import { systemTestFailure } from "./structured-error.js";
import {
  WorkspaceRepoFixtureLifecycle,
  type WorkspaceRepoFixtureCleanup,
  type WorkspaceRepoCreationScope,
  type WorkspaceRepoFixtureState,
} from "./workspace-repo-fixture.js";
import type { AgentExecutionTestPolicySpec } from "@vibestudio/shared/authority/testPolicy";
import {
  vcsStateNodeRefSchema,
  type VcsStateNodeRef,
} from "@vibestudio/service-schemas/vcs";
import type { AttachedHostApprovalAuditEvent } from "@vibestudio/service-schemas/attachedHosts";
import type { TestAuthorityPolicy } from "./types.js";
import type { BlobReader } from "@workspace/agentic-protocol";
import { createRecoveryCoordinator } from "@vibestudio/shell-core/recoveryCoordinator";
import { evalInPanel, setViewport, waitFor, waitForText } from "@workspace/testkit";
import { publishAtomicPanelStoreFixture } from "./atomic-panel-store-fixture.js";
import { probeSemanticCommand } from "./semantic-command-probe.js";
import {
  CHAT_PANEL_SOURCE,
  awaitChatPanelConnected,
  sessionBoundSignal,
  observeChatPanelRendering,
  type ChatPanelRenderEvidence,
} from "./real-chat-panel.js";

// This runner is eval'd server-side (in the orchestrating agent's EvalDO), so it
// uses the portable client surface — NOT panel-only `getStateArgs`/`slotId`.
// `rpc.selfId` is the stable runtime id, used as the channel-membership clientId.
const rpcConfig: NonNullable<ConnectionConfig["rpc"]> = rpc;

export const SYSTEM_TEST_AGENT_PROMPT = `You are running inside an automated Vibestudio system test.

Your job is to exercise the documented path honestly, not to make the test pass by inventing workarounds.

When a task depends on Vibestudio behavior, use the relevant docs or skill files to choose the most straightforward supported approach.

Treat the request like a normal user's request. Route from the Available skills index to the closest user-facing skill before doing a broad source search. Use normal approval routing for ordinary work; follow the product's authority guidance rather than assuming grants or bypassing review. Test-harness implementation and captured artifacts are not product evidence and must never be used to infer an answer.

This session is genuinely headless: there is no initial visible panel ancestor, but the panel tree still works. Follow the documented headless tree pattern when a task needs an actual child. Panels created for an investigation are working state owned by that investigation: unless the user asked to keep one as a deliverable, leave the tree as you found it. Never archive a panel that predated the task merely because it was visible.

Pursue the requested outcome through documented recovery and verification. A recoverable failure is an intermediate result: inspect its evidence, correct the cause within the requested scope, and continue. Do not abandon the task merely because the first supported attempt failed. Do not guess APIs, bypass authority, or replace a broken product path with an unrelated implementation to make the test pass. If completion requires a concrete unavailable prerequisite or unsupported behavior, report that blocker and preserve the original failure evidence.

When reporting a failure, include the docs or skill files you used, the operation you attempted, the exact error or unexpected result, and the mismatch between the docs and reality.

Follow the applicable product skills for execution, source editing, diagnostics, and resource ownership. If an operation fails, report the error you actually observed, verbatim, with the operation that produced it.

Keep evidence bounded. Report summaries, counts, ids, byte lengths, exact error messages, the final agent message, the validation reason, and the relevant tool call statuses/errors. Do not paste large raw payloads, full database rows, full channel envelopes, image data, or secrets.

Every final response should be concise and state plainly whether the user's task was completed. Summarize what you verified and mention any problems, retries, or abandoned approaches encountered along the way. For an incomplete task, include the concrete mismatch or error. Never just refer to files or artifacts; describe what the evidence shows. The harness records the full trajectory for human review, so do not hide confusion or failed attempts behind a polished success summary.`;

export type { WorkspaceRepoFixtureCleanup, WorkspaceRepoFixtureState };

interface ModelPolicyActivation {
  at: string;
  testName: string | null;
  fromModel: string;
  toModel: string;
  failureCode: string;
}

interface ModelPolicyState {
  primaryModel: string;
  activeModel: string;
  fallbackModel: string | null;
  fallbackThinkingLevel: SystemTestThinkingLevel | null;
  fallbackOn: readonly string[] | null;
  fallbackScope: "all-turns" | null;
  activations: ModelPolicyActivation[];
}

export interface EvalCancellationProbe {
  runId: string;
  cancel: { ok: true; forcedReset: boolean };
  terminal: { status: string; result?: unknown };
}

export interface EvalEventPagesProbe {
  runId: string;
  firstPage: {
    events: Array<{ sequence: number; kind: string }>;
    next: number;
    hasMore: boolean;
  };
  repeatedFirstPage: {
    events: Array<{ sequence: number; kind: string }>;
    next: number;
    hasMore: boolean;
  };
  pages: Array<{
    events: Array<{ sequence: number; kind: string }>;
    next: number;
    hasMore: boolean;
  }>;
  terminal: { status: string; result?: unknown };
}

export interface AgentVesselFaultProbe {
  targetId: string;
  aborted: true;
}

export interface SystemTestRpcFault {
  transport: "call" | "stream";
  method: string;
  occurrence?: number;
  message: string;
  code?: string;
}

export interface SystemTestRpcFaultEvidence {
  transport: "call" | "stream";
  method: string;
  occurrence: number;
  injected: boolean;
  message: string;
  code?: string;
}

export interface SelfDevelopmentRepository {
  contextId: string;
  repositoryId: string;
  repoPath:
    | "projects/vibestudio"
    | `projects/vibestudio-${"base" | "personal" | "system"}`;
  workingHead: VcsStateNodeRef;
}

export interface ChatTaskRuleEvidence {
  id: string;
  capability: string;
  action: string;
  resource: string;
  decidedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionIdFromInput(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = value["sessionId"];
  return typeof sessionId === "string" ? sessionId : undefined;
}

const developmentRpcMethods = createRpcMethods(
  "vibestudio.development.v1",
  developmentBuiltinMethods,
  "",
);

function fixturePublicationAuthority(
  fixture: (WorkspaceRepoCreationScope & { repoName: string | null }) | null,
): AgentExecutionTestPolicySpec["authority"] {
  if (!fixture) return [];
  return [
    {
      ruleId: "fixture-git-publication",
      capability: { kind: "exact", key: "git.publish" },
      resource: {
        kind: "prefix" as const,
        prefix: "workspace-source-change:publication:",
      },
      tier: "gated",
      decision: "once",
    },
    {
      ruleId: "fixture-host-publication",
      capability: { kind: "exact", key: "workspace.publish" },
      // The semantic publication and its protected-ref host effect are two
      // reviewed boundaries of the same immutable fixture publication. Keep
      // both scoped to publication resources; repo deletion is not included.
      resource: {
        kind: "prefix" as const,
        prefix: "workspace-source-change:publication:",
      },
      tier: "gated",
      decision: "once",
    },
    {
      ruleId: "fixture-publication",
      capability: { kind: "exact", key: "workspace.publish" },
      // Main advancement authorizes one immutable, atomic publication rather
      // than one repository ref. The fixture still owns and verifies the
      // repository scope: setup gives the case an isolated task context and
      // teardown rejects/counteracts every publication outside its declared
      // repository fixture.
      resource: {
        kind: "prefix" as const,
        prefix: "workspace-source-change:publication:",
      },
      tier: "gated",
      decision: "once",
    },
  ];
}

function fixtureContextAuthority(
  policy: AgentExecutionTestPolicySpec | null,
  counteractionRepoPaths: readonly string[],
): AgentExecutionTestPolicySpec | null {
  if (!policy || counteractionRepoPaths.length === 0) return policy;
  const repoPaths = [...new Set(counteractionRepoPaths)].sort();
  return {
    ...policy,
    authority: [
      ...policy.authority,
      ...repoPaths.map((repoPath, index) => ({
        ruleId: `fixture-counteraction-delete-${index + 1}`,
        capability: { kind: "exact" as const, key: "workspace-repo-delete" },
        resource: {
          kind: "exact" as const,
          key: `workspace-repo-delete:${repoPath}`,
        },
        tier: "critical" as const,
        decision: "once" as const,
      })),
    ],
  };
}

/** The panel an `openPanel` failure left committed, from its failure record. */
export function committedPanelId(error: unknown): string | undefined {
  const data = (error as { errorData?: unknown } | null)?.errorData as
    | { details?: { slotCommitted?: unknown }; provenance?: { panelId?: unknown } }
    | undefined;
  const panelId = data?.provenance?.panelId;
  return data?.details?.slotCommitted === true && typeof panelId === "string"
    ? panelId
    : undefined;
}

export class HeadlessRunner {
  readonly validationEvidenceReader: BlobReader = blobstore;
  /** Public workspace extension client for harness-owned behavioral observations. */
  readonly extensionsClient = extensions;
  /** Runtime-initialized panel opener for harness-owned scenario fixtures. */
  readonly openPanelClient = openPanel;
  /** Runtime-initialized panel-tree client for harness-owned invariants. */
  readonly panelTreeClient = panelTree;

  /** Evaluate against a separate hosted panel through the canonical testkit driver. */
  readonly evalInPanelClient = evalInPanel;

  /** Read the canonical user-facing permission inventory for harness assertions. */
  async listPermissions(): Promise<unknown[]> {
    const permissions = await rpc.call("main", mainRpcMethods["permissions.list"], []);
    if (!Array.isArray(permissions))
      throw new Error("permissions.list returned no inventory");
    return permissions;
  }

  /** Read the installed unit/config projection used to bind permission evidence. */
  async inspectInstalledWorkspace(): Promise<{
    units: unknown[];
    config: unknown;
  }> {
    const [units, config] = await Promise.all([
      rpc.call("main", mainRpcMethods["build.listUnits"], []),
      rpc.call("main", mainRpcMethods["workspace.getConfig"], []),
    ]);
    if (!Array.isArray(units))
      throw new Error("build.listUnits returned no unit inventory");
    return { units, config };
  }

  /** Read the host-owned reusable authority attached to one exact chat task. */
  inspectChatTaskRules(input: {
    contextId: string;
    channelId: string;
  }): Promise<ChatTaskRuleEvidence[]> {
    return rpc.call("main", mainRpcMethods["authority.listTaskRules"], [input]);
  }

  private contextId: string;
  private readonly shared: {
    sessions: Set<HeadlessSession>;
    testNames: Map<HeadlessSession, string | null>;
    modelPolicy: ModelPolicyState;
    thinkingLevel?: SystemTestThinkingLevel;
    sessionPolicies: Map<HeadlessSession, ModelPolicyState>;
  };
  private readonly testName: string | null;
  private readonly workspaceRepoFixture:
    | (WorkspaceRepoCreationScope & { repoName: string | null })
    | null;
  private readonly workspaceRepoFixtureLifecycle: WorkspaceRepoFixtureLifecycle | null;
  private readonly testAuthorityPolicy: AgentExecutionTestPolicySpec | null;
  private developmentTargetPromise: Promise<string> | null = null;
  /** The session owner seals diagnostics while native state still exists. */
  private readonly terminalSessionDiagnostics = new Map<
    string | null,
    Promise<Record<string, unknown>>
  >();
  private readonly ownedDevelopmentSessions = new Set<string>();
  private readonly developmentAdmissions = new Set<Promise<unknown>>();
  private readonly ownedDevelopmentRuns = new Map<string, Set<string>>();
  private developmentSessionAdmissionClosed = false;
  private fixtureForkOwnerPromise: Promise<string> | null = null;
  private readonly sessionRpcFaultEvidence = new WeakMap<
    HeadlessSession,
    SystemTestRpcFaultEvidence[]
  >();
  /** Real chat panels bound to session channels; archived before retirement. */
  private readonly chatPanels = new Map<string, PanelHandle>();

  /**
   * Model is per-agent, so each spawned headless agent is created with the
   * pinned system-test model as its initial config (via creation stateArgs),
   * unless a caller explicitly requests a model-specific test run.
   */
  constructor(
    contextId: string,
    opts?: {
      model?: string;
      thinkingLevel?: SystemTestThinkingLevel;
    },
    shared?: {
      sessions: Set<HeadlessSession>;
      testNames: Map<HeadlessSession, string | null>;
      modelPolicy: HeadlessRunner["shared"]["modelPolicy"];
      thinkingLevel?: SystemTestThinkingLevel;
      sessionPolicies: Map<HeadlessSession, ModelPolicyState>;
    },
    testName: string | null = null,
    workspaceRepoFixture: HeadlessRunner["workspaceRepoFixture"] = null,
    testAuthorityPolicy: AgentExecutionTestPolicySpec | null = null,
  ) {
    this.contextId = contextId;
    const primaryModel = opts?.model ?? SYSTEM_TEST_AGENT_MODEL;
    const modelRoute = systemTestModelRoute(
      primaryModel,
      opts?.model === undefined,
    );
    this.shared = shared ?? {
      sessions: new Set(),
      testNames: new Map(),
      sessionPolicies: new Map(),
      ...(opts?.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
      modelPolicy: {
        ...modelRoute,
        activeModel: primaryModel,
        activations: [],
      },
    };
    this.testName = testName;
    this.testAuthorityPolicy = testAuthorityPolicy;
    this.workspaceRepoFixture = workspaceRepoFixture;
    this.workspaceRepoFixtureLifecycle = workspaceRepoFixture
      ? new WorkspaceRepoFixtureLifecycle(
          {
            vcs,
            blobstore,
            createContext: (input) => {
              const contextPolicy = fixtureContextAuthority(
                testAuthorityPolicy,
                input?.counteractionRepoPaths ?? [],
              );
              return rpc.call(
                "main",
                mainRpcMethods["runtime.createContext"],
                [contextPolicy ? { testPolicy: contextPolicy } : {}],
              );
            },
            destroyContext: (contextId) =>
              rpc.call("main", mainRpcMethods["runtime.destroyContext"], [
                { contextId, recursive: true },
              ]),
          },
          testName ?? "unknown",
          workspaceRepoFixture.repoName,
          workspaceRepoFixture,
        )
      : null;
  }

  /** Exact provider:model ref every spawned test agent must execute. */
  get modelRef(): string {
    return this.shared.modelPolicy.activeModel;
  }

  /** Seed repository basename, or null for a task-created repository scope. */
  get workspaceRepoName(): string | null {
    return this.workspaceRepoFixture?.repoName ?? null;
  }

  /**
   * Put harness-created task inputs where the agent first looks: in the task
   * turn itself. The system prompt still owns authority and isolation policy;
   * this block is only concrete resource discovery, shared by every
   * fixture-backed test.
   */
  withTaskResources(prompt: string): string {
    const fixture = this.workspaceRepoFixture;
    if (
      !fixture ||
      fixture.kind === "created-repository" ||
      fixture.kind === "created-repositories"
    )
      return prompt;
    const repoPath = `${fixture.section}/${fixture.repoName}`;
    return `The project for this request is at ${repoPath}.\n\n${prompt}`;
  }

  /**
   * Record that a turn actually fell back, from the journaled model-execution
   * evidence that already proves which model ran.
   *
   * Without this the policy reports the configured route and an empty
   * activation list no matter what happened, so "inspect the run to confirm
   * whether the fallback also failed" cannot be answered from the run record —
   * the only trace is a per-test diagnostic string. `activeModel` deliberately
   * stays as configured: which model the next session requests is the host's
   * per-turn decision, and rewriting it here would make the harness start
   * asking for the fallback directly.
   */
  recordModelFallbackActivations(
    session: HeadlessSession,
    testName: string | null,
    activations: readonly Omit<ModelPolicyActivation, "testName">[],
  ): void {
    const sessionPolicy = this.shared.sessionPolicies.get(session);
    const same = (
      left: ModelPolicyActivation,
      right: ModelPolicyActivation,
    ): boolean =>
      left.at === right.at &&
      left.toModel === right.toModel &&
      left.testName === right.testName;
    for (const observed of activations) {
      const activation: ModelPolicyActivation = { ...observed, testName };
      // Evidence is captured once per phase, so the same turn is seen again on
      // a later read; a run's activation list is the set of transitions, not
      // how many times they were observed.
      for (const policy of [sessionPolicy, this.shared.modelPolicy]) {
        if (!policy) continue;
        if (
          !policy.activations.some((existing) => same(existing, activation))
        ) {
          policy.activations.push(activation);
        }
      }
    }
  }

  /** Serializable evidence for inspect/status output. */
  modelPolicySnapshot(session?: HeadlessSession): Readonly<ModelPolicyState> {
    const policy =
      (session && this.shared.sessionPolicies.get(session)) ??
      this.shared.modelPolicy;
    return {
      ...policy,
      activations: policy.activations.map((activation) => ({ ...activation })),
    };
  }

  /** A concurrency-safe runner view that associates every spawned session with one test. */
  forTest(
    testName: string,
    opts?: {
      workspaceRepoFixture?: WorkspaceRepoCreationScope;
      authorityPolicy?: TestAuthorityPolicy;
    },
  ): HeadlessRunner {
    const repoNameStem = `system-test-${slugifyTestName(testName)}-`;
    const workspaceRepoFixture = opts?.workspaceRepoFixture
      ? {
          repoName:
            opts.workspaceRepoFixture.kind === "created-repository" ||
            opts.workspaceRepoFixture.kind === "created-repositories"
              ? null
              : `${repoNameStem}${crypto.randomUUID().slice(0, 8)}`,
          ...opts.workspaceRepoFixture,
        }
      : null;
    const authorityPolicy =
      typeof opts?.authorityPolicy === "function"
        ? opts.authorityPolicy({ testName, workspaceRepoFixture })
        : opts?.authorityPolicy;
    return new HeadlessRunner(
      this.contextId,
      {
        model: this.shared.modelPolicy.primaryModel,
        ...(this.shared.thinkingLevel
          ? { thinkingLevel: this.shared.thinkingLevel }
          : {}),
      },
      this.shared,
      testName,
      workspaceRepoFixture,
      {
        testId: testName,
        agent: {
          model: this.shared.modelPolicy.primaryModel,
          approvalLevel: 2,
          fallback:
            this.shared.modelPolicy.fallbackModel &&
            this.shared.modelPolicy.fallbackThinkingLevel === "low" &&
            this.shared.modelPolicy.fallbackOn?.[0] === "usage_limit_terminal"
              ? {
                  model: this.shared.modelPolicy.fallbackModel,
                  thinkingLevel: "low",
                  on: ["usage_limit_terminal"],
                  scope: "all-turns",
                }
              : "disabled",
        },
        authority: [
          {
            ruleId: "model-credential",
            capability: { kind: "exact", key: "credential.use" },
            resource: { kind: "exact", key: "credential.use" },
            tier: "gated",
            decision: "once",
          },
          {
            ruleId: "headless-channel",
            capability: { kind: "exact", key: "workspace-service:channel" },
            resource: {
              kind: "prefix",
              prefix: "do:workers/pubsub-channel:PubSubChannel:headless-",
            },
            tier: "gated",
            decision: "once",
          },
          {
            ruleId: "subagent-task-channels",
            capability: { kind: "exact", key: "workspace-service:channel" },
            resource: {
              kind: "prefix",
              prefix: "do:workers/pubsub-channel:PubSubChannel:task-",
            },
            tier: "gated",
            decision: "once",
          },
          {
            ruleId: "workspace-state-runtime",
            capability: {
              kind: "exact",
              key: "workspace-service:workspace.state",
            },
            resource: {
              kind: "prefix",
              prefix: "do:vibestudio/internal:WorkspaceDO:",
            },
            tier: "gated",
            decision: "once",
          },
          {
            ruleId: "semantic-workspace",
            capability: {
              kind: "exact",
              key: "workspace-service:gad.workspace",
            },
            resource: {
              kind: "exact",
              key: "do:workers/workspace-source:GadWorkspaceDO:workspace",
            },
            tier: "gated",
            decision: "once",
          },
          {
            ruleId: "model-settings",
            capability: { kind: "exact", key: "workspace-service:models" },
            resource: {
              kind: "exact",
              key: "do:workers/model-settings:ModelSettingsDO:workspace-model-settings",
            },
            tier: "gated",
            decision: "once",
          },
          ...fixturePublicationAuthority(workspaceRepoFixture),
          ...(authorityPolicy?.authority ?? []),
        ],
        unexpectedPrompts: "fail",
      },
    );
  }

  /**
   * Create one exact task context. Seeded variants commit their typed source
   * repository only on that local line; task-created variants deliberately
   * begin with no repository and derive ownership from the task's work.
   */
  /** The already prepared fixture context, for deterministic source probes. */
  get workspaceRepoFixtureContextId(): string | null {
    return this.workspaceRepoFixtureLifecycle?.taskContextId ?? null;
  }

  /** Observe the canonical live inventory before task/fixture cleanup can retire it. */
  async observeFixtureRuntimeEntities(state: WorkspaceRepoFixtureState) {
    const repositories =
      await this.requireWorkspaceRepoFixtureLifecycle().observeRepositories(
        state,
      );
    const workers = repositories.filter(({ repoPath }) =>
      repoPath.startsWith("workers/"),
    );
    if (workers.length !== 1)
      throw new Error(
        "Runtime observation requires exactly one task-owned worker repository",
      );
    const source = workers[0]!.repoPath;
    const entities = await rpc.call("main", mainRpcMethods["runtime.listEntities"], []);
    return {
      source,
      entities: entities.filter((entity) => entity.source === source),
    };
  }

  /** Run the authored program under a harness-owned EvalDO in this exact seeded context. */
  async runPanelRepairTeacher(state: WorkspaceRepoFixtureState, goal: string) {
    if (
      state.kind !== "draft-repair-panel" ||
      state.contextId !== this.workspaceRepoFixtureContextId
    ) {
      throw new Error(
        "Panel repair requires the runner's own prepared draft fixture.",
      );
    }
    const { contextId, repoPath } = state;
    const owner = await this.fixtureForkOwner();
    const before = (await vcs.status({ contextId })).workingHead;
    const handle = await this.openPanelClient(repoPath, {
      contextId,
      ref: `ctx:${contextId}`,
      focus: false,
      parentId: null,
    });
    try {
      const result = await rpc.call(
        owner,
        systemTestRunnerRpcMethods.runPanelTeacher,
        [
          {
            contextId,
            panelId: handle.id,
            panelSource: repoPath,
            executorModel: this.modelRef,
            goal,
          },
        ],
      );
      const after = (await vcs.status({ contextId })).workingHead;
      return { result, before, after };
    } finally {
      await handle.archive();
    }
  }

  async runUnitRepairTeacher(goal: string) {
    const fixture = this.workspaceRepoFixture;
    const contextId = this.workspaceRepoFixtureContextId;
    if (fixture?.kind !== "unit-repair-worker" || !fixture.repoName || !contextId) {
      throw new Error("Unit repair requires the runner's own prepared worker fixture.");
    }
    const owner = await this.fixtureForkOwner();
    return rpc.call(owner, systemTestRunnerRpcMethods.runUnitRepairTeacher, [{
      contextId,
      unit: `workers/${fixture.repoName}`,
      goal,
      executorModel: this.modelRef,
    }]);
  }

  async runLocalMessaging(caseId:LocalMessagingInput["caseId"]) {
    const policy=fixtureContextAuthority(this.testAuthorityPolicy,[]);
    const target=await rpc.call("main",mainRpcMethods["runtime.createContext"],[policy?{testPolicy:policy}:{}]);
    try {const owner=await this.createFixtureWorker(target.contextId);return await rpc.call(owner,localMessagingRpcMethods.runLocalMessagingTeacher,[{contextId:target.contextId,caseId,executorModel:this.modelRef}]);}
    finally {await rpc.call("main",mainRpcMethods["runtime.destroyContext"],[{contextId:target.contextId,recursive:true}]);}
  }

  async runOwnedOperations(caseId: OwnedOperationsInput["caseId"]) {
    const policy=fixtureContextAuthority(this.testAuthorityPolicy,[]);
    const target=await rpc.call("main",mainRpcMethods["runtime.createContext"],[policy?{testPolicy:policy}:{}]);
    try {
      const owner=await this.createFixtureWorker(target.contextId);
      return await rpc.call(owner,ownedOperationsRpcMethods.runOwnedOperationsTeacher,[{contextId:target.contextId,caseId,executorModel:this.modelRef}]);
    } finally {await rpc.call("main",mainRpcMethods["runtime.destroyContext"],[{contextId:target.contextId,recursive:true}]);}
  }

  async runContentProject(request:ContentProjectInput["request"],variant:"teacher"|"reference"|"negative"="teacher") {
    const policy=fixtureContextAuthority(this.testAuthorityPolicy,[]);
    const target=await rpc.call("main",mainRpcMethods["runtime.createContext"],[policy?{testPolicy:policy}:{}]);
    try {
      const owner=await this.createFixtureWorker(target.contextId);
      const input={contextId:target.contextId,name:`content-${crypto.randomUUID()}`,title:"Grounded project deliverable",request:structuredClone(request)};
      if(variant==="teacher")return {kind:"teacher" as const,result:await rpc.call(owner,contentProjectRpcMethods.runContentProjectTeacher,[{...input,executorModel:this.modelRef}])};
      return {kind:"reference" as const,result:await rpc.call(owner,contentProjectRpcMethods.runContentProjectReference,[input,variant])};
    } finally {await rpc.call("main",mainRpcMethods["runtime.destroyContext"],[{contextId:target.contextId,recursive:true}]);}
  }

  async runScratchHandoff(caseId: string, reference?: "reference" | "negative") {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const target = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? {testPolicy:policy} : {}]);
    try {
      const owner = await this.createFixtureWorker(target.contextId);
      const input = { contextId: target.contextId, caseId };
      if (reference)
        return { kind:"reference" as const, result: await rpc.call(owner,scratchHandoffRpcMethods.qualifyScratchHandoff,[input,reference==="negative"]) };
      return { kind:"teacher" as const, result: await rpc.call(owner,scratchHandoffRpcMethods.runScratchHandoffTeacher,[{...input,executorModel:this.modelRef}]) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{contextId:target.contextId,recursive:true}]);
    }
  }

  private async createWorkspaceIntegrationWorld(seed:string,worldId:string) {
    const policy=fixtureContextAuthority(this.testAuthorityPolicy,[]);
    const target=await rpc.call("main",mainRpcMethods["runtime.createContext"],[policy?{testPolicy:policy}:{}]);
    const cleanup=()=>rpc.call("main",mainRpcMethods["runtime.destroyContext"],[{contextId:target.contextId,recursive:true}]);
    try {
      const owner=await this.createFixtureWorker(target.contextId);
      const prepared=await rpc.call(owner,integrationFixtureRpcMethods.prepareWorkspaceIntegrationFixture,[{seed,worldId}]);
      if(prepared.fixture.contextId!==target.contextId || prepared.ownerEntityId!==owner) throw new Error("Integration fixture returned another owner or context");
      return {owner,prepared,cleanup};
    } catch(error) {
      try {await cleanup();} catch(cleanupError) {throw new AggregateError([error,cleanupError],"Integration setup and cleanup failed");}
      throw error;
    }
  }

  async runWorkspaceIntegrationQualification(seed: string, worldId?: string) {
    const checks=[];
    for(const variant of ["reference","negative","alias"] as const) {
      const world=await this.createWorkspaceIntegrationWorld(`${seed}-${variant}`,variant === "alias" ? (worldId ? "paired-limits" : "theme-locale-alias") : (worldId ?? "theme-locale"));
      try {
        const verdict=await rpc.call(world.owner,integrationFixtureRpcMethods.qualifyWorkspaceIntegrationFixture,[variant]);
        if(verdict.passed!==(variant!=="negative")) throw new Error(`Oracle qualification failed for ${variant}: ${JSON.stringify(verdict.reasons)}`);
        const files = world.prepared.fixture.files;
        if (variant === "negative" && (
          verdict.verificationPaths.length !== files.length - 1 ||
          !files.slice(0, -1).every((file) => verdict.verificationPaths.includes(file.path)) ||
          !verdict.reasons.includes(`Required or preserved fields differ: ${files.at(-1)!.path}`)
        )) throw new Error("Negative qualification must fail on the omitted final file");
        checks.push({variant,verdict});
      } finally {await world.cleanup();}
    }
    return checks;
  }

  async runWorkspaceIntegrationTeacher(seed: string, goal: string, worldId: string) {
    const world=await this.createWorkspaceIntegrationWorld(seed,worldId);
    const {prepared,owner}=world;
    try {
      const result=await rpc.call(owner,systemTestRunnerRpcMethods.runWorkspaceIntegrationTeacher,[{contextId:prepared.fixture.contextId,source:prepared.fixture.source,files:prepared.files,executorModel:this.modelRef,goal}]);
      const verification=await rpc.call(owner,integrationFixtureRpcMethods.verifyWorkspaceIntegrationFixture,[]);
      return {result,verification,world:{kind:"vcs-integration",contextId:prepared.fixture.contextId,source:prepared.fixture.source,
        commonSeedEvent:prepared.fixture.commonSeedEvent,before:prepared.before,after:verification.head,mainEventId:prepared.fixture.mainEventId,
        repoPath:prepared.repoPath,repositoryId:prepared.fixture.repositoryId,
        initialComparison:prepared.initialComparison,privateOracle:{files:prepared.fixture.files}}};
    } finally {await world.cleanup();}
  }

  async runIntegrationHandoff(caseId:string, reference = false) {
    const selected = integrationHandoffWorlds.find((world)=>world.id === caseId);
    if(!selected) throw new Error("Unknown integration handoff world");
    const world = await this.createWorkspaceIntegrationWorld(`handoff-${caseId}`, selected.integration);
    try {
      if(reference) return {kind:"reference" as const,result:await rpc.call(world.owner,integrationHandoffMethods.qualifyIntegrationHandoff,[caseId])};
      return {kind:"teacher" as const,result:await rpc.call(world.owner,integrationHandoffMethods.runIntegrationHandoffTeacher,[{caseId,executorModel:this.modelRef}])};
    } finally {await world.cleanup();}
  }

  async runManagedAutomation(caseId: string, qualification = false) {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const target = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? {testPolicy:policy} : {}]);
    try {
      const owner = await this.createFixtureWorker(target.contextId);
      const input = { contextId: target.contextId, caseId };
      if (qualification)
        return { kind:"reference" as const, result: await rpc.call(owner,managedAutomationMethods.qualifyManagedAutomation,[input]) };
      return { kind:"teacher" as const, result: await rpc.call(owner,managedAutomationMethods.runManagedAutomationTeacher,[{...input,executorModel:this.modelRef}]) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{contextId:target.contextId,recursive:true}]);
    }
  }

  async runManagedPublication(goal:string, qualification = false) {
    const fixture=this.workspaceRepoFixture;
    const contextId=this.workspaceRepoFixtureContextId;
    if(fixture?.kind!=="publication-preflight-panel" || !fixture.repoName || !contextId)
      throw new Error("Publication preflight requires the runner's prepared panel fixture");
    const panelSource=`panels/${fixture.repoName}`;
    const owner=await this.fixtureForkOwner();
    const handle=await this.openPanelClient(panelSource,{contextId,ref:`ctx:${contextId}`,focus:false,parentId:null});
    try {
      const input={contextId,panelId:handle.id,panelSource,caseId:fixture.caseId,goal};
      if(qualification)
        return {kind:"reference" as const,result:await rpc.call(owner,managedPublicationMethods.qualifyManagedPublication,[input])};
      return {kind:"teacher" as const,result:await rpc.call(owner,managedPublicationMethods.runManagedPublicationTeacher,[{...input,executorModel:this.modelRef}])};
    } finally {await handle.archive();}
  }

  async runManagedPdf(caseId: string, qualification = false) {
    const policy=fixtureContextAuthority(this.testAuthorityPolicy,[]);
    const target=await rpc.call("main",mainRpcMethods["runtime.createContext"],[policy?{testPolicy:policy}:{}]);
    try {
      const owner=await this.createFixtureWorker(target.contextId);
      const input={contextId:target.contextId,caseId};
      if(qualification)
        return {kind:"reference" as const,result:await rpc.call(owner,managedPdfMethods.qualifyManagedPdf,[input])};
      return {kind:"teacher" as const,result:await rpc.call(owner,managedPdfMethods.runManagedPdfTeacher,[{...input,executorModel:this.modelRef}])};
    } finally {
      await rpc.call("main",mainRpcMethods["runtime.destroyContext"],[{contextId:target.contextId,recursive:true}]);
    }
  }

  async runManagedPdfHandoff(caseId: string, qualification = false) {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const target = await rpc.call("main", mainRpcMethods["runtime.createContext"], [
      policy ? { testPolicy: policy } : {},
    ]);
    try {
      const owner = await this.createFixtureWorker(target.contextId);
      const input = { contextId: target.contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedPdfMethods.qualifyManagedPdfHandoff, [input]) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedPdfMethods.runManagedPdfHandoffTeacher, [{ ...input, executorModel: this.modelRef }]) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [
        { contextId: target.contextId, recursive: true },
      ]);
    }
  }

  async runManagedBrowserLibrary(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedBrowserLibraryWorlds.some(({ id }) => id === caseId)) throw new Error("Unknown browser-library case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedBrowserLibraryMethods.qualifyManagedBrowserLibrary, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedBrowserLibraryMethods.runManagedBrowserLibraryTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedBrowserHandoff(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedBrowserHandoffWorlds.some(({ id }) => id === caseId)) throw new Error("Unknown browser handoff case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedBrowserHandoffMethods.qualifyManagedBrowserHandoff, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedBrowserHandoffMethods.runManagedBrowserHandoffTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedMissionPlanning(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedMissionPlanningWorlds.some(({ id }) => id === caseId)) throw new Error("Unknown mission planning case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedMissionPlanningMethods.qualifyManagedMissionPlanning, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedMissionPlanningMethods.runManagedMissionPlanningTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedChannelRoster(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedChannelRosterWorlds.some(({ id }) => id === caseId)) throw new Error("Unknown channel roster case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedChannelRosterMethods.qualifyManagedChannelRoster, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedChannelRosterMethods.runManagedChannelRosterTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedCollection(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedCollectionWorlds.some(({ id }) => id === caseId)) throw new Error("Unknown collection case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedCollectionMethods.qualifyManagedCollection, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedCollectionMethods.runManagedCollectionTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedTendril(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedTendrilWorlds.some(({ id }) => id === caseId)) throw new Error("Unknown Tendril case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    const channelId = `natlang-tendril-${crypto.randomUUID()}`;
    let warm: Awaited<ReturnType<typeof openPanel>> | undefined;
    try {
      const devices = await rpc.call("main", mainRpcMethods["panelRuntime.listPresentationTargets"], []);
      if (!devices.some((device) => device.platform === "headless" && device.online)) {
        // The first ordinary panel starts the managed headless device.
        warm = await this.openPanelClient("about/workspace", {
          contextId, ref: `ctx:${contextId}`, parentId: null, focus: false, signal,
        });
        await waitForText(warm, "Workspace");
      }
      const owner = await this.createFixtureWorker(contextId);
      const channel = await rpc.call("main", mainRpcMethods["runtime.createEntity"], [{
        kind: "do", execution: { surface: "code", source: "workers/pubsub-channel" },
        className: "PubSubChannel", key: channelId, contextId,
      }]);
      if (channel.contextId !== contextId) throw new Error("Tendril channel belongs to another context");
      const input = { contextId, caseId, channelId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedTendrilMethods.qualifyManagedTendril, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedTendrilMethods.runManagedTendrilTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      try { await warm?.archive(); }
      finally {
        await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
      }
    }
  }

  async runManagedNews(caseId: string, qualification: boolean, signal: AbortSignal) {
    const world = managedNewsWorlds.find(({ id }) => id === caseId);
    if (!world) throw new Error("Unknown News case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    const channelId = `natlang-news-${crypto.randomUUID()}`;
    const agentKey = channelId;
    let owner: string | undefined;
    let cleanup: { contextId: string; caseId: string; channelId: string; agentKey: string; channelTargetId: string; participantId: string } | undefined;
    let panel: Awaited<ReturnType<typeof openPanel>> | undefined;
    let failure: unknown;
    try {
      owner = await this.createFixtureWorker(contextId);
      const channel = await rpc.call("main", mainRpcMethods["runtime.createEntity"], [{
        kind: "do", execution: {surface: "code", source: "workers/pubsub-channel"},
        className: "PubSubChannel", key: channelId, contextId,
      }]);
      if (channel.contextId !== contextId) throw new Error("News channel has another owner context");
      cleanup = { contextId, caseId, channelId, agentKey, channelTargetId: channel.targetId, participantId: "" };
      const { subscription } = await launchAgentIntoChannel(rpc, {
        source: newsWorker, className: "NewsAgentWorker", key: agentKey, channelId, contextId,
        config: { handle: "news", model: this.modelRef, timezone: "UTC" }, replay: true,
      });
      const { participantId } = subscription;
      if (!participantId) throw new Error("News agent did not join its owned channel");
      const input = { ...cleanup, participantId };
      const result = qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedNewsMethods.qualifyManagedNews, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedNewsMethods.runManagedNewsTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
      if (world.panel) {
        panel = await this.openPanelClient(newsPanel, {
          contextId, ref: `ctx:${contextId}`, parentId: null, focus: false, signal,
          stateArgs: {channelName: channelId, agentKey},
        });
        await waitForText(panel, world.setup.length ? "Your inbox is ready" : "Add source");
        const state = await panel.stateArgs.get<{ channelName?: string; agentKey?: string }>();
        if (state.channelName !== channelId || state.agentKey !== agentKey)
          throw new Error("News panel did not present the assigned reader");
      }
      return result;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        try {
          try { await panel?.archive(); }
          finally {
            if (owner && cleanup && !(await rpc.call(owner, managedNewsMethods.retireManagedNews, [cleanup])))
              throw new Error("The fixture's News schedules remain installed");
          }
        } finally {
          await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
        }
      } catch (cleanupError) {
        if (failure === undefined) throw cleanupError;
        throw new Error(`News review failed (${String(failure)}) and cleanup failed (${String(cleanupError)})`, { cause: failure });
      }
    }
  }

  async runManagedIncidentContinuation(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!incidentContinuationWorlds.some((world) => world.id === caseId))
      throw new Error("Unknown incident continuation");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedIncidentContinuationMethods.qualifyManagedIncidentContinuation, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedIncidentContinuationMethods.runManagedIncidentContinuationTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedLogAudit(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedLogAuditWorlds.some((world) => world.id === caseId))
      throw new Error("Unknown host log audit");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedLogAuditMethods.qualifyManagedLogAudit, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedLogAuditMethods.runManagedLogAuditTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedProvenanceHistory(caseId: string, qualification: boolean, signal: AbortSignal) {
    const fixture = this.workspaceRepoFixture;
    const contextId = this.workspaceRepoFixtureContextId;
    if (fixture?.kind !== "provenance-record" || !fixture.repoName || !contextId)
      throw new Error("Provenance history requires the runner's own seeded repository");
    const owner = await this.fixtureForkOwner();
    const input = { contextId, caseId, repoPath: `projects/${fixture.repoName}` };
    return qualification
      ? { kind: "reference" as const, result: await rpc.call(owner, managedProvenanceHistoryMethods.qualifyManagedProvenanceHistory, [input], { signal }) }
      : { kind: "teacher" as const, result: await rpc.call(owner, managedProvenanceHistoryMethods.runManagedProvenanceHistoryTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
  }

  async runManagedRuntimeProgram(caseId: string, qualification: boolean, signal: AbortSignal) {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedRuntimeProgramMethods.qualifyManagedRuntimeProgram, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedRuntimeProgramMethods.runManagedRuntimeProgramTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedLocalComparison(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!localModelComparisonWorlds.some((world) => world.id === caseId))
      throw new Error("Unknown local model comparison");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(contextId);
      const input = { contextId, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedLocalComparisonMethods.qualifyManagedLocalComparison, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedLocalComparisonMethods.runManagedLocalComparisonTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
    }
  }

  async runManagedGoogleSetup(caseId: string, qualification: boolean, signal: AbortSignal) {
    if (!managedGoogleSetupWorlds.some((world) => world.id === caseId))
      throw new Error("Unknown Google setup case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    let panel: Awaited<ReturnType<typeof openPanel>> | undefined;
    try {
      const owner = await this.createFixtureWorker(contextId);
      panel = await this.openPanelClient(googleSetupPanel, {
        contextId, ref: `ctx:${contextId}`, parentId: null, focus: false, signal,
      });
      const input = { contextId, panelId: panel.id, caseId };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedGoogleSetupMethods.qualifyManagedGoogleSetup, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedGoogleSetupMethods.runManagedGoogleSetupTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      try { await panel?.archive(); }
      finally {
        await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]);
      }
    }
  }

  async runManagedSpectrolite(caseId: string, qualification: boolean, signal: AbortSignal) {
    const world = managedSpectroliteWorlds.find(({ id }) => id === caseId);
    if (!world) throw new Error("Unknown Spectrolite case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    let panel: Awaited<ReturnType<typeof openPanel>> | undefined;
    try {
      const { workingHead } = await vcs.status({ contextId });
      const repository = await vcs.resolveRepository({ state: workingHead, repoPath: spectroliteVault });
      if (!repository) throw new Error("The installed Spectrolite vault is absent");
      const seeded = await vcs.edit({
        contextId, expectedWorkingHead: workingHead, commandId: `spectrolite:seed:${contextId}`,
        changes: Object.entries(world.files).map(([path, text]) => ({
          kind: "file-create" as const, path, repositoryId: repository.repositoryId,
          content: { kind: "text" as const, text }, mode: 0o644,
        })),
      });
      const baseline = await vcs.commit({
        contextId, expectedWorkingHead: seeded.workingHead, commandId: `spectrolite:commit:${contextId}`,
        message: "Seed the assigned Spectrolite review vault",
      });
      if (world.draft) {
        const state = { kind: "event" as const, eventId: baseline.event.eventId };
        const changes = await Promise.all(Object.entries(world.draft.edits).map(async ([path, text]) => {
          const file = await vcs.readFile({
            state, repositoryId: repository.repositoryId, file: { kind: "path", path },
          });
          if (!file || file.content.kind !== "text")
            throw new Error(`Missing committed draft source: ${path}`);
          return {
            kind: "text-edit" as const, repositoryId: repository.repositoryId, fileId: file.fileId,
            edits: [{ start: 0, end: file.content.text.length, text }],
          };
        }));
        const edited = await vcs.edit({
          contextId, expectedWorkingHead: state, commandId: `spectrolite:draft:${contextId}`, changes,
        });
        if (!edited.changeIds.length) throw new Error("Spectrolite draft must change the vault");
      }
      const owner = await this.createFixtureWorker(contextId);
      panel = await this.openPanelClient(spectrolitePanel, {
        contextId, ref: `ctx:${contextId}`, parentId: null, focus: false, signal,
        stateArgs: { repoRoot: spectroliteVault, openPath: world.follow?.[0]?.path ?? world.path },
      });
      const navigation: { from: string; target: string; to: string }[] = [];
      if (world.follow?.length) {
        const target = panel;
        const editor = (path: string, heading?: string) => waitFor(async () => {
          signal.throwIfAborted();
          const current = await this.evalInPanelClient<{ path: string | null; text: string }>(target,
            '(() => { const node = document.querySelector(\'[data-testid="spectrolite-editor"]\'); return { path: node?.querySelector(\'[contenteditable="true"]\')?.getAttribute("aria-label") ?? null, text: node?.innerText ?? "" }; })()');
          return current.path === path && (!heading || current.text.includes(heading)) ? current.path : undefined;
        }, { label: `Spectrolite opens ${path}` });
        const { page } = await panel.cdp.session();
        try {
          for (const hop of world.follow) {
            const from = await editor(hop.path, hop.heading);
            await page.locator(`[data-wikilink=${JSON.stringify(hop.target)}]`).click();
            const to = await editor(hop.destination);
            navigation.push({ from, target: hop.target, to });
          }
        } finally { await page.close(); }
      }
      const input = { contextId, caseId, panelId: panel.id, navigation };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedSpectroliteMethods.qualifyManagedSpectrolite, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedSpectroliteMethods.runManagedSpectroliteTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      try { await panel?.archive(); }
      finally { await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]); }
    }
  }

  async runManagedGrimoire(caseId: string, qualification: boolean, signal: AbortSignal) {
    const world = managedGrimoireWorlds.find(({ id }) => id === caseId);
    if (!world) throw new Error("Unknown Grimoire case");
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    const garden = `natlang-garden-${crypto.randomUUID()}`;
    let handle: Awaited<ReturnType<typeof openPanel>> | undefined;
    try {
      const owner = await this.createFixtureWorker(contextId);
      handle = await this.openPanelClient(grimoirePanel, {
        contextId, ref: `ctx:${contextId}`, stateArgs: { estateKey: garden }, focus: false, parentId: null, signal,
      });
      const panel = handle;
      const before = await rpc.call(owner, managedGrimoireMethods.inspectOwnedGarden, [{ contextId, garden }], { signal }) as { day: number; phase: number };
      if (world.actions.length > 0) {
        await setViewport(panel, { width: 1200, height: 1000 });
        const { page } = await panel.cdp.session();
        let clock = before.day * 4 + before.phase;
        try {
          for (const [index, action] of world.actions.entries()) {
            signal.throwIfAborted();
            const quiet = action === "linger";
            const button = quiet ? "Observe quietly" : action;
            const control = page.getByRole("button", { name: button, exact: true });
            if (!quiet) {
              const selected = () => this.evalInPanelClient<boolean>(
                panel,
                `document.querySelector('.garden-stage .scene-note[aria-expanded="true"]')?.getAttribute("aria-label") === ${JSON.stringify(action)}`,
              );
              // Opening the resident card records a visit; closing it does not.
              if (await selected()) {
                await control.click();
                await waitFor(async () => !(await selected()) || undefined, { label: `${action}'s resident card closes` });
              }
            }
            await control.click();
            if (quiet) clock++;
            const expectedTime = `DAY ${Math.floor(clock / 4)} · ${["MORNING", "AFTERNOON", "EVENING", "NIGHT"][clock % 4]}`;
            await waitFor(async () => {
              signal.throwIfAborted();
              const state = await this.evalInPanelClient<{ clock: string; notice: string; busy: boolean }>(
                panel,
                '({clock: document.querySelector(".garden-caption .eyebrow")?.textContent ?? "", notice: document.querySelector(".garden-observations p")?.textContent ?? "", busy: document.querySelector(".garden-observations button")?.disabled ?? true})',
              );
              return (!state.busy && state.clock.replace(/\s+/gu, " ").trim() === expectedTime &&
                (quiet || state.notice.startsWith(`${action} pauses to watch you.`) ||
                  state.notice.startsWith(`${action} recognises your hand`))) || undefined;
            }, { label: `${caseId} action ${index + 1}: ${button} settles in the actual garden` });
          }
        } finally { await page.close(); }
      }
      const input = { contextId, garden, caseId, before };
      return qualification
        ? { kind: "reference" as const, result: await rpc.call(owner, managedGrimoireMethods.qualifyManagedGrimoire, [input], { signal }) }
        : { kind: "teacher" as const, result: await rpc.call(owner, managedGrimoireMethods.runManagedGrimoireTeacher, [{ ...input, executorModel: this.modelRef }], { signal }) };
    } finally {
      try { await handle?.archive(); }
      finally { await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId, recursive: true }]); }
    }
  }

  async runManagedChecklist(caseId: string, qualification = false) {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const target = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(target.contextId);
      const input = { contextId: target.contextId, caseId };
      if (qualification)
        return { kind: "reference" as const, result: await rpc.call(owner, managedChecklistMethods.qualifyManagedChecklist, [input]) };
      return { kind: "teacher" as const, result: await rpc.call(owner, managedChecklistMethods.runManagedChecklistTeacher, [{ ...input, executorModel: this.modelRef }]) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId: target.contextId, recursive: true }]);
    }
  }

  async runManagedSetup(caseId: string, qualification = false) {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const target = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(target.contextId);
      const input = { contextId: target.contextId, caseId };
      if (qualification)
        return { kind: "reference" as const, result: await rpc.call(owner, managedSetupMethods.qualifyManagedSetup, [input]) };
      return { kind: "teacher" as const, result: await rpc.call(owner, managedSetupMethods.runManagedSetupTeacher, [{ ...input, executorModel: this.modelRef }]) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId: target.contextId, recursive: true }]);
    }
  }

  async runManagedMemory(caseId: string, qualification = false) {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const target = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(target.contextId);
      const input = { contextId: target.contextId, caseId };
      if (qualification)
        return { kind: "reference" as const, result: await rpc.call(owner, managedMemoryMethods.qualifyManagedMemory, [input]) };
      return { kind: "teacher" as const, result: await rpc.call(owner, managedMemoryMethods.runManagedMemoryTeacher, [{ ...input, executorModel: this.modelRef }]) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId: target.contextId, recursive: true }]);
    }
  }

  async runManagedAuthoring(caseId: string, qualification = false) {
    const policy = fixtureContextAuthority(this.testAuthorityPolicy, []);
    const target = await rpc.call("main", mainRpcMethods["runtime.createContext"], [policy ? { testPolicy: policy } : {}]);
    try {
      const owner = await this.createFixtureWorker(target.contextId);
      const input = { contextId: target.contextId, caseId };
      if (qualification)
        return { kind: "reference" as const, result: await rpc.call(owner, managedAuthoringMethods.qualifyManagedAuthoring, [input]) };
      return { kind: "teacher" as const, result: await rpc.call(owner, managedAuthoringMethods.runManagedAuthoringTeacher, [{ ...input, executorModel: this.modelRef }]) };
    } finally {
      await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [{ contextId: target.contextId, recursive: true }]);
    }
  }

  async runManagedPanelHealth(qualification: boolean, signal: AbortSignal) {
    const fixture = this.workspaceRepoFixture;
    const contextId = this.workspaceRepoFixtureContextId;
    if (fixture?.kind !== "panel-health-preview" || !fixture.repoName || !contextId)
      throw new Error("Panel health requires the owned preview panel fixture");
    const world = managedPanelHealthWorlds.find(({ id }) => id === fixture.caseId);
    if (!world) throw new Error("Unknown managed panel health case");
    const before = await vcs.status({ contextId });
    const source = `panels/${fixture.repoName}`;
    signal.throwIfAborted();
    const handle = await this.openPanelClient(source, {
      contextId, ref: `ctx:${contextId}`, focus: false, parentId: null,
      stateArgs: { first: world.initial, ...(world.later ? { later: world.later } : {}) },
    });
    try {
      const owner = await this.fixtureForkOwner();
      const input = { contextId, caseId: world.id, source, panelId: handle.id };
      const result = qualification
        ? { teacher: null, ...await rpc.call(owner, managedPanelHealthMethods.qualifyManagedPanelHealth, [input], { signal }) }
        : { ...await rpc.call(owner, managedPanelHealthMethods.runManagedPanelHealthTeacher,
          [{ ...input, executorModel: this.modelRef }], { signal }), rejectsForeignObservation: false, rejectsWrongReceipt: false };
      const after = await vcs.status({ contextId });
      const protectedHeadUnchanged = before.mainEventId === after.mainEventId &&
        JSON.stringify(before.workingHead) === JSON.stringify(after.workingHead);
      return {
        ...result, contextId, caseId: world.id,
        verification: {
          ...result.verification,
          checks: { ...result.verification.checks, protectedHeadUnchanged },
          passed: result.verification.passed && protectedHeadUnchanged,
        },
      };
    } finally {
      await handle.archive();
    }
  }

  async runManagedPresentation(qualification: boolean, signal: AbortSignal) {
    const fixture = this.workspaceRepoFixture;
    const contextId = this.workspaceRepoFixtureContextId;
    if (fixture?.kind !== "presentation-preview-panel" || !fixture.repoName || !contextId)
      throw new Error("Presentation requires the runner's owned preview panel fixture");
    const world = managedPresentationWorlds.find(({ id }) => id === fixture.caseId);
    if (!world) throw new Error("Unknown managed presentation case");
    const before = await vcs.status({ contextId });
    const teacher = qualification
      ? null
      : await rpc.call(await this.fixtureForkOwner(), managedPresentationMethods.runManagedPresentationTeacher, [
          { contextId, executorModel: this.modelRef, request: world.request },
        ]);
    const report = qualification ? referencePresentation(world) : teacher?.report;
    const preview = checkPresentation(world, report);
    if (!preview?.length) return { contextId, caseId: world.id, teacher, verification: null, rejectedAlteredMdx: false };
    const altered = referencePresentation(world);
    const first = altered.views.find((view) => view.status === "ready");
    if (first) first.rendered = { ...first.rendered, mdx: "<Stats items={[]} />" };
    const rejectedAlteredMdx = checkPresentation(world, altered) === null;
    const source = `panels/${fixture.repoName}`;
    signal.throwIfAborted();
    const handle = await this.openPanelClient(source, {
      contextId,
      ref: `ctx:${contextId}`,
      focus: false,
      parentId: null,
      stateArgs: { views: preview.map(({ id, mdx }) => ({ id, mdx })) },
    });
    try {
      const observation = await observePresentation(handle, preview, contextId, source, signal);
      const after = await vcs.status({ contextId });
      const protectedHeadUnchanged = before.mainEventId === after.mainEventId &&
        JSON.stringify(before.workingHead) === JSON.stringify(after.workingHead);
      return {
        contextId,
        caseId: world.id,
        teacher,
        verification: {
          ...observation,
          checks: { ...observation.checks, exactReport: true, protectedHeadUnchanged },
          passed: observation.passed && protectedHeadUnchanged,
        },
        rejectedAlteredMdx,
      };
    } finally {
      await handle.archive();
    }
  }

  async prepareWorkspaceRepoFixture(): Promise<WorkspaceRepoFixtureState> {
    return this.requireWorkspaceRepoFixtureLifecycle().prepare();
  }

  async publishAtomicPanelStoreFixture() {
    const contextId = this.requireWorkspaceRepoFixtureLifecycle().taskContextId;
    if (!contextId)
      throw new Error(
        "Atomic panel-store fixture has no prepared task context",
      );
    return publishAtomicPanelStoreFixture({ vcs, blobstore, contextId });
  }

  async probeSemanticCommand(mode: "replay" | "stale") {
    const contextId = this.requireWorkspaceRepoFixtureLifecycle().taskContextId;
    const fixture = this.workspaceRepoFixture;
    if (!contextId || !fixture?.repoName)
      throw new Error("Semantic command probe has no prepared fixture");
    return probeSemanticCommand({
      vcs,
      contextId,
      repoPath: `${fixture.section}/${fixture.repoName}`,
      mode,
    });
  }

  /**
   * Retire the exact task-authored scope. Published work on this context's
   * first-parent line is counteracted; concurrent integration-parent work is
   * never attributed to this test.
   */
  async cleanupWorkspaceRepoFixture(
    state: WorkspaceRepoFixtureState,
    onPhase?: (phase: string) => void,
  ): Promise<WorkspaceRepoFixtureCleanup> {
    return this.requireWorkspaceRepoFixtureLifecycle().cleanup(state, onPhase);
  }

  /**
   * Spawn a headless session bound to this panel.
   *
   * The test agent's eval executes server-side in the agent's own EvalDO. The
   * agent uses the standard Vibestudio chat prompt and tool surface; panel/UI
   * tools like inline_ui and feedback_form are simply absent because no panel
   * is connected to this headless session. Tests that specifically exercise
   * UI-tool selection may opt into synthetic panel UI methods; those publish
   * the same typed channel events but do not mount browser renderers. Tests
   * that judge what the user actually sees opt into `realChatPanel` instead.
   *
   * Per-test prompt overrides can be passed through spawn extraConfig as
   * `systemPrompt` and `systemPromptMode`.
   */
  async spawn(opts?: {
    source?: string;
    className?: string;
    /**
     * System tests default to the fixture task context. `fork` creates a fresh
     * child from that unchanged fixture basis for each spawn; use `task` only
     * when multiple sessions deliberately share one working line, and `parent`
     * only when a test explicitly needs the orchestrator's context.
     */
    context?: "isolated" | "task" | "fork" | "parent";
    /**
     * Test-only harness mode: advertise panel-local UI methods from the
     * headless client so spawned agents can exercise inline_ui/action-bar tool
     * calls and typed UI event publication without a browser panel.
     */
    syntheticPanelUiTools?: boolean;
    /**
     * Bind the stock chat panel to the session channel in a server-hosted
     * renderer. Its participant advertises the real panel UI methods and
     * renders every message, so `observeChatPanelRendering` can report real
     * compile/render outcomes and `ui.feedback` events. Spawn returns once
     * the panel reports its channel subscription established; it is archived as part
     * of session close, before the agent context is retired.
     */
    realChatPanel?: boolean;
    /** Cancels waiting for a real chat panel to join. */
    signal?: AbortSignal;
    /**
     * Advertise a deterministic first-call argument-rejection probe. This is a
     * fault-injection seam for harness resilience tests, not a product tool.
     */
    validationRetryProbeTool?: boolean;
    /** Give the session a real recovery coordinator for reconnect probes. */
    recoverSubscriptions?: boolean;
    /** Harness-owned RPC failures injected before the production client sees the call. */
    rpcFaults?: readonly SystemTestRpcFault[];
    /** Additional test-owned participant methods advertised to the agent. */
    methods?: HeadlessWithAgentConfig["methods"];
    /** Test-specific policy appended after the shared system-test prompt. */
    additionalSystemPrompt?: string;
  }): Promise<HeadlessSession> {
    if (opts?.realChatPanel && opts.syntheticPanelUiTools)
      throw new Error("A session uses either the real chat panel or synthetic panel UI tools, not both");
    const policy = this.shared.modelPolicy;
    const model = policy.activeModel;
    const contextMode =
      opts?.context ?? (this.workspaceRepoFixture ? "task" : "isolated");
    const taskContextId =
      this.workspaceRepoFixtureLifecycle?.taskContextId ?? null;
    if ((contextMode === "task" || contextMode === "fork") && !taskContextId) {
      throw new Error(
        "Workspace repository fixture must be prepared before spawning its task agent",
      );
    }
    let forkContextId: string | null = null;
    if (contextMode === "fork") {
      const ownerEntityId = await this.fixtureForkOwner();
      const fork = await rpc.call(
        "main",
        mainRpcMethods["runtime.createSubagentContext"],
        [
          {
            parentContextId: taskContextId!,
            ownerEntityId,
            targetKey: `system-test-fixture-fork:${this.testName ?? "unknown"}:${crypto.randomUUID()}`,
          },
        ],
      );
      forkContextId = fork.contextId;
    }
    const agentContextId =
      contextMode === "parent"
        ? this.contextId
        : contextMode === "task"
          ? taskContextId
          : contextMode === "fork"
            ? forkContextId
            : undefined;
    const fixturePrompt = this.workspaceRepoFixture
      ? this.workspaceRepoFixture.kind === "created-repository"
        ? `\n\nHarness-owned test scope: this task owns exactly one repository that it creates under ${JSON.stringify(
            `${this.workspaceRepoFixture.section}/`,
          )}. All pre-existing repositories and every other newly created repository are outside the test scope.`
        : this.workspaceRepoFixture.kind === "created-repositories"
          ? `\n\nHarness-owned test scope: this task owns exactly ${this.workspaceRepoFixture.expectedSections.length} repositories that it creates, one under each of ${this.workspaceRepoFixture.expectedSections.map((section) => JSON.stringify(`${section}/`)).join(", ")}. All pre-existing repositories and every other newly created repository are outside the test scope.`
          : this.workspaceRepoFixture.kind === "buildable-panel-with-derived"
            ? `\n\nHarness-owned test scope: the disposable source repository ${JSON.stringify(
                `${this.workspaceRepoFixture.section}/${this.workspaceRepoFixture.repoName}`,
              )} is already present in this context. This task owns that source and exactly one derived repository it creates under ${JSON.stringify(
                `${this.workspaceRepoFixture.section}/`,
              )}; all other repositories are outside the test scope.`
            : `\n\nHarness-owned test scope: the exact disposable repository ${JSON.stringify(
                `${this.workspaceRepoFixture.section}/${this.workspaceRepoFixture.repoName}`,
              )} is already present in this context. It is the only repository owned by this test; ` +
              `all other repositories are outside the fixture scope.`
      : "";
    const rpcFaultEvidence: SystemTestRpcFaultEvidence[] = [];
    const occurrenceByOperation = new Map<string, number>();
    const checkFault = (
      transport: SystemTestRpcFault["transport"],
      methodName: string,
    ) => {
      const key = `${transport}:${methodName}`;
      const occurrence = (occurrenceByOperation.get(key) ?? 0) + 1;
      occurrenceByOperation.set(key, occurrence);
      const fault = opts?.rpcFaults?.find(
        (candidate) =>
          candidate.transport === transport &&
          candidate.method === methodName &&
          (candidate.occurrence ?? 1) === occurrence,
      );
      if (fault) {
        rpcFaultEvidence.push({
          transport,
          method: methodName,
          occurrence,
          injected: true,
          message: fault.message,
          ...(fault.code ? { code: fault.code } : {}),
        });
        throw Object.assign(
          new Error(fault.message),
          fault.code ? { code: fault.code } : {},
        );
      }
    };
    const callWithFault: RpcCaller["call"] = async (
      targetId,
      method,
      args,
      options,
    ) => {
      checkFault("call", method.name);
      return rpcConfig.call(targetId, method, args, options);
    };
    const faultingRpc: NonNullable<ConnectionConfig["rpc"]> = {
      selfId: rpcConfig.selfId,
      call: callWithFault,
      stream: async (targetId, method, args, options) => {
        checkFault("stream", method.name);
        return rpcConfig.stream(targetId, method, args, options);
      },
      streamReadable: async (targetId, method, args, options) => {
        checkFault("stream", method.name);
        return rpcConfig.streamReadable(targetId, method, args, options);
      },
      on: (event, listener, website) => rpcConfig.on(event, listener, website),
      ...(rpcConfig.registerResidentSession
        ? {
            registerResidentSession: (...args) => {
              const registration = rpcConfig.registerResidentSession!(...args);
              return {
                transport: {
                  call: callWithFault,
                },
                close: () => registration.close(),
                ...(registration.relationshipEnded
                  ? {
                      relationshipEnded: () =>
                        registration.relationshipEnded!(),
                    }
                  : {}),
              };
            },
          }
        : {}),
    };
    const recoveryCoordinator = opts?.recoverSubscriptions
      ? createRecoveryCoordinator()
      : undefined;
    const session = await HeadlessSession.createWithAgent({
      beforeRetirement: async ({ channelId }) => {
        try {
          const observation = this.readDiagnostics({ channelId });
          this.terminalSessionDiagnostics.set(channelId, observation);
          await observation;
        } finally {
          await this.archiveChatPanel(channelId);
        }
      },
      config: {
        clientId: rpc.selfId,
        rpc: faultingRpc,
        ...(recoveryCoordinator ? { recoveryCoordinator } : {}),
      },
      rpcCall: rpcConfig.call,
      source: opts?.source ?? "workers/agent-worker",
      className: opts?.className ?? "AiChatWorker",
      ...(agentContextId ? { contextId: agentContextId } : {}),
      ...(!agentContextId && this.testAuthorityPolicy
        ? { testPolicy: this.testAuthorityPolicy }
        : {}),
      includeSyntheticPanelUiMethods: opts?.syntheticPanelUiTools === true,
      includeValidationRetryProbeMethod:
        opts?.validationRetryProbeTool === true,
      ...(opts?.methods ? { methods: opts.methods } : {}),
      // The model rides the spawned agent's CREATION config (per-agent, seeded
      // from stateArgs.agentConfig) so it inherits the orchestrator's model.
      extraConfig: {
        // System tests are unattended by definition. Keep full-auto explicit
        // here instead of relying only on the channel default, so a workspace
        // or client default cannot leave a run waiting for approval.
        approvalLevel: 2,
        systemPrompt: `${SYSTEM_TEST_AGENT_PROMPT}${fixturePrompt}${opts?.additionalSystemPrompt ?? ""}`,
        systemPromptMode: "append",
        model,
        ...(this.shared.thinkingLevel
          ? { thinkingLevel: this.shared.thinkingLevel }
          : {}),
        ...(policy.fallbackModel &&
        policy.fallbackThinkingLevel &&
        policy.fallbackOn &&
        policy.fallbackScope
          ? {
              fallbackModel: policy.fallbackModel,
              fallbackThinkingLevel: policy.fallbackThinkingLevel,
              fallbackOn: [...policy.fallbackOn],
              fallbackScope: policy.fallbackScope,
            }
          : {}),
      },
    });
    if (opts?.realChatPanel) await this.attachChatPanel(session, opts.signal);
    this.sessionRpcFaultEvidence.set(session, rpcFaultEvidence);
    this.shared.sessions.add(session);
    this.shared.testNames.set(session, this.testName);
    const sessionPolicy: ModelPolicyState = {
      primaryModel: model,
      activeModel: model,
      fallbackModel: policy.fallbackModel,
      fallbackThinkingLevel: policy.fallbackThinkingLevel,
      fallbackOn: policy.fallbackOn,
      fallbackScope: policy.fallbackScope,
      activations: [],
    };
    this.shared.sessionPolicies.set(session, sessionPolicy);
    return session;
  }

  /**
   * Open the stock chat panel on the session's channel in its agent context
   * and wait until it reports its channel subscription established. A failed attach closes
   * the session, which archives a panel that was already opened.
   */
  private async attachChatPanel(session: HeadlessSession, signal?: AbortSignal): Promise<void> {
    const channelId = session.channelId;
    const contextId = session.agentContextId;
    try {
      if (!channelId || !contextId)
        throw new Error("A real chat panel needs a connected session with an agent context");
      const panel = await openPanel(CHAT_PANEL_SOURCE, {
        contextId,
        stateArgs: { channelName: channelId },
        parentId: null,
        focus: false,
        ...(signal ? { signal } : {}),
      });
      this.chatPanels.set(channelId, panel);
      await awaitChatPanelConnected(panel, sessionBoundSignal(session, signal));
    } catch (error) {
      // `openPanel` fails after its slot committed (abort, readiness error)
      // without returning a handle; the failure names the panel it left behind.
      // Own it so closing the session archives it.
      const leftBehind = committedPanelId(error);
      if (leftBehind && channelId && !this.chatPanels.has(channelId))
        this.chatPanels.set(channelId, panelTree.get(leftBehind));
      try {
        await session.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Real chat panel attach failed and the session could not be closed",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async archiveChatPanel(channelId: string | null): Promise<void> {
    if (!channelId) return;
    const panel = this.chatPanels.get(channelId);
    if (!panel) return;
    this.chatPanels.delete(channelId);
    await panel.archive();
  }

  /**
   * Settle the session's real chat panel for one answered turn, including the
   * feedback repair turn Base owes it, and report what it rendered: every
   * channel `ui.feedback` event, and which render failures remain unresolved.
   */
  async observeChatPanelRendering(
    session: HeadlessSession,
    answer: ChatMessage,
    options?: { signal?: AbortSignal; screenshot?: boolean },
  ): Promise<ChatPanelRenderEvidence> {
    const panel = session.channelId ? this.chatPanels.get(session.channelId) : undefined;
    if (!panel) throw new Error("Session was not spawned with realChatPanel");
    return observeChatPanelRendering(session, panel, answer, {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.screenshot ? { storeScreenshot: (data) => blobstore.putBase64(data) } : {}),
    });
  }

  /**
   * Keep one channel-free harness entity in the fixture context so ordinary
   * task forks have a real lifecycle owner. A subscribed agent is not inert:
   * cloning it also clones a live channel relationship into the child context.
   * Each `context: "fork"` spawn therefore starts from the fixture's unchanged
   * working head without inheriting any conversation state.
   */
  private fixtureForkOwner(): Promise<string> {
    const taskContextId = this.workspaceRepoFixtureLifecycle?.taskContextId;
    if (!taskContextId) {
      throw new Error(
        "Workspace fixture fork owner requires a prepared task context",
      );
    }
    this.fixtureForkOwnerPromise ??= this.createFixtureWorker(taskContextId);
    return this.fixtureForkOwnerPromise;
  }

  /** A new channel-free worker owned by the explicit captured task context. */
  private createFixtureWorker(contextId: string): Promise<string> {
    return rpc
      .call(
        "main",
        mainRpcMethods["runtime.createEntity"],
        [
          {
            kind: "do",
            execution: {
              surface: "code",
              source: "workers/system-test-runner",
            },
            className: "SystemTestRunnerDO",
            key: `system-test-fork-owner:${this.testName ?? "unknown"}:${crypto.randomUUID()}`,
            contextId,
          },
        ],
      )
      .then((handle) => {
        if (!handle.id || handle.contextId !== contextId) {
          throw new Error(
            "Workspace fixture fork owner was not created in its task context",
          );
        }
        return handle.id;
      });
  }

  rpcFaultEvidence(
    session: HeadlessSession,
  ): readonly SystemTestRpcFaultEvidence[] {
    return [...(this.sessionRpcFaultEvidence.get(session) ?? [])];
  }

  /** Non-blocking live snapshots for CLI inspection. Observation never issues
   * evidence RPCs, so it cannot perturb the run it describes. */
  snapshotAll(): Array<{ testName: string | null; snapshot: SessionSnapshot }> {
    return [...this.shared.sessions].map((session) => ({
      testName: this.shared.testNames.get(session) ?? null,
      snapshot: session.snapshot(),
    }));
  }

  async collectDiagnostics(opts?: {
    channelId?: string | null;
    branchId?: string | null;
  }): Promise<Record<string, unknown>> {
    const terminal = this.terminalSessionDiagnostics.get(
      opts?.channelId ?? null,
    );
    return terminal ?? this.readDiagnostics(opts);
  }

  private async readDiagnostics(opts?: {
    channelId?: string | null;
    branchId?: string | null;
  }): Promise<Record<string, unknown>> {
    const channelId = opts?.channelId ?? null;
    const diagnostics: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      contextId: this.contextId,
      channelId,
    };
    try {
      diagnostics["buildProvenance"] = await rpc.call(
        "main",
        mainRpcMethods["build.inspectBuildProvenance"],
        ["@workspace-skills/system-testing"],
      );
    } catch (err) {
      diagnostics["buildProvenanceFailure"] = systemTestFailure(
        "diagnostic:build-provenance",
        err,
      );
    }
    try {
      diagnostics["durableWork"] = await rpc.call(
        "main",
        mainRpcMethods["durableWork.inspect"],
        [],
      );
    } catch (err) {
      diagnostics["durableWorkFailure"] = systemTestFailure(
        "diagnostic:durable-work",
        err,
      );
    }
    if (channelId) {
      try {
        const service = (await resolveDurableObjectService(rpc, "vibestudio.channel.v1", channelId)) as {
          kind?: unknown;
          targetId?: unknown;
        };
        if (
          service.kind !== "durable-object" ||
          typeof service.targetId !== "string"
        ) {
          throw new Error(
            "channel service did not resolve to a Durable Object",
          );
        }
        diagnostics["channelDelivery"] = await rpc.call(
          service.targetId,
          channelRpcMethods["getState"],
          [],
        );
      } catch (err) {
        diagnostics["channelDeliveryFailure"] = systemTestFailure(
          "diagnostic:channel-delivery",
          err,
        );
      }
      try {
        diagnostics["agentHealth"] = await gad.inspectAgentHealth({
          channelId,
          branchId: opts?.branchId,
          limit: 50,
          envelopeLimit: 25,
          storageLimit: 25,
        });
      } catch (err) {
        diagnostics["agentHealthFailure"] = systemTestFailure(
          "diagnostic:agent-health",
          err,
        );
      }
    }
    return diagnostics;
  }

  /**
   * Exercise the host-side asynchronous eval contract from the harness that
   * owns the run. An ordinary agent tool call is intentionally synchronous, so
   * asking that same blocked turn to discover and cancel its own run cannot
   * test cancellation.
   */
  async probeEvalCancellation(): Promise<EvalCancellationProbe> {
    const runId = `system-test-cancel-${crypto.randomUUID()}`;
    const subKey = `system-test-cancel-${crypto.randomUUID()}`;
    let activated = false;
    try {
      const started = await rpc.call("main", mainRpcMethods["eval.start"], [
        {
          scope: { key: subKey, lifecycle: "finite" },
          runId,
          source: { kind: "inline", code: "await new Promise(() => {});" },
        },
      ]);
      activated = true;
      if (started.runId !== runId) {
        throw new Error(
          `eval.start returned ${started.runId}, expected ${runId}`,
        );
      }
      const cancel = await rpc.call(
        "main",
        mainRpcMethods["eval.cancel"],
        [{ scopeKey: subKey, runId }],
      );
      const terminal = await rpc.call(
        "main",
        mainRpcMethods["eval.get"],
        [{ scopeKey: subKey, runId }],
      );
      return { runId, cancel, terminal };
    } finally {
      if (activated) {
        await rpc.call("main", mainRpcMethods["eval.dispose"], [{ scopeKey: subKey }]);
      }
    }
  }

  /**
   * Prove that a completed owner-scoped run retains a stable event stream.
   * The same first cursor is read twice, then every subsequent page advances
   * through the durable cursor. This is deliberately a harness probe: an eval
   * turn cannot read its own event journal until it has already settled.
   */
  async probeEvalEventPages(): Promise<EvalEventPagesProbe> {
    const runId = `system-test-events-${crypto.randomUUID()}`;
    const subKey = `system-test-events-${crypto.randomUUID()}`;
    let activated = false;
    try {
      const started = await rpc.call("main", mainRpcMethods["eval.start"], [
        {
          scope: { key: subKey, lifecycle: "finite" },
          runId,
          source: {
            kind: "inline",
            code: 'console.log("SYSTEM_TEST_EVAL_EVENT"); return { eventProbe: true };',
          },
        },
      ]);
      activated = true;
      if (started.runId !== runId) {
        throw new Error(
          `eval.start returned ${started.runId}, expected ${runId}`,
        );
      }
      let terminal: { status: string; result?: unknown } | null = null;
      const settleDeadline = Date.now() + 30_000;
      while (Date.now() < settleDeadline) {
        terminal = await rpc.call(
          "main",
          mainRpcMethods["eval.get"],
          [{ scopeKey: subKey, runId }],
        );
        if (terminal.status === "done" || terminal.status === "cancelled")
          break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (
        !terminal ||
        (terminal.status !== "done" && terminal.status !== "cancelled")
      ) {
        throw new Error(
          `eval run ${runId} did not settle before event pagination`,
        );
      }
      const readPage = () =>
        rpc.call("main", mainRpcMethods["eval.events"], [
          { scopeKey: subKey, runId, after: 0, limit: 1 },
        ]);
      const firstPage = await readPage();
      const repeatedFirstPage = await readPage();
      const pages: EvalEventPagesProbe["pages"] = [];
      let after = 0;
      do {
        const page = await rpc.call(
          "main",
          mainRpcMethods["eval.events"],
          [{ scopeKey: subKey, runId, after, limit: 1 }],
        );
        pages.push(page);
        after = page.next;
        if (!page.hasMore) break;
      } while (pages.length < 256);
      if (pages.at(-1)?.hasMore)
        throw new Error(`eval event stream exceeded bounded pagination`);
      return { runId, firstPage, repeatedFirstPage, pages, terminal };
    } finally {
      if (activated)
        await rpc.call("main", mainRpcMethods["eval.dispose"], [{ scopeKey: subKey }]);
    }
  }

  /**
   * Abort one exact ordinary headless-agent facet while preserving its durable
   * storage. This is intentionally a harness-only fault seam. Product agents
   * do not get a crash tool; the system scenario uses it after observing one
   * live eval invocation so durable invocation replay crosses a real vessel
   * instance loss without disrupting unrelated agents.
   */
  async faultAbortAgentVesselForReplayProbe(
    targetId: string,
  ): Promise<AgentVesselFaultProbe> {
    const result = await rpc.call(
      "main",
      mainRpcMethods["runtime.faultAbortAgentVessel"],
      [{ targetId }],
    );
    return { targetId, aborted: result.aborted };
  }

  /**
   * Resolve the application checkout from the harness-owned semantic context.
   * Self-development scenarios use this host-captured identity instead of
   * asking a model to guess or restate a repository id.
   */
  async resolveSelfDevelopmentRepository(): Promise<SelfDevelopmentRepository> {
    const status = await vcs.status({ contextId: this.contextId });
    const repository = await vcs.resolveRepository({
      state: status.workingHead,
      repoPath: "projects/vibestudio",
    });
    if (!repository) {
      throw Object.assign(
        new Error(
          "Self-development prerequisite unavailable: projects/vibestudio is not adopted in the harness context",
        ),
        { code: "ESELFDEVELOPMENT_REPOSITORY" },
      );
    }
    return {
      contextId: this.contextId,
      repositoryId: repository.repositoryId,
      repoPath: "projects/vibestudio",
      workingHead: status.workingHead,
    };
  }

  async resolveSelfDevelopmentTemplateRepository(
    role: "base" | "personal" | "system",
  ): Promise<SelfDevelopmentRepository> {
    const status = await vcs.status({ contextId: this.contextId });
    const repoPath = `projects/vibestudio-${role}` as const;
    const repository = await vcs.resolveRepository({
      state: status.workingHead,
      repoPath,
    });
    if (!repository) {
      throw Object.assign(
        new Error(
          `Self-development prerequisite unavailable: ${repoPath} is not adopted in the harness context`,
        ),
        { code: "ESELFDEVELOPMENT_TEMPLATE_REPOSITORY" },
      );
    }
    return {
      contextId: this.contextId,
      repositoryId: repository.repositoryId,
      repoPath,
      workingHead: status.workingHead,
    };
  }

  /**
   * Harness-owned access to the ordinary public development service. Keeping
   * the call here makes scenario orchestration use the exact same dispatcher
   * and authority preparation as panels and eval clients, while evidence is
   * captured by the harness rather than copied from an agent response.
   */
  async callSelfDevelopment<K extends keyof typeof developmentRpcMethods & string>(
    method: K,
    ...args: RpcMethodArgs<(typeof developmentRpcMethods)[K]>
  ): Promise<RpcMethodResult<(typeof developmentRpcMethods)[K]>> {
    const admitsWork = [
      "openSession",
      "start",
      "retry",
      "checkpoint",
      "writeNativeTerminal",
      "faultFailBuildAfterSnapshotRetained",
    ].includes(method);
    if (admitsWork && this.developmentSessionAdmissionClosed) {
      throw new Error("The test's development resource lifetime has ended");
    }
    this.developmentTargetPromise ??= workers
      .resolveService("vibestudio.development.v1")
      .then((service) => {
        if (service.kind !== "durable-object" || !service.targetId) {
          throw new Error(
            "vibestudio.development.v1 did not resolve to a Durable Object service",
          );
        }
        return service.targetId;
      })
      .catch((error: unknown) => {
        this.developmentTargetPromise = null;
        throw error;
      });
    const targetId = await this.developmentTargetPromise;
    if (admitsWork && this.developmentSessionAdmissionClosed) {
      throw new Error("The test's development resource lifetime has ended");
    }
    const call = createRpcMethodCaller(rpc, targetId, developmentRpcMethods)(method, args)
      .then((result) => {
        if (method === "openSession") {
          if (isRecord(result) && result["kind"] === "opened" && isRecord(result["session"]) && typeof result["session"]["sessionId"] === "string")
            this.ownedDevelopmentSessions.add(result["session"]["sessionId"]);
        } else if (method === "start") {
          const startedRunId = isRecord(result) && typeof result["runId"] === "string" ? result["runId"] : undefined;
          const sessionId = sessionIdFromInput(args[0]);
          if (!startedRunId || !sessionId) throw new Error("Development start returned an invalid run identity");
          const runs =
            this.ownedDevelopmentRuns.get(sessionId) ?? new Set<string>();
          runs.add(startedRunId);
          this.ownedDevelopmentRuns.set(sessionId, runs);
        } else if (method === "closeSession") {
          if (isRecord(result) && result["state"] === "closed" && typeof result["sessionId"] === "string") {
            this.ownedDevelopmentSessions.delete(result["sessionId"]);
            this.ownedDevelopmentRuns.delete(result["sessionId"]);
          }
        }
        return result;
      });
    if (admitsWork) this.developmentAdmissions.add(call);
    try {
      return await call;
    } finally {
      this.developmentAdmissions.delete(call);
    }
  }

  /** A test's terminal state includes retirement of every development session it opened. */
  async closeOwnedDevelopmentSessions(): Promise<
    Array<{ sessionId: string; runs: unknown[]; session: unknown }>
  > {
    this.developmentSessionAdmissionClosed = true;
    await Promise.allSettled([...this.developmentAdmissions]);
    const outcomes = [];
    const failures: unknown[] = [];
    for (const sessionId of this.ownedDevelopmentSessions) {
      let before: { runs: Array<{ runId: string }> } = { runs: [] };
      try {
        before = await this.callSelfDevelopment("list", {
          sessionId,
          limit: 200,
        });
      } catch (error) {
        failures.push(error);
      }
      try {
        const runIds = new Set([
          ...before.runs.map((run) => run.runId),
          ...(this.ownedDevelopmentRuns.get(sessionId) ?? []),
        ]);
        for (const runId of runIds)
          await this.callSelfDevelopment("stop", {
            runId,
            idempotencyKey: `system-test-owner-stop-${runId}`,
          });
        const session = await this.callSelfDevelopment(
          "closeSession",
          {
            sessionId,
            idempotencyKey: `system-test-owner-close-${sessionId}`,
          },
        );
        const runs = await Promise.all(
          [...runIds].map((runId) =>
            this.callSelfDevelopment("get", { runId }),
          ),
        );
        outcomes.push({ sessionId, runs, session });
        if (session.state !== "closed")
          throw new Error(
            `Development session ${sessionId} did not close: ${JSON.stringify(session)}`,
          );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Owned development session cleanup failed",
      );
    return outcomes;
  }

  /** Invoke the owner-scoped ordinary attached-host client surface. */
  async callAttachedDevelopmentHost(
    sessionId: string,
    service: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    return rpc.call("main", mainRpcMethods["attachedHosts.invokeAttached"], [
      { sessionId, service, method, args },
    ]);
  }

  /** Open and attest the owner-scoped ordinary attached-host client. */
  async attachDevelopmentHost(sessionId: string): Promise<{
    sessionId: string;
    developmentRunId: string;
    childHostId: string;
    childGenerationId: string;
    authorityCeilingDigest: string;
    expiresAt: number;
  }> {
    return rpc.call("main", mainRpcMethods["attachedHosts.attachClient"], [{ sessionId }]);
  }

  /** Read bounded parent-captured approval evidence without changing child results. */
  async listAttachedDevelopmentHostApprovalAudit(
    sessionId: string,
    input: { after?: string; limit?: number } = {},
  ): Promise<{
    events: AttachedHostApprovalAuditEvent[];
    nextCursor: string | null;
  }> {
    return rpc.call("main", mainRpcMethods["attachedHosts.listApprovalAudit"], [
      { sessionId, ...input },
    ]);
  }

  /** Author one disposable semantic marker used to prove dirty-state capture. */
  async createSelfDevelopmentDirtyMarker(
    repository: SelfDevelopmentRepository,
    commandId: string,
  ): Promise<unknown> {
    return vcs.edit({
      contextId: repository.contextId,
      commandId,
      expectedWorkingHead: repository.workingHead,
      intentSummary: "Exercise exact dirty semantic self-development input",
      changes: [
        {
          kind: "file-create",
          repositoryId: repository.repositoryId,
          path: `.vibestudio-system-test/${commandId.replace(/[^a-zA-Z0-9._-]/gu, "-")}.txt`,
          content: {
            kind: "text",
            text: "self-development dirty-state probe\n",
          },
          mode: 0o644,
        },
      ],
    });
  }

  /** Discard only the harness-authored uncommitted marker after it is captured. */
  async discardSelfDevelopmentDirtyMarker(
    contextId: string,
    expectedWorkingHead: unknown,
    commandId: string,
  ): Promise<unknown> {
    return vcs.discard({
      contextId,
      commandId,
      expectedWorkingHead: vcsStateNodeRefSchema.parse(expectedWorkingHead),
    });
  }

  private requireWorkspaceRepoFixture(): NonNullable<
    HeadlessRunner["workspaceRepoFixture"]
  > {
    if (!this.workspaceRepoFixture) {
      throw new Error(
        "Workspace repo fixture lifecycle was requested for a test without a fixture",
      );
    }
    return this.workspaceRepoFixture;
  }

  private requireWorkspaceRepoFixtureLifecycle(): WorkspaceRepoFixtureLifecycle {
    this.requireWorkspaceRepoFixture();
    if (!this.workspaceRepoFixtureLifecycle) {
      throw new Error("Workspace repository fixture lifecycle is unavailable");
    }
    return this.workspaceRepoFixtureLifecycle;
  }
}

function slugifyTestName(testName: string): string {
  const slug = testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return slug || "case";
}
