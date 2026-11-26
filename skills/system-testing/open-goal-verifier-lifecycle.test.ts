import {expect,it,vi} from "vitest";
import {AGENTIC_EVENT_PAYLOAD_KIND,AGENTIC_PROTOCOL_VERSION} from "@workspace/agentic-protocol";
import {prepareOpenChatContinuity} from "./open-goal-chat-continuity-managed.js";
import {prepareIntentDiscovery} from "./open-goal-intent-discovery-managed.js";
import {prepareLaunchState} from "./open-goal-launch-state-managed.js";

vi.mock("./session-replay-managed.js",()=>({createOwnedHeadlessChannel:vi.fn(),withOwnedChannelClient:vi.fn()}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:vi.fn()}));
vi.mock("@workspace/runtime",()=>({contextId:null,fs:{},vcs:{},rpc:{},runtime:{},openPanel:vi.fn()}));
const owner="owned-verifier-test";
function scratch(realDirectories=false){
  const files=new Map<string,string>(),directories=new Set<string>();
  return {fs:{mkdtemp:async(prefix:string)=>{if(!realDirectories)return "/.tmp/fixture";const name=prefix+"-"+crypto.randomUUID();directories.add(name);return "/.tmp/"+name;},writeFile:async(path:string,text:string)=>{files.set(path,text);},
    rename:async(from:string,to:string)=>{const text=files.get(from);if(text===undefined)throw Error("Missing pending native file");files.set(to,text);files.delete(from);},
    rm:async(path:string)=>{for(const key of files.keys())if(key.startsWith(path+"/"))files.delete(key);directories.delete(path.split("/").at(-1)!);},
    readdir:async()=>realDirectories?[...directories]:["fixture"],exists:async(path:string)=>files.has(path)},
    readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??"")};
}
const status=()=>Promise.resolve({contextId:owner,clean:true,integrating:[],mainEventId:"main",workingHead:{kind:"event",eventId:"head"},committed:{eventId:"main"}});

function chatPorts(realScratch=false){
  const pages=new Map<string,unknown[]>();
  let count=0,retired=false,left=false;
  const agent={id:"owned-worker",objectKey:"original-worker",target:"worker-target",participantId:"worker-target"};
  const read=async(lane:{key:string})=>({ready:{snapshotLastSeq:pages.get(lane.key)!.length,hasMoreAfter:false},logEvents:structuredClone(pages.get(lane.key))});
  const ports={...scratch(realScratch),contextId:owner,status,
    open:async(_owner:string,_title:string,key=`chat-${++count}`)=>{pages.set(key,[]);return {key,target:`do:workers/pubsub-channel:PubSubChannel:${key}`,expected:[]};},
    send:async(lane:{key:string},_owner:string,text:string)=>{
      const rows=pages.get(lane.key)!;const id=`message-${lane.key}`;
      rows.push({id:rows.length+1,messageId:`envelope-${id}`,senderId:"user",type:AGENTIC_EVENT_PAYLOAD_KIND,ts:1,
        payload:{kind:"message.completed",actor:{kind:"user",id:"user"},causality:{messageId:id},createdAt:"2026-11-24T00:00:00.000Z",
          payload:{protocol:AGENTIC_PROTOCOL_VERSION,role:"user",outcome:"completed",blocks:[{blockId:`${id}:text`,type:"text",content:text}]}}});return id;
    },read,audit:read,createWorker:async()=>agent,
    joinWorker:async(_agent:unknown,lane:{key:string})=>{const rows=pages.get(lane.key)!;rows.push({id:rows.length+1,
      type:"channel.subscription.opened",senderId:agent.participantId,payload:{participantId:agent.participantId,revision:1,delivery:"addressed",metadata:{type:"observer",handle:"local-continuity"}}});},
    leaveWorker:async(_agent:unknown,lane:{key:string})=>{if(!realScratch)throw Error("Unexpected leave");left=true;const rows=pages.get(lane.key)!;rows.push({id:rows.length+1,type:"channel.subscription.ended",senderId:agent.participantId,payload:{participantId:agent.participantId,revision:2}});},
    workerState:async()=>{if(retired)throw Error("Owned worker is retired");return {objectKey:agent.objectKey,participantId:agent.participantId,active:!left,revision:left?2:1,endedRevision:left?2:null,handle:"local-continuity",mode:"addressed-observer"};},
    retire:vi.fn(async()=>{retired=true;}),
  };
  return {ports:ports as unknown as NonNullable<Parameters<typeof prepareOpenChatContinuity>[1]>,retire:ports.retire};
}

