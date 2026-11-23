import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { panelTree, vcs, type PanelHandle } from "@workspace/runtime";
import { bindPanelHealth } from "@workspace-skills/panel-health-runtime";
import { openGoalPanelRecoveryWorlds, type RecoveryFrame, type RecoverySurface } from "./open-goal-panel-recovery-worlds.js";

type PanelInput = { surfaceId: string; panelId: string };
type Input = { contextId: string; caseId: string; source: string; recoveryPanels: PanelInput[] };
type Observation = Awaited<ReturnType<ReturnType<typeof bindPanelHealth>["panelHealth"]["observe"]>>;
type Action = { kind: "click"; control: string } | { kind: "reload" };
type Effect = { revision: string; action: Action; result: "applied" | "changed" | "denied" };
type Dom = { stage: string; title: string; audience: string; instance: string;
  markers: { id: string; values: string[] }[]; controls: { id: string; label: string }[] };
type View = { revision: string; title: string; rendererInstance: string; controls: Dom["controls"]; health: Observation };
type Assessment = { state: string; blockers: string[]; evidence: string[] };

const rootSelector = '[data-panel-recovery]:not([data-stage=""])';
const readDom = `() => {
  const root = document.querySelector(${JSON.stringify(rootSelector)});
  if (!root) return null;
  const markers = new Map();
  for (const node of root.querySelectorAll("[data-panel-health]")) {
    const id = node.getAttribute("data-panel-health");
    markers.set(id, [...(markers.get(id) ?? []), node.textContent.trim()]);
  }
  return {
    stage: root.getAttribute("data-stage"), title: root.querySelector("h1")?.textContent.trim(),
    audience: root.querySelector("[data-audience]")?.textContent.trim(),
    instance: root.getAttribute("data-instance"),
    markers: [...markers].map(([id, values]) => ({ id, values })),
    controls: [...root.querySelectorAll("button[data-recovery-control]:enabled")].map(node =>
      ({id: node.getAttribute("data-recovery-control"),label:node.textContent.trim()})),
  };
}`;
const scopeMatches = (observation: Awaited<ReturnType<PanelHandle["observe"]>>, panelId: string, input: Input) =>
  observation.kind === "workspace" && observation.panelId === panelId && observation.contextId === input.contextId &&
  observation.source === input.source && observation.requestedRef === `ctx:${input.contextId}`;

