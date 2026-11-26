import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
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

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[];
    const contributions=authored.filter(binding=>{
      let current:unknown=value;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,value,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations) {
    const report = value as Report | null;
    const after = await observe();
    const before = inspections[0];
    const start = world.rows.map(stateOf);
    const final = start.map(row => {
      const change = expectedChanges.findLast(({ label }) => label === row.label);
      return change ? { ...row, state: change.state } : row;
    });
    const selected = final.filter(({ label }) => world.expected.labels.includes(label))
      .sort((left, right) => left.label.localeCompare(right.label));
    const returned = [...(Array.isArray(report?.rows) ? report.rows : [])]
      .sort((left, right) => left.label.localeCompare(right.label));
    const changes = attempts.filter(item => item.result === "activated");
    const choices=invocation?await invocation.returns(call=>call.definition.source.endsWith("workInBrowser/choosePanelAction.nl")):[];
    const expectedLabels=[...new Set(world.expected.labels)].sort();
    const incorrectSelections=choices.filter(call=>{
      const choice=call.value;
      if(!choice||typeof choice!=="object"||!("kind" in choice)||choice.kind!=="report")return false;
      return !("labels" in choice)||!Array.isArray(choice.labels)||choice.labels.some(label=>typeof label!=="string")||
        !isDeepStrictEqual([...new Set(choice.labels)].sort(),expectedLabels);
    }).map(call=>({callId:call.callId,checks:["incidentalBrowserSelection"],required:false,definition:call.definition,value:call.value,valueJson:call.valueJson}));
    const checks = {
      incidentalBrowserSelection:incorrectSelections.length===0,
      discoveredBrowser: Boolean(before && before.view.heading === world.heading &&
        isDeepStrictEqual(before.view.rows.map(stateOf), start)),
      readBackBrowser: Boolean(before && inspections.at(-1)?.view.revision === after.view.revision &&
        inspections.every(item => item.attemptId === after.attemptId && item.buildKey === after.buildKey)),
      exactPanelOutcome: isDeepStrictEqual(after.view.rows.map(stateOf), final),
      respectedBrowserAuthority: expectedChanges.length ? changes.length === expectedChanges.length &&
        changes.every((attempt, index) => {
          const expected = expectedChanges[index];
          const current = inspections[attempt.inspection]?.view;
          const next = inspections[attempt.inspection + 1]?.view;
          const selected = current?.rows.find(row => row.label === attempt.label)?.controls.find(({ id }) => id === attempt.control);
          return (!expected?.control || selected?.label === expected.control) &&
            attempt.label === expected?.label && attempt.revision === inspections[attempt.inspection]?.view.revision &&
            next?.revision !== attempt.revision && next?.rows.some(({ label, state }) =>
              label === expected?.label && state === expected?.state);
        })
        : attempts.length === 0,
      reportedVisibleRows: report?.status === (expectedChanges.length ? "changed" : "observed") &&
        report.revision === after.view.revision && isDeepStrictEqual(returned, selected),
    };
    return {
      incorrectReturnValues:incorrectSelections,
 passed: Object.values(checks).every(Boolean), ...input, goal, panelId: panel.id,
      inspections, attempts: structuredClone(attempts), after, checks,
      outcomeContract:{effects:{checks:["discoveredBrowser", "readBackBrowser", "exactPanelOutcome", "respectedBrowserAuthority"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["reportedVisibleRows"],required:expectedChanges.length===0,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:["incidentalBrowserSelection"],rationale:"An independently observed incorrect terminal row selection is held at its actual sampled definition; correct prior actions and native effects remain usable."}}
    };
  }
  async function qualify() {
    let view = await services.goalBrowser.inspect();
    for (const change of expectedChanges) {
      const seed = world.rows.find(row => row.label === change.label);
      const control = seed?.controls.find(item => item.nextState === change.state && (!change.control || item.label === change.control));
      const visible = view.rows.find(row => row.label === change.label)
        ?.controls.find(item => item.label === control?.label);
      if (!visible || await services.goalBrowser.activate(visible.id, view.revision) !== "activated")
        throw new Error("The reference browser action did not apply");
      view = await services.goalBrowser.inspect();
    }
    const report = {
      status: expectedChanges.length ? "changed" : "observed", revision: view.revision,
      rows: view.rows.filter(({ label }) => world.expected.labels.includes(label)).map(stateOf),
    };
    const verified = await verify(report);
    const negative = await verify({ ...report, revision: "different-viewport-revision" });
    const control = view.rows.flatMap(row => row.controls)[0]?.id ?? "missing-control";
    const rejectsControlAlias = await services.goalBrowser.activate(`./${control}`, view.revision) === "unavailable" &&
      (await observe()).view.revision === view.revision;
    const checks = { ...verified.checks, rejectsControlAlias, rejectsWrongReadback: !negative.outcomeDimensions.returnedValue.passed };
    return assessNativeQualification({ ...verified,outcomeContract:{...verified.outcomeContract,effects:{...verified.outcomeContract.effects,checks:[...verified.outcomeContract.effects.checks,"rejectsControlAlias","rejectsWrongReadback"]}}, checks, passed: Object.values(checks).every(Boolean) });
  }
  return { goal, services, verify, qualify };
}
