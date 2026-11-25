import {observedChatWorkerIdentity,chatContinuityReviewGuidance} from "./native-domain-review.js";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["index","frames","evidence"],["artifact"]);
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import {type SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import { serializeByKey } from "@vibestudio/shared/keyedSerializer";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, rpc, runtime, vcs } from "@workspace/runtime";
import { agentRpcMethods } from "@workspace/agentic-do/rpc-contract";
import { ChannelViewFeed } from "@workspace/agentic-core/chat-store";
import { resolveChannelEndpoint } from "@workspace/pubsub";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { AGENTIC_EVENT_PAYLOAD_KIND, type AgenticEvent } from "@workspace/agentic-protocol";
import { callDO } from "@workspace/testkit";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { ChatContinuityReport, ChatDisposition, ChatEvidence, ChatHandoff, ChatIndex, ChatObservation, ChatPlan, ChatReceipt,
  ChatRow, ChatWorker, DeliveryReview, ReviewedDelivery } from "@workspace-skills/open-chat-continuity/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { openChatContinuityWorlds } from "./open-goal-chat-continuity-worlds.js";
import { chatContinuityPrimaryChannel } from "./chat-continuity-authority.js";

type Lane=Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
type Agent={objectKey:string;id:string;target:string;participantId:string|null};
type NativePage=Awaited<ReturnType<typeof readNative>>;
type NativeChannel = {through:number;rows:ChatRow[];events:NativePage["logEvents"]};
const max=16*1024;
const configuration={handle:"local-continuity",name:"Local continuity worker",respondPolicy:"mentioned-strict",
  features:{tools:[]}};

async function readNative(lane:Lane) {
  return rpc.call(lane.target,channelClientRpcMethods.getReplayAfter,[{after:0,limit:35}]);
}
async function auditNative(lane:Lane):Promise<NativePage> {
  return callDO("vibestudio.channel.v1",channelClientRpcMethods.getReplayAfter,[{after:0,limit:35}],{objectKey:lane.key});
}
function transcript(page:NativePage):NativeChannel {
  const through=page.ready.snapshotLastSeq;
  if(through===undefined||page.ready.hasMoreAfter)throw new Error("Owned chat replay exceeded its scope");
  const rows=page.logEvents.flatMap((row):ChatRow[]=>{
    const event=row.payload as AgenticEvent<"message.completed">|undefined;
    if(event?.kind!=="message.completed"||!("role" in event.payload)||event.payload.role!=="user")return [];
    const text=(event.payload.blocks??[]).flatMap(block=>block.type==="text"?[block.content]:[]).join("");
    if(!event.causality?.messageId||!row.senderId||text.length>1200)throw new Error("Unattributed chat replay row");
    return [{id:event.causality.messageId,envelope:row.messageId,sender:row.senderId,sequence:row.id,text}];
  });
  return {through,rows,events:page.logEvents};
}

export function projectStockChat(channelId:string,page:NativeChannel,settled:boolean):ChatObservation["consumer"] {
  const feed=new ChannelViewFeed({channelId});
  try {
    // Exercise the exact transcript projection used by panels/chat through AgenticChat.
    const events=settled?page.events:page.events.slice(0,Math.max(0,page.events.length-1));
    for(const event of events) {
      if(event.type!==AGENTIC_EVENT_PAYLOAD_KIND)continue;
      feed.ingest({
        type:AGENTIC_EVENT_PAYLOAD_KIND,delivery:"log",phase:"replay",pubsubId:event.id,envelopeId:event.messageId,
        senderId:event.senderId,ts:event.ts,senderMetadata:event.senderMetadata,payload:event.payload as AgenticEvent,
        contentClass:event.contentClass??"internal",externalKeys:event.externalKeys??[],
      });
    }
    if(settled)feed.ingest({type:"replay-complete",delivery:"control",generation:1,hasMoreBefore:false});
    const view=feed.getSnapshot();
    return {channelId,settled:view.replaySettled,rows:view.messages.map(({id,senderId,content})=>({id,sender:senderId,text:content}))};
  } finally {feed.dispose();}
}

