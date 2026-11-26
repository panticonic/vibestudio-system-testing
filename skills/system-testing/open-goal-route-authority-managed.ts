import {compareExactAuthority} from "./route-authority-observations.js";
export {compareExactAuthority} from "./route-authority-observations.js";
import {routeAuthorityReviewGuidance} from "./native-domain-review.js";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["offer", "snapshots", "authority", "choice", "readback", "routeReadbacks"], ["artifact"]);
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import {type SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import {isDeepStrictEqual} from "node:util";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {contextId,fs,rpc,vcs,type VcsClient} from "@workspace/runtime";
import {bindAuthorityReview,type PreflightOperation} from "@workspace-skills/capabilities/workflow";
import {bindScratchHandoff, maxScratchArtifactBytes} from "@workspace-skills/scratch-handoff-bindings";
import type {EvidenceBasis,ExactRouteRecord,OwnedRouteReview,RouteAuthorityObservation,RouteChoice,RouteHandoff,
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
  const routeReadbacks=new Map<string,RouteReadback>();
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
    if(row?.content?.kind!=="text")return [null];
    return [parseRecord(basis,state.kind==="event"?state.eventId:state.applicationId,row.content.text,row.contentHash)];
  }
  function observedRequestedRecords(basis:LocalRoute=world.route as LocalRoute):(ExactRouteRecord|null)[]|null {
    const direct=[...routeReadbacks.values()].find(row=>routes.find(route=>route.id===row.routeId)?.basis===basis);
    if(direct)return direct.records;
    const comparison=[...routeReadbacks.values()].find(row=>routes.find(route=>route.id===row.routeId)?.basis==="comparison");
    if(comparison&&basis==="working")return comparison.records.slice(0,1);
    if(comparison&&basis==="private-copy")return comparison.records.slice(1,2);
    if(basis==="comparison"){const working=observedRequestedRecords("working"),copy=observedRequestedRecords("private-copy");return working&&copy?[...working,...copy]:null;}
    return null;
  }
  function intendedOutcome():RouteOutcome["status"] {
    if(world.route!=="external"){
      const observed=observedRequestedRecords();
      if(!observed||observed.some(row=>row===null))return "missing";
      return world.route==="comparison"&&observed[0]?.value!==observed[1]?.value?"mismatch":"verified";
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
        const route=routes.find(row=>row.id===routeId);
        if(!route||busy||route.basis==="external"||route.basis==="alternate-link"||
          !route.operationIds.every(id=>expectedAuthority().reviews.some(row=>row.observation.operationId===id&&row.disposition==="eligible")))return null;
        busy=true;
        try{
          const observed={routeId,records:await readRoute(route.basis as LocalRoute)};routeReadbacks.set(routeId,observed);
          if(routeId===nominated.id)readback=observed;return structuredClone(observed);
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
      if(!world.note||handoff||busy||!report?.choice||typeof report?.outcome?.summary!=="string"||!report.outcome.summary.trim()||
        (report.readback!==null&&!exact(routeReadbacks.get(report.readback.routeId),report.readback)))return null;
      busy=true;
      try{
        if(!exact(await ports.vcs.status(),before))return null;
        for(const row of routeReadbacks.values()){const route=routes.find(route=>route.id===row.routeId)!;if(!exact(await readRoute(route.basis as LocalRoute),row.records))return null;}
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
    const artifact=handoff?new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(handoff.path,maxScratchArtifactBytes)):null;
    const checks={
      returnedRouteHandoff:exact(report?.handoff,handoff),
      returnedRouteReadback:report?.readback===null||report?.readback===undefined||exact(routeReadbacks.get(report.readback.routeId),report.readback),
      exactRouteDiscovery:new Set(offer.routes.map(row=>row.id)).size===7,
      exactScopedRoutePreflight:nominatedPreflight()&&snapshots.every(row=>operations.some(operation=>operation.id===row.operationId)),
      exactCanonicalOriginCeiling:(!linkReview||sameClaim(linkReview,new URL(linkUrl).origin))&&(!altReview||sameClaim(altReview,new URL(altUrl).origin)),
      selectedExactLocalAuthority:(world.route==="external"||nominated.operationIds.every(id=>
        authorization.reviews.some(row=>row.observation.operationId===id&&row.disposition==="eligible"))),
      nativeRouteReadback:world.route==="external"?readback===null:
        !!fresh&&exact(fresh,observedRequestedRecords()),
      preservedExactProtectedBasis:exact(after,before)&&after.mainEventId===initial.mainEventId,
      exactRouteConclusion:report?.outcome?.status===intendedOutcome()&&typeof report.outcome.summary==="string"&&
        !!report.outcome.summary.trim(),
      exactPrivateRouteNote:world.note?!!handoff&&!!artifact&&written.length===1&&
        handoff.path===`/.tmp/${written[0]}/handoff.json`&&artifact===stagedText&&handoff.digest===sha256HexSyncText(artifact):
        handoff===null&&written.length===0,
      rejectedRouteRetarget:await services.routeEvidenceRead.inspect(routes.find(row=>row.basis==="alternate-link")!.id)===null&&
        await services.routeEvidenceHandoff.stage({} as OwnedRouteReview)===null,
    };
    const contract:SemanticOutcomeContract={effects:{checks:["exactRouteDiscovery", "exactScopedRoutePreflight", "exactCanonicalOriginCeiling", "selectedExactLocalAuthority", "nativeRouteReadback", "preservedExactProtectedBasis", "exactPrivateRouteNote", "rejectedRouteRetarget"],rationale:"Actual native observations, scoped authority, persisted state and private artifact bytes establish the requested application effects."},returnedValue:{checks:["exactRouteConclusion"],required:true,rationale:"The requested domain findings or query result are validated independently of copied input evidence."},incidentalValues:{checks:["returnedRouteHandoff","returnedRouteReadback"],rationale:"Receipt echoing is optional presentation; the actual retained artifact is verified through native state."}};

    const assessed=await assessObservedApplicationOutcome({contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      offer,snapshots,routeReadbacks:[...routeReadbacks.values()],authority:authorization,choice:report?.choice??null,readback,outcome:report?.outcome??null,handoff,artifact},contract,raw,invocation,[{"checks":["exactRouteConclusion"],"rootPath":["outcome"],"producerSourceSuffix":"chooseAuthorizedEvidenceRoute/concludeEvidenceRoute.nl"},{"checks":["returnedRouteReadback"],"rootPath":["readback"],"producerSourceSuffix":"chooseAuthorizedEvidenceRoute.nl","producerPath":["readback"]}]);
    assessed.semanticReviewInput.rubric+=routeAuthorityReviewGuidance;
    return assessed;
  }
  async function qualify(){
    await services.routeEvidenceRead.discover();
    for(const {id} of operations)await services.assignedAuthorityRead.preflight(id);
    const choice:RouteChoice={routeId:nominated.id,execute:world.route!=="external",retain:world.note===true,
      reason:"Selected the exact requested authority and temporal scope."};
    const readback=choice.execute&&choice.routeId!==null?await services.routeEvidenceRead.inspect(choice.routeId):null;
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
