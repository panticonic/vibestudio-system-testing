import { HeadlessSession } from "@workspace/agentic-session";
import type { RpcClient } from "@vibestudio/rpc";
import type { ResidentSessionRegistrar } from "@vibestudio/shared/residentSession";
import type { TestExecutionResult } from "./types.js";
import { systemTestFailure } from "./structured-error.js";
import { withRpcAbortSignal } from "@vibestudio/rpc";
import { hydrateStoredValueRefs, type AgenticEvent } from "@workspace/agentic-protocol";
import { iterateChannelReplayAfterPages } from "@workspace/pubsub";
import { createMissionsClient } from "@vibestudio/service-schemas/clients/missionsClient";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { MissionRecord } from "@vibestudio/automation/mission";
import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import { resolveDurableObjectService } from "@vibestudio/service-schemas/clients/durableObjectServiceClient";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { contextIdForTargetKey } from "@vibestudio/shared/runtime/contextIdentity";

interface ForkAgentRpc {
  getAgentSettings(): Promise<{ model?: unknown }>;
  canFork(channelId: string): Promise<{ ok: boolean; reason?: string }>;
}
const forkAgentMethods = createReceiverRpcMethods<ForkAgentRpc>([
  "getAgentSettings",
  "canFork",
]);

export interface AgentCellForkProbe {
  operationId: string;
  forkedContextId: string;
  forkedChannelId: string;
  clonedAgentTargetId: string;
  clonedAgentCount: number;
  sourceSequence: number;
  forkSequence: number;
  adopted: boolean;
  modelPreserved: boolean;
  elapsedMs: number;
}