async function sendNative(lane:Lane,owner:string,text:string,idempotencyKey:string) {
  return withOwnedChannelClient(lane,owner,client=>client.send(text,{idempotencyKey}));
}
async function createWorker(owner:string):Promise<Agent> {
  const objectKey=`chat-continuity-${crypto.randomUUID()}`;
  const handle=await runtime.createEntity({kind:"do",execution:{surface:"code",source:"workers/agent-worker"},
    className:"AiChatWorker",key:objectKey,contextId:owner});
  if(handle.kind!=="do"||handle.contextId!==owner)throw new Error("Default chat worker escaped its owned scope");
  return {objectKey,id:handle.id,target:handle.targetId,participantId:null};
}
async function joinWorker(agent:Agent,lane:Lane,owner:string) {
  const channelRef=await resolveChannelEndpoint(rpc,lane.key,undefined,undefined,owner);
  const receipt=await rpc.call(agent.target,agentRpcMethods.subscribeChannel,[{
    channelId:lane.key,channelRef,contextId:owner,config:configuration,replay:false,delivery:"addressed",
  }]);
  if(!receipt.ok||receipt.participantId!==agent.target)throw new Error("No address-only membership for the owned worker");
  if(agent.participantId&&agent.participantId!==receipt.participantId)throw new Error("Rejoining changed the retained worker identity");
  agent.participantId=receipt.participantId;
}
async function leaveWorker(agent:Agent,lane:Lane) {
  const receipt=await rpc.call(agent.target,agentRpcMethods.unsubscribeChannel,[lane.key]);
  if(!receipt.ok)throw new Error("Could not close the exact worker relationship");
  const readback=await workerState(agent,lane);
  if(readback.active)throw new Error("Detached worker still holds the channel membership");
}

export function retainedWorkerRelationship(events:NativePage["logEvents"],participantId:string) {
  let active=false,revision=0,endedRevision:number|null=null,handle="";
  for(const row of events) {
    if(row.senderId!==participantId||(row.type!=="channel.subscription.opened"&&
      row.type!=="channel.subscription.revised"&&row.type!=="channel.subscription.ended"))continue;
    const value=row.payload as {participantId?:unknown;revision?:unknown;delivery?:unknown;metadata?:{type?:unknown;handle?:unknown}}|null;
    if(!value||value.participantId!==participantId||typeof value.revision!=="number"||
      !Number.isSafeInteger(value.revision)||value.revision<=revision)
      throw new Error("Invalid retained worker relationship sequence");
    revision=value.revision;
    active=row.type!=="channel.subscription.ended";
    if(active){
      if(value.delivery!=="addressed"||value.metadata?.type!=="observer"||typeof value.metadata.handle!=="string")
        throw new Error("Worker relationship is not address-only observer evidence");
      handle=value.metadata.handle;
    } else endedRevision=revision;
  }
  if(!revision)throw new Error("The exact native worker opening was not retained");
  return {active,revision,endedRevision,handle};
}

async function workerState(agent:Agent,lane:Lane):Promise<ChatWorker>{
  if(!agent.participantId)throw new Error("Unknown worker membership receipt");
  const value=await rpc.call(lane.target,channelClientRpcMethods.inspectAgent,[{
    participantId:agent.participantId,method:"getAgentSettings",
  }]);
  if(value.participantId!==agent.participantId||value.channelId!==lane.key||value.isError)
    throw new Error("Worker inspection escaped its exact owned relationship");
  const relationship=retainedWorkerRelationship((await readNative(lane)).logEvents,agent.participantId);
  if(relationship.handle!==configuration.handle)
    throw new Error("Retained observer identity did not match the configured worker");
  return {objectKey:agent.objectKey,participantId:agent.participantId,...relationship,mode:"addressed-observer"};
}

type Ports={contextId:string|null;fs:typeof fs;status:typeof vcs.status;open:typeof createOwnedHeadlessChannel;
  read:typeof readNative;audit:typeof auditNative;send:typeof sendNative;createWorker:typeof createWorker;joinWorker:typeof joinWorker;
  leaveWorker:typeof leaveWorker;workerState:typeof workerState;retire(id:string):Promise<unknown>;
  readBytes(path:string,max:number):Promise<Uint8Array>};
