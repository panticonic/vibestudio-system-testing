import{createHash}from"node:crypto";
import {beforeEach,it,expect,vi} from "vitest";
const native=vi.hoisted(()=>({files:new Map<string,string>(),contexts:new Set<string>(),entities:new Map<string,any>(),sequence:0}));
vi.mock("@workspace/runtime",()=>({contextId:"owned",vcs:{status:async()=>({workingHead:{eventId:"main"}})},fs:{mkdtemp:async()=>"/owned/docket-"+(++native.sequence),writeFile:async(path:string,text:string)=>{native.files.set(path,text);},exists:async(path:string)=>native.files.has(path)},runtime:{
 createContext:async()=>{const contextId="context-"+(++native.sequence);native.contexts.add(contextId);return {contextId};},
 createEntity:async(input:any)=>{const id="entity-"+(++native.sequence),targetId="target-"+id;const row={id,kind:"do",contextId:input.contextId,targetId,state:{revision:0,checkpoints:[]}};native.entities.set(id,row);return {id,kind:"do",contextId:input.contextId,targetId};},
 retireEntity:async({id}:any)=>{native.entities.delete(id);},destroyContext:async({contextId}:any)=>{native.contexts.delete(contextId);},listEntities:async()=>[...native.entities.values()].map(({state,...row})=>row),listContexts:async()=>({contexts:[...native.contexts]}),
 supervision:{describe:async(key:any)=>[{entityId:key.entityId,generation:1}],restart:async()=>{}},
},rpc:{call:async(target:string,method:any,args:any[])=>{
 if(target==="main") {const bytes=Buffer.from(native.files.get(args[0])!),offset=args[1]?.offset??0,limit=args[1]?.limit??51200,end=Math.min(bytes.length,offset+limit);return {base64:bytes.subarray(offset,end).toString("base64"),contentHash:createHash("sha256").update(bytes).digest("hex"),maxBytes:limit,truncated:end<bytes.length,start:offset,end,totalBytes:bytes.length,...(end<bytes.length?{nextOffset:end}:{})};}
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
  const report="The current docket says customers still lack their current-cycle total; recovery alone does not clear impact.";
  const proof=await fixture.verify(report);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);expect(native.entities.size).toBe(0);
  expect((await fixture.verify({status:"held",reason:report})).outcomeDimensions.returnedValue.passed).toBe(false);

 }finally{await fixture.close();}
});
it("binds an absent conditional dossier to mandatory goal review without claiming a completed artifact",async()=>{
 const world=openOwnedOperationsWorlds.find(row=>row.id==="owned-operations-register-staff-training")!;
 const fixture=await prepareOpenOwnedOperations({contextId:"owned",caseId:world.id,goal:world.goal},world);
 try{const rows=await fixture.services.operationsDocket.list(),current=rows.find(row=>row.edition==="current")!;await fixture.services.operationsDocket.read(current.id,current.revision);const proof=await fixture.verify(null);expect(proof.artifact).toBeNull();expect(proof.dossierReadback).toBeNull();expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.goal).toBe(world.goal);expect(proof.semanticReviewInput.actual.artifacts.dossierReadback).toBeNull();}finally{await fixture.close();}
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
  const proof=await fixture.verify("Customers remain affected despite recovery readiness");
  expect(proof.passed).toBe(true);expect(proof.audit.programRequestedCleanup).toBe(false);
  expect(proof.semanticReviewInput.actual.observations.audit).toEqual(proof.audit);
  expect(proof.semanticReviewInput.expected).not.toHaveProperty("observations");
  expect(proof.semanticReviewInput.expected).not.toHaveProperty("evidenceRoleLayout");
  expect(proof.audit.retiredIds).toEqual([handle.id]);expect(native.entities.size).toBe(0);expect(native.contexts.size).toBe(0);
 }finally{await fixture.close();}
});