it("keeps a chat worker alive through positive and negative readbacks, then joins cleanup once",async()=>{
  const {ports,retire}=chatPorts();
  const prepared=await prepareOpenChatContinuity({contextId:owner,caseId:"chat-continuity-held-old-source-cannot-bind-latest-projection"},ports);
  try {
    const proof=await prepared.qualify();
    expect(proof.checks).toEqual(expect.objectContaining({exactNativeChatWorker:true,independentDurableChatReceipt:true,exactFirstPartyChatProjection:true}));
    expect(proof.passed).toBe(true);
    expect(proof.rejectsIncorrectApplicationReturn).toBe(true);
    expect((await prepared.verify({})).outcomeDimensions.returnedValue.passed).toBe(false);
    expect(retire).not.toHaveBeenCalled();
  } finally {await Promise.all([prepared.close(),prepared.close()]);}
  expect(retire).toHaveBeenCalledTimes(1);
});

it("retires an already-created chat worker when fixture setup fails",async()=>{
  const {ports,retire}=chatPorts();
  ports.joinWorker=async()=>{throw Error("join failed");};
  await expect(prepareOpenChatContinuity({contextId:owner,caseId:"chat-continuity-held-old-source-cannot-bind-latest-projection"},ports)).rejects.toThrow("join failed");
  expect(retire).toHaveBeenCalledTimes(1);
});

it("propagates joined chat cleanup failures without retrying retirement",async()=>{
  const {ports,retire}=chatPorts();retire.mockRejectedValueOnce(Error("native retirement failed"));
  const prepared=await prepareOpenChatContinuity({contextId:owner,caseId:"chat-continuity-held-old-source-cannot-bind-latest-projection"},ports);
  await expect(prepared.close()).rejects.toThrow("Could not retire owned chat continuity workers");
  await expect(prepared.close()).rejects.toThrow("Could not retire owned chat continuity workers");
  expect(retire).toHaveBeenCalledTimes(1);
});

it("retains discovered worker facts until the intent fixture owner closes",async()=>{
  const entities:{id:string;source:string;key:string;contextId:string;kind:string}[]=[];
  const retire=vi.fn(async(id:string)=>{entities.splice(entities.findIndex(row=>row.id===id),1);});
  const schema={argsSchema:{},returnsSchema:{}};
  const ports={...scratch(),contextId:owner,vcs:{status},catalog:{search:async()=>[],getSchema:async()=>schema,
    describe:async(id:string)=>({id,qualifiedName:id,...schema})},skills:async()=>[],readSkill:async()=>null,
    listEntities:async()=>structuredClone(entities),retire,
    createWorker:async(contextId:string,key:string)=>{const row={id:`worker-${entities.length}`,contextId,key,kind:"do",source:"workers/local-messaging-fixture"};entities.push(row);return row;}};
  const prepared=await prepareIntentDiscovery({contextId:owner,caseId:"intent-discovery-confirm-active-worker-before-tracking-work"},ports as unknown as NonNullable<Parameters<typeof prepareIntentDiscovery>[1]>);
  try {
    expect((await prepared.qualify()).passed).toBe(true);
    expect((await prepared.qualify()).passed).toBe(true);
    expect(retire).not.toHaveBeenCalled();
  } finally {await prepared.close();}
  expect(retire).toHaveBeenCalledTimes(2);
});

it("retains launch panels for negative replay and archives only at final owner cleanup",async()=>{
  const panels=new Map<string,{panelId:string;entryKey:string;entityId:string;contextId:string;buildKey:string;state:unknown}>();
  const archive=vi.fn(async(id:string)=>{panels.delete(id);});
  const ports={...scratch(),contextId:owner,status,
    open:async(contextId:string,state:unknown)=>{const id=`panel-${panels.size}`;panels.set(id,{panelId:id,entryKey:`entry-${id}`,entityId:`entity-${id}`,contextId,buildKey:"build",state});return {id,archive:()=>archive(id),stateArgs:{get:async()=>panels.get(id)?.state}};},
    state:async(id:string)=>structuredClone(panels.get(id)??null),bindAuthority:()=>{throw Error("Read-only fixture");}};
  const prepared=await prepareLaunchState({contextId:owner,caseId:"launch-state-count-current-value-readonly"},ports as unknown as NonNullable<Parameters<typeof prepareLaunchState>[1]>);
  try {
    expect((await prepared.qualify()).passed).toBe(true);
    expect((await prepared.verify({})).outcomeDimensions.returnedValue.passed).toBe(false);
    expect(archive).not.toHaveBeenCalled();
  } finally {await prepared.close();}
  expect(archive).toHaveBeenCalledTimes(2);
});

