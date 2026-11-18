import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { VcsClient } from "@workspace/runtime";
import { managedSetupWorlds, type SetupRoute } from "./onboarding-worlds.js";

type Readback = {
  rows: { id: string; state: string; observed: boolean }[];
  route: SetupRoute | null;
};
type Receipt = Readback & { receipt: string };
type Plan = Receipt & {
  status: string;
  unknown: string[];
  needsVerification: string[];
};
type Ports = {
  vcs: Pick<VcsClient, "status">;
  observe(ids: string[], selection: unknown): Promise<Readback>;
};

export async function prepareManagedSetup(
  ports: Ports,
  contextId: string,
  caseId: string,
) {
  const world = managedSetupWorlds.find(({ id }) => id === caseId);
  if (!world) throw new Error("Unknown installed onboarding case");
  const before = await ports.vcs.status();
  let inspected = false;
  let receipt: Receipt | undefined;
  return {
    world,
    before,
    request: { goal: world.goal, intent: world.intent },
    observed: () => receipt,
    service: {
      async inspect() {
        if (inspected)
          throw new Error("Read the assigned onboarding receipt once.");
        inspected = true;
        const readback = await ports.observe([...world.ids], world.interaction);
        receipt = {
          ...readback,
          receipt: sha256HexSyncText(
            JSON.stringify({ contextId, caseId, readback }),
          ),
        };
        return structuredClone(receipt);
      },
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedSetup>>;
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const routeMatches = (
  actual: SetupRoute | null | undefined,
  expected: SetupRoute | null,
) =>
  expected === null
    ? actual === null
    : actual?.via === expected.via &&
      actual.capabilityId === expected.capabilityId &&
      actual.action === expected.action &&
      actual.destination === expected.destination;

function reference(prepared: Prepared, observed: Receipt): Plan {
  const status =
    prepared.request.intent === "welcome"
      ? "overview"
      : prepared.request.intent === "refresh"
        ? "refresh-overview"
        : prepared.request.intent === "workspace-creation"
          ? "separate-workspace"
          : observed.route === null
            ? "invalid-selection"
            : ["panel", "about-page", "shell-navigation"].includes(
                  observed.route.via,
                )
              ? "route-client"
              : "route-owner";
  return {
    ...observed,
    status,
    unknown: observed.rows
      .filter(({ observed, state }) => !observed || state === "unknown")
      .map(({ id }) => id),
    needsVerification: observed.rows
      .filter(
        ({ observed, state }) => observed && state === "connected-unverified",
      )
      .map(({ id }) => id),
  };
}

export async function verifyManagedSetup(
  ports: Ports,
  prepared: Prepared,
  value: unknown,
) {
  const after = await ports.vcs.status();
  const observed = prepared.observed();
  const expected = prepared.world.expected;
  const observedPlan = observed && reference(prepared, observed);
  const plan = value as Plan | null;
  const checks = {
    workspaceHeadUnchanged:
      after.mainEventId === prepared.before.mainEventId &&
      same(after.workingHead, prepared.before.workingHead),
    generationBound: Boolean(observed && plan?.receipt === observed.receipt),
    exactOwnerRows: Boolean(
      observed &&
      same(
        observed.rows.map(({ id }) => id),
        prepared.world.ids,
      ) &&
      same(
        observed.rows.filter(({ observed }) => !observed).map(({ id }) => id),
        expected.absent ?? [],
      ) &&
      Array.isArray(plan?.rows) &&
      plan.rows.length === observed.rows.length &&
      observed.rows.every((row, index) => {
        const claimed = plan.rows[index];
        return (
          row.id === claimed?.id &&
          row.state === claimed.state &&
          row.observed === claimed.observed
        );
      }),
    ),
    authoritativeRoute: Boolean(
      observedPlan &&
      observedPlan.status === expected.status &&
      plan?.status === expected.status &&
      routeMatches(observedPlan.route, expected.route) &&
      routeMatches(plan.route, observedPlan.route),
    ),
    unknownAndUnverified: Boolean(
      observedPlan &&
      same(plan?.unknown, observedPlan.unknown) &&
      same(plan?.needsVerification, observedPlan.needsVerification),
    ),
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    status: expected.status,
    caseId: prepared.world.id,
    receipt: observed?.receipt ?? null,
    route: observed?.route ?? null,
  };
}

export async function qualifyManagedSetup(
  ports: Ports,
  contextId: string,
  caseId: string,
) {
  const prepared = await prepareManagedSetup(ports, contextId, caseId);
  const observed = await prepared.service.inspect();
  const correct = reference(prepared, observed);
  const accepted = await verifyManagedSetup(ports, prepared, correct);
  const altered = await verifyManagedSetup(ports, prepared, {
    ...correct,
    receipt: "previous-receipt",
  });
  return { accepted, rejectedStaleReceipt: !altered.passed };
}
