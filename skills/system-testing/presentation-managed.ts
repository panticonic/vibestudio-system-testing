import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { PanelHandle } from "@workspace/runtime";
import { renderComponent } from "@workspace-skills/visualize/render";
import type { PresentationReport } from "@workspace-skills/visualize/types";
import type {
  PresentationInteraction,
  PresentationWorld,
} from "./presentation-worlds.js";

export const catalogSelectors = {
  Chart: ".vs-r-chart-svg",
  Compare: ".vs-r-compare",
  Timeline: ".vs-r-timeline",
  Checklist: ".vs-r-checklist",
  Stats: ".vs-r-stats",
  PlaceMap: ".vs-r-map",
  Choices: ".vs-r-choices",
};

export function referencePresentation(
  world: PresentationWorld,
): PresentationReport {
  return {
    omitted: world.omitted,
    views: world.expected.map((item) =>
      "labels" in item
        ? {
            id: item.id,
            status: "ready",
            rendered: renderComponent(item.component),
          }
        : item.status === "needs-review"
          ? { id: item.id, status: item.status, reason: item.reason }
          : item,
    ),
  };
}

// Do not send model-produced text to the MDX renderer until it matches the
// canonical rendering of the verified props for this assignment.
export function checkPresentation(world: PresentationWorld, value: unknown) {
  const report = value as PresentationReport | null;
  const expected = referencePresentation(world);
  if (
    !report ||
    !isDeepStrictEqual(report.omitted, expected.omitted) ||
    !Array.isArray(report.views) ||
    report.views.length !== expected.views.length
  )
    return null;
  const views: {
    id: string;
    mdx: string;
    selector: string;
    labels: string[];
    interaction?: PresentationInteraction;
  }[] = [];
  for (const [index, target] of expected.views.entries()) {
    const actual = report.views[index];
    if (!actual || target.id !== actual.id || target.status !== actual.status)
      return null;
    const assigned = world.expected[index]!;
    if (actual.status === "needs-review") {
      if (
        "labels" in assigned ||
        assigned.status !== "needs-review" ||
        typeof actual.reason !== "string" ||
        !actual.reason.trim()
      ) {
        return null;
      }
      continue;
    }
    if (!isDeepStrictEqual(actual, target)) {
      if (actual.status !== "ready" || target.status !== "ready" || !actual.rendered ||
          actual.rendered.component !== target.rendered.component ||
          actual.rendered.mdx !== renderComponent(actual.rendered).mdx) return null;
      const {title: actualTitle,...actualData}=actual.rendered.props as Record<string,unknown>;
      const {title: expectedTitle,...expectedData}=target.rendered.props as Record<string,unknown>;
      if (!isDeepStrictEqual(actualData,expectedData)) return null;
      const normalize=(text:string)=>text.replace(/\s+/gu," ").trim().toLowerCase();
      const inputs=[world.request.goal,...world.request.sections.flatMap(section=>[section.ask,section.data])].join("\n");
      if (actualTitle!==undefined && actualTitle!==expectedTitle &&
          (typeof actualTitle!=="string" || !actualTitle.trim() || !normalize(inputs).includes(normalize(actualTitle)))) return null;
    }
    if ("labels" in assigned && assigned.requiredTitle!==undefined && actual.status==="ready" &&
        (actual.rendered.props as {title?:string}).title!==assigned.requiredTitle) return null;
    if ("labels" in assigned && actual.status === "ready")
      views.push({
        id: actual.id,
        mdx: actual.rendered.mdx,
        selector: catalogSelectors[assigned.component.component],
        labels: assigned.labels,
        ...(assigned.interaction ? { interaction: assigned.interaction } : {}),
      });
  }
  return views;
}

export function selectedPresentationViews(report: PresentationReport): NonNullable<ReturnType<typeof checkPresentation>> | null {
  if (
    !report ||
    !Array.isArray(report.views) ||
    report.views.length > 12 ||
    new Set(report.views.map((view) => view?.id)).size !== report.views.length
  )
    return null;
  const views: NonNullable<ReturnType<typeof checkPresentation>> = [];
  for (const view of report.views) {
    if (!view || typeof view.id !== "string" || !view.id) return null;
    if (view.status !== "ready") continue;
    try {
      const rendered = renderComponent(view.rendered);
      if (rendered.mdx !== view.rendered.mdx || rendered.mdx.length > 8_192)
        return null;
      views.push({
        id: view.id,
        mdx: rendered.mdx,
        selector: catalogSelectors[rendered.component],
        labels: [],
      });
    } catch {
      return null;
    }
  }
  return views;
}


