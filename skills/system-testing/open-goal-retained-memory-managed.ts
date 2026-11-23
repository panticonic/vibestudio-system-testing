import { isDeepStrictEqual as equal } from "node:util";
import { compareUtf16CodeUnits, sha256HexSyncText } from "@vibestudio/content-addressing";
import { logIdForChannel } from "@vibestudio/trajectory-identity";
import { blobstore, contextId, fs, memory, rpc, runtime, vcs, type VcsClient } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { AGENTIC_EVENT_PAYLOAD_KIND, type AgenticEvent } from "@workspace/agentic-protocol";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { MemoryBrief, MemoryCitation, MemoryEvidence, MemoryFile, MemoryKind, MemoryLead, MemoryMessage,
  MemoryNote, MemoryOutcome, MemoryPlan, RetainedMemoryReport } from "@workspace-skills/open-retained-memory/types";
import { withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { openRetainedMemoryWorlds } from "./open-goal-retained-memory-worlds.js";

type Lane={key:string;target:string;entityId:string;expected:[]};
type State=Awaited<ReturnType<VcsClient["status"]>>["workingHead"];
type Ports={
  contextId:string|null;fs:typeof fs;blobstore:Pick<typeof blobstore,"putText">;memory:Pick<typeof memory,"recall">;
  vcs:Pick<VcsClient,"status"|"mainState"|"importSnapshot"|"edit"|"resolveRepository"|"readFile">;
  createChannel(owner:string,title:string):Promise<Lane>;
  send(lane:Lane,owner:string,text:string):Promise<unknown>;
  transcript(lane:Lane):Promise<MemoryMessage[]>;
  retire(id:string):Promise<unknown>;
  readBytes(path:string,max:number):Promise<Uint8Array>;
};
const recordPath="decision.txt";
const max=24_000;
const keyOf=(state:State)=>state.kind==="event"?state.eventId:state.applicationId;

function livePorts():Ports{
  return {contextId,fs,blobstore,memory,vcs,
    async createChannel(owner,title){
      const key="retained-memory-"+crypto.randomUUID();
      const channel=await runtime.createEntity({kind:"do",execution:{surface:"code",source:"workers/pubsub-channel"},
        className:"PubSubChannel",key,contextId:owner});
      if(channel.kind!=="do"||channel.contextId!==owner)throw new Error("No exact owned memory channel");
      await rpc.call(channel.targetId,channelClientRpcMethods.initializeConversation,[owner,{title}]);
      return {key,target:channel.targetId,entityId:channel.id,expected:[]};
    },
    send:(lane,owner,text)=>withOwnedChannelClient(lane,owner,client=>client.send(text,{idempotencyKey:crypto.randomUUID()})),
    async transcript(lane){
      const page=await rpc.call(lane.target,channelClientRpcMethods.getReplayAfter,[{after:0,limit:20}]);
      if(page.ready.hasMoreAfter)throw new Error("Owned memory conversation exceeded its scope");
      return page.logEvents.flatMap((row):MemoryMessage[]=>{
        const event=row.payload as AgenticEvent<"message.completed">|undefined;
        if(row.type!==AGENTIC_EVENT_PAYLOAD_KIND||event?.kind!=="message.completed"||!("role" in event.payload)||event.payload.role!=="user")return [];
        if(!event.causality?.messageId||row.senderId!==event.actor.id)throw new Error("Invalid exact message anchor");
        const text=(event.payload.blocks??[]).flatMap(block=>block.type==="text"?[block.content]:[]).join("");
        return [{channelId:lane.key,envelopeId:row.messageId,messageId:event.causality.messageId,sender:row.senderId,sequence:row.id,text}];
      });
    },
    retire:id=>runtime.retireEntity({id}),readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)};
}

