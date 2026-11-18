import {describe,it,expect} from "vitest";
import {contentProjectRequestSchema} from "@workspace/natlang-services";
import {contentProjectWorlds} from "./content-project-worlds.js";
const siblings:Record<string,string[]>={
  "release-operations":["release-runbook","release-incident-handback"],
  "workspace-access":["role-onboarding","workspace-offboarding"],
  "inventory-migration":["migration-cutover","migration-discrepancy"],
  "research-consent":["research-session-consent","research-evidence-handoff"],
  "community-event":["event-weather-plan","event-volunteer-handoff"],
  "dataset-stewardship":["dataset-release-review","dataset-correction-recall"],
};
describe("content-project source worlds",()=>{
  it("retains exact sibling lineage for split assignment",()=>{
    const seen=new Set<string>();
    for(const [group,ids] of Object.entries(siblings)){
      expect(contentProjectWorlds.filter(w=>w.sourceGroup===`content-project/${group}-v1`).map(w=>w.id).sort()).toEqual([...ids].sort());
      for(const id of ids){expect(seen.has(id)).toBe(false);seen.add(id);}
    }
    expect([...seen].sort()).toEqual(contentProjectWorlds.map(w=>w.id).sort());
  });
  it("provides schema-valid requests and unambiguous usable fact citations",()=>{
    for(const world of contentProjectWorlds){
      expect(contentProjectRequestSchema.safeParse(world.request).success,world.id).toBe(true);
      expect(new Set(world.request.facts.map(f=>f.id)).size,world.id).toBe(world.request.facts.length);
      for(const fact of world.request.facts){expect(fact.id,world.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);expect(fact.text.trim(),world.id).not.toBe("");}
      expect(new Set(world.request.documentRoles).size,world.id).toBe(world.request.documentRoles.length);
    }
  });
  it("preserves different tasks within sibling worlds rather than paraphrased inputs",()=>{
    for(const ids of Object.values(siblings)){
      const [a,b]=ids.map(id=>contentProjectWorlds.find(w=>w.id===id)!);
      expect(a!.request.goal).not.toBe(b!.request.goal);
      expect(a!.request.audience).not.toBe(b!.request.audience);
      expect(a!.request.documentRoles).not.toEqual(b!.request.documentRoles);
      expect(a!.request.facts).not.toEqual(b!.request.facts);
    }
  });
});
