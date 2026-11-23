import type {InvocationObservations} from "./observed-invocation.js";
import {assessSemanticOutcome,type SemanticOutcomeContract} from "./semantic-outcome-contract.js";
import {isDeepStrictEqual} from "node:util";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {contextId,fs,rpc,vcs,type VcsClient} from "@workspace/runtime";
import {bindAuthorityReview,type PreflightOperation} from "@workspace-skills/capabilities/workflow";
import {bindScratchHandoff} from "@workspace-skills/scratch-handoff-bindings";
import type {EvidenceBasis,ExactRouteRecord,OwnedRouteReview,RouteAuthorityObservation,RouteAuthorityReport,RouteChoice,RouteHandoff,
  RouteOffer,RouteOutcome,RouteReadback,VisibleRoute} from "@workspace-skills/open-route-authority/types";
import {listOwnedScratchEntries} from "./owned-scratch-entries.js";
import {readWorkspaceBytes} from "./scratch-handoff-managed.js";
import {openRouteAuthorityWorlds,type LocalRoute} from "./open-goal-route-authority-worlds.js";

type Ports={contextId:string|null;fs:typeof fs;vcs:Pick<VcsClient,"status"|"edit"|"commit"|"resolveRepository"|"readFile">;
  bindAuthority:typeof bindAuthorityReview;readBytes:(path:string,max:number)=>Promise<Uint8Array>};
const branchOrigin="https://review.example.invalid";
const path="evidence.json";
const max=14_000;
const encode=(field:string,value:string)=>JSON.stringify({field,value});
const text=(field:string,value:string)=>({kind:"text" as const,text:encode(field,value)});
const exact=(a:unknown,b:unknown)=>isDeepStrictEqual(a,b);
const describe:Record<EvidenceBasis,string>={
  working:"Current working application",committed:"Last exact committed local checkpoint",earlier:"Original prior committed checkpoint",
  "private-copy":"Separate retained private copy",comparison:"Current working application compared with separate private copy",
  external:"Nominated saved reference link","alternate-link":"Alternate review link",
};
function livePorts():Ports{
  return {contextId,fs,vcs,bindAuthority:bindAuthorityReview,readBytes:(name,max)=>readWorkspaceBytes(rpc,name,max)};
}

export function compareExactAuthority(observations:RouteAuthorityObservation[],ceiling:RouteAuthorityReport["protectedLeaves"]):RouteAuthorityReport {
  const protectedLeaves:RouteAuthorityReport["protectedLeaves"]=[];
  const reviews:RouteAuthorityReport["reviews"]=observations.map(observation=>{
    const scoped=observation.leaves.filter(leaf=>leaf.tier==="gated"||leaf.tier==="critical")
      .map(({capability,resourceKey})=>({capability,resourceKey}));
    for(const row of scoped)if(!protectedLeaves.some(known=>exact(known,row)))protectedLeaves.push(row);
    const outside=scoped.filter(row=>!ceiling.some(allowed=>exact(allowed,row)));
    const disposition=outside.length?"outside-ceiling":observation.decision==="denied"?"host-denied":
      observation.decision==="acquirable"?"needs-acquisition":"eligible";
    return {observation,outside,disposition};
  });
  const held=reviews.filter(row=>row.disposition==="outside-ceiling"||row.disposition==="host-denied")
    .map(row=>row.observation.operationId);
  return {status:held.length?"held":reviews.some(row=>row.disposition==="needs-acquisition")?"needs-acquisition":"eligible",
    protectedLeaves,held,reviews};
}

