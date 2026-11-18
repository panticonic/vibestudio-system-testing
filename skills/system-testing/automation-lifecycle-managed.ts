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
  if (!live || !sameDefinition(seed.start, live))
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

export function prepareManagedAutomation(rpc: MissionRpc, seed: Seed) {
  const { world, original, start } = seed;
  const missions = createMissionsClient(rpc);
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
  const services = bindAutomationLifecycle(
    {
      get: (id) => missions.get(id),
      async transitionAtRevision(id, action, revision) {
        controllerCalls.push(action);
        return missions.transitionAtRevision(id, action, revision);
      },
    },
    request,
  );
  return {
    world,
    request,
    start,
    original,
    services,
    missions,
    controllerCalls,
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
  const expectedState =
    world.status === "applied"
      ? world.action === "pause"
        ? "paused"
        : "active"
      : start.state;
  const stateAndReport =
    current?.state === expectedState &&
    report?.missionId === request.missionId &&
    report.status === world.status &&
    report.state === (world.problem === "missing" ? null : expectedState) &&
    report.revisionDigest ===
      (world.problem === "missing" ? null : start.revisionDigest);
  const checks = {
    exactStateAndReport: stateAndReport,
    defaultMonitorUnchanged:
      protectedDefault !== null &&
      sameDefinition(original, protectedDefault) &&
      original.state === protectedDefault.state,
    definitionPreserved: current !== null && sameDefinition(start, current),
    noAutomationRunStarted:
      current !== null &&
      current.runCount === start.runCount &&
      current.lastRunAt === start.lastRunAt &&
      current.nextRunAt === undefined &&
      start.nextRunAt === undefined,
    assignedTransition: isDeepStrictEqual(
      controllerCalls,
      world.status === "applied" ? [world.action] : [],
    ),
    missingStaysMissing:
      world.problem !== "missing" ||
      (await missions.get(request.missionId)) === null,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    caseId: world.id,
    expectedStatus: world.status,
    assignedId: request.missionId,
    expectedRevision: request.revisionDigest,
    observedRevision: current?.revisionDigest ?? null,
    initialState: start.state,
    afterState: current?.state ?? null,
  };
}

export async function qualifyManagedAutomation(rpc: MissionRpc, seed: Seed) {
  const prepared = prepareManagedAutomation(rpc, seed);
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
  const receipt =
    world.status === "applied"
      ? await services.automationLifecycleChange.apply(
          request.missionId,
          request.revisionDigest,
          request.action,
        )
      : null;
  if (world.status === "applied" && receipt !== "acknowledged")
    throw new Error(
      `Expected real scheduling acknowledgement for ${world.id}, got ${receipt}`,
    );
  const after = receipt
    ? await services.automationLifecycleRead.observe(request.missionId)
    : before;
  const verification = await verifyManagedAutomation(prepared, {
    missionId: request.missionId,
    status: world.status,
    state: after?.state ?? null,
    revisionDigest: after?.revisionDigest ?? null,
  });
  return { verification, staleControllerGuard };
}
