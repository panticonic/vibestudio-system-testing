import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import type { SupervisionChange } from "@vibestudio/shared/events";
import type * as DesktopUpdateModel from "@workspace/client-update-core";
import type * as DesktopUpdateProjection from "@workspace-clients/desktop-browser/update-projection";
import type * as DesktopLayout from "@workspace-clients/desktop-browser/placement";
import type { bindClientAdmission } from "@workspace-skills/clientdev/workflow";
import type { DesktopReadinessWorld } from "./open-goal-desktop-readiness-worlds.js";

type VcsPorts = NonNullable<Parameters<typeof bindClientAdmission>[1]>;
type DesktopNativePorts = {
  updateModel: typeof DesktopUpdateModel;
  updateProjection: typeof DesktopUpdateProjection;
  layout: typeof DesktopLayout;
  bindClientAdmission: typeof bindClientAdmission;
};
type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
type SourceEvidence = Awaited<
  ReturnType<
    ReturnType<
      typeof bindClientAdmission
    >["services"]["clientAdmissionRead"]["observe"]
  >
>;
const source = "clients/desktop-browser";
const clientId = "browser";

function observeWindow(
  world: DesktopReadinessWorld,
  id: string,
  layout: DesktopNativePorts["layout"],
) {
  const {
    applyLayoutAction,
    MIN_COLUMN_WIDTH,
    PANE_VERTICAL_CHROME_HEIGHT,
    computeViewport,
    reconcileViewport,
    validateRestoredLayout,
  } = layout;
  const window = world.window ?? {};
  const mode = window.case ?? "standard";
  const left = { id: "pane-left", panelId: "schedule", heightFr: 1 };
  const right = {
    id: mode === "duplicate-pane" ? "pane-left" : "pane-right",
    panelId: mode === "duplicate-panel" ? "schedule" : "records",
    heightFr: 1,
    ...(mode === "oversize" ? { minWidthOverride: 1120 } : {}),
  };
  const columns = [
    { id: "left", widthFr: 1, panes: [left] },
    { id: "right", widthFr: 1, panes: [right] },
  ];
  const persisted = {
    workspaceId: mode === "other-workspace" ? "adjacent-desk" : id,
    version: mode === "bad-schema" ? 0 : 1,
    updatedAt: "2026-01-01T14:00:00.000Z",
    layout: {
      columns,
      focusedPaneId: window.focus === "left" ? "pane-left" : "pane-right",
      viewportColumnId: mode === "stale-anchor" ? "older-monitor" : "left",
    },
  };
  const panels =
    mode === "removed"
      ? ["schedule"]
      : mode === "empty"
        ? []
        : ["schedule", "records"];
  const restored =
    persisted.workspaceId === id
      ? validateRestoredLayout(persisted, new Set(panels))
      : null;
  const status =
    persisted.workspaceId !== id
      ? ("wrong-scope" as const)
      : restored
        ? ("restored" as const)
        : ("invalid" as const);
  const env = (width: number) => ({
    viewportWidth: width,
    viewportHeight: 940,
    paneChromeHeight: PANE_VERTICAL_CHROME_HEIGHT,
    rootPanelIds: () => panels,
    minWidthOf: () => MIN_COLUMN_WIDTH,
  });
  const view = (layout: NonNullable<typeof restored>, width: number) => {
    const viewport = computeViewport(layout, env(width));
    const focused = layout.columns
      .flatMap((column) => column.panes)
      .find((pane) => pane.id === layout.focusedPaneId);
    return {
      width,
      focused: focused?.panelId ?? null,
      resident: viewport.residentColumnIds,
      parkedLeft: viewport.parkedLeft,
      parkedRight: viewport.parkedRight,
      columns: layout.columns,
    };
  };
  const width = window.afterWidth ?? 1450;
  const finalEnv = env(width);
  const queued = window.queued
    ? { type: "focus-pane" as const, paneId: window.queued }
    : null;
  const current =
    restored &&
    reconcileViewport(
      queued ? applyLayoutAction(restored, queued, finalEnv) : restored,
      finalEnv,
    );
  return {
    deskId: id,
    status,
    before: restored && view(restored, window.beforeWidth ?? 1450),
    current: current && view(current, width),
    queuedFocus: queued?.paneId ?? null,
    pendingPlacementEdit: window.pending === true,
  };
}