function livePorts():Ports {
  return {contextId,fs,status:input=>vcs.status(input),open:createOwnedHeadlessChannel,read:readNative,audit:auditNative,send:sendNative,createWorker,
    joinWorker,leaveWorker,workerState,retire:id=>runtime.retireEntity({id}),readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max)};
}

function interpret(goal:string,plan:ChatPlan,index:ChatIndex,current:ChatObservation):ChatEvidence {
  const {receipt,worker,consumer}=current;
  const durable=current.rows.filter(row=>row.id===receipt.messageId);
  const actual=durable[0];
  const consumerRows=consumer.rows.filter(row=>row.id===receipt.messageId);
  const visible=consumerRows[0];
  const scope=consumer.channelId===current.channelId;
  const matched=scope&&consumer.settled&&consumerRows.length===1&&visible.sender===receipt.senderId&&visible.text===receipt.text;
  const request:DeliveryReview={kind:"delivery",goal,channelId:plan.channelId,
    channelAccepted:receipt.channelId===current.channelId&&!!actual,
    originMatched:receipt.channelId===current.channelId&&actual?.sender===receipt.senderId&&actual.text===receipt.text,
    durableCount:durable.length,recipientsResolved:scope,
    membershipVerified:plan.requireWorker?!!worker?.active&&worker.objectKey===index.openingWorker?.objectKey&&
      worker.participantId===index.openingWorker?.participantId:scope,
    replayMeaningMatches:matched,settlement:!consumer.settled?"pending":matched?"delivered":"failed",
    accountedRetry:!current.retryId||current.retryId===receipt.messageId,
  };
  const blockers=[
    ...(!request.channelAccepted?["accepted"]:[]),
    ...(!request.originMatched?["origin"]:[]),
    ...(request.durableCount!==1?["durable-count"]:[]),
    ...(!request.replayMeaningMatches?["replay"]:[]),
    ...(!request.membershipVerified?["membership"]:[]),
    ...(!request.recipientsResolved?["addressing"]:[]),
    ...(request.settlement!=="delivered"?["settlement"]:[]),
    ...(request.settlement==="failed"&&!request.accountedRetry?["outbox"]:[]),
  ];
  const review:ReviewedDelivery={kind:"delivery",basis:plan.channelId,blockers,ready:blockers.length===0};
  return {request,review};
}