it("retains requested held chat diagnostics and accepts substantive explanations beyond the old prose cap",async()=>{
 const {ports}=chatPorts(true);
 const prepared=await prepareOpenChatContinuity({contextId:owner,caseId:"chat-continuity-agent-left-but-history-is-readable"},ports);
 try{
  const reference=await prepared.qualify();expect(reference.passed).toBe(true);
  expect(reference.evidence.nativeWorkerIdentity).toMatchObject({sameObjectKey:true,sameParticipantId:true,currentlyActive:false,endedSinceOpening:true});
  expect(reference.semanticReviewInput.expected.observations.evidence).toEqual(reference.evidence);
  const actual=reference.semanticReviewInput.actual.requestedReturn as {review:unknown;disposition:{status:string;write:boolean;explanation:string};handoff:unknown};
  expect(actual.disposition).toMatchObject({status:"held",write:true});
  const longer={...actual,disposition:{...actual.disposition,explanation:"The installed worker is no longer active, while the original retained history remains readable. ".repeat(12)}};
  expect((await prepared.verify(longer)).outcomeDimensions.returnedValue.passed).toBe(true);
  expect(reference.artifact).not.toBeNull();
  // A correct verbal observation cannot substitute for the requested private diagnostic.
  const alternate=await prepared.verify({...actual,disposition:{...actual.disposition,write:false},handoff:null});
  expect(alternate.outcomeDimensions.returnedValue.passed).toBe(true);
  expect(alternate.artifact).toBe(reference.artifact); // Actual retained diagnostic remains; a copied write flag cannot undo it.
  expect(alternate.checks.verifiedPrivateChatHandoff).toBe(true);
 }finally{await prepared.close();}
});

// Extra actual observations are evidence, not an invalid reference-route deviation.
it("accepts additional current chat reads without freezing the second snapshot or repeating fixture mutations",async()=>{
 const {ports}=chatPorts(true);
 const prepared=await prepareOpenChatContinuity({contextId:owner,caseId:"chat-continuity-agent-left-but-history-is-readable"},ports);
 try{
  const reference=await prepared.qualify();expect(reference.passed).toBe(true);
  const index=await prepared.services.chatContinuityIndex.list();
  const first=await prepared.services.chatContinuityState.read(index.scopes[0]!.id);
  const second=await prepared.services.chatContinuityState.read(index.scopes[0]!.id);
  expect(first).toEqual(second);expect(first?.worker?.active).toBe(false);
  const checked=await prepared.verify(reference.semanticReviewInput.actual.requestedReturn);
  expect(checked.checks.exactOwnedChatSelection).toBe(true);expect(checked.checks.exactNativeChatWorker).toBe(true);expect(checked.passed).toBe(true);
 }finally{await prepared.close();}
});

it("allows additional truthful owned intent observations without a private method-count or catalog-description route",async()=>{
 const entities:{id:string;source:string;key:string;contextId:string;kind:string}[]=[];const schema={argsSchema:{},returnsSchema:{}};
 const ports={...scratch(),contextId:owner,vcs:{status},catalog:{search:async()=>[],getSchema:async()=>schema,describe:async(id:string)=>({id,qualifiedName:id,...schema})},skills:async()=>[],readSkill:async()=>null,listEntities:async()=>structuredClone(entities),retire:async(id:string)=>{entities.splice(entities.findIndex(row=>row.id===id),1);},createWorker:async(contextId:string,key:string)=>{const row={id:'intent-'+entities.length,contextId,key,kind:'do',source:'workers/local-messaging-fixture'};entities.push(row);return row;}};
 const fixture=await prepareIntentDiscovery({contextId:owner,caseId:'intent-discovery-confirm-active-worker-before-tracking-work'},ports as unknown as NonNullable<Parameters<typeof prepareIntentDiscovery>[1]>);
 try{const service=fixture.services.nativeIntentDiscovery;const notice=await service.notice();
 expect(await service.inspect('service:runtime.listEntities',notice.workerKey)).not.toBeNull();
 expect(await service.inspect('service:vcs.status',owner)).not.toBeNull();
 const proof=await fixture.verify({outcome:{status:'observed',summary:'The exact room helper is active; the separately inspected owned workspace is clean.'},handoff:null});
 expect(proof.passed).toBe(true);expect(proof.capabilities).toEqual([]);expect(proof.evidence).toHaveLength(2);expect(proof.semanticReviewRequired).toBe(true);
 expect(await service.inspect('service:runtime.listEntities',notice.workerKey+'-foreign')).toBeNull();
 expect((await fixture.verify(undefined)).passed).toBe(false);
 }finally{await fixture.close();}
});