async function observeUpdates(
  world: DesktopReadinessWorld,
  id: string,
  desktop: DesktopNativePorts,
) {
  const { createClientUpdateModel } = desktop.updateModel;
  const { applyDesktopUpdateNotice, projectRetainedDesktopUpdates } =
    desktop.updateProjection;
  let portCalls = 0;
  const unavailable = async () => {
    portCalls++;
    throw new Error("Desktop readiness is a read-only review");
  };
  const model = createClientUpdateModel({
    scope: { runtime: "web", clientId, source },
    port: { apply: unavailable, rollback: unavailable },
  });
  const currentBuild = world.active ?? "running";
  const runningBuild = "running";
  const previousBuilds = world.previous ?? [];
  const unit = (entityId: string) => ({
    identity: { kind: "client", entityId },
    source: entityId === clientId ? source : "clients/adjacent-desk",
  });
  const project = async (
    offers: DesktopReadinessWorld["current"],
    active: boolean,
  ) => {
    const retained = (offers ?? []).map((offer) => ({
      appId: offer.identity ?? clientId,
      buildKey: offer.build,
      effectiveVersion: offer.version,
      previousEffectiveVersion: offer.from,
    }));
    const units = active
      ? [unit(clientId), unit("neighbor")]
      : [unit("neighbor")];
    return (
      await projectRetainedDesktopUpdates(retained, units, async (id) =>
        id === clientId ? previousBuilds.length : 0,
      )
    ).filter((row) => row.clientId === clientId);
  };
  model.seed(await project(world.before, true));
  const before = model.getSnapshot().pending;
  model.seed(await project(world.current, !world.missingCurrentUnit));
  const events = world.events ?? [];
  for (const signal of events) {
    const change: SupervisionChange = {
      identity: {
        kind: "client",
        entityId: signal === "foreign" ? "neighbor" : clientId,
      },
      source: signal === "foreign" ? "clients/adjacent-desk" : source,
      status: "running",
      lastError:
        signal === "rejected" ? "The supplied candidate was refused." : null,
      artifact: {
        buildKey: currentBuild,
        effectiveVersion: currentBuild,
        executionDigest: null,
      },
      canRollback: previousBuilds.length > 0,
      change:
        signal === "rejected" || signal === "foreign"
          ? "update-rejected"
          : signal,
      previousBuildKey: runningBuild,
      previousEffectiveVersion: runningBuild,
      client: {
        id: signal === "foreign" ? "neighbor" : clientId,
        runtime: "web",
        grantedCapabilities: [],
      },
    };
    // The desktop host, not the browser, turns an adopted event into a retained offer.
    applyDesktopUpdateNotice(model, change);
  }
  const { pending, notices } = model.getSnapshot();
  return {
    deskId: id,
    runningBuild,
    currentBuild,
    before,
    current: pending,
    notices,
    events,
    previousBuilds,
    portCalls,
    admissionPending: world.admissionPending === true,
  };
}

function expectedAdmission(observation: SourceEvidence) {
  const { working, published, host, trusted, catalog } = observation;
  const has = (capability: string) => host.capabilities.includes(capability);
  const denied = (capability: string) =>
    !trusted && host.deviceLevel.includes(capability);
  const capabilities = {
    missingRequired: working.required.filter((value) => !has(value)),
    untrustedRequired: working.required.filter(denied),
    deniedOptional: working.optional.filter(
      (value) => !has(value) || denied(value),
    ),
  };
  const abi = !host.runtimes[working.runtime]
    ? "wrong-runtime"
    : host.runtimes[working.runtime] === working.abi
      ? "compatible"
      : "wrong-abi";
  const disposition =
    working.hash === published.hash ? "published-contract" : "working-change";
  const status = {
    ready: "reviewed-ready",
    "approval-required": "await-approval",
    building: "await-build",
    available: "await-build",
    error: "inspect-build",
  } as const;
  const decision =
    abi === "wrong-runtime"
      ? "match-runtime"
      : abi === "wrong-abi"
        ? "resolve-abi"
        : capabilities.missingRequired.length ||
            capabilities.untrustedRequired.length
          ? "resolve-required-capabilities"
          : disposition === "working-change"
            ? "review-candidate"
            : catalog
              ? status[catalog.status]
              : "check-declaration";
  return {
    source: { observation, disposition },
    host: { abi, capabilities },
    decision,
  };
}

