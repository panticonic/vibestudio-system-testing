import { isDeepStrictEqual } from "node:util";
import {
  createMissionsClient,
  type MissionRpc,
} from "@vibestudio/service-schemas/clients/missionsClient";
import { bindAutomationLifecycle } from "@workspace-skills/automation-lifecycle-bindings";
import type { PersonalAutomationWorld } from "./open-goal-personal-automation-worlds.js";
import {
  managedAutomationPlanningWorlds,
  managedAutomationWorlds,
} from "./automation-lifecycle-worlds.js";
import type {
  AutomationPlanningRequest,
  AutomationPlanningReview,
  AutomationPlanningSnapshot,
} from "../automations/types.js";

const defaultId = "workspace-updates";
type Missions = ReturnType<typeof createMissionsClient>;
type Mission = NonNullable<Awaited<ReturnType<Missions["get"]>>>;

type OpenAutomationSeedItem = { key: string; record: Mission; suffix: string };

export async function pauseOpenPersonalAutomation(
  rpc: MissionRpc,
  items: readonly OpenAutomationSeedItem[],
) {
  const missions = createMissionsClient(rpc);
  const outcomes = await Promise.allSettled(
    items.map(async ({ record }) => {
      const live = await missions.get(record.missionId);
      if (!live || live.owner.userId !== record.owner.userId || live.charter.trigger.kind !== "manual")
        throw new Error("Owned manual monitor identity changed before cleanup");
      if (live.state === "active")
        await missions.transitionAtRevision(live.missionId, "pause", live.revisionDigest);
      else if (live.state !== "paused")
        throw new Error(`Owned manual monitor has unexpected cleanup state ${live.state}`);
    }),
  );
  const errors = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (errors.length)
    throw new AggregateError(errors, `Could not pause all owned manual monitors (${errors.map(String).join(", ")})`);
}

/** Authority plan creation runs with the installed system-test worker's durable identity. */
export async function seedOpenPersonalAutomation(rpc: MissionRpc, world: PersonalAutomationWorld) {
  const missions = createMissionsClient(rpc);
  const defaultMonitor = await missions.getDefault(defaultId);
  if (!defaultMonitor)
    throw new Error("Workspace update monitor could not be verified");
  const namespace = crypto.randomUUID().slice(0, 12);
  const items: OpenAutomationSeedItem[] = [];
  try {
    for (const spec of world.monitors) {
      const suffix = ` [${namespace}-${spec.key}]`;
      const record = await missions.launch({
        name: spec.name + suffix,
        charter: {
          ...defaultMonitor.charter,
          summary: JSON.stringify({
            team: spec.team,
            needs: spec.needs ?? [],
            permitted: spec.permitted ?? ["pause", "resume"],
          }),
          trigger: { kind: "manual" },
        },
      });
      const item = { key: spec.key, record, suffix };
      items.push(item);
      if (spec.initial === "paused")
        item.record = await missions.transitionAtRevision(record.missionId, "pause", record.revisionDigest);
    }
    return { defaultMonitor, items };
  } catch (error) {
    try {
      await pauseOpenPersonalAutomation(rpc, items);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], `Owned manual monitor setup failed (${error}); cleanup also failed (${cleanup})`);
    }
    throw error;
  }
}

function changedDigest(digest: string) {
  return (digest.startsWith("a") ? "b" : "a") + digest.slice(1);
}

function sameDefinition(expected: Mission, observed: Mission) {
  return (
    expected.missionId === observed.missionId &&
    expected.revisionDigest === observed.revisionDigest &&
    expected.revision === observed.revision &&
    expected.name === observed.name &&
    expected.owner.userId === observed.owner.userId &&
    isDeepStrictEqual(expected.authorityPlan, observed.authorityPlan) &&
    isDeepStrictEqual(expected.charter, observed.charter)
  );
}

function updatedCharter(mission: Mission) {
  return {
    ...mission.charter,
    summary: "Updated review terms for the owned manual-only automation.",
  };
}

function reviewedEdit(expected: Mission, observed: Mission) {
  return (
    observed.revisionDigest !== expected.revisionDigest &&
    observed.revision === expected.revision + 1 &&
    sameDefinition(
      {
        ...expected,
        charter: updatedCharter(expected),
        revision: observed.revision,
        revisionDigest: observed.revisionDigest,
      },
      observed,
    )
  );
}

