import {expect,it} from "vitest";
import {readFile} from "node:fs/promises";
import * as continuity from "@workspace-clients/mobile-browser/continuity";
import {prepareOpenMobileContinuity} from "./open-continuity.js";
import {openMobileContinuityWorlds} from "@workspace-skills/system-testing/open-goal-mobile-continuity-worlds";

async function fixture(){
 const world=openMobileContinuityWorlds.find(w=>w.id==="mobile-continuity-live-other-client-owns-overview")!;
 const files=new Map<string,string>(),directory="/.tmp/mobile-component";
 const system=process.env.MOBILE_CONTINUITY_SYSTEM_ROOT!;
 const fs={mkdtemp:async()=>directory,writeFile:async(p:string,s:string)=>{files.set(p,s);},readFile:async(p:string)=>files.has(p)?files.get(p)!:readFile(system+p,"utf8"),readdir:async()=>[...files.keys()].map(p=>p.slice(directory.length+1)),rm:async()=>{files.clear();}};
 const state={workingHead:{kind:"event",eventId:"native-protected"},mainEventId:"native-main"};
 const prepared=await prepareOpenMobileContinuity({contextId:"mobile-owned",caseId:world.id},world,{contextId:"mobile-owned",fs:fs as never,vcs:{status:async()=>structuredClone(state)} as never,continuity});
 return {...prepared,world,files,state};
}
it("retains actual foreign-lease evidence and accepts a requested finding without private enum, ID or vocabulary echoes",async()=>{
 const f=await fixture();try{
 const s=f.services.mobileContinuity,profiles=await s.discover(),current=profiles.find(p=>p.edition==="current")!;
 await s.profile(current.id); // No unrequested archive inspection.
 await Promise.all([s.build(current.id),s.cache(current.id),s.transport(current.id),s.routes(current.id)]);
 const answer="The retained overview belongs to another client. You cannot keep using it from this handset without taking it back; leave its ownership unchanged. This is local retained-state evidence, not physical-device proof.";
 const proof=await f.verify(answer);
 expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput).not.toBeNull();
 expect(proof.observations.routes.lost).toContain("panel:tree/overview");expect(proof.observations.routes.unleased).toEqual([]);
 expect(proof.semanticReviewInput!.actual.observations).toEqual({profile:proof.profile,observations:proof.observations,journal:proof.journal});
 expect((await f.verify("")).outcomeDimensions.returnedValue.passed).toBe(false);
 expect((await f.verify({profile:current.id,action:"hold",reason:"foreign"})).outcomeDimensions.returnedValue.passed).toBe(false);
 await expect(s.profile("foreign")).rejects.toThrow();
 f.state.mainEventId="changed";expect((await f.verify(answer)).outcomeDimensions.effects.passed).toBe(false);
 }finally{await f.close();}
});
it("requires actual current native observations and refuses changed retained records",async()=>{
 const f=await fixture();try{
 expect((await f.verify("Cannot use the overview.")).outcomeDimensions.effects.passed).toBe(false);
 const s=f.services.mobileContinuity,profiles=await s.discover(),current=profiles.find(p=>p.edition==="current")!;await s.profile(current.id);
 const path=[...f.files.keys()].find(p=>p.endsWith(current.id+".json"))!;f.files.set(path,"{}");
 await expect(s.routes(current.id)).rejects.toThrow("record changed");
 }finally{await f.close();}
});
