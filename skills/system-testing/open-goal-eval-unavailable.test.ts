import {it,expect,vi} from "vitest";
import {prepareOpenEvalHandoff} from "./open-goal-eval-handoff-managed.js";
import {openGoalEvalHandoffWorlds} from "./open-goal-eval-handoff-worlds.js";
it("verifies the actual unavailable result without inventing a review collection for a nonexistent active job",async()=>{
 const world=openGoalEvalHandoffWorlds.find(row=>row.id==="eval-handoff-archive-is-not-active-mapping")!;
 const files=new Map<string,string>(),head={mainEventId:"main",workingHead:{eventId:"working"}};
 const forbidden=vi.fn(async()=>{throw new Error("No native run exists for this archived-only catalog");});
 const fixture=await prepareOpenEvalHandoff({contextId:"owned",caseId:world.id},world,{contextId:"owned",fs:{mkdtemp:async()=>"/owned-docket",writeFile:async(path:string,text:string)=>{files.set(path,text);},readFile:async(path:string)=>files.get(path)} as never,vcs:{status:async()=>structuredClone(head)} as never,native:{run:forbidden,retained:forbidden,replay:forbidden,readText:forbidden,close:async()=>{}} as never,readBytes:forbidden});
 try{
  expect((await fixture.qualify()).passed).toBe(true);
  const actual={status:"unresolved",reason:"job-unavailable"};const verified=await fixture.verify(actual);
  expect(verified.passed).toBe(true);expect(verified.outcomeDimensions.returnedValue.required).toBe(true);
  expect(verified.checks.returnedEvalReviews).toBe(true);expect(verified.checks.reconciledEvalHandoff).toBe(true);
  expect(verified.outcomeDimensions.returnedValue.passed).toBe(true);
  for(const report of [null,{status:"unresolved",reason:"invented"},{status:"reviewed",jobId:"foreign",reviews:[],decision:{action:"hold",reason:"no-confirmed-effect"},result:null,artifact:null}])expect((await fixture.verify(report)).passed).toBe(false);
  expect(forbidden).not.toHaveBeenCalled();
 }finally{await fixture.close();}
});