export async function seedManagedAutomation(
  rpc: MissionRpc,
  caseId: string,
  planning = false,
) {
  const worlds = planning
    ? managedAutomationPlanningWorlds
    : managedAutomationWorlds;
  const world = worlds.find((item) => item.id === caseId);
  if (!world) throw new Error("Unknown managed automation lifecycle world");
  const missions = createMissionsClient(rpc);
  const original = await missions.getDefault(defaultId);
  if (!original || (original.state !== "paused" && original.state !== "active"))
    throw new Error(
      "The caller's provisioned workspace-update monitor is unavailable",
    );
  const created = await missions.launch({
    name: `Lifecycle qualification ${crypto.randomUUID()}`,
    charter: {
      ...original.charter,
      summary: "Owned manual-only automation for verifying scheduling control.",
      trigger: { kind: "manual" },
    },
  });
  const start =
    world.initial === "active"
      ? created
      : await missions.transitionAtRevision(
          created.missionId,
          "pause",
          created.revisionDigest,
        );

  return { world, original, start };
}

type Seed = Awaited<ReturnType<typeof seedManagedAutomation>>;

export async function pauseManagedAutomationFixture(
  rpc: MissionRpc,
  seed: Seed,
) {
  const missions = createMissionsClient(rpc);
  const live = await missions.get(seed.start.missionId);
  if (
    !live ||
    (!sameDefinition(seed.start, live) &&
      !(
        (seed.world.planning === "changed" ||
          seed.world.problem === "revised-before-review" ||
          seed.world.problem === "revision-race" ||
          seed.world.problem === "revision-after-effect") &&
        reviewedEdit(seed.start, live)
      ))
  )
    throw new Error(
      "The test-owned mission changed identity during lifecycle verification",
    );
  if (live.state !== "paused")
    await missions.transitionAtRevision(
      live.missionId,
      "pause",
      live.revisionDigest,
    );
}

