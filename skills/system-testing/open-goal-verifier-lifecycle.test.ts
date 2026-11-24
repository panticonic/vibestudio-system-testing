import {expect,it,vi} from "vitest";
import {AGENTIC_EVENT_PAYLOAD_KIND,AGENTIC_PROTOCOL_VERSION} from "@workspace/agentic-protocol";
import {prepareOpenChatContinuity} from "./open-goal-chat-continuity-managed.js";
import {prepareIntentDiscovery} from "./open-goal-intent-discovery-managed.js";
import {prepareLaunchState} from "./open-goal-launch-state-managed.js";

vi.mock("@workspace/runtime",()=>({contextId:null,fs:{},vcs:{},rpc:{},runtime:{},openPanel:vi.fn()}));
const owner="owned-verifier-test";
function scratch(){
  const files=new Map<string,string>();
  return {fs:{mkdtemp:async()=>"/.tmp/fixture",writeFile:async(path:string,text:string)=>{files.set(path,text);},
    readdir:async()=>["fixture"],exists:async(path:string)=>files.has(path)},
    readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??"")};
}
const status=()=>Promise.resolve({contextId:owner,clean:true,integrating:[],mainEventId:"main",workingHead:{kind:"event",eventId:"head"},committed:{eventId:"main"}});

function chatPorts(){
  const pages=new Map<string,unknown[]>();
  let count=0,retired=false;
  const agent={id:"owned-worker",objectKey:"original-worker",target:"worker-target",participantId:"worker-target"};
  const read=async(lane:{key:string})=>({ready:{snapshotLastSeq:pages.get(lane.key)!.length,hasMoreAfter:false},logEvents:structuredClone(pages.get(lane.key))});
  const ports={...scratch(),contextId:owner,status,
    open:async(_owner:string,_title:string,key=`chat-${++count}`)=>{pages.set(key,[]);return {key,target:`do:workers/pubsub-channel:PubSubChannel:${key}`,expected:[]};},
    send:async(lane:{key:string},_owner:string,text:string)=>{
      const rows=pages.get(lane.key)!;const id=`message-${lane.key}`;
      rows.push({id:rows.length+1,messageId:`envelope-${id}`,senderId:"user",type:AGENTIC_EVENT_PAYLOAD_KIND,ts:1,
        payload:{kind:"message.completed",actor:{kind:"user",id:"user"},causality:{messageId:id},createdAt:"2026-11-24T00:00:00.000Z",
          payload:{protocol:AGENTIC_PROTOCOL_VERSION,role:"user",outcome:"completed",blocks:[{blockId:`${id}:text`,type:"text",content:text}]}}});return id;
    },read,audit:read,createWorker:async()=>agent,
    joinWorker:async(_agent:unknown,lane:{key:string})=>{const rows=pages.get(lane.key)!;rows.push({id:rows.length+1,
      type:"channel.subscription.opened",senderId:agent.participantId,payload:{participantId:agent.participantId,revision:1,delivery:"addressed",metadata:{type:"observer",handle:"local-continuity"}}});},
    leaveWorker:async()=>{throw Error("Unexpected leave");},
    workerState:async()=>{if(retired)throw Error("Owned worker is retired");return {objectKey:agent.objectKey,participantId:agent.participantId,active:true,revision:1,endedRevision:null,handle:"local-continuity",mode:"addressed-observer"};},
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
