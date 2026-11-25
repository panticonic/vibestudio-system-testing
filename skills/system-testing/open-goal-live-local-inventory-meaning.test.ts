import {beforeEach,it,expect,vi} from "vitest";
const native=vi.hoisted(()=>({files:new Map<string,string>()}));
vi.mock("@workspace/runtime",()=>({contextId:"owned",vcs:{status:async()=>({workingHead:{eventId:"main"},mainEventId:"main"})},fs:{mkdtemp:async()=>"/owned-docket",writeFile:async(path:string,text:string)=>{native.files.set(path,text);},readFile:async(path:string)=>native.files.get(path)}}));
import {prepareOpenLiveLocalInventory} from "./open-goal-live-local-inventory-managed.js";
import {openLiveLocalInventoryWorlds} from "./open-goal-live-local-inventory-worlds.js";
import {prepareLocalModelComparison} from "@workspace-skills/local-model-task-bindings/live";
const inventory=["lfm3-1.7b","lfm2.5-2.6b","qwen3.8-27b","qwen3.5-4b","qwen3.5-9b","gpt-oss-20b"].map((slug,index)=>({slug,displayName:slug,baseUrl:"http://localhost:8080",server:"main",maxTokens:32768,contextWindow:index===2?131072:32768,toolsCapable:index!==0,reasoningCapable:false,fit:{fit:"cpu-only",estTokensPerSec:null,contextLength:32768,gpuLayers:0,notes:[]},measuredTokensPerSec:null,state:"startable",download:null,errorMessage:null}));
const port={invoke:async()=>structuredClone(inventory)};
beforeEach(()=>native.files.clear());
it.each(openLiveLocalInventoryWorlds)("$id binds current native catalog facts and actual requested findings",async world=>{
 const fixture=await prepareOpenLiveLocalInventory({contextId:"owned",caseId:world.id,goal:world.goal},world,(contextId,selected)=>prepareLocalModelComparison(port,contextId,selected));
 const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput.actual.observations.inventoryReadback.rows).toEqual(proof.native.rows);
 expect(proof.semanticReviewInput.actual.observations.inventoryReadback).not.toHaveProperty("expected");
 expect(proof.outcomeDimensions.returnedValue.required).toBe(true);
});
it("preserves catalog truth checks and source-binds an explanation rather than treating nonempty prose as verified meaning",async()=>{
 const world=openLiveLocalInventoryWorlds[0]!;
 const fixture=await prepareOpenLiveLocalInventory({contextId:"owned",caseId:world.id,goal:world.goal},world,(contextId,selected)=>prepareLocalModelComparison(port,contextId,selected));
 const qualified=await fixture.qualify();const report=qualified.native.expected;
 const wrongExplanation={report,reason:"A made-up explanation that must be judged against actual catalog and workload requirements"};
 const proof=await fixture.verify(wrongExplanation);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(wrongExplanation);
 expect((await fixture.verify({report:{...report,state:"not-installed"},reason:"Invented availability"})).passed).toBe(false);
});

it("can complete a current catalog query after a real external state change and fresh native observations",async()=>{
 const world=openLiveLocalInventoryWorlds.find(row=>row.id==="live-local-inventory-textile-notes-standalone")!;
 let comparison:Awaited<ReturnType<typeof prepareLocalModelComparison>>;
 const fixture=await prepareOpenLiveLocalInventory({contextId:"owned",caseId:world.id,goal:world.goal},world,async(contextId,selected)=>(comparison=await prepareLocalModelComparison(port,contextId,selected)));
 const initial=await fixture.qualify();const original=inventory[0]!.state;
 try{
  inventory[0]!.state="starting";
  expect((await fixture.verify({report:initial.native.expected,reason:"Old availability"})).passed).toBe(false);
  for(const candidate of world.preferences)await fixture.services.localModelTaskInventory.inspect(candidate.ref);
  const refreshed=await fixture.verify({report:comparison!.expected,reason:"The initial option is now starting; the current fallback remains eligible for a fresh conversation"});
  expect(refreshed.passed).toBe(true);expect(refreshed.native.checks.currentInventory).toBe(true);
  expect(refreshed.native.rows).not.toEqual(refreshed.native.initialRows);
  expect(refreshed.semanticReviewInput.actual.observations.inventoryReadback.observations).toEqual(refreshed.native.observations);
 }finally{inventory[0]!.state=original;}
});
