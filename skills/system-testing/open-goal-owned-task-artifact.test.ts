import {expect,it,vi} from "vitest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {prepareOwnedTaskRecovery} from "./open-goal-owned-task-managed.js";
import {openOwnedTaskWorlds} from "./open-goal-owned-task-worlds.js";
vi.mock("@workspace/runtime",()=>({contextId:null,rpc:{},runtime:{}}));
vi.mock("./open-goal-local-delivery-managed.js",()=>({prepareOpenLocalDelivery:vi.fn()}));
const original=openOwnedTaskWorlds.find(w=>w.id==="owned-task-inbox-owner-not-current-recipient")!;
async function setup(world=structuredClone(original),options:{get?:(digest:string)=>Promise<string|null>;failLocal?:boolean;retained?:Map<string,string>}={}){
 const tasks=new Map<string,any>(),blobs=new Map<string,string>(),retained=options.retained??new Map<string,string>();let count=0;
 const store={call:async(method:string,input:any)=>{
  if(method==="createProject")return{id:crypto.randomUUID(),name:input.name};
  if(method==="createTask"){const row={...input,id:`task-${++count}`,revision:1,updatedAt:0,dependencies:input.dependencies??[]};tasks.set(row.id,row);return structuredClone(row);}
  if(method==="getTask")return structuredClone(tasks.get(input.id));
  throw Error("Unexpected task mutation");
 }};
 const local=async(_input:unknown,spec:any)=>{if(options.failLocal)throw Error("Native lane setup failed");return({services:{localDeliveryCatalog:{discover:async()=>spec.rooms.map((r:any)=>({id:r.key,title:r.title,maySend:r.maySend}))},
  localDeliveryHistory:{inspect:async(id:string)=>{const r=spec.rooms.find((r:any)=>r.key===id);if(!r)throw Error("Foreign room");return{room:{id,title:r.title,maySend:r.maySend},basis:`basis-${id}`,resolution:null,prior:r.prior?{roomId:id,channelId:id,messageId:`message-${id}`,senderId:"native-owner",recipientRef:`@${r.prior.to}`,content:r.prior.content,sequence:3,acknowledged:true}:null};}},localDeliverySend:{submit:vi.fn()},localDeliveryReadback:{read:async()=>{throw Error("Foreign attempt");}}},verify:async()=>({passed:true,checks:{nativeReadback:true},outcomeDimensions:{effects:{passed:true}}}),close:vi.fn()});};
 const p=await prepareOwnedTaskRecovery({contextId:"owned",caseId:world.id},world,store as any,{activeContext:"owned",runtime:{},rpc:{},prepareOpenLocalDelivery:local,
  put:async(owner:string,text:string)=>{const digest=sha256HexSyncText(text);blobs.set(digest,text);retained.set(owner,digest);return digest;},release:async(owner:string)=>{retained.delete(owner);},get:options.get??(async(digest:string)=>blobs.get(digest)??null)} as any);
 const taskOptions=await p.services.ownedTaskBoard.discover();const current=await p.services.ownedTaskBoard.observe(taskOptions.find(o=>o.project===world.project)!.id);
 await p.services.ownedTaskAttempts.discover();const lane=await p.services.ownedTaskAttempts.inspect("result",null);
 return{p,current,lane,tasks,blobs,retained};
}
it("reads actual retained CSV bytes through the inspected accepted assignment",async()=>{
 const {p,current,lane}=await setup();try{const result=await p.services.ownedTaskAttempts.readArtifact(current.task.id,current.revision,lane.lane.id,lane.basis);
 expect(result.content).toBe(original.lanes[0].artifactContents!.content);expect(result.reference.digest).toBe(sha256HexSyncText(result.content));expect(result.name).toBe("measurements.csv");
 const report={task:current.task.id,revision:current.revision,status:current.status,original:lane.receipt,delivery:null,result,reason:"Found the accepted measurements; current room has no authorized recipient."};
 const proof=await p.verify(report);expect(proof.observedChecks.attestedReturnedTaskArtifact).toBe(true);expect(proof.semanticReviewInput.actual.observations.resultArtifacts[0].artifact).toEqual(result);
 expect((await p.verify({...report,result:{...result,content:"Invented measurements"}})).observedChecks.attestedReturnedTaskArtifact).toBe(false);
 }finally{await p.close();}
});
for(const [name,alter] of [
 ["foreign task",(f:any,args:any[])=>{args[0]="foreign";}],
 ["stale revision",(f:any,args:any[])=>{args[1]++;}],
 ["foreign room",(f:any,args:any[])=>{args[2]="archive";}],
 ["old inspection basis",(f:any,args:any[])=>{args[3]="old";}],
 ["changed current owner",(f:any)=>{const row=f.tasks.get(f.current.task.id);row.description=JSON.stringify({...JSON.parse(row.description),owner:"different-owner"});row.revision++;}],
 ["changed current attempt",(f:any)=>{const row=f.tasks.get(f.current.task.id);row.description=JSON.stringify({...JSON.parse(row.description),attempt:"new-attempt"});row.revision++;}],
 ["changed blob bytes",(f:any)=>{f.blobs.set(f.lane.record.artifactRef.digest,"Substituted");}],
 ["missing blob",(f:any)=>{f.blobs.clear();}],
] as const)it(`refuses ${name} without granting arbitrary blob reads`,async()=>{const f=await setup();try{const args=[f.current.task.id,f.current.revision,f.lane.lane.id,f.lane.basis];alter(f,args);await expect((f.p.services.ownedTaskAttempts.readArtifact as any)(...args)).rejects.toThrow();}finally{await f.p.close();}});
it("preserves genuinely absent output rather than interpreting a filename as file bytes",async()=>{const world=structuredClone(original);delete world.lanes[0].artifactContents;const f=await setup(world);try{expect(f.lane.record).not.toHaveProperty("artifactRef");await expect(f.p.services.ownedTaskAttempts.readArtifact(f.current.task.id,f.current.revision,f.lane.lane.id,f.lane.basis)).rejects.toThrow("no retained artifact reference");expect(f.blobs.size).toBe(0);}finally{await f.p.close();}});
it("does not grant artifact reads before an actual lane inspection",async()=>{const f=await setup();try{await expect(f.p.services.ownedTaskAttempts.readArtifact(f.current.task.id,f.current.revision,"archive","basis-archive")).rejects.toThrow();}finally{await f.p.close();}});

