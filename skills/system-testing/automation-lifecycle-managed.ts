import { isDeepStrictEqual } from "node:util";
import {
  createMissionsClient,
  type MissionRpc,
} from "@vibestudio/service-schemas/clients/missionsClient";
import { bindAutomationLifecycle } from "@workspace-skills/automation-lifecycle-bindings";
import { managedAutomationWorlds } from "./automation-lifecycle-worlds.js";

const defaultId = "workspace-updates";
type Missions = ReturnType<typeof createMissionsClient>;
type Mission = NonNullable<Awaited<ReturnType<Missions["get"]>>>;

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

export async function seedManagedAutomation(rpc: MissionRpc, caseId: string) {
  const world = managedAutomationWorlds.find((item) => item.id === caseId);
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
        (seed.world.problem === "revised-before-review" ||
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