interface CompactionState {
  head: string;
  lastCollectedHead: string | null;
  observedCommitsAtLastCollection: number | null;
  logLimit: number;
}
interface StorageSample {
  engine: "dolt";
  compaction: CompactionState;
}
export interface AgentCellCompactionProbe {
  turns: number;
  validatedTurns: number;
  executorId: string;
  channelId: string;
  contextId: string;
  missionId: string;
  firstInvocationId: string;
  lastInvocationId: string;
  nativeReceiptDigest: string;
  firstStorage: StorageSample;
  lastStorage: StorageSample;
  modelCalls: number;
  elapsedMs: number;
  meanTurnMs: number;
  p95TurnMs: number;
  fork?: AgentCellForkProbe;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function storageSample(value: unknown): StorageSample {
  if (
    !object(value) ||
    value["engine"] !== "dolt" ||
    !object(value["compaction"])
  )
    throw new Error("The actual agent did not report Dolt compaction state");
  const state = value["compaction"];
  if (
    typeof state["head"] !== "string" ||
    !(
      state["lastCollectedHead"] === null ||
      typeof state["lastCollectedHead"] === "string"
    ) ||
    !(
      state["observedCommitsAtLastCollection"] === null ||
      typeof state["observedCommitsAtLastCollection"] === "number"
    ) ||
    typeof state["logLimit"] !== "number"
  )
    throw new Error("Agent compaction observation has an invalid shape");
  return {
    engine: "dolt",
    compaction: {
      head: state["head"],
      lastCollectedHead: state["lastCollectedHead"],
      observedCommitsAtLastCollection: state["observedCommitsAtLastCollection"],
      logLimit: state["logLimit"],
    },
  };
}

/** Read the mission's exact invocation result from durable channel replay. */
export async function readNativeTurnReceipt(
  rpc: Pick<RpcClient, "call">,
  input: {
    channelTarget: string;
    channelId: string;
    executorId: string;
    runId: string;
    turn: number;
    after: number;
  },
) {
  let after = input.after;
  let invocationId: string | undefined;
  let completion: AgenticEvent<"invocation.completed"> | undefined;
  const callId = `automation:${input.runId}:eval`;
  for await (const page of iterateChannelReplayAfterPages(
    (request) => rpc.call(input.channelTarget, channelRpcMethods.getReplayAfter, [request]),
    { after, limit: 32 },
  )) {
    for (const row of page.logEvents) {
      after = row.id;
      const event = row.payload as AgenticEvent | undefined;
      if (event?.kind === "invocation.started") {
        const payload = event.payload as AgenticEvent<"invocation.started">["payload"];
        if (!("nativeSource" in payload)) continue;
        const { nativeSource: native, name } = payload;
        if (native?.operation.kind !== "direct-tool" || native.operation.callId !== callId)
          continue;
        if (invocationId || native.owner.runtimeId !== input.executorId ||
            native.owner.channelId !== input.channelId || name !== "eval" ||
            !event.causality?.invocationId)
          throw new Error(`Native turn ${input.turn} has a duplicate or foreign invocation`);
        invocationId = event.causality.invocationId;
      }
      if (event?.kind === "invocation.completed" && invocationId &&
          event.causality?.invocationId === invocationId) {
        if (completion) throw new Error(`Native turn ${input.turn} has duplicate completion events`);
        completion = event as AgenticEvent<"invocation.completed">;
      }
    }
  }
  if (!invocationId || !completion)
    throw new Error(`Native turn ${input.turn} has no exact durable completion for ${input.runId}`);
  const result = await hydrateStoredValueRefs(completion.payload.result, {
    getText: (digest) => rpc.call("main", mainRpcMethods["blobstore.getText"], [digest]),
  }, { strict: true });
  const details = object(result) ? result["details"] : null;
  const value = object(details) ? details["returnValue"] : null;
  if (!object(value) || value["marker"] !== "P4_NATIVE_TURN" || value["turn"] !== input.turn)
    throw new Error(`Native turn ${input.turn} has an invalid return value`);
  return { after, invocationId, value };
}

/** The caller owns the headless session. This operation owns and retires its manual mission. */
export async function probeAgentCellCompaction(
  session: HeadlessSession,
  options: { rpc: RpcClient; turns: number; signal: AbortSignal },
): Promise<AgentCellCompactionProbe> {
  const { rpc, turns, signal } = options;
  if (!Number.isSafeInteger(turns) || turns < 65)
    throw new Error("The compaction workload must cross 64 closed turns");
  const wire = withRpcAbortSignal(rpc, signal);
  const missions = createMissionsClient(wire);
  const cleanupMissions = createMissionsClient(rpc);
  let mission: MissionRecord | undefined;
  const failures: unknown[] = [];
  const missionName = `P4 compaction ${crypto.randomUUID()}`;
  let launchAttempted = false;
  let result: AgentCellCompactionProbe | undefined;
  try {
    const identity = session.snapshot();
    const {
      channelId,
      agentContextId: contextId,
      agentTargetId: executorId,
    } = identity;
    if (!channelId || !contextId || !executorId || !identity.agentEntityId)
      throw new Error("The headless session has no exact agent identity");
    const entities = await wire.call(
      "main",
      mainRpcMethods["runtime.listEntities"],
      [{ kind: "do" }],
    );
    const entity = entities.find(
      (candidate) => candidate.id === identity.agentEntityId,
    );
    if (
      !entity ||
      entity.source !== "workers/agent-worker" ||
      entity.contextId !== contextId
    )
      throw new Error("The soak target is not the exact owned chat agent");
    const built = await wire.call("main", mainRpcMethods["build.getBuild"], [
      entity.source,
      `ctx:${contextId}`,
    ]);
    if (!("sourceStateHash" in built) || !("metadata" in built))
      throw new Error(
        `The agent source build failed: ${JSON.stringify(built)}`,
      );
    const sourceRef = built.sourceStateHash;
    if (
      typeof sourceRef !== "string" ||
      !/^state:[0-9a-f]{64}$/u.test(sourceRef)
    )
      throw new Error("The agent build has no exact immutable source state");
    const channel = await resolveDurableObjectService(wire, "vibestudio.channel.v1", channelId);
    if (channel.kind !== "durable-object")
      throw new Error("The compaction channel did not resolve to a Durable Object");
    const replay = await wire.call(channel.targetId, channelRpcMethods.getReplayAfter, [{ after: 0, limit: 1 }]);
    let after = replay.ready.snapshotLastSeq ?? 0;
    const code = `scope.__p4Turn = (scope.__p4Turn ?? 0) + 1; return { marker: "P4_NATIVE_TURN", turn: scope.__p4Turn, storage: (scope.__p4Turn === 1 || scope.__p4Turn === ${turns}) ? (await agent.describe()).storage : null };`;
    launchAttempted = true;
    mission = await missions.launch({
      name: missionName,
      charter: {
        summary: "Model-free native turns in a disposable headless agent",
        trigger: { kind: "manual" },
        execution: {
          kind: "agent",
          image: {
            source: entity.source,
            ref: sourceRef as `state:${string}`,
            effectiveVersion: built.metadata.ev,
            className: "AiChatWorker",
            objectKey: entity.key,
          },
          action: { kind: "eval", code },
          conversation: { mode: "continue", channelId, contextId, executorId },
          operations: [],
        },
      },
    });
    const seen = new Set<string>();
    const durations: number[] = [];
    let firstStorage: StorageSample | undefined;
    let lastStorage: StorageSample | undefined;
    let firstInvocationId = "";
    let lastInvocationId = "";
    let digest = "";
    const startedAt = Date.now();
    for (let n = 1; n <= turns; n++) {
      signal.throwIfAborted();
      const turnStartedAt = Date.now();
      let { version } = await missions.observeChanges({ signal });
      const admitted = await missions.runNow(mission.missionId);
      for (;;) {
        const run = await missions.getRun(admitted.runId);
        if (!run) throw new Error("An admitted automation run disappeared");
        if (run.phase === "terminal") {
          if (run.outcome !== "succeeded")
            throw new Error(`Native turn ${n} failed: ${JSON.stringify(run)}`);
          break;
        }
        ({ version } = await missions.observeChanges({
          afterVersion: version,
          signal,
        }));
      }
      // Mission settlement and delivery of its transcript are owned by
      // different cells. Join the matching channel receipt before reading
      // its durable replay window.
      const delivered = await session.waitUntil(() =>
        session.messages.findLast(({ invocation }) => {
          if (!invocation) return false;
          const native = invocation.nativeSource;
          const status = invocation.execution.status;
          return native?.owner.runtimeId === executorId &&
            native.owner.channelId === channelId &&
            native.operation.kind === "direct-tool" &&
            native.operation.callId === `automation:${admitted.runId}:eval` &&
            status !== "pending" && status !== "running";
        })?.invocation, { signal });
      const receipt = await readNativeTurnReceipt(wire, {
        after, channelTarget: channel.targetId, channelId, executorId, runId: admitted.runId, turn: n,
      });
      if (receipt.invocationId !== delivered.id)
        throw new Error(`Native turn ${n} replay did not match its delivered invocation`);
      after = receipt.after;
      const { invocationId, value } = receipt;
      if (seen.has(invocationId))
        throw new Error(`Native turn ${n} repeated a previous invocation`);
      seen.add(invocationId);
      if (n === 1) {
        firstStorage = storageSample(value["storage"]);
        firstInvocationId = invocationId;
      }
      if (n === turns) lastStorage = storageSample(value["storage"]);
      lastInvocationId = invocationId;
      digest = sha256HexSyncText(
        `${digest}\n${admitted.runId}\n${invocationId}\n${n}`,
      );
      durations.push(Date.now() - turnStartedAt);
      if (n === 1 || n % 64 === 0 || n === turns) {
        console.info(
          "[system-test:native-turns]",
          JSON.stringify({
            validatedTurns: n,
            turns,
            executorId,
            channelId,
            elapsedMs: Date.now() - startedAt,
            nativeReceiptDigest: digest,
            lastInvocationId,
          }),
        );
      }
      if (n === 64) {
        // A controlled idle interval in the workload exercises the production idle collection hook.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    if (!firstStorage || !lastStorage || seen.size !== turns)
      throw new Error("Missing exact native soak results");
    const evidence = await session.captureModelExecutionEvidence({ signal });
    if (!object(evidence) || evidence["totalCalls"] !== 0)
      throw new Error(
        "The model-free workload did not retain proof of zero model calls",
      );
    const sorted = [...durations].sort((a, b) => a - b);
    result = {
      turns,
      validatedTurns: seen.size,
      executorId,
      channelId,
      contextId,
      missionId: mission.missionId,
      firstInvocationId,
      lastInvocationId,
      nativeReceiptDigest: digest,
      firstStorage,
      lastStorage,
      modelCalls: 0,
      elapsedMs: Date.now() - startedAt,
      meanTurnMs: durations.reduce((sum, n) => sum + n, 0) / durations.length,
      p95TurnMs: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    };
  } catch (error) {
    failures.push(error);
  }
  try {
    // Cancellation can settle after launch committed but before its reply was consumed.
    // Recover only this operation's unique owned name; do not create or retry a mission.
    if (!mission && launchAttempted) {
      const matches = (await cleanupMissions.list()).filter(
        (candidate) => candidate.name === missionName,
      );
      if (matches.length > 1)
        throw new Error("The owned soak mission name is ambiguous");
      mission = matches[0];
    }
    if (mission) await cleanupMissions.retire(mission.missionId);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "Agent soak and manual mission retirement failed",
    );
  if (!result) throw new Error("Agent soak has no joined result");
  return result;
}

/** Measure the ordinary channel fork, then retire only its deterministic owned context. */
async function measureAgentCellFork(
  rpc: RpcClient,
  signal: AbortSignal,
  source: AgentCellCompactionProbe,
): Promise<AgentCellForkProbe> {
  const wire = withRpcAbortSignal(rpc, signal);
  const operationId = `system-test-native-fork-${crypto.randomUUID()}`;
  const expectedContextId = contextIdForTargetKey(`fork:${operationId}`);
  const existing = await wire.call(
    "main",
    mainRpcMethods["runtime.listContexts"],
    [{ prefix: expectedContextId }],
  );
  if (existing.contexts.includes(expectedContextId))
    throw new Error("The owned fork context already exists");
  const channel = await resolveDurableObjectService(
    wire,
    "vibestudio.channel.v1",
    source.channelId,
  );
  if (channel.kind !== "durable-object")
    throw new Error("The source channel did not resolve to a Durable Object");
  const before = await wire.call(
    channel.targetId,
    channelRpcMethods.getReplayAfter,
    [{ after: 0, limit: 1 }],
  );
  const sourceSequence = before.ready.snapshotLastSeq;
  if (
    typeof sourceSequence !== "number" ||
    !Number.isSafeInteger(sourceSequence)
  )
    throw new Error("The source replay omitted its bounded snapshot head");
  const failures: unknown[] = [];
  let result: AgentCellForkProbe | undefined;
  let attempted = false;
  try {
    attempted = true;
    const startedAt = Date.now();
    const forked = await wire.call(channel.targetId, channelRpcMethods.fork, [
      {
        operationId,
        locus: { kind: "head" },
        reason: "Measure a fork after actual native turns",
        label: "Native turn fork",
      },
    ]);
    const elapsedMs = Date.now() - startedAt;
    if (
      forked.forkedContextId !== expectedContextId ||
      forked.clonedAgents.length !== 1
    )
      throw new Error(
        "The normal fork did not return its one expected cloned agent",
      );
    const cloned = forked.clonedAgents[0]!;
    const clonedAgentTargetId = `do:${cloned.source}:${cloned.className}:${cloned.objectKey}`;
    if (clonedAgentTargetId === source.executorId)
      throw new Error("The fork returned the source agent");
    const [originalResult, copyResult, adoptionResult] =
      await Promise.allSettled([
        wire.call(source.executorId, forkAgentMethods.getAgentSettings, []),
        wire.call(clonedAgentTargetId, forkAgentMethods.getAgentSettings, []),
        wire.call(clonedAgentTargetId, forkAgentMethods.canFork, [
          forked.forkedChannelId,
        ]),
      ]);
    if (
      originalResult.status !== "fulfilled" ||
      copyResult.status !== "fulfilled" ||
      adoptionResult.status !== "fulfilled"
    ) {
      const rejected = [originalResult, copyResult, adoptionResult].filter(
        (entry) => entry.status === "rejected",
      );
      throw new AggregateError(
        rejected.map((entry) => entry.reason),
        "Fork verification failed",
      );
    }
    const original = originalResult.value,
      copy = copyResult.value,
      adopted = adoptionResult.value;
    const forkChannel = await resolveDurableObjectService(
      wire,
      "vibestudio.channel.v1",
      forked.forkedChannelId,
    );
    if (forkChannel.kind !== "durable-object")
      throw new Error("The fork channel did not resolve to a Durable Object");
    const after = await wire.call(
      forkChannel.targetId,
      channelRpcMethods.getReplayAfter,
      [{ after: 0, limit: 1 }],
    );
    const forkSequence = after.ready.snapshotLastSeq;
    if (typeof forkSequence !== "number" || !Number.isSafeInteger(forkSequence))
      throw new Error("The fork replay omitted its bounded snapshot head");
    result = {
      operationId,
      forkedContextId: forked.forkedContextId,
      forkedChannelId: forked.forkedChannelId,
      clonedAgentTargetId,
      clonedAgentCount: forked.clonedAgents.length,
      sourceSequence,
      forkSequence,
      adopted: adopted.ok,
      modelPreserved:
        JSON.stringify(original.model) === JSON.stringify(copy.model),
      elapsedMs,
    };
    if (
      !result.adopted ||
      !result.modelPreserved ||
      result.forkSequence < result.sourceSequence
    )
      throw new Error(
        "The fork did not preserve its source history, model and agent adoption",
      );
    // Retain verified measurements even when the subsequent owned teardown fails.
    source.fork = result;
  } catch (cause) {
    failures.push(cause);
  }
  if (attempted) {
    try {
      // The normal clone key identifies ownership even when its reply was lost.
      // A lineage edge is not included in the source session's recursive teardown.
      const contexts = await rpc.call(
        "main",
        mainRpcMethods["runtime.listContexts"],
        [{ prefix: expectedContextId }],
      );
      if (contexts.contexts.includes(expectedContextId))
        await rpc.call("main", mainRpcMethods["runtime.destroyContext"], [
          { contextId: expectedContextId, recursive: true },
        ]);
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(
      failures,
      "Native fork and its owned context retirement failed",
    );
  if (!result) throw new Error("The normal fork returned no evidence");
  return result;
}

/** Durable worker entry: this owner creates and joins the entire native workload. */
export async function runAgentCellCompaction(
  rpc: RpcClient & ResidentSessionRegistrar,
  signal: AbortSignal,
  turns = 65,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await HeadlessSession.createWithAgent({
    config: { clientId: rpc.selfId, rpc },
    rpcCall: rpc.call,
    source: "workers/agent-worker",
    className: "AiChatWorker",
  });
  let probe: AgentCellCompactionProbe | undefined;
  let failure;
  try {
    probe = await probeAgentCellCompaction(session, { rpc, turns, signal });
    probe.fork = await measureAgentCellFork(rpc, signal, probe);
  } catch (cause) {
    failure = systemTestFailure(
      probe ? "agent-cell-fork" : "agent-cell-compaction",
      cause,
    );
  }
  const snapshot = session.snapshot();
  // Return a bounded diagnostic tail; the receipt chain covers every joined turn.
  snapshot.messages = snapshot.messages.slice(-16);
  snapshot.invocations = snapshot.invocations.slice(-8);
  snapshot.tasks = snapshot.tasks.slice(-8);
  const execution: TestExecutionResult = {
    messages: [...snapshot.messages],
    duration: Date.now() - startedAt,
    snapshot,
    diagnostics: { ...(probe ? { agentCellCompaction: probe } : {}) },
    ...(failure ? { error: failure.error.message, failure } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [String(cause)];
    execution.cleanupFailures = [
      systemTestFailure("agent-cell-compaction-close", cause),
    ];
  }
  return execution;
}
