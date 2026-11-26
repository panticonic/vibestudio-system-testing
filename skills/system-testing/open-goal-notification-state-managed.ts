import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import type { WorkspaceRuntime } from "@workspace/runtime/hosted";
import {
  notificationStateFixtureMethods as actor,
  type FixtureLane,
} from "@workspace-workers/notification-state-fixture/contract";
import type {
  NotificationStateWorld,
  NotificationSeed,
} from "./open-goal-notification-state-worlds.js";

type Runtime = WorkspaceRuntime["runtime"];
type Ports = {
  contextId: string | null;
  runtime: Pick<Runtime, "createEntity" | "retireEntity">;
  rpc: WorkspaceRuntime["rpc"];
};
type Journal = { method: string; args: unknown[]; result: unknown };

function expectedStore(
  world: NotificationStateWorld,
  lanes: { assigned: FixtureLane; neighbor: FixtureLane },
) {
  function row(seed: NotificationSeed) {
    const owner = lanes[seed.account ?? "assigned"].id;
    const createdAt = seed.at ?? 10;
    return {
      owner,
      id: seed.id,
      title: seed.title,
      kind: seed.kind ?? "work.notice",
      revision: seed.revision ?? 1,
      createdAt,
      acknowledgedAt: seed.read ? createdAt + 100 : null,
      data: seed.channel ? { channelId: seed.channel } : null,
    };
  }
  const rows = world.initial.map(row);
  const change = world.change;
  if (change && "remove" in change && world.expected.receipt === "removed") {
    const index = rows.findIndex(
      (entry) =>
        entry.id === change.remove &&
        entry.owner === lanes[change.account ?? "assigned"].id,
    );
    rows.splice(index, 1);
  }
  if (change && "put" in change && world.expected.receipt === "applied") {
    const incoming = row(change.put);
    const index = rows.findIndex(
      (entry) => entry.id === incoming.id && entry.owner === incoming.owner,
    );
    if (index === -1) rows.push(incoming);
    else rows[index] = incoming;
  }
  if (world.expected.action === "acknowledge") {
    const target = rows.find(
      (entry) =>
        entry.id === world.expected.target?.[0] &&
        entry.owner === lanes.assigned.id,
    );
    if (target) target.acknowledgedAt = 10_000;
  }
  return rows.sort((a, b) =>
    a.owner < b.owner
      ? -1
      : a.owner > b.owner
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
}

export async function prepareOpenNotificationState(
  input: { contextId: string; caseId: string },
  world: NotificationStateWorld,
  ports: Ports,
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) {
    throw new Error(
      "Notification lifecycle needs its exact owned test context",
    );
  }
  const { rpc, runtime } = ports;
  const key = `notification-state-${crypto.randomUUID()}`;
  const handle = await runtime.createEntity({
    kind: "do",
    execution: {
      surface: "code",
      source: "workers/notification-state-fixture",
    },
    className: "NotificationStateFixtureDO",
    key,
    contextId: input.contextId,
  });
  const close = () => runtime.retireEntity({ id: handle.id });
  if (handle.kind !== "do" || handle.contextId !== input.contextId) {
    await close();
    throw new Error(
      "Created notification store does not belong to the assigned test context",
    );
  }
  const target = handle.targetId;
  const lanes = await rpc
    .call(target, actor.configure, [
      {
        desk: world.desk,
        initial: world.initial,
        change: world.change,
        transition: world.transition,
      },
    ])
    .catch(async (cause: unknown) => {
      await close();
      throw cause;
    });
  const journal: Journal[] = [];
  const log = <T>(method: string, args: unknown[], result: T): T => {
    journal.push({
      method,
      args: structuredClone(args),
      result: structuredClone(result),
    });
    return result;
  };
  function requireAssigned(lane: FixtureLane) {
    if (lane?.id !== lanes.assigned.id || lane.label !== lanes.assigned.label) {
      throw new Error("Notification request is outside the assigned lane");
    }
  }
  const service = {
    async discover() {
      return log("discover", [], [lanes.assigned, lanes.neighbor]);
    },
    async read(lane: FixtureLane) {
      requireAssigned(lane);
      return log("read", [lane], await rpc.call(target, actor.read, [lane]));
    },
    async refresh(lane: FixtureLane) {
      requireAssigned(lane);
      return log(
        "refresh",
        [lane],
        await rpc.call(target, actor.refresh, [lane]),
      );
    },
    async acknowledge(lane: FixtureLane, id: string, revision: number) {
      requireAssigned(lane);
      return log(
        "acknowledge",
        [lane, id, revision],
        await rpc.call(target, actor.acknowledge, [lane, id, revision]),
      );
    },
  };
  type Snapshot = Awaited<ReturnType<typeof service.read>>;
  type Refresh = Awaited<ReturnType<typeof service.refresh>>;
  type Ack = Awaited<ReturnType<typeof service.acknowledge>>;
  const assess=bindObservedContentReview(["journal","assigned","initial","refresh","current","ack","final","durable"]);
  async function verify(report:unknown,observations?:InvocationObservations){
    const proof=await verifyNativeApplication(report);
    const assessed=await assess(proof,proof.outcomeContract,report,observations);
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
  async function verifyNativeApplication(report:unknown){
    const result=report as {explanation?:unknown;acknowledgment?:unknown}|null;
    const raw = await rpc.call(target, actor.audit, []);
    const ownsFinal = raw.active?.id === lanes.assigned.id;
    const final =
      ownsFinal && raw.active
        ? await rpc.call(target, actor.read, [raw.active])
        : null;
    const refreshIndex=journal.findIndex(row=>row.method==="refresh");
    const initial = journal.slice(0,refreshIndex<0?0:refreshIndex).find(row=>row.method==="read")?.result as Snapshot|undefined;
    const refresh = journal.find((row) => row.method === "refresh")?.result as
      | Refresh
      | undefined;
    const current = refreshIndex<0?undefined:journal.slice(refreshIndex+1).find(row=>row.method==="read")?.result as Snapshot|undefined;
    const ack = journal.find((row) => row.method === "acknowledge")?.result as
      | Ack
      | undefined;
    const expected = world.expected;
    const checks = {
      exactNotificationReadScope:
        journal.every(row=>row.method==="discover" ||
          isDeepStrictEqual(row.args[0],lanes.assigned) ||
          refresh?.lane?.id===lanes.assigned.id && isDeepStrictEqual(row.args[0],refresh.lane)) &&
        (initial===undefined || isDeepStrictEqual(initial.attention.map(row=>row.id),expected.before)),
      verifiedNotificationRefresh:
        raw.refreshCommits===1 &&
        refresh?.producerReceipt === expected.receipt &&
        refresh.discardedPriorRead === true && refresh.authority ===
          (world.transition === "retire"
            ? "retired"
            : world.transition
              ? "changed"
              : "unchanged") &&
        isDeepStrictEqual(refresh.lane, ownsFinal ? raw.active : null),
      requestedNotificationAnswer:!world.requestedAnswer ||
        typeof result?.explanation==="string" && result.explanation.trim().length>0,
      independentNotificationReadback:
        isDeepStrictEqual(
          final?.attention.map((row) => row.id) ?? null,
          expected.attention,
        ) &&
        isDeepStrictEqual(
          final?.retained.map((row) => row.id) ?? null,
          expected.retained,
        ) &&
        final?.unreadCount === (expected.attention?.length ?? undefined) &&
        final?.retainedCount === (expected.retained?.length ?? undefined) &&
        isDeepStrictEqual(raw.rows, expectedStore(world, lanes)),
    };
    return {
      outcomeContract: {
        effects: {checks:["exactNotificationReadScope", "verifiedNotificationRefresh", "independentNotificationReadback"],rationale:"Actual retained rows, refresh ownership, acknowledgment and native counts establish the action."},
        returnedValue: {checks:["requestedNotificationAnswer"],required:world.requestedAnswer,rationale:"Only an explicitly requested answer or confirmation is required; native acknowledgment evidence is independent."},
        incidentalValues: {checks:[],rationale:"Internal finding classifications and receipt echoes do not define goal completion."},
      },
      incorrectReturnValues:[],
      contextId: input.contextId,
      caseId: world.id,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      journal: structuredClone(journal),
      assigned: lanes.assigned,
      initial,
      refresh,
      current: current ?? null,
      ack: ack ?? null,
      final,
      durable: raw,
    };
  }

  async function qualify() {
    const found = await service.discover();
    let rejectedForeignLane = false;
    try {
      await service.read(found[1]!);
    } catch {
      rejectedForeignLane = true;
    }
    await service.read(lanes.assigned);
    const refresh = await service.refresh(lanes.assigned);
    const current = refresh.lane ? await service.read(refresh.lane) : null;
    const [id, revision] = world.expected.target ?? [null, null];
    const decision = {
      action: world.expected.action,
      reason: "Exact retained notification and current authorized projection.",
      finding: { state: world.expected.state, id, revision },
    };
    const rejectStale = await rpc.call(target, actor.acknowledge, [
      lanes.assigned,
      id ?? "absent",
      0,
    ]);
    let acknowledgement = null;
    if (decision.action === "acknowledge" && current && id && revision) {
      acknowledgement = await service.acknowledge(current.lane, id, revision);
      await service.read(current.lane);
    }
    const report = {finding:decision.finding,explanation:decision.reason,acknowledgment:acknowledgement};
    const proof = await verify(report);
    const rejectedWrongOutput = world.requestedAnswer ?
      !(await verify({...report,explanation:""})).outcomeDimensions.returnedValue.passed : true;
    const checks = {
      ...proof.checks,
      rejectedForeignLane,
      rejectedStaleAck:
        rejectStale.status === "stale" || rejectStale.status === "unavailable",
      rejectedWrongOutput,
    };
    return assessNativeQualification({
      ...proof,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedForeignLane","rejectedStaleAck","rejectedWrongOutput"]}},
      checks,
      passed: Object.values(checks).every(Boolean),
      report,
    });
  }

  return { services: { notificationState: service }, verify, qualify, close };
}