it("caller mutation of returned references cannot alter the authoritative inspected receipt",async()=>{const f=await setup();try{const originalDigest=f.lane.record!.artifactRef!.digest;f.lane.record!.artifactRef!.digest="foreign";f.lane.record!.owner="different";const result=await f.p.services.ownedTaskAttempts.readArtifact(f.current.task.id,f.current.revision,f.lane.lane.id,f.lane.basis);expect(result.reference.digest).toBe(originalDigest);result.reference.digest="changed-by-caller";expect((await f.p.services.ownedTaskAttempts.readArtifact(f.current.task.id,f.current.revision,f.lane.lane.id,f.lane.basis)).reference.digest).toBe(originalDigest);}finally{await f.p.close();}});

it("qualification reads the real seeded output and retains scope controls before cleanup",async()=>{const f=await setup();try{const proof=await f.p.qualify();expect(proof.observedChecks.attestedReturnedTaskArtifact).toBe(true);expect(proof.checks.rejectedForeignTaskOrPriorSend).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn.result.content).toBe(original.lanes[0].artifactContents!.content);}finally{await f.p.close();}});

for(const [name,change]of [["foreign owner",(w:any)=>{w.lanes[0].record.owner="other-owner";}],["foreign task",(w:any)=>{w.lanes[0].recordScope="archive";}],["old attempt",(w:any)=>{w.lanes[0].record.attempt="prior-attempt";}]] as const)it(`refuses an accepted artifact belonging to a ${name}`,async()=>{const world=structuredClone(original);change(world);const f=await setup(world);try{await expect(f.p.services.ownedTaskAttempts.readArtifact(f.current.task.id,f.current.revision,f.lane.lane.id,f.lane.basis)).rejects.toThrow("inspected current owned attempt");}finally{await f.p.close();}});

it("retains native bytes until joined owner cleanup and refuses reads after release",async()=>{let releaseGet:((value:string)=>void)|undefined;let enteredResolve!:()=>void;const entered=new Promise<void>(resolve=>{enteredResolve=resolve;});const content=original.lanes[0].artifactContents!.content;const f=await setup(undefined,{get:async()=>{enteredResolve();return new Promise<string>(resolve=>{releaseGet=resolve;});}});expect(f.retained.size).toBe(1);const read=f.p.services.ownedTaskAttempts.readArtifact(f.current.task.id,f.current.revision,f.lane.lane.id,f.lane.basis);await entered;const close=f.p.close();await Promise.resolve();expect(f.retained.size).toBe(1);releaseGet!(content);await read;await close;expect(f.retained.size).toBe(0);await expect(f.p.services.ownedTaskAttempts.readArtifact(f.current.task.id,f.current.revision,f.lane.lane.id,f.lane.basis)).rejects.toThrow("closed");});

it("releases retained publication when later native lane setup fails",async()=>{const retained=new Map<string,string>();await expect(setup(undefined,{failLocal:true,retained})).rejects.toThrow("Native lane setup failed");expect(retained.size).toBe(0);});
