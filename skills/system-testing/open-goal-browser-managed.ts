import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { PanelCdpSessionReceipt, PanelHandle } from "@workspace/runtime";
import type { BrowserGoalWorld } from "./open-goal-browser-worlds.js";

type GoalInput = { contextId: string; caseId: string; source: string };
type Row = { label: string; state: string; detail: string };
type Visible = { heading: string; rows: (Row & { controls: { id: string; label: string }[] })[] };
type View = Visible & { revision: string };
type Report = { status?: string; rows?: Row[]; revision?: string };
type Attempt = { control: string; label?: string; revision: string; result: string; inspection: number;
  binding?: PanelCdpSessionReceipt };

// Page contents are data. The only supported actuation is an observed button in this panel.
const readView = `() => {
  const region = document.querySelector("[data-open-goal-panel]");
  const text = element => element?.textContent?.trim() ?? "";
  return {
    heading: text(region?.querySelector("h1")),
    rows: Array.from(region?.querySelectorAll("[data-open-goal-row]") ?? []).map(row => ({
      label: text(row.querySelector("h2")),
      state: text(row.querySelector("[data-state]")),
      detail: text(row.querySelector("[data-detail]")),
      controls: Array.from(row.querySelectorAll("button[data-goal-control]")).map(button => ({
        id: button.getAttribute("data-goal-control"), label: text(button),
      })),
    })),
  };
}`;
const stateOf = ({ label, state, detail }: Row): Row => ({ label, state, detail });

export function prepareBrowserGoal(panel: PanelHandle, input: GoalInput, world: BrowserGoalWorld) {
  const { goal } = world;
  const expectedChanges = world.expected.changes ?? [];
  async function observe() {
    const identity = await panel.observe();
    if (identity.kind !== "workspace" || identity.panelId !== panel.id ||
        identity.contextId !== input.contextId || identity.source !== input.source)
      throw new Error("The renderer does not belong to the current goal workspace");
    const session = await panel.cdp.session();
    try {
      await session.page.waitForSelector("[data-open-goal-panel] h1");
      const raw = await session.page.evaluate<Visible>(`(${readView})()`);
      const current = await panel.observe();
      const binding = session.receipt;
      if (!binding || binding.generation.panelId !== panel.id ||
          binding.generation.attemptId !== current.attemptId || binding.generation.buildKey !== current.buildKey ||
          current.attemptId !== identity.attemptId || current.buildKey !== identity.buildKey)
        throw new Error("The browser renderer changed during inspection");
      const view: View = { ...raw, revision: sha256HexSyncText(JSON.stringify(raw)) };
      return { view, binding, attemptId: current.attemptId, buildKey: current.buildKey };
    } finally {
      await session.close();
    }
  }

  const inspections: Awaited<ReturnType<typeof observe>>[] = [];
  const attempts: Attempt[] = [];
  const services = {
    goalBrowser: {
      async inspect() {
        const snapshot = await observe();
        inspections.push(snapshot);
        return snapshot.view;
      },
      async activate(control: string, revision: string) {
        const latest = inspections.at(-1);
        const owner = latest?.view.rows.find(row => row.controls.some(item => item.id === control));
        const attempt: Attempt = { control, label: owner?.label, revision, result: "unavailable", inspection: inspections.length - 1 };
        attempts.push(attempt);
        if (!expectedChanges.length || !owner || !latest)
          return attempt.result;
        const current = await observe();
        if (revision !== latest.view.revision || current.view.revision !== revision ||
            current.attemptId !== latest.attemptId || current.buildKey !== latest.buildKey) {
          attempt.result = "changed";
          return attempt.result;
        }
        const session = await panel.cdp.session();
        try {
          await session.page.waitForSelector("[data-open-goal-panel] h1");
          const binding = session.receipt;
          if (!binding || binding.generation.attemptId !== current.attemptId ||
              binding.generation.buildKey !== current.buildKey || binding.generation.panelId !== panel.id) {
            attempt.result = "changed";
            return attempt.result;
          }
          attempt.binding = binding;
          const basis = { heading: current.view.heading, rows: current.view.rows };
          attempt.result = await session.page.evaluate<string>(`(() => {
            if (JSON.stringify((${readView})()) !== ${JSON.stringify(JSON.stringify(basis))}) return "changed";
            const control = Array.from(document.querySelectorAll("[data-open-goal-panel] button[data-goal-control]"))
              .find(button => button.getAttribute("data-goal-control") === ${JSON.stringify(control)});
            if (!(control instanceof HTMLButtonElement) || control.disabled) return "unavailable";
            control.click();
            return "activated";
          })()`);
          return attempt.result;
        } finally {
          await session.close();
        }
      },
    },
  };

  async function verify(value: unknown) {
    const report = value as Report | null;
    const after = await observe();
    const before = inspections[0];
    const start = world.rows.map(stateOf);
    const final = start.map(row => {
      const change = expectedChanges.find(({ label }) => label === row.label);
      return change ? { ...row, state: change.state } : row;
    });
    const selected = final.filter(({ label }) => world.expected.labels.includes(label))
      .sort((left, right) => left.label.localeCompare(right.label));
    const returned = [...(Array.isArray(report?.rows) ? report.rows : [])]
      .sort((left, right) => left.label.localeCompare(right.label));
    const changes = attempts.filter(item => item.result === "activated");
    const checks = {
      discoveredBrowser: Boolean(before && before.view.heading === world.heading &&
        isDeepStrictEqual(before.view.rows.map(stateOf), start)),
      readBackBrowser: Boolean(before && inspections.at(-1)?.view.revision === after.view.revision &&
        inspections.every(item => item.attemptId === after.attemptId && item.buildKey === after.buildKey)),
      exactPanelOutcome: isDeepStrictEqual(after.view.rows.map(stateOf), final),
      respectedBrowserAuthority: expectedChanges.length ? changes.length === expectedChanges.length &&
        changes.every((attempt, index) => {
          const expected = expectedChanges[index];
          const next = inspections[attempt.inspection + 1]?.view;
          return attempt.label === expected?.label && attempt.revision === inspections[attempt.inspection]?.view.revision &&
            next?.revision !== attempt.revision && next?.rows.some(({ label, state }) =>
              label === expected?.label && state === expected?.state);
        })
        : attempts.length === 0,
      reportedVisibleRows: report?.status === (expectedChanges.length ? "changed" : "observed") &&
        report.revision === after.view.revision && isDeepStrictEqual(returned, selected),
    };
    return { passed: Object.values(checks).every(Boolean), ...input, goal, panelId: panel.id,
      inspections, attempts, after, checks };
  }
  async function qualify() {
    let view = await services.goalBrowser.inspect();
    for (const change of expectedChanges) {
      const seed = world.rows.find(row => row.label === change.label);
      const control = seed?.controls.find(item => item.nextState === change.state);
      const visible = view.rows.find(row => row.label === change.label)
        ?.controls.find(item => item.label === control?.label);
      if (!visible || await services.goalBrowser.activate(visible.id, view.revision) !== "activated")
        throw new Error("The reference browser action did not apply");
      view = await services.goalBrowser.inspect();
    }
    return verify({
      status: expectedChanges.length ? "changed" : "observed", revision: view.revision,
      rows: view.rows.filter(({ label }) => world.expected.labels.includes(label)).map(stateOf),
    });
  }
  return { goal, services, verify, qualify };
}
