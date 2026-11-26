/** TEST-only native factories with actual installed omnibox functions and actual
 * SQL-backed DeliveryWakeFixtureDO. No model, remote service or teacher registry. */
import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({contextId:"owned",rpc:{},runtime:{},fs:{}}));
import * as omnibox from "@workspace/omnibox-core";
import {createTestDO,createTestDirectAuthority} from "@workspace/runtime/worker/test-utils";
import {DeliveryWakeFixtureDO} from "../../workers/delivery-wake-fixture/index.js";
import {prepareWorkspaceSmoke} from "./open-goal-workspace-smoke-managed.js";
import {prepareDeliveryWake} from "./open-goal-delivery-wake-managed.js";
import {openWorkspaceSmokeWorlds} from "./open-goal-workspace-smoke-worlds.js";
import {openDeliveryWakeWorlds} from "./open-goal-delivery-wake-worlds.js";
function smokePorts(){
 const files=new Map<string,string>();let dirs=0,runs=0,retained:any=null;
 const ports:any={contextId:"owned",dir:async()=>`/.tmp/test-smoke-${++dirs}`,write:async(path:string,text:string)=>{files.set(path,text);},read:async(path:string)=>{if(!files.has(path))throw Error("Missing native test file");return new TextEncoder().encode(files.get(path)!);},entries:async(path:string)=>[...files.keys()].filter(p=>p.startsWith(path+'/')).map(p=>p.slice(path.length+1)),grep:async(path:string,marker:string)=>{const matches=[...files].filter(([p,t])=>p.startsWith(path+'/')&&t.includes(marker)).map(([file,text])=>({file,line:text.split('\n')[1],lineNumber:2}));return {matches,matchCount:matches.length,truncated:false};},run:async(_scope:string,runId:string,code:string)=>{runs++;const value=new Function('lib',code.replace('import * as lib from "@workspace/omnibox-core";',''))(omnibox);retained={runId,runDigest:'TEST-only-native-digest',result:{success:true,returnValue:value}};return structuredClone(retained);},retained:async()=>structuredClone(retained),dispose:async()=>{}};
 return {ports,files,get runs(){return runs;}};
}
for(const world of openWorkspaceSmokeWorlds)it(`Smoke actual installed reference ${world.id}`,async()=>{
 const t=smokePorts(),fixture=await prepareWorkspaceSmoke({contextId:'owned',caseId:world.id},world,t.ports);
 try{const result=await fixture.qualify();expect(result.passed,JSON.stringify(result.checks)).toBe(true);expect(result.semanticReviewRequired).toBe(true);expect(result.outcomeContract.returnedValue.required).toBe(world.requestedAnswerRequired);}finally{await fixture.close();}
});
it('Smoke repeated observations and native acknowledgments preserve one execution; permission alone requests no artifact',async()=>{
 const world=openWorkspaceSmokeWorlds.find(w=>w.source==='unique'&&w.mayStage&&w.noteRequest==='none'&&!w.unavailableExport)!;
 const t=smokePorts(),fixture=await prepareWorkspaceSmoke({contextId:'owned',caseId:world.id},world,t.ports);
 try{const a=await fixture.services.workspaceSmokeEvidence.discover();const view=await fixture.services.workspaceSmokeEvidence.scan(a.id);expect(await fixture.services.workspaceSmokeEvidence.scan(a.id)).toEqual(view);const p=view.plans.find(p=>p.context===a.context&&p.revision===a.revision&&p.subject===a.subject)!;const r=await fixture.services.workspaceSmokeRuntime.run(a.id,p.path,p.digest);expect(await fixture.services.workspaceSmokeRuntime.run(a.id,p.path,p.digest)).toEqual(r);expect(t.runs).toBe(1);const proof=await fixture.verify('Actual behavior has been inspected; no acceptance note was requested.');expect(proof.passed).toBe(true);expect(proof.receipt).toBeNull();expect(proof.semanticReviewRequired).toBe(true);expect((await fixture.verify(undefined)).passed).toBe(false);t.files.set(p.path,t.files.get(p.path)!+' ');await expect(fixture.services.workspaceSmokeRuntime.run(a.id,p.path,p.digest)).rejects.toThrow('changed');}finally{await fixture.close();}
});
it('Smoke a requested note does not waive a requested answer, and optional answers do not gate the effect',async()=>{
 for(const world of openWorkspaceSmokeWorlds.filter(w=>w.noteRequest==='if-accepted')){
  const t=smokePorts(),fixture=await prepareWorkspaceSmoke({contextId:'owned',caseId:world.id},world,t.ports);
  try{const a=await fixture.services.workspaceSmokeEvidence.discover(),v=await fixture.services.workspaceSmokeEvidence.scan(a.id),p=v.plans.find(p=>p.context===a.context&&p.revision===a.revision&&p.subject===a.subject)!;const r=await fixture.services.workspaceSmokeRuntime.run(a.id,p.path,p.digest);expect((await fixture.verify('Native run completed.')).checks.verifiedPrivateSmokeReceipt).toBe(false);const ack=await fixture.services.workspaceSmokeHandoff.stage(a.id,p.path,r.runDigest);expect(await fixture.services.workspaceSmokeHandoff.stage(a.id,p.path,r.runDigest)).toEqual(ack);expect((await fixture.verify(undefined)).passed).toBe(!world.requestedAnswerRequired);expect((await fixture.verify('A wrong explanation remains subject to mandatory meaning review.')).semanticReviewRequired).toBe(true);}finally{await fixture.close();}
 }
});
async function wakeFixture(world:typeof openDeliveryWakeWorlds[number],admissions=1){
 const d=await createTestDO(DeliveryWakeFixtureDO,{__objectKey:'TEST-only-wake',WORKER_SOURCE:'workers/delivery-wake-fixture',WORKER_CLASS_NAME:'DeliveryWakeFixtureDO'}),channel='delivery-wake-'+crypto.randomUUID();
 const nativeCall=(method:string,v:unknown)=>{
  const authorization=createTestDirectAuthority({callerKind:'host',capability:'host',method,source:'workers/delivery-wake-fixture',className:'DeliveryWakeFixtureDO',objectKey:'TEST-only-wake',effect:{kind:'open'},tier:'open'});
  // This fixture's actual public contract requires an authenticated root member.
  authorization.context.workspace={workspaceId:'test',member:true,role:'root',revision:'test'};
  return d.callAs({callerId:'main',callerKind:'host',authorization},method,v);
 };
 const projection:any={seed:(v:unknown)=>nativeCall('seed',v),inspect:(v:unknown)=>nativeCall('inspect',v),recover:(v:unknown)=>nativeCall('recover',v)};
 const fixture=await prepareDeliveryWake({contextId:'owned',caseId:world.id},world,{contextId:'owned',channel,projection,connect:async(mode)=>({channel,context:'owned',attempts:mode==='unavailable'?1:admissions+(mode==='recover'?1:0),firstRejected:mode!=='clean',ready:mode!=='unavailable',admittedSurfaces:mode==='unavailable'?0:admissions})});
 return {fixture,dispose:()=>d.db.close()};
}
for(const world of openDeliveryWakeWorlds)it(`Wake actual SQL reference ${world.id}`,async()=>{
 const t=await wakeFixture(world);try{const result=await t.fixture.qualify();expect(result.passed,JSON.stringify(result.checks)).toBe(true);expect(result.semanticReviewRequired).toBe(true);expect(result.outcomeContract.returnedValue.required).toBe(world.requestedAnswerRequired);}finally{t.dispose();}
});
it('Wake redundant reads and same acknowledgment are harmless, while foreign and stale requests still fail',async()=>{
 const world=openDeliveryWakeWorlds.find(w=>w.recoveryRequested&&w.expected==='advance'&&w.requestedAnswerRequired)!;
 const t=await wakeFixture(world);try{const s=t.fixture.services,a=await s.deliveryWakeEvidence.discover(),first=await s.deliveryWakeEvidence.observe(a.id);expect(await s.deliveryWakeEvidence.observe(a.id)).toEqual(first);expect((await t.fixture.verify('The actual recovery has not been performed.')).checks.verifiedUniqueNormalizedMailbox).toBe(false);const event=first.events.find(e=>e.name===a.request&&e.kind===a.kind&&e.recipients.includes(a.recipient))!;await expect(s.deliveryWakeAction.apply(a.id,'foreign',first.pending)).rejects.toThrow();await expect(s.deliveryWakeAction.apply(a.id,event.id,{...first.pending!,after:0})).rejects.toThrow();const ack=await s.deliveryWakeAction.apply(a.id,event.id,first.pending);expect(await s.deliveryWakeAction.apply(a.id,event.id,first.pending)).toEqual(ack);const fresh=await s.deliveryWakeEvidence.observe(a.id);expect(fresh.pending).toBeNull();expect(fresh.mailbox.some(row=>row.deliveryId===ack.deliveryId)).toBe(true);expect((await t.fixture.verify(undefined)).passed).toBe(false);const proof=await t.fixture.verify('Any claim must still undergo native-bound review.');expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.semanticReviewRequired).toBe(true);}finally{t.dispose();}
});
it('preserves every authored goal/ID/split and its explicit independent answer/effect obligation',async()=>{
 const {readFileSync}=await import('node:fs'),{URL:NodeURL}=await import('node:url'),{createHash}=await import('node:crypto');
 const rows=JSON.parse(readFileSync(new NodeURL('../../meta/SMOKE_WAKE_GOAL_OBLIGATIONS.json',import.meta.url),'utf8'));
 const worlds=[...openWorkspaceSmokeWorlds,...openDeliveryWakeWorlds];expect(worlds).toHaveLength(54);expect(rows).toHaveLength(54);expect(new Set(worlds.map(w=>w.id)).size).toBe(54);
 for(const world of worlds){const row=rows.find((r:{id:string})=>r.id===world.id);expect(row).toBeDefined();expect(world.goal).toBe(row.goal);expect(createHash('sha256').update(world.goal).digest('hex')).toBe(row.goalSha256);expect(world.split??'train').toBe(row.split);expect(world.sourceGroup).toBe(`vibestudio:${world.id.startsWith('workspace-smoke-')?'workspace-smoke':'delivery-wake'}:${world.id.replace(/^(workspace-smoke|delivery-wake)-/u,'')}`);expect(world.requestedAnswerRequired).toBe(row.requestedAnswerRequired);if(world.kind==='workspace-smoke')expect(world.noteRequest).toBe(row.noteRequest);else expect(world.recoveryRequested).toBe(row.recoveryRequested);}
 expect(worlds.filter(w=>w.requestedAnswerRequired)).toHaveLength(45);expect(worlds.filter(w=>w.split==='test')).toHaveLength(16);
});
it('closed Smoke ownership refuses new observations and execution without requiring a prior run',async()=>{
 const world=openWorkspaceSmokeWorlds[0]!,t=smokePorts(),fixture=await prepareWorkspaceSmoke({contextId:'owned',caseId:world.id},world,t.ports);
 const a=await fixture.services.workspaceSmokeEvidence.discover();await fixture.close();await expect(fixture.services.workspaceSmokeEvidence.discover()).rejects.toThrow('closed');await expect(fixture.services.workspaceSmokeEvidence.scan(a.id)).rejects.toThrow();await expect(fixture.services.workspaceSmokeRuntime.run(a.id,'foreign','foreign')).rejects.toThrow();expect(t.runs).toBe(0);
});
it('private reference verdicts and predictions cannot decide a teacher finding',async()=>{
 const original=openWorkspaceSmokeWorlds[0]!,world={...original,expected:'regression' as const,runtime:{invented:'private prediction'},noteRequest:'none' as const};
 const t=smokePorts(),fixture=await prepareWorkspaceSmoke({contextId:'owned',caseId:world.id},world,t.ports);
 try{const a=await fixture.services.workspaceSmokeEvidence.discover(),v=await fixture.services.workspaceSmokeEvidence.scan(a.id),p=v.plans.find(p=>p.context===a.context&&p.revision===a.revision&&p.subject===a.subject)!;await fixture.services.workspaceSmokeRuntime.run(a.id,p.path,p.digest);const proof=await fixture.verify('The observed installed behavior is judged against the actual approved input, not a hidden verdict.');expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.semanticReviewRequired).toBe(true);}finally{await fixture.close();}
 const wake={...openDeliveryWakeWorlds[0]!,expected:'hold-policy' as const},actual=await wakeFixture(wake);try{expect((await actual.fixture.qualify()).passed).toBe(true);}finally{actual.dispose();}
});

