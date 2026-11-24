import {assessObservedApplicationOutcome} from "@workspace/application-outcomes/observed-application-outcome";
import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import type { Credential } from "@vibestudio/credential-client/types";
import type { matchUrlBoundCredentialCandidates, findCredentialBinding } from "@vibestudio/credential-client/urlBoundSelection";
import type { findMatchingUrlAudience } from "@vibestudio/credential-client/urlAudience";
import type { credentialLifecycle } from "@vibestudio/credential-client/credentialStatus";
import { bindIntegrationReview } from "@workspace-skills/api-integrations/workflow";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { BoundReport, Destination, DestinationObservation, IntegrationIndex, IntegrationReadinessPlan, LookupFact, QuietAudit,
  QuietRequest, ReadinessArtifact, ReadinessReport, ApiReadinessResult, SelectionFrontier, SelectionRow, SelectionWitness } from "@workspace-skills/open-api-readiness/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { openApiReadinessWorlds, type ApiReadinessWorld, type Endpoint, type Seed } from "./open-goal-api-readiness-worlds.js";

type Lane=Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
type Selection=SelectionRow["selection"];
type Installed={match:typeof matchUrlBoundCredentialCandidates;binding:typeof findCredentialBinding;
  audience:typeof findMatchingUrlAudience;lifecycle:typeof credentialLifecycle};
type Candidate=Pick<Credential,"bindings"|"label"|"revokedAt"|"actor"|"owner"|"agentExchange"|"expiresAt"|"oauthRefresh"|"refreshToken"> & {key:string};
type SealedPlan={receipt:string;destinations:Destination[]};
const countBytes=(value:string)=>new TextEncoder().encode(value).length;
const max=12*1024;
const fixtureClock=Date.UTC(2026,10,1);

async function appendNative(lane:Lane,context:string,records:Selection[]) {
  return withOwnedChannelClient(lane,context,async client=>{
    const out:string[]=[];
    for(const record of records)out.push(await client.send(JSON.stringify(record),{idempotencyKey:crypto.randomUUID()}));
    return out;
  });
}
export async function readApiReadinessNative(lane:Lane,client=rpc):Promise<SelectionFrontier> {
  const page=await client.call(lane.target,channelClientRpcMethods.getReplayAfter,[{after:0,limit:40}]);
  if(page.ready.snapshotLastSeq===undefined||page.ready.hasMoreAfter)throw new Error("Integration selection exceeds its retained window");
  const rows=page.logEvents.flatMap((envelope):SelectionRow[]=>{
    const event=envelope.payload as AgenticEvent<"message.completed">|undefined;
    if(event?.kind!=="message.completed"||!("role" in event.payload)||event.payload.role!=="user"||!event.causality?.messageId)return [];
    const content=(event.payload.blocks??[]).flatMap(block=>block.type==="text"?[block.content]:[]).join("");
    if(!envelope.senderId||countBytes(content)>2048)throw new Error("Invalid selected integration evidence");
    return [{messageId:event.causality.messageId,envelopeId:envelope.messageId,seq:envelope.id,selection:JSON.parse(content) as Selection}];
  });
  return {channelId:lane.key,through:page.ready.snapshotLastSeq,rows};
}
type Ports={contextId:string|null;fs:typeof fs;status:typeof vcs.status;open:typeof createOwnedHeadlessChannel;
  append:typeof appendNative;read:typeof readApiReadinessNative;readBytes(path:string,max:number):Promise<Uint8Array>};
