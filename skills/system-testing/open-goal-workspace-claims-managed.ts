import {assessSemanticOutcome,type SemanticOutcomeContract} from "./semantic-outcome-contract.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, rpc, vcs, type VcsClient } from "@workspace/runtime";
import { bindAuthorityReview } from "@workspace-skills/capabilities/workflow";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { fail, runSuites, suite } from "@workspace/testkit";
import type { ClaimDisposition, ClaimEvidence, ClaimHandoff, ClaimIndex, ClaimPacket,
  ClaimSupport, WorkspaceClaimReview } from "@workspace-skills/open-workspace-claims/types";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { openWorkspaceClaimWorlds, type Claim, type WorkspaceClaimWorld } from "./open-goal-workspace-claims-worlds.js";

const guidePath="skills/vibestudio-workflows/evidence/checkSupport/skills/workspace-evidence/SKILL.md";
const contractPath="policy.json";
const assertionsPath="acceptance.json";
const testName="candidate-policy-readback";
const suiteName="owned-semantic-assertions";
const text=(value:unknown)=>({kind:"text" as const,text:JSON.stringify(value)});
const limit=16_384;
type Status=Awaited<ReturnType<VcsClient["status"]>>;
type Policy={value:string;preservation:string|null;releaseCheck:"ready"|"pending"};
type Authority=Awaited<ReturnType<ReturnType<typeof bindAuthorityReview>["services"]["assignedAuthorityRead"]["preflight"]>>;
type Ports={contextId:string|null;vcs:Pick<VcsClient,"status"|"edit"|"commit"|"readFile"|"resolveRepository">;fs:typeof fs;
  guide:()=>Promise<string>;readBytes:(path:string,max:number)=>Promise<Uint8Array>;
  preflight:(owner:string)=>Promise<Authority>;runtime:"workerd-eval"|"source-reference"};

function livePorts():Ports {
  return {contextId,vcs,fs,guide:()=>fs.readFile(guidePath,"utf8"),readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max),
    runtime:"workerd-eval",preflight(owner){
      const id="exact-status-read";
      return bindAuthorityReview({goal:"Check the owner's exact read-only status operation",
        operations:[{id,label:"Current owned semantic status",service:"vcs",method:"status",args:[{contextId:owner}]}],ceiling:[]})
        .services.assignedAuthorityRead.preflight(id);
    }};
}

function statement(key:Claim,world:WorkspaceClaimWorld) {
  switch(key){
    case "state":return "The working candidate advanced beyond the earlier local semantic revision.";
    case "value":return `The current saved policy says: ${world.targetValue}`;
    case "preserved":return `The current and earlier policy preserve this rule: ${world.rule}`;
    case "native":return "The declared TestKit policy-readback test passed at the current candidate revision.";
    case "read-eligible":return "The exact current workspace status read is eligible under the observed preflight.";
    case "publish-granted":return "The observed preflight grants permission to publish this local candidate.";
    case "visible":return "The live panel displayed the new policy to an operator.";
    case "protected":return "The protected main event remained unchanged across this review.";
  }
}
function disposition(support:ClaimSupport):ClaimDisposition["status"] {
  return !support.supported.length?"unconfirmed":support.missing.length?"partial":"confirmed";
}
export function guideRevision(guide:string) {
  return "sk1_"+sha256HexSyncText("SKILL.md\u0000"+guide).slice(0,32);
}
function state(eventId:string){return {kind:"event" as const,eventId};}