type Candidate = Pick<MemoryPlan,"kinds"|"readTranscript"|"readWorking">;
export async function prepareRetainedMemory(input:{contextId:string;caseId:string},ports=livePorts()){
  const world=openRetainedMemoryWorlds.find(row=>row.id===input.caseId);
  if(!world||ports.contextId!==input.contextId)throw new Error("Memory requires the exact owned context");
  const owner=input.contextId;
  const original=await ports.vcs.status();
  const main=await ports.vcs.mainState();
  if(original.contextId!==owner||!original.clean||original.mainEventId!==main.eventId)
    throw new Error("Memory requires a fresh owned semantic context");
  const tag="retained"+crypto.randomUUID().replaceAll("-","");
  const repoPath="projects/decision-"+tag.slice(-16);
  const lane=await ports.createChannel(owner,world.subject);
  let closed=false;
  async function close(){
    if(closed)return;
    await ports.retire(lane.entityId);
    closed=true;
  }
  try {
    for(const text of world.messages)
      await ports.send(lane,owner,text);
    let head=original.workingHead;
    let repositoryId:string|undefined;
    const events:string[]=[];
    for(const [ordinal,text] of world.records.entries()){
      const files=[{path:recordPath,mode:0o644,contentHash:(await ports.blobstore.putText(text)).digest}];
      const result=await ports.vcs.importSnapshot({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:head,
        source:{kind:"generated",uri:"system-test://retained-memory/"+tag,
          snapshotRevision:sha256HexSyncText(JSON.stringify({ordinal,files}))},
        intentSummary:tag+" "+text,message:tag+" "+text,
        repositories:[{repoPath,...(repositoryId?{repositoryId}:{}),files}]});
      const installed=result.importedRepositoryIds[0];
      if(!installed||result.importedRepositoryIds.length!==1||repositoryId&&repositoryId!==installed)
        throw new Error("Memory changed its assigned native repository identity");
      repositoryId=installed;
      events.push(result.eventId);
      head={kind:"event",eventId:result.eventId};
    }
    async function realFile(state:State):Promise<MemoryFile|null>{
      const repo=await ports.vcs.resolveRepository({state,repoPath});
      if(!repo)return null;
      if(repositoryId&&repo.repositoryId!==repositoryId)throw new Error("Exact memory repository changed");
      const file=await ports.vcs.readFile({state,repositoryId:repo.repositoryId,file:{kind:"path",path:recordPath}});
      if(!file)return null;
      if(file.path!==recordPath||file.repoPath!==repoPath||file.repositoryId!==repo.repositoryId||file.content.kind!=="text")
        throw new Error("Wrong native memory file origin");
      return {eventId:keyOf(state),fileId:file.fileId,path:repoPath+"/"+recordPath,digest:file.contentHash,text:file.content.text};
    }
    if(world.draft!==undefined){
      const previous=await realFile(head);
      if(!previous||!repositoryId)throw new Error("Memory draft needs owned immutable basis");
      await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:head,
        intentSummary:"Retain an unpublished comparison draft",changes:[{kind:"content-replace",repositoryId,
          fileId:previous.fileId,content:{kind:"text",text:world.draft}}]});
    }
    const before=await ports.vcs.status();
    if(before.contextId!==owner||before.mainEventId!==main.eventId)throw new Error("Memory setup changed protected main");
    const reference:MemoryBrief={subject:world.subject,channelId:lane.key,repository:repoPath};
    const expected:Candidate={
      kinds:world.sources==="discussion"?["message"]:world.sources==="records"?["file","commit"]:["message","file","commit"],
      readTranscript:world.sources!=="records",readWorking:world.draft!==undefined};
    const anchor=world.anchor.toLowerCase();
    const acceptsQuery=(query:string)=>typeof query==="string"&&query.length<=90&&
      query.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(anchor);
    const scopePath=await ports.fs.mkdtemp("retained-memory-scope")+"/request.txt";
    await ports.fs.writeFile(scopePath,world.goal);
    const scratchBefore=new Set(await listOwnedScratchEntries(ports.fs));
    const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which exact original sources establish the decision?"],
      sources:[{id:"memory-request",path:scopePath}]},ports.readBytes).scratchHandoffWrite;

    const observed:{brief:boolean;query?:string;kinds?:MemoryKind[];leads?:MemoryLead[];messages?:MemoryMessage[];
      committed:Map<string,MemoryFile|null>;working?:MemoryFile|null}={brief:false,committed:new Map()};
    let handoff:MemoryNote|null=null;
    let writing=false;
    const encode=(brief:MemoryBrief,plan:MemoryPlan,evidence:MemoryEvidence,outcome:MemoryOutcome)=>
      JSON.stringify({visibility:"private-local",brief,plan,evidence,outcome});
    const acceptedKinds=(kinds:MemoryKind[])=>equal(kinds,expected.kinds);
    function inScope(row:{kind:string;eventId:string|null;logId:string|null}){
      return row.kind==="message"?!!row.eventId&&row.logId===logIdForChannel(lane.key):
        (row.kind==="commit"||row.kind==="file")&&!!row.eventId&&events.includes(row.eventId);
    }
    async function recall(query:string,kinds:MemoryKind[]):Promise<MemoryLead[]>{
      // Opaque per-world commit marker allows a bounded native index query even on a populated workspace.
      const found=await ports.memory.recall({query:query+" "+tag,kinds,limit:36});
      const leads=found.results.flatMap((row):MemoryLead[]=>!row.eventId||!inScope(row)?[]:[{
        kind:row.kind as MemoryKind,snippet:row.snippet.split(tag).join("").trim(),eventId:row.eventId,
        logId:row.logId,head:row.head,path:row.path,digest:row.contentHash}]);
      return leads.sort((a,b)=>events.indexOf(a.eventId)-events.indexOf(b.eventId)||
        compareUtf16CodeUnits(a.kind,b.kind)||compareUtf16CodeUnits(a.eventId,b.eventId));
    }
    function planMatches(plan:MemoryPlan|undefined){
      return plan?.query===observed.query&&!!plan&&acceptsQuery(plan.query)&&equal(plan.kinds,expected.kinds)&&
        plan.readTranscript===expected.readTranscript&&plan.readWorking===expected.readWorking;
    }
    const eventSet=()=>[...new Set((observed.leads??[]).filter(row=>row.kind!=="message").map(row=>row.eventId))];
    function proofEvidence():MemoryEvidence|null{
      if(!observed.leads||(expected.readTranscript&&!observed.messages)||
         (expected.readWorking&&observed.working===undefined)||!eventSet().every(event=>observed.committed.has(event)))return null;
      return {leads:observed.leads,messages:observed.messages??[],committed:eventSet().flatMap(event=>{
        const row=observed.committed.get(event);
        return row?[row]:[];
      }),working:observed.working??null};
    }
    async function auditEvidence(actual:MemoryEvidence) {
      const current=await ports.vcs.status();
      const reads=await Promise.all(actual.committed.map(row=>realFile({kind:"event",eventId:row.eventId})));
      const messages=expected.readTranscript?await ports.transcript(lane):[];
      const working=expected.readWorking?await realFile(current.workingHead):null;
      return equal(current,before)&&equal(await ports.vcs.mainState(),main)&&equal(reads,actual.committed)&&
        equal(messages,actual.messages)&&equal(working,actual.working)&&
        (!expected.readTranscript||equal(messages.map(({text})=>text),world.messages));
    }
    function citations(evidence:MemoryEvidence):MemoryCitation[]|null{
      const file=(row:MemoryFile,layer:"commit"|"working"):MemoryCitation=>({layer,ref:row.eventId,coordinate:row.fileId,quote:row.text});
      const selected:MemoryCitation[]=[];
      for(const index of world.required.messages??[]){
        const row=evidence.messages[index];
        if(!row)return null;
        selected.push({layer:"message",ref:row.envelopeId,coordinate:row.messageId,quote:row.text});
      }
      for(const index of world.required.records??[]){
        const row=evidence.committed.find(row=>row.eventId===events[index]);
        if(!row)return null;
        selected.push(file(row,"commit"));
      }
      if(world.required.draft){
        if(!evidence.working)return null;
        selected.push(file(evidence.working,"working"));
      }
      return selected;
    }
    function validOutcome(outcome:MemoryOutcome|undefined,evidence:MemoryEvidence){
      const exact=citations(evidence);
      return !!outcome&&exact!==null&&outcome.disposition===world.required.disposition&&equal(outcome.citations,exact)&&
        typeof outcome.summary==="string"&&!!outcome.summary.trim()&&outcome.summary.length<=700;
    }
    const services={
      nativeRetainedMemory:{
        async brief(){observed.brief=true;return structuredClone(reference);},
        async recall(query:string,kinds:MemoryKind[]){
          if(!observed.brief||observed.query!==undefined||!acceptsQuery(query)||!acceptedKinds(kinds))return [];
          observed.query=query;observed.kinds=[...kinds];observed.leads=await recall(query,kinds);
          return structuredClone(observed.leads);
        },
        async transcript(channelId:string){
          if(!observed.leads||!expected.readTranscript||channelId!==lane.key||observed.messages)return [];
          observed.messages=await ports.transcript(lane);return structuredClone(observed.messages);
        },
        async archivedFile(eventId:string){
          if(!eventSet().includes(eventId)||observed.committed.has(eventId))return null;
          const row=await realFile({kind:"event",eventId});
          observed.committed.set(eventId,row);return structuredClone(row);
        },
        async workingFile(){
          if(!observed.leads||!expected.readWorking||observed.working!==undefined)return null;
          const current=await ports.vcs.status();
          if(!equal(current,before)||current.clean)return null;
          observed.working=await realFile(current.workingHead);return structuredClone(observed.working);
        },
      },
      nativeMemoryHandoff:{async stage(brief:MemoryBrief,plan:MemoryPlan,evidence:MemoryEvidence,outcome:MemoryOutcome){
        if(!world.private||writing||handoff||!equal(brief,reference)||!planMatches(plan)||
          !equal(evidence,proofEvidence())||!validOutcome(outcome,evidence))return null;
        writing=true;
        if(!await auditEvidence(evidence))return null;
        const text=encode(brief,plan,evidence,outcome);
        const saved=await writer.stage(text);
        handoff=saved?{path:saved.path,digest:sha256HexSyncText(text)}:null;
        return structuredClone(handoff);
      }},
    };
    async function verify(raw:unknown){
      const value=raw as RetainedMemoryReport|null;
      const report=value;
      const evidence=proofEvidence();
      const notes=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!scratchBefore.has(name));
      const artifact=handoff?new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(handoff.path,max)):null;
      const nativeCheck=evidence!==null&&await auditEvidence(evidence);
      const checks={
        exactRetainedMemoryScope:observed.brief&&equal(report?.brief,reference)&&planMatches(report?.plan),
        exactBoundedNativeRecall:evidence!==null&&report!==undefined&&equal(report.evidence?.leads,evidence.leads)&&
          evidence.leads.every(inScope)&&(expected.kinds.includes("commit")?events.every(event=>eventSet().includes(event)):eventSet().length===0),
        independentlyReadMemorySources:nativeCheck&&equal(report?.evidence,evidence),
        exactMemoryCitations:evidence!==null&&validOutcome(report?.outcome,evidence),
        protectedMemoryScope:equal(await ports.vcs.status(),before)&&equal(await ports.vcs.mainState(),main)&&
          (await services.nativeRetainedMemory.transcript("foreign-"+lane.key)).length===0&&
          await services.nativeRetainedMemory.archivedFile("foreign-"+main.eventId)===null,
        exactPrivateMemoryHandoff:world.private?!!report&&!!artifact&&!!handoff&&notes.length===1&&
          handoff.path===`/.tmp/${notes[0]}/handoff.json`&&handoff.digest===sha256HexSyncText(artifact)&&
          equal(report.handoff,handoff)&&artifact===encode(report.brief,report.plan,report.evidence,report.outcome):
          handoff===null&&report?.handoff===null&&notes.length===0,
      };
      return {contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
        brief:reference,plan:report?.plan??null,evidence,outcome:report?.outcome??null,handoff,artifact};
    }
    async function qualify(){
      const api=services.nativeRetainedMemory;
      const brief=await api.brief();
      const plan={query:world.anchor,...expected};
      await api.recall(plan.query,plan.kinds);
      if(plan.readTranscript)await api.transcript(brief.channelId);
      for(const event of eventSet())await api.archivedFile(event);
      if(plan.readWorking)await api.workingFile();
      const evidence=proofEvidence();
      const refs=evidence&&citations(evidence);
      if(!evidence||!refs)throw new Error("Reference could not recover the assigned original evidence");
      const outcome:MemoryOutcome={disposition:world.required.disposition,citations:refs,
        summary:"Compared exact original conversation rows and the requested native source evidence."};
      const handoff=world.private?await services.nativeMemoryHandoff.stage(brief,plan,evidence,outcome):null;
      return verify({brief,plan,evidence,outcome,handoff});
    }
    return {services,verify,qualify,close};
  }catch(error){
    await close();
    throw error;
  }
}