function livePorts():Ports {
  return {contextId,fs,status:input=>vcs.status(input),open:createOwnedHeadlessChannel,append:appendNative,read:readApiReadinessNative,
    readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)};
}
function fixtureUrl(path:string) {
  const target=new URL(path.startsWith("/")?`https://unit.system-test.invalid${path}`:path);
  if(!["unit.system-test.invalid","127.0.0.1"].includes(target.hostname)||target.username||target.password||
    !["http:","https:"].includes(target.protocol))throw new Error("Only reserved offline synthetic audiences are supported");
  return target.href;
}
function candidate(seed:Seed):Candidate {
  return {
    key:seed.key,label:seed.label,actor:seed.actor,
    owner:seed.owner?{userId:seed.owner==="current"?"fixture-member":"other-member",sourceId:"fixture",
      sourceKind:"user",label:"Synthetic member"}:undefined,
    agentExchange:seed.exchange?{tokenUrl:fixtureUrl("/token"),clientId:"fixture-client"}:undefined,
    bindings:[{id:`fixture:${seed.key}`,use:seed.use,audience:[{url:fixtureUrl(seed.path),match:seed.match??"exact"}],
      injection:{type:"header",name:"Authorization",valueTemplate:"Fixture {token}"}}],
    expiresAt:seed.lifecycle==="expired"||seed.lifecycle==="refreshable"?fixtureClock-30_000:undefined,
    revokedAt:seed.lifecycle==="revoked"?fixtureClock-60_000:undefined,
    refreshToken:seed.lifecycle==="refreshable"?"synthetic-refresh-marker":undefined,
    oauthRefresh:seed.lifecycle==="refreshable"?{clientId:"fixture-client",tokenAuth:"none",tokenUrl:fixtureUrl("/token")}:undefined,
  };
}
function statusOf(destinations:Destination[],observations:DestinationObservation[]):BoundReport["status"] {
  const required=destinations.filter(row=>row.required).map(row=>observations.find(observation=>observation.id===row.id)?.state);
  if(required.some(state=>!state||state==="unverified"))return "authorization-unverified";
  if(required.includes("missing"))return "setup-needed";
  return required.some(state=>state==="expired"||state==="revoked")?"renewal-needed":"ready";
}
function disposition(observation:DestinationObservation) {
  switch(observation.state) {
    case "active":return "ready";
    case "missing":return "setup-needed";
    case "unverified":return "authorization-unverified";
    default:return "renewal-needed";
  }
}