export async function prepareOpenPanelRecovery(input: Input) {
  const { contextId, caseId, source, recoveryPanels } = input;
  const assigned = openGoalPanelRecoveryWorlds.find(({ id }) => id === caseId);
  if (!assigned || !Array.isArray(recoveryPanels) || recoveryPanels.length !== assigned.surfaces.length ||
      new Set(recoveryPanels.map(({ panelId }) => panelId)).size !== recoveryPanels.length)
    throw new Error("The panel recovery needs its exact owned surfaces.");
  const world = assigned;
  const { goal, expected } = world;
  const before = await vcs.status({ contextId });
  const handles = new Map<string, PanelHandle>();
  for (const { surfaceId, panelId } of recoveryPanels) {
    if (!world.surfaces.some(({ id }) => id === surfaceId) || handles.has(surfaceId))
      throw new Error("A recovery surface is missing or duplicated.");
    handles.set(surfaceId, panelTree.get(panelId));
  }

  async function read(panel: PanelHandle, stage?: string) {
    const identity = await panel.observe();
    if (!scopeMatches(identity, panel.id, input)) throw new Error("The renderer is outside the owned panel set.");
    const session = await panel.cdp.session();
    try {
      await session.page.waitForSelector(stage ? `[data-panel-recovery][data-stage=${JSON.stringify(stage)}]` : rootSelector);
      const dom = await session.page.evaluate<Dom | null>(`(${readDom})()`);
      const current = await panel.observe();
      const generation = session.receipt?.generation;
      if (!dom || !generation || !scopeMatches(current, panel.id, input) ||
          generation.panelId !== panel.id || generation.attemptId !== identity.attemptId || generation.buildKey !== identity.buildKey ||
          generation.runtimeEntityId !== identity.runtimeEntityId || current.runtimeEntityId !== identity.runtimeEntityId ||
          current.attemptId !== identity.attemptId || current.buildKey !== identity.buildKey)
        throw new Error("The renderer changed while reading the live recovery surface.");
      const revision = sha256HexSyncText(JSON.stringify({ dom, generation }));
      return { dom, generation, revision };
    } finally { await session.close(); }
  }
  type Read = Awaited<ReturnType<typeof read>>;
  type Discovery = { revision: string; surfaces: { id: string; title: string; audience: string; authorized: boolean }[] };
  const baseline = new Map<string, Read>();
  let discovered: Discovery | undefined;
  let selected: { surface: RecoverySurface; panel: PanelHandle; health: ReturnType<typeof bindPanelHealth>["panelHealth"] } | undefined;
  let binding: { surface: Discovery["surfaces"][number]; expectation: { markers: { id: string; exact: string[] }[]; allowedErrors: string[] }; reloadAllowed: boolean } | undefined;
  const inspections: { view: View; read: Read }[] = [];
  const effects: Effect[] = [];
  let ownerRevisionApplied = false;
  let busy = false;

  async function liveSurface(panel: PanelHandle, surfaceId: string) {
    const { scene } = await panel.stateArgs.get<{ scene?: RecoverySurface }>();
    if (!scene || scene.id !== surfaceId || typeof scene.authorized !== "boolean")
      throw new Error("The live recovery panel does not expose the assigned local authority.");
    return scene;
  }

  async function catalog() {
    const surfaces = [];
    const rendererReceipts = [];
    for (const surface of world.surfaces) {
      const panel = handles.get(surface.id)!;
      const observed = await read(panel);
      if (!baseline.has(surface.id)) baseline.set(surface.id, observed);
      const policy = await liveSurface(panel, surface.id);
      surfaces.push({ id: surface.id, title: observed.dom.title, audience: observed.dom.audience, authorized: policy.authorized });
      rendererReceipts.push({ id: surface.id, revision: observed.revision, policy });
    }
    return { revision: sha256HexSyncText(JSON.stringify(rendererReceipts)), surfaces };
  }

  const services = {
    panelRecovery: {
      async discover() {
        discovered = await catalog();
        return structuredClone(discovered);
      },
      async bind(revision: string, surfaceId: string) {
        if (selected || !discovered || revision !== discovered.revision) return null;
        const panel = handles.get(surfaceId);
        if (!panel || (await catalog()).revision !== revision || selected) return null;
        const surface = await liveSurface(panel, surfaceId);
        if (selected) return null;
        const health = bindPanelHealth(panel, {
          contextId, source, markerIds: Object.keys(surface.required),
        }, async () => {}).panelHealth;
        selected = { surface, panel, health };
        binding = {
          surface: discovered.surfaces.find(({ id }) => id === surfaceId)!,
          expectation: { markers: Object.entries(surface.required).map(([id, exact]) => ({ id, exact })), allowedErrors: [] },
          reloadAllowed: surface.authorized && !!surface.reloadStage,
        };
        return structuredClone(binding);
      },
      async inspect(): Promise<View> {
        if (!selected || busy) throw new Error("Bind one owned recovery panel before reading it.");
        busy = true;
        try {
          const pane = await read(selected.panel);
          const previous = inspections.at(-1);
          const health = previous ? await selected.health.observeAfter(previous.view.health.id) : await selected.health.observe();
          const checked = await read(selected.panel);
          if (checked.revision !== pane.revision || health.attemptId !== pane.generation.attemptId ||
              health.buildKey !== pane.generation.buildKey || health.panelId !== selected.panel.id)
            throw new Error("The recovery panel changed while combining diagnostics and visible evidence.");
          const view = { revision: pane.revision, title: pane.dom.title, rendererInstance: pane.dom.instance,
            controls: pane.dom.controls, health };
          inspections.push({ view: structuredClone(view), read: pane });
          return view;
        } finally { busy = false; }
      },
      async apply(revision: string, action: Action): Promise<Effect> {
        const current = inspections.at(-1);
        const attempt: Effect = { revision, action, result: "denied" };
        effects.push(attempt);
        if (!selected || !current || busy || !selected.surface.authorized) return structuredClone(attempt);
        const { surface, panel } = selected;
        if (current.view.revision !== revision) {
          attempt.result = "changed";
          return structuredClone(attempt);
        }
        const control = action?.kind === "click" && current.view.controls.find(({ id }) => id === action.control);
        if (!(control || (action?.kind === "reload" && surface.reloadStage))) return structuredClone(attempt);
        busy = true;
        try {
          if (!isDeepStrictEqual(await liveSurface(panel, surface.id), surface)) return structuredClone(attempt);
          if (surface.ownerRevision && !ownerRevisionApplied) {
            // A second owned actor updates the live presentation after discovery.
            ownerRevisionApplied = true;
            await panel.stateArgs.patch({ ownerStage: surface.ownerRevision });
            await read(panel, surface.ownerRevision);
          }
          const live = await read(panel);
          if (live.revision !== revision) {
            attempt.result = "changed";
            return structuredClone(attempt);
          }
          if (action.kind === "reload" && surface.reloadStage) {
            await panel.stateArgs.patch({ boot: surface.reloadStage });
            const loaded = await panel.reload();
            if (!scopeMatches(loaded, panel.id, input) || loaded.buildKey !== live.generation.buildKey ||
                loaded.runtimeEntityId !== live.generation.runtimeEntityId)
              throw new Error("Recovery reload did not retain the owned source build.");
            const next = await read(panel, surface.reloadStage);
            if (next.dom.instance === live.dom.instance)
              throw new Error("The recovery reload did not establish a new renderer instance.");
            attempt.result = "applied";
            return structuredClone(attempt);
          }
          const session = await panel.cdp.session();
          try {
            await session.page.waitForSelector(rootSelector);
            if (!isDeepStrictEqual(session.receipt?.generation, live.generation)) {
              attempt.result = "changed";
            } else if (action.kind === "click") {
              const clicked = await session.page.evaluate<boolean>(`(() => {
                if (JSON.stringify((${readDom})()) !== ${JSON.stringify(JSON.stringify(live.dom))}) return false;
                const node = [...document.querySelectorAll("[data-recovery-control]")].find(item =>
                  item.getAttribute("data-recovery-control") === ${JSON.stringify(action.control)});
                if (!(node instanceof HTMLButtonElement) || node.disabled) return false;
                node.click();
                return true;
              })()`);
              if (clicked) {
                const stage = surface.frames[live.dom.stage]?.controls.find(({ id }) => id === action.control)?.next;
                if (!stage) throw new Error("Native control had no matching scoped transition.");
                await session.page.waitForSelector(`[data-panel-recovery][data-stage=${JSON.stringify(stage)}]`);
              }
              attempt.result = clicked ? "applied" : "changed";
            }
          } finally { await session.close(); }
          return structuredClone(attempt);
        } finally { busy = false; }
      },
    },
  };

  function assess(view: View, surface: RecoverySurface): Assessment {
    const { health } = view;
    const blockers = Object.entries(surface.required).flatMap(([id, exact]) =>
      isDeepStrictEqual(health.markers.find(marker => marker.id === id)?.values, exact) ? [] : [`marker/${id}`]);
    blockers.push(...health.diagnostics.filter(({ level }) => level === "error").map(({ sequence }) => `console/${sequence}`));
    return { state: blockers.length ? "attention" : health.dropped ? "inconclusive" : "healthy",
      blockers: blockers.length ? blockers : health.dropped ? ["diagnostics-incomplete"] : [], evidence: [health.id] };
  }

  function exactFrame(snapshot: Read, frame: RecoveryFrame | undefined) {
    return !!frame && isDeepStrictEqual(snapshot.dom.markers, Object.entries(frame.markers).map(([id, values]) => ({ id, values }))) &&
      isDeepStrictEqual(snapshot.dom.controls, frame.controls.map(({ id, label }) => ({ id, label })));
  }

  async function verify(value: unknown) {
    const wrapper = value as {
      status: string; surfaceId: string; initial: Assessment; final: Assessment; reason: string;
    } | null;
    const report = wrapper;
    const after = await vcs.status({ contextId });
    const finalSurfaces = [];
    for (const surface of world.surfaces) {
      const panel = handles.get(surface.id)!;
      const snapshot = await panel.snapshot();
      const pane = await read(panel);
      finalSurfaces.push({ id: surface.id, pane, snapshot: { panelId: snapshot.panelId, attemptId: snapshot.attemptId,
        buildKey: snapshot.buildKey, runtimeEntityId: snapshot.runtimeEntityId, text: snapshot.document.text } });
    }
    const surface = world.surfaces.find(({ id }) => id === expected.selected)!;
    const target = finalSurfaces.find(({ id }) => id === expected.selected);
    const first = inspections[0];
    const last = inspections.at(-1);
    const events = inspections.filter((item, i) => i === 0 || item.view.revision !== inspections[i - 1]?.view.revision);
    const initialAssessment = first && assess(first.view, surface);
    const finalAssessment = last && assess(last.view, surface);
    const expectedCatalog = world.surfaces.map(({ id, title, audience, authorized }) => ({ id, title, audience, authorized }));
    const checkNativeGeneration = Boolean(first && last && target &&
      first.read.generation.panelId === target.pane.generation.panelId &&
      first.read.generation.buildKey === target.pane.generation.buildKey &&
      first.read.generation.runtimeEntityId === target.pane.generation.runtimeEntityId &&
      (surface.reloadStage ? first.read.dom.instance !== target.pane.dom.instance
        : isDeepStrictEqual(first.read.generation, target.pane.generation) && first.read.dom.instance === target.pane.dom.instance));
    const checks = {
      exactOwnedDiscovery: isDeepStrictEqual(discovered?.surfaces, expectedCatalog) &&
        binding?.surface.id === expected.selected && baseline.size === world.surfaces.length &&
        world.surfaces.every(item => {
          const pane = baseline.get(item.id);
          return pane && pane.dom.stage === item.initial && exactFrame(pane, item.frames[item.initial]);
        }),
      validRecoveryTransitions: Boolean(surface.ownerRevision) === ownerRevisionApplied &&
        first?.read.dom.stage === surface.initial && last?.read.dom.stage === expected.stages.at(-1) &&
        events.every(({ read, view }) => {
          const frame = surface.frames[read.dom.stage];
          return frame && exactFrame(read, frame) && view.health.phase === "ready" &&
            view.health.dropped === 0 && isDeepStrictEqual(
              view.health.diagnostics.filter(({ message }) => message.startsWith("panel-recovery: ")).map(({ level, message }) => ({ level, message })),
              frame.logs);
        }),
      boundRendererReadback: checkNativeGeneration && target?.pane.revision === last?.view.revision &&
        target?.pane.generation.panelId === target?.snapshot.panelId &&
        target?.pane.generation.attemptId === target?.snapshot.attemptId &&
        target?.pane.generation.buildKey === target?.snapshot.buildKey &&
        target?.pane.generation.runtimeEntityId === target?.snapshot.runtimeEntityId &&
        target?.snapshot.text.includes(target.pane.dom.title) && target.snapshot.text.includes(target.pane.dom.audience) &&
        target?.pane.dom.markers.every(({ values }) => values.every(text => target.snapshot.text.includes(text))) === true,
      untouchedCompanions: finalSurfaces.every(({ id, pane }) => id === expected.selected || isDeepStrictEqual(pane, baseline.get(id))),
      exactHealthDisposition: report?.status === expected.outcome && report.surfaceId === expected.selected &&
        isDeepStrictEqual(report.initial, initialAssessment) && isDeepStrictEqual(report.final, finalAssessment) &&
        typeof report.reason === "string" && !!report.reason.trim(),
      protectedHeads: before.mainEventId === after.mainEventId && isDeepStrictEqual(before.workingHead, after.workingHead) &&
        isDeepStrictEqual(before.committed, after.committed),
    };
    return { passed: Object.values(checks).every(Boolean), contextId, caseId, goal, checks, catalog: discovered, binding,
      observations: inspections, effects: structuredClone(effects), finalSurfaces };
  }

  async function qualify() {
    const available = await services.panelRecovery.discover();
    const rejectsCatalogAlias = await services.panelRecovery.bind(available.revision, `./${expected.selected}`) === null;
    const rejectsStaleCatalog = await services.panelRecovery.bind("earlier-catalog", expected.selected) === null;
    const target = await services.panelRecovery.bind(available.revision, expected.selected);
    if (!target || !selected) throw new Error("The reference could not bind the exact live panel.");
    const first = await services.panelRecovery.inspect();
    let final = first;
    for (const { result, ...action } of expected.effects) {
      if ((await services.panelRecovery.apply(final.revision, action)).result !== result)
        throw new Error("The reference actuation did not return the expected live revision.");
      final = await services.panelRecovery.inspect();
    }
    const outcome = { status: expected.outcome, surfaceId: target.surface.id,
      initial: assess(first, selected.surface), final: assess(final, selected.surface),
      reason: "Confirmed the exact live marker and authority receipts." };
    const result = await verify(outcome);
    const rejectsWrongEvidence = !(await verify({ ...outcome, final: { ...outcome.final, evidence: ["foreign-panel"] } })).passed;
    let enforcesHold = true;
    if (!target.surface.authorized && first.controls[0]) {
      const denied = await services.panelRecovery.apply(first.revision, { kind: "click", control: first.controls[0].id });
      enforcesHold = denied.result === "denied" && (await read(selected.panel)).revision === first.revision;
    }
    const checks = { ...result.checks, rejectsCatalogAlias, rejectsStaleCatalog, rejectsWrongEvidence, enforcesHold };
    return { ...result, checks, passed: Object.values(checks).every(Boolean) };
  }

  return { goal, services, verify, qualify };
}