export async function prepareDesktopReadiness(
  input: { contextId: string; caseId: string },
  world: DesktopReadinessWorld,
  ports: VcsPorts & { contextId: string | null; desktop: DesktopNativePorts },
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) {
    throw new Error(
      "Desktop readiness requires the exact owned System context",
    );
  }
  const status = () => ports.vcs.status({ contextId: input.contextId });
  const baseline = await status();
  const { desktop } = ports;
  const bound = desktop.bindClientAdmission(
    {
      contextId: input.contextId,
      source,
      host: "desktop",
      goal: world.goal,
    },
    ports,
  );
  const desk = {
    id: crypto.randomUUID(),
    name: world.name,
    operationId: bound.request.operationId,
  };
  const neighbor = {
    id: crypto.randomUUID(),
    name: world.name + " adjacent workspace",
    operationId: crypto.randomUUID(),
  };
  const journal: Journal[] = [];
  const keep = <T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ): T => {
    journal.push({
      service,
      method,
      args: structuredClone(args),
      result: structuredClone(result),
    });
    return result;
  };
  function requireDesk(id: string) {
    if (id !== desk.id) throw new Error("Read only the assigned desktop desk");
  }
  const services = {
    clientAdmissionRead: {
      async observe(id: string) {
        return keep(
          "clientAdmissionRead",
          "observe",
          [id],
          await bound.services.clientAdmissionRead.observe(id),
        );
      },
    },
    desktopReadiness: {
      async discover() {
        return keep("desktopReadiness", "discover", [], [desk, neighbor]);
      },
      async readWindow(id: string) {
        requireDesk(id);
        return keep(
          "desktopReadiness",
          "readWindow",
          [id],
          observeWindow(world, id, desktop.layout),
        );
      },
      async readUpdates(id: string) {
        requireDesk(id);
        return keep(
          "desktopReadiness",
          "readUpdates",
          [id],
          await observeUpdates(world, id, desktop),
        );
      },
    },
  };
  type Window = ReturnType<typeof observeWindow>;
  type Updates = Awaited<ReturnType<typeof observeUpdates>>;


  
  async function verify(report: unknown,observations?: InvocationObservations) {
    const proof=await verifyNativeApplication(report,observations);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedDesktopReadinessDecision"],"rootPath":[],"producerSourceSuffix":"reviewDesktopReadiness/decideDesktopReadiness.nl","producerPath":[]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=report;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,report,observations,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(report: unknown, observations?: InvocationObservations) {
    const outcome = report as {action:string;reason:string} | null;
    const sourceRead = journal.find((row) => row.method === "observe")
      ?.result as SourceEvidence | undefined;
    const exactAdmission = sourceRead && expectedAdmission(sourceRead);
    const reread = await bound.services.clientAdmissionRead.observe(
      desk.operationId,
    );
    const window = observeWindow(world, desk.id, desktop.layout);
    const updates = await observeUpdates(world, desk.id, desktop);
    const final = await status();
    const expected = world.expected;
    const pane = window.current;
    const journalOf = (method: string) =>
      journal.filter((row) => row.method === method);
    const matched = (method: string, args: unknown[], value: unknown) => {
      const rows = journalOf(method);
      return (
        rows.some(row => isDeepStrictEqual(row.args, args) && isDeepStrictEqual(row.result, value))
      );
    };
    const childReturns = observations ? await observations.returns(call =>
      call.definition.source.includes("reviewDesktopReadiness/clientDevelopment/") &&
      (call.definition.name === "chooseNext" || call.definition.name === "reviewClientAdmission")) : [];
    const incorrectReturnValues = exactAdmission ? childReturns.filter(call => {
      const decision = call.definition.name === "chooseNext" ? call.value :
        (call.value as {decision?:unknown}|null)?.decision;
      return !isDeepStrictEqual(decision, exactAdmission.decision);
    }).map(call => ({required:false,callId:call.callId,checks:["incidentalDesktopAdmissionClassification"],definition:call.definition,value:call.value,valueJson:call.valueJson})) : [];
    const checks = {
      exactDesktopClientSource:
        sourceRead?.contextId === input.contextId &&
        sourceRead.operationId === desk.operationId &&
        sourceRead.source === source &&
        sourceRead.mainRevision === baseline.mainEventId &&
        sourceRead.workingRevision ===
          (baseline.workingHead.kind === "event"
            ? baseline.workingHead.eventId
            : baseline.workingHead.applicationId) &&
        isDeepStrictEqual(sourceRead, reread) &&
        sourceRead.host.kind === "desktop" &&
        sourceRead.published.id === clientId &&
        sourceRead.published.runtime === "web" &&
        sourceRead.published.abi === "web-host-1" &&
        matched("observe", [desk.operationId], sourceRead) && matched("discover",[],[desk,neighbor]),
      incidentalDesktopAdmissionClassification:
        incorrectReturnValues.length === 0,
      exactResponsivePlacement:
        matched("readWindow", [desk.id], window) &&
        window.status === (expected.layout ?? "restored") &&
        (expected.currentFocus === undefined ||
          pane?.focused === expected.currentFocus) &&
        (expected.resident === undefined ||
          isDeepStrictEqual(pane?.resident, expected.resident)) &&
        (expected.leftParked === undefined ||
          isDeepStrictEqual(pane?.parkedLeft, expected.leftParked)) &&
        (expected.rightParked === undefined ||
          isDeepStrictEqual(pane?.parkedRight, expected.rightParked)),
      exactRetainedDesktopOffer:
        matched("readUpdates", [desk.id], updates) &&
        updates.portCalls === 0 &&
        isDeepStrictEqual(
          updates.before.map((row) => row.buildKey),
          expected.before ?? [],
        ) &&
        isDeepStrictEqual(
          updates.current.map((row) => row.buildKey),
          expected.current ?? [],
        ) &&
        isDeepStrictEqual(
          updates.notices.map((row) => row.title),
          expected.notices ?? [],
        ),
      matchedDesktopReadinessDecision:
        outcome?.action === expected.action &&
        typeof outcome.reason === "string" && Boolean(outcome.reason.trim()),
      preservedDesktopWorkspaceHeads:
        final.mainEventId === baseline.mainEventId &&
        isDeepStrictEqual(final.workingHead, baseline.workingHead),
    };

    return {
      incorrectReturnValues,
      outcomeContract:{
        effects:{checks:["exactDesktopClientSource","exactResponsivePlacement","exactRetainedDesktopOffer","preservedDesktopWorkspaceHeads"],rationale:"Native source, layout, build distinction, requested answer and protected workspace are required by this desktop goal."},
        returnedValue:{checks:["matchedDesktopReadinessDecision"],required:true,rationale:"The requested layout and version answer is required and checked with native facts."},
        incidentalValues:{checks:["incidentalDesktopAdmissionClassification"],rationale:"An unused internal client admission recommendation is not the requested layout/build answer; retain and exclude its known incorrect generated values."},
      },
      contextId: input.contextId,
      caseId: input.caseId,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      desk,
      window,
      updates,
      exactAdmission,
      journal: structuredClone(journal),
    };
  }
  async function qualify() {
    const cards = await services.desktopReadiness.discover();
    let rejectedDesk = false;
    let rejectedAdmission = false;
    try {
      await services.desktopReadiness.readWindow(cards[1]!.id);
    } catch {
      rejectedDesk = true;
    }
    try {
      await services.clientAdmissionRead.observe(cards[1]!.operationId);
    } catch {
      rejectedAdmission = true;
    }
    const admission = expectedAdmission(
      await services.clientAdmissionRead.observe(desk.operationId),
    );
    const window = await services.desktopReadiness.readWindow(desk.id);
    const updates = await services.desktopReadiness.readUpdates(desk.id);
    const report = {action:world.expected.action,reason:"Current scoped desktop evidence."};
    const proof = await verify(report);
    const negative = structuredClone(report);
    negative.action = "invented" as typeof negative.action;
    const rejectedWrongReadback = !(await verify(negative)).outcomeDimensions.returnedValue.passed;
    const checks = {
      ...proof.checks,
      rejectedDesk,
      rejectedAdmission,
      rejectedWrongReadback,
    };
    return {
      ...proof,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedDesk","rejectedAdmission","rejectedWrongReadback"]}},
      checks,
      passed: Object.values(checks).every(Boolean),
      report,
    };
  }
  return { services, verify, qualify };
}