export async function observePresentation(
  panel: PanelHandle,
  prepared: NonNullable<ReturnType<typeof checkPresentation>>,
  contextId: string,
  source: string,
  signal: AbortSignal,
  previewRevision?: string,
) {
  const before = await panel.observe();
  const session = await panel.cdp.session();
  let rendered;
  const close = () => {
    void session.close().catch(() => undefined);
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    signal.throwIfAborted();
    const selectors = JSON.stringify(prepared.map(({ selector }) => selector));
    const expectedRevision = JSON.stringify(previewRevision ?? null);
    const probes = JSON.stringify(
      prepared.flatMap(({ id, interaction }) =>
        interaction
          ? [
              {
                id,
                kind: interaction.kind,
                target:
                  interaction.kind === "checklist"
                    ? interaction.item
                    : undefined,
                choices:
                  interaction.kind === "choice"
                    ? interaction.choices
                    : undefined,
              },
            ]
          : [],
      ),
    );
    rendered = await session.page.evaluate<{
      ids: string[];
      revision: string | null;
      texts: string[];
      rendered: boolean[];
      errors: number;
      interactions: unknown[];
      controls?: {tag:string;role:string|null;label:string;disabled:boolean;checked:string|null;type:string|null}[][];
    }>(
      `(async () => {
        const selectors = ${selectors};
        const expectedRevision = ${expectedRevision};
        const probes = ${probes};
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const click = async (control) => {
          if (!control) throw new Error("Assigned preview control was unavailable");
          control.click();
          await frame();
        };
        const readInteraction = async (probe) => {
          const view = Array.from(document.querySelectorAll("[data-presentation-view]"))
            .find(node => node.getAttribute("data-presentation-view") === probe.id);
          if (!view) throw new Error("Assigned preview view was unavailable");
          const text = node => node?.textContent?.trim();
          if (probe.kind === "chart-table") {
            const button = view.querySelector(".vs-r-chart button[aria-pressed]");
            const before = text(button);
            await click(button);
            const table = view.querySelector(".vs-r-table-scroll table");
            const cells = Array.from(table?.rows ?? []).map(row => Array.from(row.cells).map(text));
            return { id: probe.id, kind: probe.kind, before, after: text(button), cells };
          }
          if (probe.kind === "checklist") {
            const items = Array.from(view.querySelectorAll(".vs-r-checklist li"));
            const count = () => items.filter(item => item.hasAttribute("data-checked")).length + "/" + items.length;
            const item = items.find(row => text(row.querySelector("label")) === probe.target);
            const before = count();
            if (item?.hasAttribute("data-checked")) throw new Error("Assigned checklist item was already checked");
            await click(item?.querySelector('[role="checkbox"]'));
            return { id: probe.id, kind: probe.kind, item: probe.target, before, after: count() };
          }
          const roles = '[role="radio"], [role="checkbox"]';
          const options = Array.from(view.querySelectorAll(".vs-r-choice")).map(option => ({
            label: text(option),
            control: option.matches(roles) ? option : option.querySelector(roles),
          }));
          for (const choice of probe.choices) await click(options.find(option => option.label === choice)?.control);
          return { id: probe.id, kind: probe.kind, choices: probe.choices,
            selected: options.filter(option => option.control?.getAttribute("aria-checked") === "true")
              .map(option => option.label) };
        };
        const read = () => {
          const views = Array.from(document.querySelectorAll("[data-presentation-view]"));
          const errors = document.querySelectorAll('[data-ui-render="failed"], [data-ui-feedback-category]').length;
          return {
            revision: document.querySelector("[data-presentation-preview]")?.getAttribute("data-presentation-revision") ?? null,
            ids: views.map((view) => view.getAttribute("data-presentation-view")),
            texts: views.map((view) => view.textContent),
            controls: views.map(view => Array.from(view.querySelectorAll('button,input,select,textarea,[role="radio"],[role="checkbox"]')).map(control => ({
              tag:control.tagName.toLowerCase(),role:control.getAttribute("role"),
              label:control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
              disabled:control.disabled === true || control.getAttribute("aria-disabled") === "true",
              checked:control.getAttribute("aria-checked"),type:control.getAttribute("type")
            }))),
            rendered: views.map((view, i) => !!selectors[i] && !!view.querySelector(selectors[i])),
            errors,
          };
        };
        const observed = await new Promise((resolve) => {
          const check = () => {
            const preview = document.querySelector("[data-presentation-preview]");
            if (!preview || expectedRevision !== null && preview.getAttribute("data-presentation-revision") !== expectedRevision ||
                preview.querySelector('[data-ui-render="pending"]')) return;
            const current = read();
            observer.disconnect();
            resolve(current);
          };
          const observer = new MutationObserver(check);
          observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
          check();
        });
        const interactions = [];
        for (const probe of probes) interactions.push(await readInteraction(probe));
        return { ...observed, interactions };
      })()`,
    );
  } finally {
    signal.removeEventListener("abort", close);
    if (!signal.aborted) await session.close();
  }
  const after = await panel.observe();
  const checks = {
    ownedPanel:
      before.kind === "workspace" &&
      before.contextId === contextId &&
      before.source === source &&
      before.requestedRef === `ctx:${contextId}` &&
      before.phase === "ready" &&
      Boolean(before.attemptId && before.buildKey) &&
      after.attemptId === before.attemptId &&
      after.buildKey === before.buildKey,
    exactViewOrder: isDeepStrictEqual(
      rendered.ids,
      prepared.map(({ id }) => id),
    ),
    browserRenderedCatalog:
      rendered.errors === 0 && rendered.rendered.every(Boolean),
    interactiveReadback: isDeepStrictEqual(
      rendered.interactions,
      prepared.flatMap(({ id, interaction }) =>
        interaction ? [{ id, ...interaction }] : [],
      ),
    ),
    visibleLabels: prepared.every(({ labels }, index) =>
      labels.every((label) => rendered.texts[index]?.includes(label)),
    ),
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    panelAttempt: after.attemptId,
    buildKey: after.buildKey,
    mdxDigests: prepared.map(({ mdx }) => sha256HexSyncText(mdx)),
    rendered,
  };
}
