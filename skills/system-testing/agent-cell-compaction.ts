import { HeadlessSession } from "@workspace/agentic-session";
import type { RpcClient } from "@vibestudio/rpc";
import type { ResidentSessionRegistrar } from "@vibestudio/shared/residentSession";
import type { TestExecutionResult } from "./types.js";
import { systemTestFailure } from "./structured-error.js";
import { withRpcAbortSignal } from "@vibestudio/rpc";
import { createMissionsClient } from "@vibestudio/service-schemas/clients/missionsClient";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { MissionRecord } from "@vibestudio/automation/mission";

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
      const invocation = await session.waitUntil(
        () =>
          session
            .snapshot()
            .invocations.slice(-12)
            .find((candidate) => {
              if (
                candidate.name !== "eval" ||
                candidate.status !== "complete" ||
                !object(candidate.result)
              )
                return false;
              const details = candidate.result["details"];
              return (
                object(details) &&
                object(details["returnValue"]) &&
                details["returnValue"]["turn"] === n
              );
            }),
        { signal },
      );
      if (
        seen.has(invocation.id) ||
        invocation.nativeSource?.owner.runtimeId !== executorId
      )
        throw new Error(
          "The native result has a duplicate or foreign invocation identity",
        );
      seen.add(invocation.id);
      const details = (invocation.result as Record<string, unknown>)[
        "details"
      ] as Record<string, unknown>;
      const value = details["returnValue"] as Record<string, unknown>;
      if (value["marker"] !== "P4_NATIVE_TURN")
        throw new Error("The actual eval lost its marker");
      if (n === 1) {
        firstStorage = storageSample(value["storage"]);
        firstInvocationId = invocation.id;
      }
      if (n === turns) lastStorage = storageSample(value["storage"]);
      lastInvocationId = invocation.id;
      digest = sha256HexSyncText(
        `${digest}\n${admitted.runId}\n${invocation.id}\n${n}`,
      );
      durations.push(Date.now() - turnStartedAt);
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

/** Durable worker entry: this owner creates and joins the entire native workload. */
export async function runAgentCellCompaction(
  rpc: RpcClient & ResidentSessionRegistrar,
  signal: AbortSignal,
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
    probe = await probeAgentCellCompaction(session, { rpc, turns: 65, signal });
  } catch (cause) {
    failure = systemTestFailure("agent-cell-compaction", cause);
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
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
