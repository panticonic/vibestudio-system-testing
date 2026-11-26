import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["brief", "plan", "evidence"],["artifact"],{nonAuthoritativeKeys:["plan"]});
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import {type SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import { isDeepStrictEqual as equal } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { logIdForChannel } from "@vibestudio/trajectory-identity";
import { blobstore, contextId, fs, memory, rpc, runtime, vcs, type VcsClient } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { AGENTIC_EVENT_PAYLOAD_KIND, type AgenticEvent } from "@workspace/agentic-protocol";
import { bindScratchHandoff, maxScratchArtifactBytes as max} from "@workspace-skills/scratch-handoff-bindings";
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
    const allowedKinds:MemoryKind[]=world.sources==="discussion"?["message"]:world.sources==="records"?["file","commit"]:["message","file","commit"];
    const permits=(kinds:MemoryKind[])=>Array.isArray(kinds)&&kinds.every(kind=>allowedKinds.includes(kind));
    const scopePath=await ports.fs.mkdtemp("retained-memory-scope")+"/request.txt";
    await ports.fs.writeFile(scopePath,world.goal);
    const scratchBefore=new Set(await listOwnedScratchEntries(ports.fs));
    const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which exact original sources establish the decision?"],sources:[{id:"memory-request",path:scopePath}]},ports.readBytes).scratchHandoffWrite;
    const journal:{method:string;args:unknown[];result:unknown}[]=[];
    const observed:{queries:{query:string;kinds:MemoryKind[];leads:MemoryLead[]}[];leads:MemoryLead[];messages?:MemoryMessage[];committed:Map<string,MemoryFile|null>;working?:MemoryFile|null}={queries:[],leads:[],committed:new Map()};
    let handoff:MemoryNote|null=null,stagedText:string|null=null,writing=false;
    const assertOpen=()=>{if(closed)throw new Error("Owned retained-memory scope is closed");};
    const record=<T>(method:string,args:unknown[],result:T):T=>{journal.push({method,args:structuredClone(args),result:structuredClone(result)});return structuredClone(result);};
    function inScope(row:{kind:string;eventId:string|null;logId:string|null}){
      return row.kind==="message"?!!row.eventId&&row.logId===logIdForChannel(lane.key):
        (row.kind==="commit"||row.kind==="file")&&!!row.eventId&&events.includes(row.eventId);
    }
    async function recall(query:string,kinds:MemoryKind[]):Promise<MemoryLead[]>{
      const found=await ports.memory.recall({query:query+" "+tag,kinds,limit:36});
      return found.results.flatMap((row):MemoryLead[]=>!row.eventId||!inScope(row)?[]:[{kind:row.kind as MemoryKind,snippet:row.snippet.split(tag).join("").trim(),eventId:row.eventId,logId:row.logId,head:row.head,path:row.path,digest:row.contentHash}]);
    }
    const proofEvidence=():MemoryEvidence=>({leads:observed.leads,messages:observed.messages??[],committed:[...observed.committed.values()].flatMap(row=>row?[row]:[]),working:observed.working??null});
    const hasOriginalRead=()=>observed.messages!==undefined||[...observed.committed.values()].some(row=>row!==null)||observed.working!=null;
    async function auditEvidence(){
      const current=await ports.vcs.status(),currentMain=await ports.vcs.mainState();
      const messages=allowedKinds.includes("message")?await ports.transcript(lane):[];
      const committed=await Promise.all(events.map(eventId=>realFile({kind:"event",eventId})));
      const working=world.draft!==undefined?await realFile(current.workingHead):null;
      const stable=equal(current,before)&&equal(currentMain,main)&&
        (observed.messages===undefined||equal(observed.messages,messages))&&
        [...observed.committed].every(([event,row])=>equal(row,committed[events.indexOf(event)]))&&
        (observed.working===undefined||equal(observed.working,working));
      return{stable,messages,committed,working,current,main:currentMain};
    }
    function validEvidence(value:MemoryEvidence){
      const actual=proofEvidence();
      return !!value&&Array.isArray(value.leads)&&value.leads.every(row=>actual.leads.some(issued=>equal(row,issued)))&&
        Array.isArray(value.messages)&&value.messages.every(row=>actual.messages.some(issued=>equal(row,issued)))&&
        Array.isArray(value.committed)&&value.committed.every(row=>actual.committed.some(issued=>equal(row,issued)))&&
        (value.working===null||actual.working!==null&&equal(value.working,actual.working));
    }
    function validCitation(citation:MemoryCitation,evidence:MemoryEvidence){
      if(!citation||typeof citation.quote!=="string"||!citation.quote.trim())return false;
      if(citation.layer==="message")return evidence.messages.some(row=>citation.ref===row.envelopeId&&citation.coordinate===row.messageId&&row.text.includes(citation.quote));
      const candidates=citation.layer==="commit"?evidence.committed:citation.layer==="working"&&evidence.working?[evidence.working]:[];
      return candidates.some(row=>citation.ref===row.eventId&&citation.coordinate===row.fileId&&row.text.includes(citation.quote));
    }
    function validOutcome(outcome:MemoryOutcome|undefined,evidence:MemoryEvidence){
      return !!outcome&&typeof outcome.summary==="string"&&!!outcome.summary.trim()&&
        Array.isArray(outcome.citations)&&(!world.requestedCitationRequired||outcome.citations.length>0)&&outcome.citations.every(citation=>validCitation(citation,evidence));
    }
    const encode=(brief:MemoryBrief,plan:MemoryPlan,evidence:MemoryEvidence,outcome:MemoryOutcome)=>JSON.stringify({visibility:"private-local",brief,plan,evidence,outcome});
    const services={nativeRetainedMemory:{
      async brief(){assertOpen();return record("brief",[],reference);},
      async recall(query:string,kinds:MemoryKind[]){
        assertOpen();if(typeof query!=="string"||!query.trim()||!permits(kinds))return [];
        const selected=[...new Set(kinds)],leads=await recall(query,selected);observed.queries.push({query,kinds:selected,leads});
        for(const lead of leads)if(!observed.leads.some(row=>equal(row,lead)))observed.leads.push(lead);
        return record("recall",[query,kinds],leads);
      },
      async transcript(channelId:string){assertOpen();if(!allowedKinds.includes("message")||channelId!==lane.key)return [];
        observed.messages=await ports.transcript(lane);return record("transcript",[channelId],observed.messages);
      },
      async archivedFile(eventId:string){assertOpen();if(!allowedKinds.some(kind=>kind==="file"||kind==="commit")||!events.includes(eventId))return null;
        const row=await realFile({kind:"event",eventId});observed.committed.set(eventId,row);return record("archivedFile",[eventId],row);
      },
      async workingFile(){assertOpen();if(!allowedKinds.includes("file"))return null;
        const current=await ports.vcs.status();if(!equal(current,before))return null;
        observed.working=current.clean?null:await realFile(current.workingHead);return record("workingFile",[],observed.working);
      },
    },nativeMemoryHandoff:{async stage(brief:MemoryBrief,plan:MemoryPlan,evidence:MemoryEvidence,outcome:MemoryOutcome){
      assertOpen();if(!world.private||writing||handoff||!equal(brief,reference)||!hasOriginalRead()||!validEvidence(evidence)||!validOutcome(outcome,proofEvidence()))return null;
      writing=true;
      try{if(!(await auditEvidence()).stable)return null;const text=encode(brief,plan,evidence,outcome);const saved=await writer.stage(text);if(saved){stagedText=text;handoff={path:saved.path,digest:sha256HexSyncText(text)};}return structuredClone(handoff);}finally{writing=false;}
    }}};
    async function verify(raw:unknown,invocation?:InvocationObservations){
      const report=raw as RetainedMemoryReport|null,evidence=proofEvidence(),independent=await auditEvidence();
      const notes=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!scratchBefore.has(name));
      const artifact=handoff?new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(handoff.path,max)):null;
      const checks={returnedMemoryHandoff:equal(report?.handoff,handoff),
        exactRetainedMemoryScope:hasOriginalRead(),
        exactBoundedNativeRecall:observed.queries.every(query=>query.leads.length<=36&&permits(query.kinds)&&query.leads.every(inScope)),
        independentlyReadMemorySources:independent.stable,
        exactMemoryCitations:validOutcome(report?.outcome,evidence),
        protectedMemoryScope:equal(await ports.vcs.status(),before)&&equal(await ports.vcs.mainState(),main)&&
          (await services.nativeRetainedMemory.transcript("foreign-"+lane.key)).length===0&&await services.nativeRetainedMemory.archivedFile("foreign-"+main.eventId)===null,
        exactPrivateMemoryHandoff:world.private?!!artifact&&!!handoff&&notes.length===1&&handoff.path===`/.tmp/${notes[0]}/handoff.json`&&handoff.digest===sha256HexSyncText(artifact)&&artifact===stagedText:handoff===null&&notes.length===0};
      const contract:SemanticOutcomeContract={effects:{checks:["exactRetainedMemoryScope","exactBoundedNativeRecall","independentlyReadMemorySources","protectedMemoryScope","exactPrivateMemoryHandoff"],rationale:"Actual owned originals, current source identity and protected state, and requested authorized private-note bytes establish native effects independently of answer labels or read routes."},returnedValue:{checks:["exactMemoryCitations"],required:world.requestedReturnRequired,rationale:"Only the literal goal's requested returned explanation and authentic citations are required; a private note may itself be the requested answer artifact."},incidentalValues:{checks:["returnedMemoryHandoff"],rationale:"An optional native receipt echo is independently checked without changing actual artifact completion."}};
      return assessObservedApplicationOutcome({contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),brief:reference,plan:{queries:observed.queries.map(({query,kinds})=>({query,kinds}))},evidence:{observed:evidence,independent,reads:structuredClone(journal),permittedSources:allowedKinds},outcome:report?.outcome??null,handoff,artifact},contract,raw,invocation,[{checks:["exactMemoryCitations"],rootPath:["outcome"],producerSourceSuffix:"reviewRetainedMemory/judgeMemoryClaim.nl"}]);
    }
    async function qualify(){
      const api=services.nativeRetainedMemory,brief=await api.brief();
      const plan:MemoryPlan={query:world.anchor,kinds:allowedKinds,readTranscript:allowedKinds.includes("message"),readWorking:world.draft!==undefined};
      await api.recall(plan.query,plan.kinds);if(plan.readTranscript)await api.transcript(brief.channelId);
      if(allowedKinds.includes("commit"))for(const event of events)await api.archivedFile(event);
      if(plan.readWorking)await api.workingFile();
      const evidence=proofEvidence(),citations:MemoryCitation[]=[];
      for(const index of world.required.messages??[]){const row=evidence.messages[index];if(!row)throw new Error("Reference original message unavailable");citations.push({layer:"message",ref:row.envelopeId,coordinate:row.messageId,quote:row.text});}
      for(const index of world.required.records??[]){const row=evidence.committed.find(row=>row.eventId===events[index]);if(!row)throw new Error("Reference immutable source unavailable");citations.push({layer:"commit",ref:row.eventId,coordinate:row.fileId,quote:row.text});}
      if(world.required.draft){const row=evidence.working;if(!row)throw new Error("Reference draft unavailable");citations.push({layer:"working",ref:row.eventId,coordinate:row.fileId,quote:row.text});}
      const outcome:MemoryOutcome={disposition:world.required.disposition,citations,summary:"Compared exact original conversation rows and the requested native source evidence."};
      const handoff=world.private?await services.nativeMemoryHandoff.stage(brief,plan,evidence,outcome):null;
      const application={outcome,handoff},proof=await verify(application);
      const rejectedInvalidCitation=!(await verify({...application,outcome:{...outcome,citations:[{layer:"commit",ref:"unissued-event",coordinate:"foreign-file",quote:"invented"}]}})).outcomeDimensions.returnedValue.passed;
      return{...proof,rejectsIncorrectApplicationReturn:rejectedInvalidCitation,passed:proof.passed&&rejectedInvalidCitation};
    }
    return{services,verify,qualify,close};
  }catch(error){await close();throw error;}
}