export async function prepareRouteAuthority(input:{contextId:string;caseId:string},ports=livePorts()) {
  const world=openRouteAuthorityWorlds.find(row=>row.id===input.caseId);
  if(!world||!ports.contextId||ports.contextId!==input.contextId)throw new Error("Evidence route requires its exact owned workspace");
  const owner=input.contextId;
  const initial=await ports.vcs.status();
  if(initial.contextId!==owner||!initial.clean||initial.integrating.length)throw new Error("Evidence route expects a clean disposable context");
  const repoPath=`projects/owned-route-${crypto.randomUUID()}`;
  const baseline=await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:initial.workingHead,
    intentSummary:"Retain exact earlier owned evidence",
    changes:[{kind:"repository-create",repoPath,files:[{path,mode:0o644,content:text(world.field,world.before)}]}]});
  const prior=(await ports.vcs.commit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:baseline.workingHead,
    message:"Retain earlier local evidence coordinate"})).event;
  const repo=await ports.vcs.resolveRepository({state:prior,repoPath});
  if(!repo)throw new Error("Missing exact evidence repository");
  const repositoryId=repo.repositoryId;
  const priorFile=await ports.vcs.readFile({state:prior,repositoryId,file:{kind:"path",path}});
  if(!priorFile)throw new Error("Missing earlier evidence file");
  const newer=await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:prior,
    intentSummary:"Retain committed evidence candidate",
    changes:[{kind:"content-replace",repositoryId,fileId:priorFile.fileId,content:text(world.field,world.committed)}]});
  const committed=(await ports.vcs.commit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:newer.workingHead,
    message:"Retain the last exact committed evidence"})).event;
  if(world.working!==undefined)
    await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:committed,
      intentSummary:"Retain distinct local working evidence",
      changes:[{kind:"content-replace",repositoryId,fileId:priorFile.fileId,content:text(world.field,world.working)}]});
  const before=await ports.vcs.status();
  if(before.contextId!==owner||before.mainEventId!==initial.mainEventId||before.committed.eventId!==committed.eventId)
    throw new Error("Disposable route changed its protected basis");
  const temporary=await ports.fs.mkdtemp("route-authority");
  const sidecar=`${temporary}/retained-copy.json`;
  const policy=`${temporary}/note-authority.txt`;
  if(world.copy!==null)await ports.fs.writeFile(sidecar,encode(world.field,world.copy));
  await ports.fs.writeFile(policy,"Only an explicitly authorized local review note may be written.");
  const scratchBefore=new Set(await listOwnedScratchEntries(ports.fs));
  const noteWriter=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which lawful route supports this exact evidence?"],
    sources:[{id:"note-authority",path:policy}]},ports.readBytes).scratchHandoffWrite;

  const linkUrl=world.target==="lookalike"?"https://review.example.invalid.lookalike.invalid/nominated":
    world.target==="subdomain"?"https://team.review.example.invalid/nominated":branchOrigin+"/nominated";
  const altUrl=branchOrigin+"/other";
  const operations:PreflightOperation[]=[];
  function propose(label:string,service:string,method:string,args:unknown[]){
    const id=crypto.randomUUID();
    operations.push({id,label,service,method,args});return id;
  }
  const workingStatus=propose("Read current scoped workspace status","vcs","status",[{contextId:owner}]);
  const states={working:before.workingHead,committed,earlier:prior};
  const reading=(key:keyof typeof states)=>propose("Read the exact "+describe[key],"vcs","readFile",
    [{state:states[key],repositoryId,file:{kind:"path",path}}]);
  const nowRead=reading("working"),commitRead=reading("committed"),priorRead=reading("earlier");
  const copyRead=propose("Read the separate local retained copy","fs","readBytes",[sidecar,{offset:0,limit:max}]);
  const link=propose("Preflight the nominated reference URL","externalOpen","openExternal",[linkUrl]);
  const alt=propose("Preflight the alternate reference URL","externalOpen","openExternal",[altUrl]);
  const ids:Record<EvidenceBasis,string[]>={
    working:[workingStatus,nowRead],committed:[commitRead],earlier:[priorRead],"private-copy":[copyRead],
    comparison:[workingStatus,nowRead,copyRead],external:[link],"alternate-link":[alt],
  };
  const bases=Object.keys(ids) as EvidenceBasis[];
  const shift=world.id.length%bases.length;
  const routes:VisibleRoute[]=[...bases.slice(shift),...bases.slice(0,shift)].map(basis=>({id:crypto.randomUUID(),basis,label:describe[basis],
    operationIds:ids[basis],origin:basis==="external"?new URL(linkUrl).origin:basis==="alternate-link"?new URL(altUrl).origin:null}));
  const ceiling=world.allowedOrigin?[{capability:"external.open",resourceKey:branchOrigin}]:[];
  const binding=ports.bindAuthority({goal:world.goal,operations,ceiling});
  const offer:RouteOffer={title:world.title,purpose:world.purpose,field:world.field,routes,request:binding.request};
  const nominated=routes.find(row=>row.basis===world.route)!;
  const snapshots:RouteAuthorityObservation[]=[];
  const expectedAuthority=()=>compareExactAuthority(snapshots,ceiling);
  const nominatedPreflight = () => nominated.operationIds.every(id => snapshots.some(row => row.operationId === id));
  let busy=false;
  let readback:RouteReadback|null=null,handoff:RouteHandoff|null=null;
  const body=(report:OwnedRouteReview)=>JSON.stringify({visibility:"private-local",routeId:report.choice.routeId,
    outcome:report.outcome,readback:report.readback,reviewedOperations:report.authority.reviews.map(row=>row.observation.operationId)});

  function parseRecord(basis:EvidenceBasis,coordinate:string,raw:string,hash:string):ExactRouteRecord {
    const value=JSON.parse(raw) as {field:string;value:string};
    if(value.field!==world.field||typeof value.value!=="string")throw new Error("Evidence file has the wrong owned field");
    return {basis,coordinate,field:value.field,value:value.value,fileHash:hash};
  }
  async function readRoute(basis:LocalRoute):Promise<(ExactRouteRecord|null)[]> {
    if(basis==="comparison")return [...await readRoute("working"),...await readRoute("private-copy")];
    if(basis==="private-copy"){
      if(!await ports.fs.exists(sidecar))return [null];
      const raw=new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(sidecar,max));
      return [parseRecord(basis,sidecar,raw,sha256HexSyncText(raw))];
    }
    const state=states[basis];
    if(basis==="working"&&!exact((await ports.vcs.status()).workingHead,state))
      throw new Error("The exact working basis moved before the local read");
    const row=await ports.vcs.readFile({state,repositoryId,file:{kind:"path",path}});
    if(row?.content.kind!=="text")return [null];
    return [parseRecord(basis,state.kind==="event"?state.eventId:state.applicationId,row.content.text,row.contentHash)];
  }
  function matchesChoice(choice:RouteChoice|undefined) {
    return choice?.routeId===nominated.id&&choice.execute===(world.route!=="external")&&choice.retain===(world.note===true)&&
      typeof choice.reason==="string"&&choice.reason.trim().length>0;
  }
  function intendedOutcome():RouteOutcome["status"] {
    if(world.route!=="external"){
      if(!readback||readback.records.some(row=>row===null))return "missing";
      return world.route==="comparison"&&readback.records[0]?.value!==readback.records[1]?.value?"mismatch":"verified";
    }
    const row=expectedAuthority().reviews.find(row=>row.observation.operationId===link);
    switch(row?.disposition) {
      case "outside-ceiling":return "outside-limit";
      case "needs-acquisition":return "needs-approval";
      case "eligible":return "eligible-preflight";
      default:return "refused";
    }
  }
  let stagedText:string|null=null;
  const services={
    routeEvidenceRead:{
      async discover(){return structuredClone(offer);},
      async inspect(routeId:string){
        if(!nominatedPreflight()||busy||routeId!==nominated.id||world.route==="external"||
          !nominated.operationIds.every(id=>expectedAuthority().reviews.some(row=>row.observation.operationId===id&&row.disposition==="eligible")))return null;
        if(readback)return structuredClone(readback);
        busy=true;
        try{
          readback={routeId,records:await readRoute(world.route)};return structuredClone(readback);
        }finally{busy=false;}
      },
    },
    assignedAuthorityRead:{async preflight(operationId:string){
      if(!operations.some(operation=>operation.id===operationId))throw new Error("Preflight only scoped route candidates");
      const previous=snapshots.find(row=>row.operationId===operationId);
      if(previous)return structuredClone(previous);
      const observation=await binding.services.assignedAuthorityRead.preflight(operationId);
      snapshots.push(observation);
      snapshots.sort((a,b)=>operations.findIndex(operation=>operation.id===a.operationId)-operations.findIndex(operation=>operation.id===b.operationId));
      return structuredClone(observation);
    }},
    routeEvidenceHandoff:{async stage(report:OwnedRouteReview){
      if(!world.note||handoff||busy||!nominatedPreflight()||report?.handoff!==null||!matchesChoice(report.choice)||
        !exact(report.offer,offer)||!exact(report.authority,expectedAuthority())||!exact(report.readback,readback)||
        report.outcome.status!==intendedOutcome()||typeof report.outcome.summary!=="string"||!report.outcome.summary.trim()||
        report.outcome.summary.length>650||(world.route!=="external"&&!readback))return null;
      busy=true;
      try{
        if(!exact(await ports.vcs.status(),before))return null;
        if(world.route!=="external"&&!exact(await readRoute(world.route),readback?.records))return null;
        const payload=body(report);
        const staged=(stagedText=payload,await noteWriter.stage(payload));
        if(!staged)return null;
        handoff={path:staged.path,digest:sha256HexSyncText(payload)};return structuredClone(handoff);
      }finally{busy=false;}
    }},
  };

  async function verify(raw:unknown,invocation?:InvocationObservations){
    const value=raw as OwnedRouteReview|null;
    const report=value;
    const after=await ports.vcs.status();
    const fresh=world.route==="external"?null:await readRoute(world.route);
    const authorization=expectedAuthority();
    const [linkReview,altReview]=[link,alt].map(id=>authorization.reviews.find(row=>row.observation.operationId===id));
    const sameClaim=(row:typeof linkReview,origin:string)=>!!row&&row.observation.leaves.some(leaf=>
      leaf.capability==="external.open"&&leaf.resourceKey===origin)&&
      row.outside.some(leaf=>leaf.capability==="external.open")===(origin!==branchOrigin||!world.allowedOrigin);
    const written=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!scratchBefore.has(name));
    const artifact=handoff?new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(handoff.path,max)):null;
    const checks={
      returnedRouteHandoff:exact(report?.handoff,handoff),
      returnedRouteReadback:exact(report?.readback,readback),
      exactRouteDiscovery:new Set(offer.routes.map(row=>row.id)).size===7,
      exactScopedRoutePreflight:nominatedPreflight()&&snapshots.every(row=>operations.some(operation=>operation.id===row.operationId)),
      exactCanonicalOriginCeiling:(!linkReview||sameClaim(linkReview,new URL(linkUrl).origin))&&(!altReview||sameClaim(altReview,new URL(altUrl).origin)),
      selectedExactLocalAuthority:(world.route==="external"||nominated.operationIds.every(id=>
        authorization.reviews.some(row=>row.observation.operationId===id&&row.disposition==="eligible"))),
      nativeRouteReadback:world.route==="external"?readback===null:
        !!fresh&&!!readback&&readback.routeId===nominated.id&&exact(fresh,readback.records),
      preservedExactProtectedBasis:exact(after,before)&&after.mainEventId===initial.mainEventId,
      exactRouteConclusion:report?.outcome.status===intendedOutcome()&&typeof report.outcome.summary==="string"&&
        !!report.outcome.summary.trim()&&report.outcome.summary.length<=650,
      exactPrivateRouteNote:world.note?!!handoff&&!!artifact&&written.length===1&&
        handoff.path===`/.tmp/${written[0]}/handoff.json`&&artifact===stagedText&&handoff.digest===sha256HexSyncText(artifact):
        handoff===null&&written.length===0,
      rejectedRouteRetarget:await services.routeEvidenceRead.inspect(routes.find(row=>row.basis==="alternate-link")!.id)===null&&
        await services.routeEvidenceHandoff.stage({} as OwnedRouteReview)===null,
    };
    const contract:SemanticOutcomeContract={effects:{checks:["exactRouteDiscovery", "exactScopedRoutePreflight", "exactCanonicalOriginCeiling", "selectedExactLocalAuthority", "nativeRouteReadback", "preservedExactProtectedBasis", "exactPrivateRouteNote", "rejectedRouteRetarget"],rationale:"Actual native observations, scoped authority, persisted state and private artifact bytes establish the requested application effects."},returnedValue:{checks:["returnedRouteReadback", "exactRouteConclusion"],required:true,rationale:"The requested domain findings or query result are validated independently of copied input evidence."},incidentalValues:{checks:["returnedRouteHandoff"],rationale:"Receipt echoing is optional presentation; the actual retained artifact is verified through native state."}};
    const incorrectOptionalReturn=contract.incidentalValues!.checks.some(name=>!(checks as Record<string,boolean>)[name])||(!contract.returnedValue.required&&contract.returnedValue.checks.some(name=>!(checks as Record<string,boolean>)[name]));
    const incorrectReturnValues=incorrectOptionalReturn&&invocation ? (await invocation.returns(call=>call.parentCallId===null)).filter(row=>exact(row.value,raw)).map(({definition,value})=>({definition,value,required:contract.returnedValue.required&&contract.returnedValue.checks.some(name=>!(checks as Record<string,boolean>)[name])})) : [];
    return assessSemanticOutcome({incorrectReturnValues,contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      offer,snapshots,authority:authorization,choice:report?.choice??null,readback,outcome:report?.outcome??null,handoff,artifact},contract);
  }
  async function qualify(){
    await services.routeEvidenceRead.discover();
    for(const {id} of operations)await services.assignedAuthorityRead.preflight(id);
    const choice:RouteChoice={routeId:nominated.id,execute:world.route!=="external",retain:world.note===true,
      reason:"Selected the exact requested authority and temporal scope."};
    const readback=choice.execute?await services.routeEvidenceRead.inspect(choice.routeId):null;
    const outcome={status:intendedOutcome(),summary:"Verified the exact native route, its scope and result."};
    const report:OwnedRouteReview={offer,authority:expectedAuthority(),choice,readback,outcome,handoff:null};
    if(world.note)report.handoff=await services.routeEvidenceHandoff.stage(report);
    const application={readback:report.readback,outcome:report.outcome,handoff:report.handoff};
    const proof=await verify(application);
    const rejectsIncorrectApplicationReturn=!(await verify({...application,outcome:{...application.outcome,status:"invented"}})).outcomeDimensions.returnedValue.passed;
    return {...proof,rejectsIncorrectApplicationReturn,passed:proof.passed&&rejectsIncorrectApplicationReturn};
  }
  return {services,verify,qualify};
}