it('cumulative reconnect admissions do not prescribe a route when the actual receiver and recovered mailbox are exact',async()=>{
 const world=openDeliveryWakeWorlds[0]!,t=await wakeFixture(world,2);try{const result=await t.fixture.qualify();expect(result.passed,JSON.stringify(result.checks)).toBe(true);expect(result.evidence?.connection.admittedSurfaces).toBe(2);expect(result.semanticReviewRequired).toBe(true);}finally{t.dispose();}
});

it('retains allocation failure and all actual owned cleanup failures',async()=>{
 const {rpc,runtime}=await import('@workspace/runtime');const primary=new Error('native channel initialization failed'),cleanup=new Error('native retirement failed');
 Object.assign(runtime,{createEntity:async()=>({id:'owned-allocation',targetId:'do:owned',kind:'do',contextId:'owned'}),retireEntity:async()=>{throw cleanup;}});Object.assign(rpc,{call:async()=>{throw primary;}});
 try{await expect(prepareDeliveryWake({contextId:'owned',caseId:openDeliveryWakeWorlds[0]!.id},openDeliveryWakeWorlds[0]!)).rejects.toMatchObject({name:'AggregateError',errors:[primary,{name:'AggregateError',errors:[cleanup]}]});}
 finally{Reflect.deleteProperty(runtime,'createEntity');Reflect.deleteProperty(runtime,'retireEntity');Reflect.deleteProperty(rpc,'call');}
});