export async function prepareManagedAutomation(rpc: MissionRpc, seed: Seed) {
  const { world, original, start } = seed;
  const missions = createMissionsClient(rpc);
  if (world.problem === "revised-before-review")
    await missions.edit(start.missionId, { charter: updatedCharter(start) });
  const request = {
    goal: world.goal,
    missionId:
      world.problem === "missing"
        ? `missing-managed-monitor-${crypto.randomUUID()}`
        : start.missionId,
    revisionDigest:
      world.problem === "stale"
        ? changedDigest(start.revisionDigest)
        : start.revisionDigest,
    action: world.action,
  };
  const controllerCalls: string[] = [];
  const transitionReceipts: Mission[] = [];
  const attempts: string[] = [];
  const observations: string[] = [];
  let staleControllerGuard = false;
  const services = bindAutomationLifecycle(
    {
      get: (id) => missions.get(id),
      async transitionAtRevision(id, action, revision) {
        if (world.problem === "lost-before-effect")
          throw new Error(
            "Controlled interruption before scheduling dispatch.",
          );
        if (world.problem === "revision-race")
          await missions.edit(id, { charter: updatedCharter(start) });
        controllerCalls.push(action);
        let changed: Mission;
        try {
          changed = await missions.transitionAtRevision(id, action, revision);
        } catch (error) {
          staleControllerGuard = Boolean(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "MISSION_REVISION_CHANGED",
          );
          throw error;
        }
        transitionReceipts.push(changed);
        if (world.problem === "lost-ack")
          throw new Error("Controlled interruption after scheduling dispatch.");
        if (world.problem === "revision-after-effect")
          await missions.edit(id, { charter: updatedCharter(start) });
        return changed;
      },
    },
    request,
  );
  const read = services.automationLifecycleRead.observe;
  services.automationLifecycleRead.observe = (id) => {
    observations.push(id);
    return read(id);
  };
  const apply = services.automationLifecycleChange.apply;
  services.automationLifecycleChange.apply = async (id, digest, action) => {
    attempts.push(action);
    if (
      world.problem === "race-already" &&
      attempts.length === 1 &&
      id === request.missionId &&
      digest === request.revisionDigest &&
      action === request.action
    )
      transitionReceipts.push(
        await missions.transitionAtRevision(id, action, digest),
      );
    return apply(id, digest, action);
  };
  return {
    world,
    request,
    start,
    original,
    services,
    missions,
    controllerCalls,
    transitionReceipts,
    attempts,
    observations,
    staleControllerGuard: () => staleControllerGuard,
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedAutomation>>;

export async function verifyManagedAutomation(
  prepared: Prepared,
  value: unknown,
) {
  const { world, request, start, original, missions, controllerCalls } =
    prepared;
  const report = value as {
    missionId: string;
    status: string;
    state: string | null;
    revisionDigest: string | null;
  } | null;
  const current = await missions.get(start.missionId);
  const protectedDefault = await missions.getDefault(defaultId);
  const shouldAttempt =
    world.status === "applied" ||
    world.status === "reconciled" ||
    world.status === "uncertain" ||
    world.problem === "revision-race" ||
    world.problem === "race-already";
  const schedulingChanged =
    world.status === "applied" ||
    world.status === "reconciled" ||
    world.problem === "revision-after-effect" ||
    world.problem === "race-already";
  const definitionChanged =
    world.problem === "revised-before-review" ||
    world.problem === "revision-race" ||
    world.problem === "revision-after-effect";
  const desiredState = world.action === "pause" ? "paused" : "active";
  const expectedState = schedulingChanged ? desiredState : start.state;
  const missing = world.problem === "missing";
  const stateAndReport =
    current?.state === expectedState &&
    report?.missionId === request.missionId &&
    report.status === world.status &&
    report.state === (missing ? null : expectedState) &&
    report.revisionDigest === (missing ? null : current.revisionDigest);
  const checks = {
    exactStateAndReport: stateAndReport,
    defaultMonitorUnchanged:
      protectedDefault !== null &&
      sameDefinition(original, protectedDefault) &&
      original.state === protectedDefault.state,
    exactDefinition:
      current !== null &&
      (definitionChanged
        ? reviewedEdit(start, current)
        : sameDefinition(start, current)),
    revisionGuard:
      world.problem !== "revision-race" || prepared.staleControllerGuard(),
    effectReadback:
      prepared.transitionReceipts.length === (schedulingChanged ? 1 : 0) &&
      prepared.transitionReceipts.every(
        (receipt) =>
          receipt.state === desiredState && sameDefinition(start, receipt),
      ),
    scopedReadback: isDeepStrictEqual(
      prepared.observations,
      shouldAttempt
        ? [request.missionId, request.missionId]
        : [request.missionId],
    ),
    noAutomationRunStarted:
      current !== null &&
      current.runCount === start.runCount &&
      current.lastRunAt === start.lastRunAt &&
      current.nextRunAt === undefined &&
      start.nextRunAt === undefined,
    assignedTransition:
      isDeepStrictEqual(
        controllerCalls,
        shouldAttempt &&
          world.problem !== "lost-before-effect" &&
          world.problem !== "race-already"
          ? [world.action]
          : [],
      ) &&
      isDeepStrictEqual(prepared.attempts, shouldAttempt ? [world.action] : []),
    missingStaysMissing:
      world.problem !== "missing" ||
      (await missions.get(request.missionId)) === null,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    caseId: world.id,
    expectedStatus: world.status,
    problem: world.problem ?? null,
    assignedId: request.missionId,
    expectedRevision: request.revisionDigest,
    observedRevision: current?.revisionDigest ?? null,
    reportedRevision: report?.revisionDigest ?? null,
    reportedState: report?.state ?? null,
    initialState: start.state,
    afterState: current?.state ?? null,
  };
}

export async function qualifyManagedAutomation(rpc: MissionRpc, seed: Seed) {
  const prepared = await prepareManagedAutomation(rpc, seed);
  const { request, world, services, missions, start } = prepared;
  let staleControllerGuard = false;
  if (world.problem === "stale") {
    try {
      await missions.transitionAtRevision(
        start.missionId,
        request.action,
        request.revisionDigest,
      );
    } catch (error) {
      staleControllerGuard = Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "MISSION_REVISION_CHANGED",
      );
    }
  }
  const before = await services.automationLifecycleRead.observe(
    request.missionId,
  );
  const desired = request.action === "pause" ? "paused" : "active";
  const allowed =
    before?.revisionDigest === request.revisionDigest &&
    (before.state === "active" || before.state === "paused");
  const receipt =
    allowed && before.state !== desired
      ? await services.automationLifecycleChange.apply(
          request.missionId,
          request.revisionDigest,
          request.action,
        )
      : null;
  const after = receipt
    ? await services.automationLifecycleRead.observe(request.missionId)
    : before;
  const verified =
    after?.revisionDigest === request.revisionDigest && after.state === desired;
  const status =
    !allowed || receipt === "blocked"
      ? "held"
      : !receipt
        ? "unchanged"
        : !verified
          ? "uncertain"
          : receipt === "acknowledged"
            ? "applied"
            : receipt === "already"
              ? "unchanged"
              : "reconciled";
  const verification = await verifyManagedAutomation(prepared, {
    missionId: request.missionId,
    status,
    state: after?.state ?? null,
    revisionDigest: after?.revisionDigest ?? null,
  });
  return { verification, staleControllerGuard };
}

export async function prepareManagedAutomationPlanning(
  rpc: MissionRpc,
  seed: Seed,
) {
  const { world, original, start } = seed;
  const planningStatus = world.planning;
  if (!planningStatus) throw new Error("Unknown automation planning assignment");
  const status = planningStatus;
  const missions = createMissionsClient(rpc);
  const request: AutomationPlanningRequest = {
    goal: `${world.goal} The assigned mission is ${start.name}.`,
    operationId: crypto.randomUUID(),
    timezone: "UTC",
    now: new Date().toISOString(),
  };
  const observations: AutomationPlanningSnapshot[] = [];
  let reading = false;
  async function readPlanningState(): Promise<AutomationPlanningSnapshot> {
    const current = await missions.get(start.missionId);
    if (!current || (current.state !== "active" && current.state !== "paused"))
      throw new Error("The assigned manual mission is unavailable");
    const history = await missions.listRuns(current.missionId, { limit: 1 });
    if (history.items.length || history.nextCursor)
      throw new Error("The assigned manual mission unexpectedly started a run");
    return {
      visible: [
        {
          id: current.missionId,
          name: current.name,
          state: current.state,
          revisionDigest: current.revisionDigest,
          latestRun: null,
        },
      ],
    };
  }
  const services = {
    automationPlanning: {
      async inspect(operationId: string) {
        if (
          operationId !== request.operationId ||
          reading
        )
          throw new Error(
            "The read is outside the assigned automation planning window",
          );
        reading = true;
        try {
          const observation = await readPlanningState();
          if (status === "changed" && observations.length === 0)
            await missions.edit(start.missionId, {
              charter: updatedCharter(start),
            });
          observations.push(structuredClone(observation));
          return observation;
        } finally {
          reading = false;
        }
      },
    },
  };
  const expectedPlan = {
    kind: "control",
    automationId: start.missionId,
    action: world.action,
  } as const;
  async function verify(report: AutomationPlanningReview | null) {
    const current = await missions.get(start.missionId);
    const actual = await readPlanningState();
    const protectedDefault = await missions.getDefault(defaultId);
    const before = observations[0], after = observations.at(-1);
    const checks = {
      assignedPlan:
        report?.status === status &&
        isDeepStrictEqual(report?.plan, expectedPlan),
      snapshotReadback:
        observations.length >= 2 &&
        before?.visible[0]?.revisionDigest === start.revisionDigest &&
        isDeepStrictEqual(before, report?.before) &&
        isDeepStrictEqual(after, report?.after) &&
        isDeepStrictEqual(after, actual),
      exactDefinition:
        current !== null &&
        (status === "changed"
          ? reviewedEdit(start, current)
          : sameDefinition(start, current)),
      schedulingUntouched:
        current !== null &&
        current.state === start.state &&
        current.runCount === start.runCount &&
        current.lastRunAt === start.lastRunAt &&
        current.nextRunAt === start.nextRunAt,
      protectedDefault:
        protectedDefault !== null &&
        sameDefinition(original, protectedDefault) &&
        original.state === protectedDefault.state,
    };
    return {
      caseId: world.id,
      request,
      expectedPlan,
      expectedStatus: status,
      before,
      after,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }
  async function qualify() {
    const before = await services.automationPlanning.inspect(
      request.operationId,
    );
    const after = await services.automationPlanning.inspect(
      request.operationId,
    );
    return verify({ status, plan: expectedPlan, before, after });
  }

  return { request, services, verify, qualify };
}