it("retains the actual selected current checkpoint with valid extra history and source subsets beyond the old16KiB read cap",async()=>{
 const world=openOwnedOperationsWorlds.find(row=>row.id==="owned-operations-register-staff-training")!;
 const fixture=await prepareOpenOwnedOperations({contextId:"owned",caseId:world.id,goal:world.goal},world);
 try{
  const docket=(await fixture.services.operationsDocket.list()).find(row=>row.edition==="current")!;
  await fixture.services.operationsDocket.read(docket.id,docket.revision);
  const prior=await fixture.services.ownedOperations.open("release");
  await fixture.services.ownedOperations.append(prior,0,{role:"release",decision:"blocked",evidenceIds:["shift-training"],reason:"Historical pending training"});
  const current=await fixture.services.ownedOperations.open("release");
  await expect(fixture.services.ownedOperations.read({...current,targetId:"foreign"})).rejects.toThrow("exact handle");
  await expect(fixture.services.ownedOperations.append(current,0,{role:"release",decision:"ready",evidenceIds:["foreign-source"],reason:"Invented source"})).rejects.toThrow("actual owned docket");
  await fixture.services.ownedOperations.append(current,0,{role:"release",decision:"blocked",evidenceIds:["shift-training"],reason:"Original pending training"});
  await fixture.services.ownedOperations.restart(current);
  await expect(fixture.services.ownedOperations.append(current,0,{role:"release",decision:"ready",evidenceIds:["shift-training"],reason:"Stale revision"})).rejects.toThrow("Revision conflict");
  await fixture.services.ownedOperations.append(current,1,{role:"release",decision:"ready",evidenceIds:["shift-training"],reason:"Current training now approved; floor signoff remains approved"});
  const cleanup=await fixture.services.ownedOperations.close();
  const report={kind:"release-continuation" as const,handles:[current],cleanup,handoff:{decision:"ready" as const,evidenceIds:["shift-training"],summary:"Actual current readiness. "+"Detailed retained assessment. ".repeat(1200)}};
  await expect(fixture.services.operationsDossier.retain(docket.id,docket.revision,{...report,handles:[{...current,targetId:"foreign"}]})).rejects.toThrow("do not permit");
  const receipt=await fixture.services.operationsDossier.retain(docket.id,docket.revision,report);
  const proof=await fixture.verify(undefined);
  expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.artifact).toEqual(receipt);
  expect(Buffer.byteLength(proof.dossierReadback!)).toBeGreaterThan(16384);expect(JSON.parse(proof.dossierReadback!).checkpoints.at(-1).assessment.reason).toContain("Current training");
  expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();
 }finally{await fixture.close();}
});

it("binds optional format-only root and private explanation holds without failing observed native work",async()=>{
 const world=openOwnedOperationsWorlds.find(row=>!row.requestedReturnRequired)!;
 const fixture=await prepareOpenOwnedOperations({contextId:"owned",caseId:world.id,goal:world.goal},world);
 try{
  const current=(await fixture.services.operationsDocket.list()).find(row=>row.edition==="current")!;
  await fixture.services.operationsDocket.read(current.id,current.revision);
  const value="An extra operational explanation whose meaning was not requested",valueJson=JSON.stringify(value),hash=createHash("sha256").update(valueJson).digest("hex");
  const {observeInvocation}=await import("@workspace/application-outcomes/observed-invocation");
  const calls=[{callId:"root",summary:{run_id:"run",owner_key:"owner",owner_kind:"eval"},record:{call_id:"root",parent_call_id:null,definition:{name:"coordinateOwnedOperations",source:"coordinateOwnedOperations.nl"},executor:{kind:"agent",model_id:"actual-teacher"},cost:{model_requests:1},outcome:"done",output:{complete:true,bytes:Buffer.byteLength(valueJson),hash}}},{callId:"explain",summary:{run_id:"run",owner_key:"owner",owner_kind:"eval"},record:{call_id:"explain",parent_call_id:"root",definition:{name:"explainOperationsFinding",source:"coordinateOwnedOperations/explainOperationsFinding.nl"},executor:{kind:"agent",model_id:"actual-teacher"},cost:{model_requests:1},outcome:"done",output:{complete:true,bytes:Buffer.byteLength(valueJson),hash}}}];
  const invocation=observeInvocation({evalRunId:"run",rootCallIds:["root"],captureErrors:[],calls},async reference=>reference===hash?valueJson:null);
  const proof=await fixture.verify(value,invocation);
  expect(proof.passed).toBe(true);expect(proof.checks.returnedOperationsFinding).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();
  expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);
  expect(proof.outcomeDimensions.returnedValue.unreviewedReturns?.map(row=>row.definition.source)).toEqual(["coordinateOwnedOperations.nl","coordinateOwnedOperations/explainOperationsFinding.nl"]);
  expect(proof.outcomeDimensions.incidentalValues?.incorrectReturns).toEqual([]);
 }finally{await fixture.close();}
});
