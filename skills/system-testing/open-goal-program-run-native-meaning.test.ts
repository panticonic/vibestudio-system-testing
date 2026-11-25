/** Actual fixture service/capture/crypto implementation over deterministic native
 * filesystem/compiler/load ports. No model, network, or real compiler claimed. */
import {expect,it} from "vitest";
import {prepareOpenProgramRun} from "./open-goal-program-run-managed.js";
import type {ProgramRunWorld,Sample} from "./open-goal-program-run-worlds.js";
const sample=(key:string,input:number,authorization:Sample["authorization"]="initial"):Sample=>({key,input,reference:input,label:key,purpose:"Caller-approved "+key,authorization});
async function fixture(options:{samples?:Sample[];reject?:boolean;edit?:boolean;refresh?:boolean;revoke?:boolean;callable?:boolean;permission?:"trial"|"inspect"|"verify-and-sign"}={}){
 const files=new Map<string,string>();const contextId="owned-program-context",root="/.tmp/program-component";
 const state={kind:"event",eventId:"protected-working"};
 const world:ProgramRunWorld={id:"native-component",workspace:"examples",kind:"program-run",sourceGroup:"native-component",goal:"Inspect the current authorized programs, run the individually approved trials needed for this request, preserve their actual outputs and sign only if verified and currently permitted.",allowRefresh:options.refresh??false,
  ...(options.edit?{edit:{file:"main.ts",text:"updated native program"}}:{}),...(options.revoke?{revokeSigning:true}:{}),
  projects:[{key:"target",label:"Current owned program",purpose:"Requested trials",state:"active",permission:options.permission??"verify-and-sign",files:{"main.ts":"initial native program"},samples:options.samples??[sample("one",1),sample("two",2),sample("three",3)]},
   {key:"other",label:"Other owned program",purpose:"Disambiguation only",state:"active",permission:"inspect",files:{"main.ts":"other native program"},samples:[]}],
  // Deliberately no reference trajectory. It must not grade actual authorized work.
  expected:{project:"target",inspected:0,attempts:[],next:null,signed:false}};
 const fs={mkdtemp:async()=>root,mkdir:async()=>{},writeFile:async(path:string,text:string)=>{files.set(path,text);},readFile:async(path:string)=>{if(!files.has(path))throw Error("Native file absent");return files.get(path)!;},readdir:async(path:string)=>[...new Set([...files.keys()].filter(key=>key.startsWith(path+"/")).map(key=>key.slice(path.length+1).split("/")[0]!))],exists:async(path:string)=>files.has(path),rename:async(from:string,to:string)=>{if(!files.has(from))throw Error("Native file absent");files.set(to,files.get(from)!);files.delete(from);}};
 const prepared=await prepareOpenProgramRun({contextId,caseId:world.id},world,{contextId,fs:fs as never,vcs:{status:async()=>({workingHead:state,mainEventId:"protected-main"})} as never,describe:async()=>({} as never),load:async(path:string)=>options.callable===false?{}:{check:(value:number)=>{if(options.reject&&value<2)throw Error("rejected native input");return options.edit&&files.get(path)==="updated native program"?value+1:value;}}});
 const [app,other]=await prepared.services.programRunCatalog.list();
 return {...prepared,files,app:app!,other:other!,world};
}
it("uses matching issued inspection, permits three individually approved initial trials, and retains repeated actual reads",async()=>{
 const f=await fixture(),s=f.services,inspection=(await s.programRunCatalog.inspect(f.app.id))!;
 await s.programRunCatalog.inspect(f.other.id); // Does not revoke the first issued source observation.
 const receipts=[];
 for(const sample of f.app.samples){
  const started=await s.programExecution.run(f.app.id,inspection.revision,sample.id);expect(started).not.toBeNull();
  const receipt=(await s.programExecution.read(started!.id))!;receipts.push(receipt);
  expect(await s.programExecution.read(started!.id)).toEqual(receipt);
 }
 expect(receipts.map(receipt=>receipt.output)).toEqual([1,2,3]);
 const report={status:"reviewed",programId:f.app.id,receipts,signed:null};
 const proof=await f.verify(report);
 expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput).not.toBeNull();
 const forged=await f.verify({...report,receipts:[{...receipts[0],output:"invented"}]});
 expect(forged.outcomeDimensions.returnedValue.passed).toBe(false);
 expect(await s.programExecution.run(f.app.id,"forged",f.app.samples[0]!.id)).toBeNull();
 expect(await s.programExecution.run(f.app.id,inspection.revision,f.app.samples[0]!.id)).toBeNull(); // No repeat grant.
 expect(await s.programExecution.read("foreign")).toBeNull();
 expect(await s.programReceiptSigner.stage("foreign")).toBeNull();
});
it("admits a third approved recovery only after the actual observed rejection, not after an interruption or success",async()=>{
 const f=await fixture({reject:true,samples:[sample("first",0),sample("second",1,"after-rejection"),sample("third",2,"after-rejection"),sample("wrong-condition",3,"after-interruption")]});
 const s=f.services,i=(await s.programRunCatalog.inspect(f.app.id))!;
 expect(await s.programExecution.run(f.app.id,i.revision,f.app.samples[1]!.id)).toBeNull();
 for(const sample of f.app.samples.slice(0,3)){
  const started=await s.programExecution.run(f.app.id,i.revision,sample.id);expect(started).not.toBeNull();
  const receipt=await s.programExecution.read(started!.id);expect(receipt?.status).toBe(sample===f.app.samples[2]?"returned":"rejected");
 }
 expect(await s.programExecution.run(f.app.id,i.revision,f.app.samples[3]!.id)).toBeNull();
});
it("refreshes readback after actual source change and requires the explicit refresh grant for a repeated initial input",async()=>{
 for(const refresh of [false,true]){
  const f=await fixture({edit:true,refresh,samples:[{...sample("original",3),revisedReference:4}]}),s=f.services;
  const opening=(await s.programRunCatalog.inspect(f.app.id))!,id=f.app.samples[0]!.id;
  const started=(await s.programExecution.run(f.app.id,opening.revision,id))!;
  const original=await s.programExecution.read(started.id);expect(original?.verification).toBe("stale");expect(original?.output).toBe(3);
  const current=(await s.programRunCatalog.inspect(f.app.id))!;
  expect(await s.programExecution.run(f.app.id,opening.revision,id)).toBeNull();
  const retried=await s.programExecution.run(f.app.id,current.revision,id);
  if(refresh){expect(retried).not.toBeNull();const fresh=await s.programExecution.read(retried!.id);expect(fresh?.output).toBe(4);expect(fresh?.verification).toBe("verified");}
  else expect(retried).toBeNull();
 }
});
it("preserves an actual checked output when current signing authority is revoked",async()=>{
 const f=await fixture({revoke:true}),s=f.services,i=(await s.programRunCatalog.inspect(f.app.id))!;
 const started=(await s.programExecution.run(f.app.id,i.revision,f.app.samples[0]!.id))!;
 const readback=(await s.programExecution.read(started.id))!;expect(readback.signatureAuthorized).toBe(false);
 expect(await s.programReceiptSigner.stage(started.id)).toBeNull();
 const proof=await f.verify({status:"reviewed",programId:f.app.id,receipts:[readback],signed:null});
 expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);
});
it("checks actual cryptographic signed bytes and refuses corrupted stored receipts",async()=>{
 const f=await fixture(),s=f.services,i=(await s.programRunCatalog.inspect(f.app.id))!;
 const started=(await s.programExecution.run(f.app.id,i.revision,f.app.samples[0]!.id))!;
 const readback=(await s.programExecution.read(started.id))!,signed=(await s.programReceiptSigner.stage(started.id))!;
 expect(signed).not.toBeNull();
 const proof=await f.verify({status:"reviewed",programId:f.app.id,receipts:[readback],signed});expect(proof.checks.verifiedSignedOutput).toBe(true);
 f.files.set(signed.path,"{corrupted native artifact");
 const corrupt=await f.verify({status:"reviewed",programId:f.app.id,receipts:[readback],signed});expect(corrupt.checks.verifiedSignedOutput).toBe(false);
 const path=[...f.files.keys()].find(path=>path.endsWith("/receipts/"+started.id+".json"))!;
 const original=f.files.get(path)!;f.files.set(path,JSON.stringify({...JSON.parse(original),output:"altered"}));
 await expect(s.programExecution.read(started.id)).rejects.toThrow("exact owned call");
});
it("keeps inspection-only grants and honest missing-callable evidence",async()=>{
 for(const options of [{permission:"inspect" as const},{callable:false}]){
  const f=await fixture(options),s=f.services,i=(await s.programRunCatalog.inspect(f.app.id))!;
  expect(await s.programExecution.run(f.app.id,i.revision,f.app.samples[0]!.id)).toBeNull();
  const proof=await f.verify({status:"reviewed",programId:f.app.id,receipts:[],signed:null});
  expect(proof.checks.inspectedCurrentCallable).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 }
});
