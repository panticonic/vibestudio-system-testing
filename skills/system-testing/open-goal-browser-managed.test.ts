// @vitest-environment jsdom
import {createHash} from "node:crypto";
import {observeInvocation} from "@workspace/application-outcomes/observed-invocation";
import { act, render, cleanup } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as React from "react";
import type { PanelHandle } from "@workspace/runtime";
import { expect, it, afterEach } from "vitest";
import { prepareBrowserGoal } from "./open-goal-browser-managed.js";
import { openGoalBrowserPanelSource } from "./open-goal-browser-panel.js";
import { browserGoalWorlds, type BrowserGoalWorld } from "./open-goal-browser-worlds.js";

afterEach(cleanup);

function bind(world: BrowserGoalWorld) {
  const esbuild = createRequire(join(process.cwd(), "package.json")).resolve("esbuild/bin/esbuild");
  const code = execFileSync(esbuild, ["--loader=tsx", "--format=cjs"], {
    input: openGoalBrowserPanelSource, encoding: "utf8",
  });
  const module = { exports: {} as { default: React.ComponentType } };
  new Function("module", "exports", "require", "React", code)(module, module.exports,
    (name: string) => name === "react" ? React : { useStateArgs: () => ({ heading: world.heading, rows: world.rows }) },
    React);
  render(React.createElement(module.exports.default));
  const input = { contextId: "owned", caseId: world.id, source: "panels/owned" };
  const panel = {
    id: "panel-live",
    observe: async () => ({ ...input, kind: "workspace", panelId: "panel-live", attemptId: "attempt", buildKey: "build" }),
    cdp: {
      session: async () => ({
        receipt: { status: "acquired", generation: { panelId: "panel-live", attemptId: "attempt", buildKey: "build" } },
        close: async () => {},
        page: {
          waitForSelector: async (selector: string) => {
            expect(document.querySelector(selector)).not.toBeNull();
          },
          async evaluate(script: string) {
            let result: unknown;
            await act(async () => { result = new Function(`return ${script}`)(); });
            return result;
          },
        },
      }),
    },
  };
  return prepareBrowserGoal(panel as unknown as PanelHandle, input, world);
}

it("checks a revision before activating and verifies the independently observed result", async () => {
  const world = browserGoalWorlds[0]!;
  const prepared = bind(world);
  const browser = prepared.services.goalBrowser;
  const before = await browser.inspect();
  const row = before.rows.find(item => item.detail.includes("remains unresolved"))!;
  const control = row.controls.find(item => item.label === "Send to inspection")!;
  expect(await browser.activate(control.id, "stale-revision")).toBe("changed");
  expect((await browser.inspect()).revision).toBe(before.revision);
  expect(await browser.activate(control.id, before.revision)).toBe("activated");
  const after = await browser.inspect();
  const edited = after.rows.find(item => item.label === row.label)!;
  expect(edited.state).toBe("In inspection");
  const reply = { status: "changed", revision: after.revision,
    rows: [{ label: edited.label, state: edited.state, detail: edited.detail }] };
  expect((await prepared.verify(reply)).passed).toBe(true);
  expect((await prepared.verify({ ...reply, revision: before.revision })).outcomeDimensions.returnedValue.passed).toBe(false);
  const value={...reply,rows:[]},texts=new Map<string,string>();
  const rows=[{id:"root",parent:null,kind:"crisp",value},
    {id:"correct-action",parent:"root",kind:"agent",value:{kind:"act",control:control.id}},
    {id:"wrong-terminal-selection",parent:"root",kind:"agent",value:{kind:"report",labels:["unrelated row"]}}];
  const calls=rows.map(row=>{const text=JSON.stringify(row.value),hash=createHash("sha256").update(text).digest("hex");texts.set(hash,text);return {callId:row.id,summary:{run_id:"run",owner_key:"owner",owner_kind:"eval"},record:{call_id:row.id,parent_call_id:row.parent,definition:{name:row.id,source:row.id==="root"?"workInBrowser.ts":"workInBrowser/choosePanelAction.nl"},executor:{kind:row.kind,model_id:row.kind==="agent"?"test:offline":null},cost:{model_requests:row.kind==="agent"?1:0},outcome:"done",output:{complete:true,hash}}};});
  const invocation=observeInvocation({evalRunId:"run",rootCallIds:["root"],captureErrors:[],calls},async hash=>texts.get(hash)??null);
  const partial=await prepared.verify(value,invocation);
  expect(partial.outcomeDimensions.effects.passed).toBe(true);
  expect(partial.passed).toBe(true);
  expect(partial.incorrectReturnValues.some(row=>row.definition.name==="wrong-terminal-selection")).toBe(true);
  expect(partial.incorrectReturnValues.some(row=>row.definition.name==="correct-action")).toBe(false);
  cleanup();
  const qualified = await bind(world).qualify();
  expect(qualified.passed).toBe(true);
  expect(qualified.outcomeDimensions.effects.checks.rejectsControlAlias).toBe(true);
  expect(qualified.outcomeDimensions.effects.checks.rejectsWrongReadback).toBe(true);

});

it("allows observation of the checklist and denies changes on a read-only goal", async () => {
  const world = browserGoalWorlds[1]!;
  const prepared = bind(world);
  const browser = prepared.services.goalBrowser;
  const snapshot = await browser.inspect();
  const candidates = snapshot.rows.filter(row => row.state === "Caption needed");
  const report = { status: "observed", revision: snapshot.revision,
    rows: candidates.map(({ label, state, detail }) => ({ label, state, detail })) };
  expect((await prepared.verify(report)).passed).toBe(true);
  expect(await browser.activate(candidates[0]!.controls[0]!.id, snapshot.revision)).toBe("unavailable");
  expect((await browser.inspect()).revision).toBe(snapshot.revision);
  expect((await prepared.verify(report)).passed).toBe(false);
});

it.each([true, false])("requires the requested dispatch order (%s)", async (inOrder) => {
  const world = browserGoalWorlds.find(({ id }) => id === "sequence-studio-dispatch")!;
  const prepared = bind(world);
  const browser = prepared.services.goalBrowser;
  let snapshot = await browser.inspect();
  const steps = [["Gold folder", "Return to review"], ["Blue folder", "Queue for delivery"]];
  for (const [label, action] of inOrder ? steps : steps.reverse()) {
    const target = snapshot.rows.find(row => row.label === label)!;
    const control = target.controls.find(item => item.label === action)!;
    expect(await browser.activate(control.id, snapshot.revision)).toBe("activated");
    snapshot = await browser.inspect();
  }
  const rows = snapshot.rows.filter(row => world.expected.labels.includes(row.label))
    .map(({ label, state, detail }) => ({ label, state, detail }));
  const verification = await prepared.verify({ status: "changed", revision: snapshot.revision, rows });
  expect(verification.checks.exactPanelOutcome).toBe(true);
  expect(verification.passed).toBe(inOrder);
});