export async function prepareOpenChatContinuity(input:{contextId:string;caseId:string},ports=livePorts()) {
  const world=openChatContinuityWorlds.find(entry=>entry.id===input.caseId);
  if(!world||!input.contextId||input.contextId!==ports.contextId)throw new Error("Chat continuity requires its owned context");
  const owner=input.contextId;
  const before=await ports.status();
  const assigned=world.worker&&world.worker!=="missing"?chatContinuityPrimaryChannel(owner):undefined;
  const active=await ports.open(owner,world.title,assigned?.key);
  if(assigned&&(active.key!==assigned.key||active.target!==assigned.target))
    throw new Error("The managed chat does not match its scoped inspection target");
  const alternate=await ports.open(owner,world.title);
  if(alternate.target===active.target)throw new Error("The comparison chat must be separate");
  const key=`user-note-${crypto.randomUUID()}`;
  const original=await ports.send(active,owner,world.message,key);
  const lookalike=await ports.send(alternate,owner,world.message,`standalone-${crypto.randomUUID()}`);
  const firstLog=transcript(await ports.read(active));
  const otherLog=transcript(await ports.read(alternate));
  const sourceRow=firstLog.rows.find(row=>row.id===original);
  const alternateRow=otherLog.rows.find(row=>row.id===lookalike);
  if(!sourceRow||!alternateRow||original===lookalike)throw new Error("Missing distinct durable user sources");
  const receipt:ChatReceipt=world.receipt==="other-channel"?
    {channelId:alternate.key,messageId:lookalike,senderId:alternateRow.sender,text:world.message}:
    {channelId:active.key,messageId:world.receipt==="unknown-id"?crypto.randomUUID():original,
      senderId:world.receipt==="wrong-sender"?crypto.randomUUID():sourceRow.sender,text:world.message};
  const agents:Agent[]=[];
  let closing:Promise<void>|undefined;
  function close():Promise<void>{
    return closing??=(async()=>{
      const retired=await Promise.allSettled(agents.map(agent=>ports.retire(agent.id)));
      const failures=retired.filter(row=>row.status==="rejected");
      if(failures.length)throw new AggregateError(failures.map(row=>row.reason),"Could not retire owned chat continuity workers");
    })();
  }
  try {
  let worker:Agent|null=null;
  if(world.worker&&world.worker!=="missing") {
    worker=await ports.createWorker(owner);
    agents.push(worker);
    await ports.joinWorker(worker,active,owner);
  }
  const originalWorker=worker?await ports.workerState(worker,active):null;
  const index:ChatIndex={scopes:[
    {id:active.key,title:world.title,purpose:"original working chat",contextId:owner},
    {id:alternate.key,title:world.title,purpose:"parallel archive",contextId:owner},
  ],original:receipt,openingWorker:originalWorker};
  const plan:ChatPlan={channelId:active.key,requireWorker:world.checkWorker===true,note:world.note};
  const shouldWrite=world.note==="decision"||world.note==="ready-only"&&world.status==="ready";
  const scratch=await ports.fs.mkdtemp("chat-continuity");
  const policy=`${scratch}/scope.md`;
  await ports.fs.writeFile(policy,"Only the exact owned chat transfer receipt and stock transcript support this private decision.");
  const existing=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What proves continuity of this exact local chat?"],
    sources:[{id:"scope",path:policy}]},ports.readBytes).scratchHandoffWrite;
  let activeOperation=false;
  const transcriptReads = new Map<string, Promise<unknown>>();
  let retryId:string|null=null;
  const frames:ChatObservation[]=[];
  let handoff:ChatHandoff|null=null;
  const body=(report:ChatContinuityReport)=>JSON.stringify({scope:"private-local",receipt,current:report.current,
    disposition:report.disposition,evidence:report.evidence},null,2);

  async function changeFixture() {
    if(world.worker==="detached"||world.worker==="replaced"||world.worker==="rejoined") {
      if(!worker)throw new Error("Cannot replace an unowned worker");
      await ports.leaveWorker(worker,active);
      if(world.worker==="replaced"){
        worker=await ports.createWorker(owner);
        agents.push(worker);
      }
      if(world.worker!=="detached")await ports.joinWorker(worker,active,owner);
    }
    if(world.duplicate==="retry")retryId=await ports.send(active,owner,world.message,key);
    if(world.duplicate==="distinct")await ports.send(active,owner,world.message,`second-intent-${crypto.randomUUID()}`);
    if(world.duplicate==="later")await ports.send(active,owner,"A later co-editor is checking the local reply.",`later-${crypto.randomUUID()}`);
  }
  async function observe(opening:boolean):Promise<ChatObservation> {
    const log=transcript(await ports.read(active));
    const wrongView=world.consumer==="still-other"||opening&&world.consumer==="opening-other";
    const pending=world.consumer==="replay-pending"||opening&&world.consumer==="opening-pending";
    const consumer=projectStockChat(wrongView?alternate.key:active.key,wrongView?transcript(await ports.read(alternate)):log,!pending);
    return {channelId:active.key,through:log.through,rows:log.rows,consumer,
      worker:worker?await ports.workerState(worker,active):null,receipt,retryId};
  }

  let stagedText:string|null=null;
  const services={
    chatContinuityIndex:{async list(){return structuredClone(index);}},
    chatContinuityState:{async read(channelId:string){
      if(channelId!==active.key)return null;
      return serializeByKey(transcriptReads, channelId, async () => {
        if(frames.length>=2)return structuredClone(frames.at(-1)!);
        if(activeOperation)return frames.length ? structuredClone(frames.at(-1)!) : null;
        activeOperation=true;
        try {
        const opening=frames.length===0;
        if(!opening)await changeFixture();
        const value=await observe(opening);
        frames.push(value);
        return structuredClone(value);
        } finally {activeOperation=false;}
      });
    }},
    chatContinuityHandoff:{async stage(report:ChatContinuityReport){
      if(!shouldWrite||!frames[1]||!report?.disposition?.write||report.disposition.status!==world.status||
        !report.disposition.explanation?.trim()||
        activeOperation||handoff||report.handoff!==null||!isDeepStrictEqual(report.plan,plan)||
        !isDeepStrictEqual(report.opening,frames[0])||!isDeepStrictEqual(report.current,frames[1]))return null;
      activeOperation=true;
      try {
        const latest=await observe(false);
        if(!isDeepStrictEqual(latest,frames[1])||!isDeepStrictEqual(report.evidence,interpret(world.goal,plan,index,latest)))return null;
        const current=await ports.status();
        if(current.mainEventId!==before.mainEventId||!isDeepStrictEqual(current.workingHead,before.workingHead))return null;
        const text=body(report);
        if(new TextEncoder().encode(text).length>max)return null;
        const saved=(stagedText=text,await writer.stage(text));
        if(!saved)return null;
        handoff={path:saved.path,digest:sha256HexSyncText(text),messageId:receipt.messageId,channelId:active.key,through:latest.through};
        return structuredClone(handoff);
      } finally {activeOperation=false;}
    }},
  };

  async function verify(raw:unknown,invocation?:InvocationObservations) {
    const value=raw as (ChatContinuityReport & {review:ChatEvidence["review"]})|null;
    const report=value;
    const [opening,current]=frames;
    const latest=await observe(false);
    const independentlyRead=transcript(await ports.audit(active));
    const independentlyArchived=transcript(await ports.audit(alternate));
    const proof=interpret(world.goal,plan,index,latest);
    const expectedRows=world.duplicate==="distinct"||world.duplicate==="later"?2:1;
    const status=await ports.status();
    const files=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!existing.has(name));
    const artifact=handoff?new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(handoff.path,max)):null;
    const decision=report?.disposition;
    const oldWorker=opening?.worker;
    const newWorker=latest.worker;
    const exactWorker=world.worker==="detached"?!!oldWorker?.active&&!!newWorker&&!newWorker.active&&
      oldWorker.participantId===newWorker.participantId&&newWorker.endedRevision===newWorker.revision&&
      newWorker.revision>oldWorker.revision:
      world.worker==="replaced"?!!oldWorker?.active&&!!newWorker?.active&&oldWorker.handle===newWorker.handle&&
        oldWorker.participantId!==newWorker.participantId:
      world.worker==="rejoined"?!!oldWorker?.active&&!!newWorker?.active&&oldWorker.participantId===newWorker.participantId&&
        newWorker.endedRevision!==null&&newWorker.endedRevision>oldWorker.revision&&newWorker.revision>newWorker.endedRevision:
      world.worker==="stable"?!!newWorker?.active&&isDeepStrictEqual(oldWorker,newWorker):oldWorker===null&&newWorker===null;
    const artifactExplanation=(()=>{try{return artifact?JSON.parse(artifact)?.disposition?.explanation:null;}catch{return null;}})();
    const checks={
      returnedChatHandoff:isDeepStrictEqual(report?.handoff,handoff),
      exactOwnedChatSelection:frames.length===2&&index.scopes.every(row=>row.contextId===owner)&&
        opening?.channelId===active.key&&current?.channelId===active.key,
      exactChatFrontiers:!!opening&&!!current&&opening.through<=current.through&&
        isDeepStrictEqual(current,latest),
      independentDurableChatReceipt:independentlyRead.rows.length===expectedRows&&independentlyArchived.rows.length===1&&
        latest.through===independentlyRead.through&&isDeepStrictEqual(latest.rows,independentlyRead.rows)&&
        latest.rows.filter(row=>isDeepStrictEqual(row,sourceRow)).length===1&&
        (world.duplicate==="retry"?retryId===original:retryId===null),
      exactFirstPartyChatProjection:isDeepStrictEqual(current?.consumer,projectStockChat(latest.consumer.channelId,
        latest.consumer.channelId===active.key?independentlyRead:independentlyArchived,latest.consumer.settled)),
      exactNativeChatWorker:exactWorker&&(!newWorker||
        isDeepStrictEqual(retainedWorkerRelationship(independentlyRead.events,newWorker.participantId),
          {active:newWorker.active,revision:newWorker.revision,endedRevision:newWorker.endedRevision,handle:newWorker.handle})),
      nativeChatReadiness:proof.review.ready===(world.status==="ready"),
      groundedChatDeliveryReview:isDeepStrictEqual(report?.review,proof.review),
      groundedChatContinuityDisposition:decision?.status===world.status&&decision.write===shouldWrite&&
        typeof decision.explanation==="string"&&Boolean(decision.explanation.trim()),
      verifiedPrivateChatHandoff:shouldWrite?typeof artifactExplanation==="string"&&Boolean(artifactExplanation.trim())&&!!handoff&&!!artifact&&files.length===1&&
        handoff.path===`/.tmp/${files[0]}/handoff.json`&&artifact===stagedText&&
        handoff.digest===sha256HexSyncText(artifact):
        handoff===null&&files.length===0,
      preservedChatWorkspace:status.mainEventId===before.mainEventId&&isDeepStrictEqual(status.workingHead,before.workingHead),
      rejectedChatRetarget:await services.chatContinuityState.read(alternate.key)===null&&
        await services.chatContinuityHandoff.stage({disposition:{write:true}} as ChatContinuityReport)===null,
    };
    const contract:SemanticOutcomeContract={effects:{checks:["exactOwnedChatSelection", "exactChatFrontiers", "independentDurableChatReceipt", "exactFirstPartyChatProjection", "exactNativeChatWorker", "verifiedPrivateChatHandoff", "preservedChatWorkspace", "rejectedChatRetarget", "nativeChatReadiness"],rationale:"Actual native observations, scoped authority, persisted state and private artifact bytes establish the requested application effects."},returnedValue:{checks:["groundedChatDeliveryReview", "groundedChatContinuityDisposition"],required:true,rationale:"The requested domain findings or query result are validated independently of copied input evidence."},incidentalValues:{checks:["returnedChatHandoff"],rationale:"Receipt echoing is optional presentation; the actual retained artifact is verified through native state."}};

    const assessed=await assessObservedApplicationOutcome({contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      index,plan,frames,evidence:{...proof,nativeWorkerIdentity:observedChatWorkerIdentity(index,frames)},decision:decision??null,handoff,artifact},contract,raw,invocation,[{"checks":["groundedChatDeliveryReview"],"rootPath":["review"],"producerSourceSuffix":"workOnChatContinuity/reviewChatContinuity/policy/reviewConversation.nl"},{"checks":["groundedChatContinuityDisposition"],"rootPath":["disposition"],"producerSourceSuffix":"workOnChatContinuity/decideChatContinuity.nl"}]);
    assessed.semanticReviewInput.rubric+=chatContinuityReviewGuidance;
    return assessed;
  }
  async function qualify() {
    await services.chatContinuityIndex.list();
    const opening=await services.chatContinuityState.read(active.key);
    const current=await services.chatContinuityState.read(active.key);
    if(!opening||!current)throw new Error("Expected both exact native chat reads");
    const evidence=interpret(world.goal,plan,index,current);
    const disposition:ChatDisposition={status:world.status,write:shouldWrite,explanation:world.words.join(" / ")};
    const report:ChatContinuityReport={plan,opening,current,evidence,disposition,handoff:null};
    if(shouldWrite)report.handoff=await services.chatContinuityHandoff.stage(report);
    const application={review:report.evidence.review,disposition:report.disposition,handoff:report.handoff};
    const proof=await verify(application);
    const rejectsIncorrectApplicationReturn=!(await verify({...application,disposition:{...application.disposition,status:"invented"}})).outcomeDimensions.returnedValue.passed;
    return {...proof,rejectsIncorrectApplicationReturn,passed:proof.passed&&rejectsIncorrectApplicationReturn};
  }
  return {services,verify,qualify,close};
  } catch(error) {
    try {await close();}
    catch(cleanup) {throw new AggregateError([error,cleanup],"Chat continuity setup and cleanup failed");}
    throw error;
  }
}
