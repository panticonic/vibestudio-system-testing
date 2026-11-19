import { isDeepStrictEqual } from "node:util";
import type { PanelHandle } from "@workspace/runtime";
import { bindPanelHealth } from "@workspace-skills/panel-health-runtime";
import { managedPanelHealthWorlds } from "./panel-health-worlds.js";

type Bound = ReturnType<typeof bindPanelHealth>["panelHealth"];
type Observation = Awaited<ReturnType<Bound["observe"]>>;
type World = (typeof managedPanelHealthWorlds)[number];
type Expected = World["expected"]["initial"];
type Assessment = { state: string; blockers: string[]; evidence: string[] };
type Report = {
  initial: Assessment;
  later: Assessment | null;
  outcome: string;
};

export async function waitForPanelHealthFrame(
  panel: PanelHandle,
  step: "first" | "later",
) {
  const session = await panel.cdp.session();
  try {
    await session.page.waitForSelector(`[data-panel-probe-ready="${step}"]`);
  } finally {
    await session.close();
  }
}

export async function prepareManagedPanelHealth(
  panel: PanelHandle,
  contextId: string,
  source: string,
  caseId: string,
) {
  const assigned = managedPanelHealthWorlds.find(
    (entry) => entry.id === caseId,
  );
  if (!assigned) throw new Error("Unknown managed panel health assignment");
  const world = assigned;
  const request = {
    goal: world.goal,
    expectation: {
      markers: world.markers.map(([id, ...exact]) => ({ id, exact })),
      allowedErrors: world.allowedErrors,
    },
    observeChange: world.later !== null,
  };
  await waitForPanelHealthFrame(panel, "first");
  const observations: Observation[] = [];
  const operations: string[] = [];
  const bound = bindPanelHealth(
    panel,
    {
      contextId,
      source,
      markerIds: world.markers.map(([id]) => id),
    },
    world.later
      ? async () => {
          const session = await panel.cdp.session();
          try {
            await session.page.locator("[data-panel-probe-advance]").click();
            await session.page.waitForSelector(
              '[data-panel-probe-ready="later"]',
            );
          } finally {
            await session.close();
          }
        }
      : undefined,
  );

  const capture = async (
    operation: string,
    read: () => Promise<Observation>,
  ) => {
    const observation = await read();
    observations.push(structuredClone(observation));
    operations.push(operation);
    return observation;
  };
  const services = {
    panelHealth: {
      observe() {
        if (operations.length)
          throw new Error("The panel has one initial health observation");
        return capture("initial", bound.panelHealth.observe);
      },
      observeAfter(id: string) {
        if (operations.length !== 1 || !world.later)
          throw new Error("The assignment has no unread follow-up");
        return capture("later", () => bound.panelHealth.observeAfter(id));
      },
    },
  };

  function viewAndDiagnostics(
    observation: Observation,
    frame: World["initial"],
  ) {
    const markers = frame.markers
      .filter(([id]) =>
        request.expectation.markers.some((marker) => marker.id === id),
      )
      .map(([id, ...values]) => ({ id, values }));
    const markerById = new Map(markers.map((marker) => [marker.id, marker]));
    const owned = observation.diagnostics.filter((row) =>
      row.message.startsWith("panel-health: "),
    );
    return (
      observation.phase === "ready" &&
      observation.panelId === panel.id &&
      typeof observation.attemptId === "string" &&
      observation.attemptId.length > 0 &&
      typeof observation.buildKey === "string" &&
      observation.buildKey.length > 0 &&
      observation.dropped === 0 &&
      observation.markers.length === markers.length &&
      observation.markers.every((marker) =>
        isDeepStrictEqual(marker, markerById.get(marker.id)),
      ) &&
      isDeepStrictEqual(
        owned.map(({ level, message }) => ({ level, message })),
        frame.logs,
      ) &&
      observation.diagnostics.every(
        (signal) =>
          signal.level !== "error" ||
          frame.logs.some(
            (log) => log.level === "error" && log.message === signal.message,
          ),
      )
    );
  }

  function assessment(
    observation: Observation,
    expected: Expected,
  ): Assessment | null {
    const blockers = (expected.markers ?? []).map((id) => "marker/" + id);
    for (const message of expected.errors ?? []) {
      const diagnostic = observation.diagnostics.find(
        (row) => row.level === "error" && row.message === message,
      );
      if (!diagnostic) return null;
      blockers.push("console/" + diagnostic.sequence);
    }
    if (expected.identity) blockers.push("observation-mismatch");
    return { state: expected.state, blockers, evidence: [observation.id] };
  }

  function expectedReport(): Report | null {
    const [first, later] = observations;
    if (!first) return null;
    const initial = assessment(first, world.expected.initial);
    const rechecked =
      later && world.expected.later
        ? assessment(later, world.expected.later)
        : null;
    return initial
      ? { initial, later: rechecked, outcome: world.expected.outcome }
      : null;
  }

  async function verify(report: Report | null) {
    const [first, later] = observations;
    const expected = expectedReport();
    const current = await panel.observe();
    const identityChanged =
      first &&
      later &&
      (later.consoleThrough > first.consoleThrough ||
        !isDeepStrictEqual(later.markers, first.markers) ||
        later.attemptId !== first.attemptId ||
        later.buildKey !== first.buildKey);
    const checks = {
      exactOps: isDeepStrictEqual(
        operations,
        world.later ? ["initial", "later"] : ["initial"],
      ),
      initial: !!first && viewAndDiagnostics(first, world.initial),
      followUp: world.later
        ? !!first &&
          !!later &&
          viewAndDiagnostics(later, world.later) &&
          later.id !== first.id &&
          Boolean(identityChanged) !== Boolean(world.expected.later?.identity)
        : later === undefined,
      ownedPanel:
        current.panelId === panel.id &&
        current.contextId === contextId &&
        current.source === source &&
        current.requestedRef === `ctx:${contextId}` &&
        current.attemptId === (later ?? first)?.attemptId &&
        current.buildKey === (later ?? first)?.buildKey,
      report: !!expected && isDeepStrictEqual(report, expected),
    };
    return {
      caseId,
      contextId,
      source,
      panelId: panel.id,
      observations,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    const first = await services.panelHealth.observe();
    let rejectsForeignObservation = false;
    if (world.later) {
      try {
        await services.panelHealth.observeAfter("unobserved-health-record");
      } catch (error) {
        rejectsForeignObservation =
          error instanceof Error && error.message.includes("does not match");
      }
      await services.panelHealth.observeAfter(first.id);
    } else {
      try {
        await services.panelHealth.observeAfter(first.id);
      } catch (error) {
        rejectsForeignObservation =
          error instanceof Error && error.message.includes("no unread");
      }
    }
    const verification = await verify(expectedReport());
    const rejectsWrongReceipt = !(await verify(null)).passed;
    return { verification, rejectsForeignObservation, rejectsWrongReceipt };
  }
  return { request, services, verify, qualify };
}
