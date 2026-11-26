import {expect,it} from "vitest";
import {createTestDO} from "@vibestudio/durable/test-utils";
import {NotificationStateFixtureDO} from "../../workers/notification-state-fixture/index.js";
import {openNotificationStateWorlds as worlds} from "./open-goal-notification-state-worlds.js";
import {prepareOpenNotificationState} from "./open-goal-notification-state-managed.js";

async function fixture(world:typeof worlds[number],run:(prepared:Awaited<ReturnType<typeof prepareOpenNotificationState>>)=>Promise<void>){
 const contextId=`TEST-notification-${world.id}`;let store:Awaited<ReturnType<typeof createTestDO<typeof NotificationStateFixtureDO>>>|undefined;let retired=false;
 const ports={contextId,runtime:{async createEntity(spec:{key:string;contextId:string}){expect(spec.contextId).toBe(contextId);store=await createTestDO(NotificationStateFixtureDO,{__objectKey:spec.key,WORKER_SOURCE:"workers/notification-state-fixture",WORKER_CLASS_NAME:"NotificationStateFixtureDO"});return{id:"TEST-actor",targetId:"TEST-target",kind:"do",contextId};},async retireEntity({id}:{id:string}){expect(id).toBe("TEST-actor");retired=true;}},rpc:{async call(destination:string,method:string|{name:string},args:unknown[]){expect(destination).toBe("TEST-target");expect(retired).toBe(false);return store!.call(typeof method==="string"?method:method.name,...args);}}};
 const prepared=await prepareOpenNotificationState({contextId,caseId:world.id},world,ports as unknown as Parameters<typeof prepareOpenNotificationState>[2]);
 try{await run(prepared);}finally{try{await prepared.close();}finally{store?.db.close();}}expect(retired).toBe(true);
}
async function observe(prepared:Awaited<ReturnType<typeof prepareOpenNotificationState>>,repeat=false){
 const service=prepared.services.notificationState;const [assigned,foreign]=await service.discover();
 const initial=await service.read(assigned!);if(repeat)await service.read(assigned!);
 const refresh=await service.refresh(assigned!);const current=refresh.lane?await service.read(refresh.lane):null;
 if(repeat&&refresh.lane)await service.read(refresh.lane);
 return{service,assigned:assigned!,foreign:foreign!,initial,refresh,current};
}
function nativePassed(proof:Awaited<ReturnType<Awaited<ReturnType<typeof prepareOpenNotificationState>>["verify"]>>){
 expect(proof.checks).toEqual(Object.fromEntries(Object.keys(proof.checks).map(key=>[key,true])));
 expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput.expected.goal).toBe(proof.semanticReviewInput.actual.goal);
 expect(proof.incorrectReturnValues).toEqual([]);
}
const removed=worlds.find(world=>world.id.endsWith("removed-history"))!;
it("accepts a truthful removed original ID with redundant real reads and binds it for mandatory meaning review",async()=>fixture(removed,async prepared=>{
 await observe(prepared,true);
 const report={finding:{state:"missing",id:"old",revision:1},explanation:"The old read receipt was removed; the accessibility note remains.",acknowledgment:null};
 const proof=await prepared.verify(report);nativePassed(proof);
 expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);
 expect(proof.semanticReviewInput.expected.observations.durable.rows.map((row:{id:string})=>row.id)).toEqual(["access"]);
}));
it("keeps an incorrect nonempty answer subject to meaning review rather than claiming crisp semantic certification",async()=>fixture(removed,async prepared=>{
 await observe(prepared);const report={finding:{state:"read",id:"old",revision:1},explanation:"The old read receipt still survives.",acknowledgment:null};
 const proof=await prepared.verify(report);nativePassed(proof);
 expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);
 expect(proof.semanticReviewInput.expected.requestedReturnRequired).toBe(true);
}));
it("rejects a missing or empty requested explanation despite successful native lifecycle observations",async()=>fixture(removed,async prepared=>{
 await observe(prepared);for(const explanation of [undefined,"","   "]){const proof=await prepared.verify({finding:{state:"missing",id:"old",revision:1},explanation,acknowledgment:null});expect(proof.checks.requestedNotificationAnswer).toBe(false);expect(proof.outcomeDimensions.returnedValue.passed).toBe(false);expect(proof.semanticReviewRequired).toBe(true);}
}));
const mixed=worlds.find(world=>world.expected.action==="acknowledge"&&world.requestedAnswer)!;
it("retains the explicitly requested explanation alongside a real acknowledgment and independent readback",async()=>fixture(mixed,async prepared=>{
 const {service,refresh,current}=await observe(prepared,true);expect(current).not.toBeNull();const [id,revision]=mixed.expected.target!;
 const acknowledgment=await service.acknowledge(refresh.lane!,id,revision);await service.read(refresh.lane!);
 const report={finding:{state:"read",id,revision},explanation:"The authorized current receipt was acknowledged and the retained readback confirms it.",acknowledgment:acknowledgment};
 const proof=await prepared.verify(report);nativePassed(proof);expect(proof.ack).toEqual(acknowledgment);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);
 const missing=await prepared.verify({...report,explanation:""});expect(missing.checks.independentNotificationReadback).toBe(true);expect(missing.checks.requestedNotificationAnswer).toBe(false);
}));
const rotated=worlds.find(world=>world.id.endsWith("restored-owner-generation"))!;
it("allows refreshed same-owner generation while rejecting foreign and stale acknowledgments",async()=>fixture(rotated,async prepared=>{
 const {service,assigned,foreign,refresh}=await observe(prepared,true);const [id,revision]=rotated.expected.target!;
 await expect(service.read(foreign)).rejects.toThrow(/assigned lane/);
 await expect(service.acknowledge(foreign,id,revision)).rejects.toThrow(/assigned lane/);
 expect(await service.acknowledge(assigned,id,revision)).toMatchObject({status:"unavailable"});
 expect(await service.acknowledge(refresh.lane!,id,0)).toMatchObject({status:"stale"});
 expect(await service.acknowledge(refresh.lane!,id,revision)).toMatchObject({status:"acknowledged"});await service.read(refresh.lane!);
 const proof=await prepared.verify(undefined);nativePassed(proof);expect(proof.outcomeContract.returnedValue.required).toBe(false);expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();
}));
