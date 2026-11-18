import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { PanelHandle } from "@workspace/runtime";
import { renderComponent } from "@workspace-skills/visualize/render";
import type { PresentationReport } from "@workspace-skills/visualize/types";
import type { PresentationWorld } from "./presentation-worlds.js";

const catalogSelectors = {
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
  }[] = [];
  for (const [index, target] of expected.views.entries()) {
    const actual = report.views[index];
    if (!actual || target.id !== actual.id || target.status !== actual.status)
      return null;
    if (actual.status === "needs-review") {
      if (
        typeof actual.reason !== "string" ||
        !/(?:capacity|capacities)/iu.test(actual.reason) ||
        !/(?:missing|unconfirmed|not (?:given|provided|confirmed|verified)|lack)/iu.test(
          actual.reason,
        )
      )
        return null;
      continue;
    }
    if (!isDeepStrictEqual(actual, target)) {
      if (
        actual.status !== "ready" ||
        target.status !== "ready" ||
        !actual.rendered ||
        !isDeepStrictEqual(actual.rendered.props, target.rendered.props) ||
        actual.rendered.component !== target.rendered.component ||
        actual.rendered.mdx !== renderComponent(actual.rendered).mdx
      )
        return null;
    }
    const assigned = world.expected[index]!;
    if ("labels" in assigned && actual.status === "ready")
      views.push({
        id: actual.id,
        mdx: actual.rendered.mdx,
        selector: catalogSelectors[assigned.component.component],
        labels: assigned.labels,
      });
  }
  return views;
}

export async function observePresentation(
  panel: PanelHandle,
  prepared: NonNullable<ReturnType<typeof checkPresentation>>,
  contextId: string,
  source: string,
  signal: AbortSignal,
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
    rendered = await session.page.evaluate<{
      ids: string[];
      texts: string[];
      rendered: boolean[];
      errors: number;
    }>(
      `(async () => {
        const selectors = ${selectors};
        const read = () => {
          const views = Array.from(document.querySelectorAll("[data-presentation-view]"));
          const errors = document.querySelectorAll('[data-ui-render="failed"], [data-ui-feedback-category]').length;
          return {
            ids: views.map((view) => view.getAttribute("data-presentation-view")),
            texts: views.map((view) => view.textContent),
            rendered: views.map((view, i) => !!selectors[i] && !!view.querySelector(selectors[i])),
            errors,
          };
        };
        return await new Promise((resolve) => {
          const check = () => {
            const preview = document.querySelector("[data-presentation-preview]");
            if (!preview || preview.querySelector('[data-ui-render="pending"]')) return;
            const current = read();
            observer.disconnect();
            resolve(current);
          };
          const observer = new MutationObserver(check);
          observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
          check();
        });
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