export async function prepareOpenApiReadiness(input:{contextId:string;caseId:string},installed:Installed,ports=livePorts()) {
  const world=openApiReadinessWorlds.find(item=>item.id===input.caseId);
  if(!world||input.contextId!==ports.contextId)throw new Error("Quiet integration readiness belongs to its assigned context");
  const before=await ports.status();
  const lane=await ports.open(input.contextId,world.title);
  const profileId=crypto.randomUUID();
  const revision=crypto.randomUUID();
  const destinations=world.endpoints.map(({id,purpose,use,required,path})=>({id,purpose,use,required,url:fixtureUrl(path)}));
  const profile={id:profileId,title:world.title,revision,destinations:destinations.map(({url,...endpoint})=>({...endpoint,audience:url}))};
  const index:IntegrationIndex={scope:{contextId:input.contextId,channelId:lane.key,revision,approvals:"pregranted-only",mayStage:world.stage===true},
    profiles:[profile,{...profile,id:crypto.randomUUID(),title:world.ambiguous?profile.title:`Archived ${profile.title}`,
      revision:world.ambiguous?revision:"previous-version"}]};
  const privateRecords=world.records.map(candidate);
  const caller=world.caller==="unattributed"?{}:{userId:"fixture-member",...(world.caller==="agent"?{agentId:"fixture-agent"}:{})};
  const authGrants=(world.grants??[]).map(grant=>{
    const endpoint=world.endpoints.find(row=>row.id===grant.destination)!;
    return {key:grant.key,bindingId:`fixture:${grant.key}`,url:fixtureUrl(endpoint.path),
      use:grant.wrongUse??endpoint.use,revision:grant.stale?"previous-version":revision};
  });
  const maps=new Map<string,Selection>();
  function materialize(mode:ApiReadinessWorld["selection"]):Selection {
    return {profileId,contextId:mode==="foreign"?"another-workspace":input.contextId,revision:mode==="stale"?"previous-version":revision,
      sender:mode==="copied"?"copied-message":"owner-selection"};
  }
  async function append(rows:Selection[]) {
    if(!rows.length)return;
    const ids=await ports.append(lane,input.contextId,rows);
    if(ids.length!==rows.length||new Set(ids).size!==ids.length)throw new Error("Integration selection has no exact message IDs");
    ids.forEach((id,i)=>maps.set(id,rows[i]!));
  }
  if(world.selection!=="absent")await append([materialize(world.selection)]);
  const initial=await ports.read(lane);
  const folder=await ports.fs.mkdtemp("api-readiness");
  const policyPath=`${folder}/scope.md`;
  await ports.fs.writeFile(policyPath,"Check exact synthetic audience metadata under pregranted-only authority. No provider use is requested.");
  const baseline=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What quiet binding metadata supports the readiness decision?"],
    sources:[{id:"scope",path:policyPath}]},ports.readBytes).scratchHandoffWrite;

  let reading=false;
  let writing=false;
  let bound:ReturnType<typeof bindIntegrationReview>|null=null;
  let seenPlan:SealedPlan|null=null;
  let audited:QuietAudit|null=null;
  let handoff:ReadinessArtifact|null=null;
  const observations:DestinationObservation[]=[];
  const facts:LookupFact[]=[];
  const snapshots:SelectionFrontier[]=[];
  const calls:{profileId:string;message:string;request:QuietRequest}[]=[];
  function check(current:SelectionFrontier,chosen:string|null):SelectionWitness {
    if(!chosen)return {message:null,reason:world.ambiguous?"ambiguous-plan":"unavailable-plan"};
    const row=current.rows.findLast(item=>item.selection.profileId===chosen);
    if(!row)return {message:null,reason:"unconfirmed-selection"};
    const r=row.selection;
    const reason=r.contextId!==input.contextId?"foreign-selection":r.sender!=="owner-selection"?"unconfirmed-selection":
      r.revision!==revision?"stale-selection":"selected";
    return {message:row.messageId,reason};
  }
  function fixtureLookup(endpoint:Endpoint):LookupFact & {canRefresh:boolean|null} {
    const audience=fixtureUrl(endpoint.path);
    const output={destination:endpoint.id,transport:endpoint.use,audience,matched:null};
    const {candidates,refusal}=installed.match(privateRecords,new URL(audience),endpoint.use,caller,{label:endpoint.label});
    if(candidates.length>1)return {...output,authorization:"ambiguous",state:"unverified",canRefresh:null};
    if(refusal)return {...output,authorization:"actor-refused",state:"unverified",canRefresh:null};
    const matched=candidates[0];
    if(!matched)return {...output,authorization:"no-match",state:"missing",canRefresh:null};
    const binding=installed.binding(matched,new URL(audience),endpoint.use);
    const known=binding&&installed.audience(new URL(audience),binding.audience);
    if(!binding||!known)throw new Error("Shared matching returned no exact credential binding");
    if(!authGrants.some(grant=>grant.key===matched.key&&grant.bindingId===binding.id&&grant.url===audience&&
      grant.use===endpoint.use&&grant.revision===revision))
      return {...output,authorization:"grant-not-current",state:"unverified",canRefresh:null};
    return {...output,authorization:"pregranted",...installed.lifecycle(matched,fixtureClock),
      matched:{audience:known.url,match:known.match,selection:endpoint.label?"trusted-label":"unique-audience"}};
  }
  function expectedObservations(request:QuietRequest) {
    const redacted:LookupFact[]=[];
    const observed:DestinationObservation[]=[];
    for(const endpoint of world.endpoints.filter(endpoint => observations.some(row => row.id === endpoint.id))) {
      const {canRefresh,...fact}=fixtureLookup(endpoint);
      redacted.push(fact);
      observed.push({id:endpoint.id,receipt:`${request.operationId}:binding:${endpoint.id}`,state:fact.state,canRefresh});
    }
    return {observed,redacted,held:destinations.filter(item=>!observed.some(row=>row.id===item.id)).map(item=>item.id)};
  }
  function actionFor(current:SelectionFrontier,profileChoice:string|null) {
    const selection=check(current,profileChoice);
    const ready=selection.reason==="selected";
    const reason=ready&&seenPlan?statusOf(seenPlan.destinations,observations):selection.reason;
    const action:IntegrationReadinessPlan["action"]=!ready?"hold":reason!=="ready"?"escalate":index.scope.mayStage?"stage":"report";
    return {profileId:profileChoice,channelId:lane.key,through:current.through,message:selection.message,reason,action,providerAccess:"unobserved" as const};
  }
  function verifiedReview(value:ReadinessReport["review"],audit:QuietAudit|null) {
    if(!value||!bound||!seenPlan||!audit||!audited)return false;
    const report=value.result;
    const expected=expectedObservations(bound.request);
    return isDeepStrictEqual(value.request,bound.request)&&report.planReceipt===seenPlan.receipt&&
      sameEvidenceMembers(report.destinations,expected.observed.map(observation=>({observation,disposition:disposition(observation)})))&&
      sameEvidenceMembers(report.held,expected.held)&&report.status===statusOf(seenPlan.destinations,expected.observed)&&
      (report.guidance===null?report.status==="ready":typeof report.guidance==="string"&&!!report.guidance.trim()&&countBytes(report.guidance)<=480)&&
      sameEvidenceMembers(observations,expected.observed)&&isDeepStrictEqual(audit,audited)&&
      sameEvidenceMembers(audit.facts,expected.redacted)&&audit.approvals==="pregranted-only"&&audit.providerAccess==="unobserved";
  }
  function body(report:ReadinessReport) {
    return JSON.stringify({schema:"vibestudio.quiet-integration-readiness/1",contextId:input.contextId,revision,
      plan:report.plan,review:report.review,audit:report.audit});
  }
  function publicPlan(id:string,msg:string,current:SelectionFrontier) {
    if(id!==profileId||world.ambiguous||index.scope.approvals!=="pregranted-only")return false;
    const selected=check(current,id);
    return selected.reason==="selected"&&selected.message===msg;
  }
  let stagedText:string|null=null;
  const services={
    quietIntegrationIndex:{async list(){return structuredClone(index);}},
    quietIntegrationJournal:{async read(channelId:string){
      if(channelId!==lane.key)return null;
      if(snapshots.length>=2)return structuredClone(snapshots.at(-1)!);
      if(reading)return null;
      reading=true;
      try{
        const current=await ports.read(lane);
        snapshots.push(current);
        if(snapshots.length===1&&world.later)await append([materialize(world.later)]);
        return structuredClone(current);
      }finally{reading=false;}
    }},
    quietIntegrationProtocol:{
      async open(id:string,message:string){
        const current=snapshots[1];
        if(!current||!publicPlan(id,message,current)||(await ports.read(lane)).through!==current.through)return null;
        if(bound)return structuredClone(bound.request);
        bound=bindIntegrationReview({goal:world.goal,destinations},async({id,url,use})=>{
          const endpoint=world.endpoints.find(endpoint=>endpoint.id===id);
          if(!endpoint||fixtureUrl(endpoint.path)!==url||endpoint.use!==use)throw new Error("Substituted audience or transport in quiet plan");
          const {canRefresh,...observed}=fixtureLookup(endpoint);
          facts.push(observed);
          facts.sort((a,b)=>world.endpoints.findIndex(endpoint=>endpoint.id===a.destination)-world.endpoints.findIndex(endpoint=>endpoint.id===b.destination));
          if(observed.state==="unverified")throw new Error("Quiet lookup has no verified current authorization");
          if(observed.state==="missing")return null;
          return {lifecycle:{state:observed.state,canRefresh:canRefresh===true}};
        });
        calls.push({profileId:id,message,request:structuredClone(bound.request)});
        return structuredClone(bound.request);
      },
      async audit(id:string){
        if(!bound||id!==bound.request.operationId||!seenPlan||
          (!observations.some(row=>row.state==="unverified")&&!destinations.filter(row=>row.required).every(row=>observations.some(value=>value.id===row.id))))return null;
        if(audited)return structuredClone(audited);
        audited={approvals:"pregranted-only",providerAccess:"unobserved",facts:structuredClone(facts)};
        return structuredClone(audited);
      },
    },
    integrationPlanRead:{async observe(id:string){
      if(!bound)throw new Error("Open the current trusted quiet plan first");
      seenPlan=await bound.services.integrationPlanRead.observe(id);
      return structuredClone(seenPlan);
    }},
    integrationCredentialLookup:{async resolve(receipt:string,id:string){
      const previous=observations.find(row=>row.id===id);
      if(bound&&seenPlan?.receipt===receipt&&previous)return structuredClone(previous);
      if(!bound||audited||!snapshots[1]||(await ports.read(lane)).through!==snapshots[1].through)
        throw new Error("The quiet review no longer owns this selection frontier");
      if(!(world.lookupAfter?.[id]??[]).every(required=>observations.some(row=>row.id===required)))
        throw new Error("Observe the user-requested prerequisite destination first");
      const result=await bound.services.integrationCredentialLookup.resolve(receipt,id);
      if(!observations.some(row=>row.id===result.id))observations.push(result);
      observations.sort((a,b)=>destinations.findIndex(endpoint=>endpoint.id===a.id)-destinations.findIndex(endpoint=>endpoint.id===b.id));
      return structuredClone(result);
    }},
    quietIntegrationHandoff:{async stage(report:ReadinessReport){
      if(!index.scope.mayStage||writing||handoff||report?.plan?.action!=="stage"||report.handoff!==null||!snapshots[1])return null;
      writing=true;
      try{
        const current=await ports.read(lane);
        const status=await ports.status();
        const {explanation,...plan}=report.plan;
        if(!explanation?.trim()||!isDeepStrictEqual(plan,actionFor(current,profileId))||!verifiedReview(report.review,report.audit)||
          current.through!==snapshots[1].through||status.mainEventId!==before.mainEventId||
          !isDeepStrictEqual(status.workingHead,before.workingHead))return null;
        const text=body(report);
        if(countBytes(text)>max)return null;
        const receipt=(stagedText=text,await writer.stage(text));
        if(!receipt)return null;
        handoff={...receipt,sha256:sha256HexSyncText(text)};
        return structuredClone(handoff);
      }finally{writing=false;}
    }},
  };
  async function verify(raw:unknown,invocation?:InvocationObservations) {
    const value=raw as ApiReadinessResult|null;
    const outcome=value;
    const current=await ports.read(lane);
    const planned=actionFor(current,world.ambiguous?null:profileId);
    const expected=world.expected;
    const status=await ports.status();
    const found=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!baseline.has(name));
    const data=handoff?await ports.readBytes(handoff.path,max):null;
    const artifact=data?new TextDecoder("utf-8",{fatal:true}).decode(data):null;
    const plan=outcome?.plan;
    const completed=bound?expectedObservations(bound.request):null;
    const foreign=crypto.randomUUID();
    const artifactExplanation=(()=>{try{return artifact?JSON.parse(artifact)?.plan?.explanation:null;}catch{return null;}})();
    const checks={
      returnedArtifactReceipt:isDeepStrictEqual(outcome?.handoff,handoff),
      exactIntegrationFrontiers:snapshots.length===2&&isDeepStrictEqual(initial,snapshots[0])&&isDeepStrictEqual(current,snapshots[1])&&
        current.rows.length===maps.size&&current.rows.every(row=>isDeepStrictEqual(row.selection,maps.get(row.messageId)))&&
        new Set(current.rows.map(row=>row.envelopeId)).size===current.rows.length,
      trustedIntegrationSelection:planned.action==="hold"?!calls.length&&seenPlan===null&&!observations.length:
        calls.length===1&&calls[0]?.profileId===profileId&&calls[0]?.message===planned.message&&!!seenPlan&&
        isDeepStrictEqual(seenPlan.destinations,destinations.map(({url,...endpoint})=>endpoint)),
      explicitQuietIntegration:planned.action==="hold"?audited===null&&outcome?.review===null&&Array.isArray(outcome?.facts)&&outcome.facts.length===0:
        !!bound&&verifiedReview(outcome.review?{request:bound.request,result:outcome.review}:null,audited)&&isDeepStrictEqual(outcome.facts,audited?.facts),
      observedIntegrationLifecycles:bound ? !!completed && sameEvidenceMembers(facts,completed.redacted) &&
        sameEvidenceMembers(observations,completed.observed) &&
        expected.rows.filter(([id])=>world.expected.held!==undefined||world.endpoints.find(endpoint=>endpoint.id===id)?.required)
          .every(([id,auth,state,refresh])=>facts.some(fact=>fact.destination===id&&fact.authorization===auth&&fact.state===state)&&
            observations.some(row=>row.id===id&&row.canRefresh===(refresh??null))) &&
        (expected.held===undefined||sameEvidenceMembers(completed.held,expected.held)) : expected.rows.length===0,
      groundedIntegrationDisposition:!!plan&&isDeepStrictEqual((({explanation,...facts})=>facts)(plan),planned)&&
        plan.action===expected.action&&plan.reason===expected.reason&&
        typeof plan.explanation==="string"&&countBytes(plan.explanation)<=660&&expected.claims.every(pattern=>pattern.test(plan.explanation)),
      verifiedPrivateIntegrationNote:expected.action==="stage"?typeof artifactExplanation==="string"&&countBytes(artifactExplanation)<=660&&expected.claims.every(pattern=>pattern.test(artifactExplanation))&&!!handoff&&!!data&&!!artifact&&found.length===1&&
        handoff.path===`/.tmp/${found[0]}/handoff.json`&&artifact===stagedText&&handoff.bytes===data.length&&
        handoff.sha256===sha256HexSyncText(artifact):
        found.length===0&&handoff===null,
      preservedIntegrationWorkspace:status.mainEventId===before.mainEventId&&isDeepStrictEqual(status.workingHead,before.workingHead),
      rejectedForeignIntegration:await services.quietIntegrationJournal.read(foreign)===null&&
        await services.quietIntegrationProtocol.open(foreign,foreign)===null&&await services.quietIntegrationProtocol.audit(foreign)===null,
    };
    const contract:SemanticOutcomeContract={"effects": {"checks": ["exactIntegrationFrontiers", "trustedIntegrationSelection", "observedIntegrationLifecycles", "verifiedPrivateIntegrationNote", "preservedIntegrationWorkspace", "rejectedForeignIntegration"], "rationale": "Native observations, scoped authority, retained bytes and protected state establish application effects independently."}, "returnedValue": {"checks": ["explicitQuietIntegration", "groundedIntegrationDisposition"], "required": true, "rationale": "The returned domain findings are required for queries; completed mutations are established independently."}, "incidentalValues": {"checks": ["returnedArtifactReceipt"], "rationale": "Receipt echoes are optional presentation of independently verified native artifacts."}};
    return assessObservedApplicationOutcome({caseId:input.caseId,contextId:input.contextId,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      index,snapshots,planned,calls,seenPlan,observations,audit:audited,handoff,artifact},contract,raw,invocation,[{"checks":["groundedIntegrationDisposition"],"rootPath":["plan"],"producerSourceSuffix":"workOnApiReadinessGoal/decideApiReadiness.nl","producerPath":[]},{"checks":["explicitQuietIntegration"],"rootPath":["review"],"producerSourceSuffix":"workOnApiReadinessGoal/reviewQuietCredentials.nl","producerPath":["result"]}]);
  }
  async function qualify() {
    await services.quietIntegrationIndex.list();
    await services.quietIntegrationJournal.read(lane.key);
    const current=await services.quietIntegrationJournal.read(lane.key);
    if(!current)throw new Error("Both owned selection frontiers are required");
    const chosen=world.ambiguous?null:profileId;
    const selection=check(current,chosen);
    let review:ReadinessReport["review"]=null;
    let audit:QuietAudit|null=null;
    if(selection.reason==="selected"&&chosen&&selection.message){
      const request=await services.quietIntegrationProtocol.open(chosen,selection.message);
      if(!request)throw new Error("The native current selection must open");
      const observed=await services.integrationPlanRead.observe(request.operationId);
      const results:BoundReport["destinations"]=[];
      for(const endpoint of observed.destinations) {
        const observation=await services.integrationCredentialLookup.resolve(observed.receipt,endpoint.id);
        results.push({observation,disposition:disposition(observation)});
        if(observation.state==="unverified")break;
      }
      const status=statusOf(observed.destinations,observations);
      review={request,result:{planReceipt:observed.receipt,destinations:results,
        held:observed.destinations.slice(results.length).map(item=>item.id),status,
        guidance:status==="ready"?null:"Review only the observed public readiness gap."}};
      audit=await services.quietIntegrationProtocol.audit(request.operationId);
    }
    const plan={...actionFor(current,chosen),explanation:world.expected.statement};
    const outcome:ReadinessReport={plan,review,audit,handoff:null};
    if(plan.action==="stage")outcome.handoff=await services.quietIntegrationHandoff.stage(outcome);
    const report={plan:outcome.plan,review:outcome.review?.result??null,facts:outcome.audit?.facts??[],handoff:outcome.handoff};
    const accepted=await verify(report);
    const forged=await verify({...report,plan:{...plan,through:-1}});
    return {...accepted,passed:accepted.passed&&!forged.passed};
  }
  return {goal:world.goal,services,verify,qualify};
}
