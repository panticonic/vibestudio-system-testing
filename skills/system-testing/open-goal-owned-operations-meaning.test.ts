import {beforeEach,it,expect,vi} from "vitest";
const native=vi.hoisted(()=>({files:new Map<string,string>(),contexts:new Set<string>(),entities:new Map<string,any>(),sequence:0}));
vi.mock("@workspace/runtime",()=>({contextId:"owned",vcs:{status:async()=>({workingHead:{eventId:"main"}})},fs:{mkdtemp:async()=>"/owned/docket-"+(++native.sequence),writeFile:async(path:string,text:string)=>{native.files.set(path,text);},exists:async(path:string)=>native.files.has(path)},runtime:{
 createContext:async()=>{const contextId="context-"+(++native.sequence);native.contexts.add(contextId);return {contextId};},
 createEntity:async(input:any)=>{const id="entity-"+(++native.sequence),targetId="target-"+id;const row={id,kind:"do",contextId:input.contextId,targetId,state:{revision:0,checkpoints:[]}};native.entities.set(id,row);return {id,kind:"do",contextId:input.contextId,targetId};},
 retireEntity:async({id}:any)=>{native.entities.delete(id);},destroyContext:async({contextId}:any)=>{native.contexts.delete(contextId);},listEntities:async()=>[...native.entities.values()].map(({state,...row})=>row),listContexts:async()=>({contexts:[...native.contexts]}),
 supervision:{describe:async(key:any)=>[{entityId:key.entityId,generation:1}],restart:async()=>{}},
},rpc:{call:async(target:string,method:any,args:any[])=>{
 if(target==="main") {const bytes=new TextEncoder().encode(native.files.get(args[0])!);return {base64:Buffer.from(bytes).toString("base64"),truncated:false,start:0,end:bytes.length,totalBytes:bytes.length};}
 const entity=[...native.entities.values()].find(row=>row.targetId===target);if(!entity)throw new Error("Missing native target");
 if(method.name==="append"){if(args[0]!==entity.state.revision)throw new Error("Revision conflict");entity.state.revision++;entity.state.checkpoints.push({revision:entity.state.revision,assessment:structuredClone(args[1])});}
 else if(method.name!=="snapshot")throw new Error("Unexpected native method");return structuredClone(entity.state);
}}}));
import {prepareOpenOwnedOperations} from "./open-goal-owned-operations-managed.js";
import {openOwnedOperationsWorlds} from "./open-goal-owned-operations-worlds.js";
beforeEach(()=>{native.files.clear();native.contexts.clear();native.entities.clear();native.sequence=0;});
it.each(openOwnedOperationsWorlds)("$id binds real native custody and requested meaning independently",async world=>{
 const fixture=await prepareOpenOwnedOperations({contextId:"owned",caseId:world.id,goal:world.goal},world);
 try {const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(world.requestedReturnRequired);expect(proof.semanticReviewInput.actual.observations.audit).toEqual(proof.audit);expect(proof.semanticReviewInput.actual.artifacts.dossierReadback).toEqual(proof.dossierReadback);}finally{await fixture.close();}
});
it("does not force a worker/report route for a requested docket assessment, while binding any supplied native references",async()=>{
 const world=openOwnedOperationsWorlds.find(row=>row.id==="owned-operations-billing-view-reading")!;
 const fixture=await prepareOpenOwnedOperations({contextId:"owned",caseId:world.id,goal:world.goal},world);
 try{
  const docket=[...native.files.values()].map(text=>JSON.parse(text)).find(row=>row.docket.edition==="current")!.docket;
  await fixture.services.operationsDocket.read(docket.id,docket.revision);
  const report={docket:null,operation:null,dossier:null,disposition:"held",reason:"The current docket says customers still lack their current-cycle total; recovery alone does not clear impact."};
  const proof=await fixture.verify(report);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);expect(native.entities.size).toBe(0);
  const forged={...report,operation:{kind:"incident-handoff",handoff:{decision:"ready",evidenceIds:["customer-view"],summary:"unsupported"},handles:[{id:"foreign",contextId:"foreign",targetId:"foreign",role:"impact"}],cleanup:{retiredIds:[],destroyedContextIds:[]}}};
  expect((await fixture.verify(forged)).passed).toBe(false);
 }finally{await fixture.close();}
});
it("does not waive a requested native private dossier merely because a redundant return is optional",async()=>{
 const world=openOwnedOperationsWorlds.find(row=>row.id==="owned-operations-register-staff-training")!;
 const fixture=await prepareOpenOwnedOperations({contextId:"owned",caseId:world.id,goal:world.goal},world);
 try{const rows=await fixture.services.operationsDocket.list(),current=rows.find(row=>row.edition==="current")!;await fixture.services.operationsDocket.read(current.id,current.revision);const proof=await fixture.verify(null);expect(proof.passed).toBe(false);expect(proof.checks.actualPrivateDossierReadback).toBe(false);}finally{await fixture.close();}
});

it("joins actual worker resources at verification without imposing an explicit model cleanup call",async()=>{
 const world=openOwnedOperationsWorlds.find(row=>row.id==="owned-operations-billing-view-reading")!;
 const fixture=await prepareOpenOwnedOperations({contextId:"owned",caseId:world.id,goal:world.goal},world);
 try{
  const current=(await fixture.services.operationsDocket.list()).find(row=>row.edition==="current")!;
  await fixture.services.operationsDocket.read(current.id,current.revision);
  const handle=await fixture.services.ownedOperations.open("impact");
  await fixture.services.ownedOperations.append(handle,0,{role:"impact",decision:"blocked",evidenceIds:["customer-view"],reason:"Current-cycle total absent"});
  expect(native.entities.size).toBe(1);
  const proof=await fixture.verify({docket:null,operation:null,dossier:null,disposition:"held",reason:"Customers remain affected despite recovery readiness"});
  expect(proof.passed).toBe(true);expect(proof.audit.programRequestedCleanup).toBe(false);
  expect(proof.audit.retiredIds).toEqual([handle.id]);expect(native.entities.size).toBe(0);expect(native.contexts.size).toBe(0);
 }finally{await fixture.close();}
});
