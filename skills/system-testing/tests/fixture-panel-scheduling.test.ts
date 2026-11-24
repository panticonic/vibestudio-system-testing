import {expect,it} from "vitest";
import {managedWebBriefTests} from "./web-brief-managed.js";
import {managedSpectroliteTests} from "./spectrolite-managed.js";
import {panelTests} from "./panels.js";
import {spectroliteGoalWorlds,openGoalPdfVaultWorlds} from "../open-goal-worlds.js";
import {openVaultKnowledgeWorlds} from "../open-goal-vault-knowledge-worlds.js";
import {PANEL_AUTOMATION_RESOURCE as resource} from "../panel-authority.js";

it("shares only audited owned Spectrolite fixture families and retains the same global-tree conflict",()=>{
  const worlds=[...spectroliteGoalWorlds,...openVaultKnowledgeWorlds,...openGoalPdfVaultWorlds].flatMap(world=>[false,true].map(qualification=>({world,qualification})));
  expect(worlds.length).toBeGreaterThan(0);
  const fixtures=worlds.map(({world,qualification})=>{
    const test=managedWebBriefTests.find(test=>test.name===`open-goal-${qualification?"oracle-":""}${world.id}`);
    expect(test).toBeDefined();return test!;
  });
  for(const test of [...fixtures,...managedSpectroliteTests]){
    expect(test.sharedResources).toEqual([resource]);expect(test.resources??[]).not.toContain(resource);
  }
  expect(panelTests.length).toBeGreaterThan(0);
  for(const test of panelTests){expect(test.resources).toContain(resource);expect(test.sharedResources??[]).not.toContain(resource);}
});