export async function prepareWorkspaceClaims(input:{contextId:string;caseId:string},ports=livePorts()) {
  const world=openWorkspaceClaimWorlds.find(row=>row.id===input.caseId);
  if(!world||!ports.contextId||input.contextId!==ports.contextId)throw new Error("Claim audit belongs to its exact owned context");
  const owner=input.contextId;
  const initial=await ports.vcs.status();
  if(initial.contextId!==owner||!initial.clean||initial.integrating.length)throw new Error("Claim audit requires a clean local context");
  const repoPath=`projects/workspace-claim-${crypto.randomUUID()}`,archivePath=repoPath+"-archive";
  const id=crypto.randomUUID(),archive=crypto.randomUUID();
  const index:ClaimIndex={scopes:[{id:archive,purpose:"archive",title:world.title},{id,purpose:"review",title:world.title}]};
  const choice={id,retain:world.note===true};
  const priorPolicy:Policy={value:world.oldValue,preservation:world.rule,releaseCheck:"ready"};
  const candidatePolicy:Policy={value:world.value==="old"?world.oldValue:world.targetValue,
    preservation:world.preservation==="lost"?null:world.rule,releaseCheck:world.test==="fail"?"pending":"ready"};
  const requirements=world.claims.map(key=>({id:key,text:statement(key,world)}));
  const stored={id,title:world.title,requirements};
  const priorEdit=await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:initial.workingHead,
    intentSummary:"Create exact owned acceptance packet",
    changes:[{kind:"repository-create",repoPath,files:[
      {path:contractPath,mode:0o644,content:text(priorPolicy)},
      {path:assertionsPath,mode:0o644,content:text(stored)},
    ]},{kind:"repository-create",repoPath:archivePath,files:[
      {path:assertionsPath,mode:0o644,content:text({...stored,id:archive})},
    ]}]});
  const prior=(await ports.vcs.commit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:priorEdit.workingHead,
    message:"Retain original policy and review statements"})).event;
  const repository=await ports.vcs.resolveRepository({state:prior,repoPath});
  if(!repository)throw new Error("No original owned repository");
  const repositoryId=repository.repositoryId;
  async function read(eventId:string,path:string){
    return ports.vcs.readFile({state:state(eventId),repositoryId,file:{kind:"path",path}});
  }
  const original=await read(prior.eventId,contractPath);
  if(!original)throw new Error("Original policy was not retained");
  const working=await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:prior,
    intentSummary:"Record the candidate change at its own semantic revision",
    changes:[world.value==="missing"?{kind:"file-delete",repositoryId,fileId:original.fileId}:
      {kind:"content-replace",repositoryId,fileId:original.fileId,content:text(candidatePolicy)},
    {kind:"file-create",repositoryId,path:"local-attempt.json",mode:0o644,content:text({previous:prior.eventId})}]});
  const candidate=(await ports.vcs.commit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:working.workingHead,
    message:"Retain the local evidence candidate"})).event;
  const before=await ports.vcs.status();
  if(!before.clean||before.committed.eventId!==candidate.eventId||before.mainEventId!==initial.mainEventId)
    throw new Error("The candidate did not retain its intended local and protected bases");

  async function nativeFacts(status:Status) {
    const [current,previous,packet,protectedRepo]=await Promise.all([
      read(candidate.eventId,contractPath),read(prior.eventId,contractPath),read(candidate.eventId,assertionsPath),
      ports.vcs.resolveRepository({state:state(status.mainEventId),repoPath}),
    ]);
    if(packet?.content.kind!=="text"||previous?.content.kind!=="text"||(current&&current.content.kind!=="text")||protectedRepo)
      throw new Error("The owned acceptance packet or local policy escaped its scope");
    return {current:current?{fileId:current.fileId,hash:current.contentHash,value:JSON.parse(current.content.text) as Policy}:null,
      previous:{fileId:previous.fileId,hash:previous.contentHash,value:JSON.parse(previous.content.text) as Policy},
      packetHash:packet.contentHash,packet:JSON.parse(packet.content.text) as Pick<ClaimPacket,"id"|"title"|"requirements">};
  }

  async function runObservedTest(){
    const requestEvent=world.test==="prior"?prior.eventId:candidate.eventId;
    const name=world.test==="unrelated"?"revision-metadata-only":testName;
    const expectedValue=world.test==="prior"?world.oldValue:world.targetValue;
    let checkedHash:string|null=null;
    const assigned=suite(suiteName).test(name,async()=>{
      if(name!==testName){
        const repo=await ports.vcs.resolveRepository({state:state(requestEvent),repoPath});
        if(!repo||repo.repositoryId!==repositoryId)fail("Expected exact repository metadata");
        return;
      }
      const observed=await read(requestEvent,contractPath);
      if(observed?.content.kind!=="text")return fail("Policy file is absent at this exact state");
      checkedHash=observed.contentHash;
      const policy=JSON.parse(observed.content.text) as Policy;
      if(policy.value!==expectedValue)fail("Candidate policy did not match its declared contract");
      if(policy.releaseCheck!=="ready")fail("The required local review flag remains pending");
    },{skip:world.test==="skipped",timeoutMs:10_000});
    const report=await runSuites(assigned);
    const result=report.results[0];
    if(report.total!==1||!result||result.name!==name||result.suite!==suiteName)throw new Error("TestKit returned an unassigned result");
    return {id:crypto.randomUUID(),at:requestEvent,runtime:ports.runtime,suite:suiteName,name:result.name,status:result.status,
      checkedHash,detail:result.error?.message??null};
  }

  const capture=await nativeFacts(before);
  const packet:ClaimPacket={...capture.packet,candidateEvent:candidate.eventId,priorEvent:prior.eventId,
    protectedEvent:initial.mainEventId,packetHash:capture.packetHash};
  if(!isDeepStrictEqual(capture.packet,stored))throw new Error("Exact original requirement wording did not survive");
  const guide=await ports.guide();
  const revision=guideRevision(guide);
  const test=await runObservedTest();
  const authority=await ports.preflight(owner);
  const evidence:ClaimEvidence={packetId:id,candidateEvent:candidate.eventId,priorEvent:prior.eventId,sourceHash:capture.packetHash,
    observations:[
      `Prior local event ${prior.eventId}. Policy from that event: ${JSON.stringify(capture.previous)}`,
      `Current local event ${candidate.eventId}. Policy from that event: ${JSON.stringify(capture.current)}`,
      `Protected main before the candidate: ${initial.mainEventId}. Protected main after the candidate and before the review: ${before.mainEventId}.`,
      `Executed TestKit report for native semantic readback: ${JSON.stringify(test)}`,
      `The sole read-only preflight was vcs.status for this context ${owner}: ${JSON.stringify(authority)}. No publish or panel surface operation was executed.`,
    ]};
  function expectedSupport(facts:Awaited<ReturnType<typeof nativeFacts>>,after:Status) {
    const supported=new Set<Claim>();
    if(candidate.eventId!==prior.eventId&&after.committed.eventId===candidate.eventId)supported.add("state");
    if(facts.current?.value.value===world.targetValue)supported.add("value");
    if(facts.current?.value.preservation&&facts.current.value.preservation===facts.previous.value.preservation)supported.add("preserved");
    if(test.at===candidate.eventId&&test.name===testName&&test.status==="passed"&&test.checkedHash&&test.checkedHash===facts.current?.hash)
      supported.add("native");
    if(authority.operationId==="exact-status-read"&&authority.decision==="allowed")supported.add("read-eligible");
    if(after.mainEventId===initial.mainEventId)supported.add("protected");
    return {supported:requirements.filter(row=>supported.has(row.id)).map(row=>row.text),
      missing:requirements.filter(row=>!supported.has(row.id)).map(row=>row.text)};
  }
  const expected=expectedSupport(capture,before);
  const scratch=await ports.fs.mkdtemp("workspace-claims");
  const policy=`${scratch}/private-review.txt`;
  await ports.fs.writeFile(policy,"Only retain an explicitly authorized private review of this exact packet.");
  const existing=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which exact claims were established?"],
    sources:[{id:"review-scope",path:policy}]},ports.readBytes).scratchHandoffWrite;
  const body=(result:WorkspaceClaimReview)=>JSON.stringify({visibility:"private-local",packet:result.packet,evidence:result.evidence,
    support:result.support,disposition:result.disposition});
  let selected=false,observed=false,staging=false;
  let handoff:ClaimHandoff|null=null;
  let stagedText:string|null=null;
  const services={
    workspaceClaimRead:{
      async list(){return structuredClone(index);},
      async read(scope:string){
        if(scope!==id)return null;
        selected=true;return structuredClone(packet);
      },
      async observe(scope:string){
        if(!selected||scope!==id)return null;
        observed=true;return structuredClone(evidence);
      },
    },
    workspaceClaimHandoff:{async stage(report:WorkspaceClaimReview){
      if(!world.note||!observed||staging||handoff||!report||report.handoff!==null||
        !isDeepStrictEqual(report.choice,choice)||!isDeepStrictEqual(report.packet,packet)||!isDeepStrictEqual(report.evidence,evidence)||
        !isDeepStrictEqual(report.support,expected)||report.disposition?.status!==disposition(expected)||
        typeof report.disposition.summary!=="string"||!report.disposition.summary.trim()||report.disposition.summary.length>650)return null;
      staging=true;
      try{
        if(!isDeepStrictEqual(await ports.vcs.status(),before))return null;
        const payload=body(report);
        const saved=(stagedText=payload,await writer.stage(payload));
        if(!saved)return null;
        handoff={path:saved.path,digest:sha256HexSyncText(payload)};
        return structuredClone(handoff);
      }finally{staging=false;}
    }},
  };

  async function verify(raw:unknown) {
    const value=raw as WorkspaceClaimReview|null;
    const report=value;
    const after=await ports.vcs.status();
    const readback=await nativeFacts(after);
    const support=expectedSupport(readback,after);
    const scratchFiles=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!existing.has(name));
    const artifact=handoff?new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(handoff.path,limit)):null;
    const actualOutcome=({pass:"passed",prior:"passed",unrelated:"passed",fail:"failed",skipped:"skipped"} as const)[world.test];
    const checks={
      returnedClaimHandoff:isDeepStrictEqual(report?.handoff,handoff),
      exactClaimScope:selected&&
        packet.packetHash===readback.packetHash&&isDeepStrictEqual(readback.packet,stored),
      independentSemanticEvidence:observed&&isDeepStrictEqual(capture,readback)&&
        isDeepStrictEqual(readback.current?.value??null,world.value==="missing"?null:candidatePolicy),
      exactTestkitClaimInput:test.status===actualOutcome&&test.at===(world.test==="prior"?prior.eventId:candidate.eventId)&&
        test.name===(world.test==="unrelated"?"revision-metadata-only":testName)&&
        test.runtime===ports.runtime&&test.checkedHash===(world.test==="skipped"||world.test==="unrelated"?null:
          world.test==="prior"?readback.previous.hash:readback.current?.hash??null),
      exactAuthorityPreflight:authority.operationId==="exact-status-read"&&authority.decision==="allowed"&&authority.leaves.every(
        leaf=>leaf.status==="granted"||leaf.tier==="open"),
      exactGroundedClaimPartition:isDeepStrictEqual(report?.support,support)&&report?.disposition.status===disposition(support)&&
        typeof report.disposition.summary==="string"&&!!report.disposition.summary.trim()&&report.disposition.summary.length<=650,
      independentlyPreservedClaimContext:isDeepStrictEqual(before,after)&&after.mainEventId===initial.mainEventId,
      exactPrivateClaimNote:world.note?!!artifact&&!!handoff&&scratchFiles.length===1&&artifact===stagedText&&
        handoff.path===`/.tmp/${scratchFiles[0]}/handoff.json`&&handoff.digest===sha256HexSyncText(artifact):handoff===null&&scratchFiles.length===0,
      rejectedClaimRetarget:await services.workspaceClaimRead.read(archive)===null&&await services.workspaceClaimRead.observe(archive)===null,
      exactInstalledClaimGuide:guide.includes("A green build")&&revision===guideRevision(await ports.guide()),
    };
    const contract:SemanticOutcomeContract={effects:{checks:["exactClaimScope", "independentSemanticEvidence", "exactTestkitClaimInput", "exactAuthorityPreflight", "independentlyPreservedClaimContext", "exactPrivateClaimNote", "rejectedClaimRetarget", "exactInstalledClaimGuide"],rationale:"Actual native observations, scoped authority, persisted state and private artifact bytes establish the requested application effects."},returnedValue:{checks:["exactGroundedClaimPartition"],required:true,rationale:"The requested domain findings or query result are validated independently of copied input evidence."},incidentalValues:{checks:["returnedClaimHandoff"],rationale:"Receipt echoing is optional presentation; the actual retained artifact is verified through native state."}};
    return assessSemanticOutcome({passed:Object.values(checks).every(Boolean),checks,contextId:owner,caseId:world.id,goal:world.goal,index,packet,choice,evidence,
      required:packet.requirements.map(row=>row.text),support,disposition:report?.disposition??null,test,authority,guideRevision:revision,handoff,artifact},contract);
  }

  async function qualify() {
    await services.workspaceClaimRead.list();
    await services.workspaceClaimRead.read(id);
    await services.workspaceClaimRead.observe(id);
    const report:WorkspaceClaimReview={choice,packet,evidence,support:expected,
      disposition:{status:disposition(expected),summary:"Compared the exact claim packet against independent candidate, test and authority evidence."},handoff:null};
    if(world.note)report.handoff=await services.workspaceClaimHandoff.stage(report);
    const application={support:report.support,disposition:report.disposition,handoff:report.handoff};
    const proof=await verify(application);
    const rejectsIncorrectApplicationReturn=!(await verify({...application,disposition:{...application.disposition,status:"invented"}})).outcomeDimensions.returnedValue.passed;
    return {...proof,rejectsIncorrectApplicationReturn,passed:proof.passed&&rejectsIncorrectApplicationReturn};
  }
  return {services,verify,qualify};
}
