import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { createMissionsClient } from "@vibestudio/service-schemas/clients/missionsClient";
import { missionRevisionDigest, type MissionRecord, type MissionTrigger } from "@vibestudio/automation/mission";
import { stableSha256Hex } from "@vibestudio/content-addressing";
import { contextId as context, fs, rpc } from "@workspace/runtime";
import type { AutomationActivationWorld } from "./open-goal-automation-activation-worlds.js";

type Missions=Pick<ReturnType<typeof createMissionsClient>,"getDefault"|"get"|"list"|"listRuns"|"transitionAtRevision">;
type Ports={contextId:string|null;missions:Missions;fs:Pick<typeof fs,"mkdtemp"|"readFile"|"writeFile"|"rename"|"rm">};
type NativeLaunch = () => Promise<MissionRecord>;
type Assignment = {
  caseId: string;
  contextId: string;
  id: string;
  now: number;
  baseline: { missionId: string; revisionDigest: string; owner: string };
};

export class OwnedAutomationActivationLaunches {
  private readonly callbacks = new Map<string, NativeLaunch>();

  register(evalId: string, launch: NativeLaunch) {
    if (this.callbacks.has(evalId)) throw new Error("Automation activation Eval is already assigned");
    this.callbacks.set(evalId, launch);
    return () => { this.callbacks.delete(evalId); };
  }

  async launch(callerId: string | null, callerKind: string | null): Promise<MissionRecord> {
    const launch = callerKind === "do" && callerId && this.callbacks.get(callerId);
    if (!launch) throw new Error("No native activation is assigned to this finite Eval");
    return launch();
  }
}
type Consent={
  id:string;subject:string;owner:string;state:"approved"|"pending"|"withdrawn"|"preview-only";edition:"current"|"archive";
};
type Plan={kind:"launch";executor:string;conversation:string;trigger:MissionTrigger;operations:unknown[]}|{kind:"hold";reason:string};
type Choice={action:"activate"|"hold";basis:string;consent:(Consent&{digest:string})|null;reason:string};
type Receipt={missionId:string;revisionDigest:string;revision:number;nextRunAt:number|null;recovered:boolean};
type Journal={service:string;method:string;args:unknown[];result:unknown};
const day=86_400_000;
function projection(mission:MissionRecord) {
  return { missionId:mission.missionId,owner:mission.owner.userId,trigger:mission.charter.trigger,
    revisionDigest:mission.revisionDigest,nextRunAt:mission.nextRunAt ?? null,runCount:mission.runCount,state:mission.state };
}

async function readDefault(missions: Pick<Missions, "getDefault">) {
  const initialDefault = await missions.getDefault("workspace-updates");
  const execution = initialDefault?.charter.execution;
  if (!initialDefault || execution?.kind !== "agent")
    throw new Error("Could not bind the native installed automation executor image");
  return { initialDefault, image: execution.image };
}

function baseline(record: MissionRecord) {
  return { missionId: record.missionId, revisionDigest: record.revisionDigest, owner: record.owner.userId };
}

export async function assignOwnedAutomationActivation(
  missions: Pick<ReturnType<typeof createMissionsClient>, "getDefault" | "launch">,
  contextId: string,
  world: AutomationActivationWorld,
): Promise<{ assignment: Assignment; launch: NativeLaunch | null }> {
  const { initialDefault } = await readDefault(missions);
  const assignment: Assignment = {
    caseId: world.id, contextId, id: crypto.randomUUID(), now: Date.now(), baseline: baseline(initialDefault),
  };
  const needsLaunch = world.profile === "activate" || world.profile === "retry" || world.profile === "already-active";
  const launch = needsLaunch ? async () => {
    const { initialDefault: current, image } = await readDefault(missions);
    if (!isDeepStrictEqual(baseline(current), assignment.baseline))
      throw new Error("The assigned automation baseline moved before activation");
    const { name, charter } = definition(world, assignment, image);
    return missions.launch({ name, charter }, { idempotencyKey: "owned-activation:" + assignment.id });
  } : null;
  return { assignment, launch };
}

function definition(
  world: AutomationActivationWorld,
  assignment: Assignment,
  image: Awaited<ReturnType<typeof readDefault>>["image"],
) {
  const { id, now } = assignment;
  const name=world.title+" ["+id+"]";
  const operation="automation-review:"+id;
  const sourceRows=[
    { id:operation+":first", eligible:true },
    { id:operation+":reviewed", eligible:true },
    { id:operation+":superseded", eligible:false },
  ];
  const execution={
    kind:"agent" as const,image,conversation:{mode:"fresh" as const},operations:[],
    action:{kind:"eval" as const,code:
      "const rows = "+JSON.stringify(sourceRows)+"; "+
      "return { operation: "+JSON.stringify(world.operation)+", count: rows.filter(row => row.eligible).length };"},
  };
  const futureAnchor=now+45*day;
  const desired:MissionTrigger=world.cadence==="manual"?{kind:"manual"}:{
    kind:"schedule",everyMs:world.minutes!*60_000,...(world.maxRuns===undefined?{}:{maxRuns:world.maxRuns}),
  };
  const nativeTrigger=desired.kind==="schedule"?{...desired,anchorAt:futureAnchor}:desired;
  const charter={summary:world.operation,execution,trigger:nativeTrigger};
  return { name, operation, futureAnchor, desired, nativeTrigger, charter };
}

export async function prepareOwnedAutomationActivation(
  input: { contextId: string; caseId: string },
  world: AutomationActivationWorld,
  assignment: Assignment,
  launch: NativeLaunch,
  ports: Ports = { contextId: context, missions: createMissionsClient(rpc), fs },
) {
  const { missions, fs } = ports;
  const { contextId } = input;
  if (!contextId || contextId !== ports.contextId || input.caseId !== world.id ||
      assignment.contextId !== contextId || assignment.caseId !== world.id)
    throw new Error("Automation activation needs its assigned owned context");
  const { initialDefault, image } = await readDefault(missions);
  if (!isDeepStrictEqual(baseline(initialDefault), assignment.baseline))
    throw new Error("The assigned automation baseline moved before review");
  const { now, baseline: { owner } } = assignment;
  const { name, operation, futureAnchor, desired, nativeTrigger, charter } = definition(world, assignment, image);
  const directory=await fs.mkdtemp("owned-automation-activation");
  const file=directory+"/consent.json";
  let created:MissionRecord|null=null;
  let existing:MissionRecord|null=null;
  let receipt:Receipt|null=null;
  let moved=false;
  let busy=false;
  let launchCalls=0;
  const journal:Journal[]=[];
  const note=<T>(service:string,method:string,args:unknown[],result:T)=> {
    journal.push(structuredClone({service,method,args,result}));
    return result;
  };
  function consent(edition:Consent["edition"],state:Consent["state"],account=owner,subject=operation):Consent {
    return {id:crypto.randomUUID(),edition,state,owner:account,subject};
  }
  const profile=world.profile;
  const firstConsent=[
    consent("current",profile==="pending"||profile==="withdrawn"||profile==="preview-only"?profile:"approved",
      profile==="scope-mismatch"?owner+"-prior":owner,
      profile==="scope-mismatch"?operation+"-different":operation),
    ...(profile==="ambiguous"?[consent("current","withdrawn")]:[]),
    consent("archive","approved"),
  ];
  async function writeConsents(records:Consent[]) {
    const temporary=directory+"/.pending";
    await fs.writeFile(temporary,JSON.stringify(records));
    await fs.rename(temporary,file);
  }
  async function observe() {
    const raw=await fs.readFile(file,"utf8");
    if(typeof raw!=="string")throw new Error("Owned consent record is unreadable");
    const records=(JSON.parse(raw) as Consent[]).map(value=>({...value,digest:stableSha256Hex(value)}));
    const bound=existing && await missions.get(existing.missionId);
    const visible=bound && bound.state==="active"?[{id:bound.missionId,name:world.title,state:"active" as const,latestRun:null}]:[];
    return {
      title:world.title,operation,owner,current:stableSha256Hex(raw),records,existing:bound?.missionId ?? null,
      requiresBound:world.maxRuns!==undefined || profile==="invalid-plan",futureAnchor,
      request:{goal:world.goal,timezone:"Etc/UTC",now:new Date(now).toISOString(),visible,availableOperations:[]},
    };
  }
  type Evidence=Awaited<ReturnType<typeof observe>>;
  let observed:Evidence|undefined;
  let initialMissionIds:string[]=[];
  async function close() {
    // Rediscover via the unique fixture title when a launch persisted but its first response was lost.
    const owned=(await missions.list()).filter(row=>row.name===name && row.owner.userId===owner &&
      isDeepStrictEqual(row.charter,charter));
    const results=await Promise.allSettled(owned.map(async item=>{
      const live=await missions.get(item.missionId);
      if(live?.state==="active" && live.owner.userId===owner && live.name===name && isDeepStrictEqual(live.charter,charter))
        await missions.transitionAtRevision(live.missionId,"pause",live.revisionDigest);
    }));
    await fs.rm(directory,{recursive:true,force:true});
    const failed=results.flatMap(result=>result.status==="rejected"?[result.reason]:[]);
    if(failed.length)throw new AggregateError(failed,"Dispose owned native automation activations");
  }
  try {
    await writeConsents(firstConsent);
    if(profile==="already-active") existing=await launch();
    initialMissionIds=(await missions.list()).map(record=>record.missionId);
  } catch(error) {
    try {await close();}
    catch(cleanup) {throw new AggregateError([error,cleanup],"Owned automation setup failed");}
    throw error;
  }

  const validPlan=(plan:Plan)=>plan?.kind==="launch"&&plan.executor==="eval"&&plan.conversation==="fresh"&&
    plan.operations.length===0&&isDeepStrictEqual(plan.trigger,desired)&&profile!=="invalid-plan";
  async function activate(revision:string,plan:Plan,decision:Choice) {
    const latest=await observe();
    const deny={status:"held" as const,receipt:null,evidenceRevision:latest.current};
    const current=latest.records.filter(row=>row.edition==="current");
    if (latest.current!==revision) return {...deny,status:"moved" as const};
    if (!observed || observed.current!==revision || current.length!==1 || latest.existing || created || busy ||
        decision?.action!=="activate" || decision.basis!=="authorized" || !isDeepStrictEqual(decision.consent,current[0]) ||
        current[0]!.subject!==operation || current[0]!.owner!==owner || current[0]!.state!=="approved" || !validPlan(plan)) return deny;
    busy=true;
    try {
      if (profile==="moved" && !moved) {
        await writeConsents([consent("current","withdrawn"),firstConsent[1]!]);
        moved=true;
        return {...deny,status:"moved" as const,evidenceRevision:(await observe()).current};
      }
      launchCalls++;
      created=await launch();
      if (profile==="retry") {
        // Drop the first response and recover the very same persisted mission.
        launchCalls++;
        const recovered=await launch();
        if (!isDeepStrictEqual(projection(recovered),projection(created)) ||
            recovered.revision!==created.revision || !isDeepStrictEqual(recovered.charter,created.charter) ||
            !isDeepStrictEqual(recovered.authorityPlan,created.authorityPlan))
          throw new Error("Native creation retry diverged from its retained definition");
      }
      receipt={missionId:created.missionId,revisionDigest:created.revisionDigest,revision:created.revision,
        nextRunAt:created.nextRunAt ?? null,recovered:profile==="retry"};
      return {status:"activated" as const,receipt,evidenceRevision:latest.current};
    } finally {busy=false;}
  }
  let capturedRead:ReturnType<typeof projection>|null=null;
  const services={
    automationActivationEvidence:{async observe() {
      if(observed)return structuredClone(observed);
      observed=await observe();
      return note("automationActivationEvidence","observe",[],observed);
    }},
    automationActivationCommit:{async activate(revision:string,plan:Plan,decision:Choice) {
      return note("automationActivationCommit","activate",[revision,plan,decision],await activate(revision,plan,decision));
    }},
    automationActivationReadback:{async read(wanted:Receipt) {
      if(!receipt||!isDeepStrictEqual(wanted,receipt))throw new Error("Read from the exact owned launch receipt");
      if(capturedRead)return structuredClone(capturedRead);
      const live=await missions.get(receipt.missionId);
      if(!live||live.revisionDigest!==receipt.revisionDigest)throw new Error("Native scheduler no longer matches the activation");
      capturedRead=projection(live);
      return note("automationActivationReadback","read",[wanted],capturedRead);
    }},
  };
  const launches=profile==="activate"||profile==="retry";
  const expectedBasis=launches||profile==="moved"?"authorized":profile;
  const expectsPlan=launches||profile==="moved"||profile==="invalid-plan";
  type Outcome={evidence:Evidence;plan:Plan|null;decision:Choice;
    activation:Awaited<ReturnType<typeof activate>>|null;readback:ReturnType<typeof projection>|null};

  
  async function verify(raw: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(raw,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["returnedActivationDecision"],"rootPath":["decision","action"],"producerSourceSuffix":"activateOwnedAutomation/reviewLaunchEvidence.nl","producerPath":["decision","action"]},{"checks":["returnedActivationDecision"],"rootPath":["decision","basis"],"producerSourceSuffix":"activateOwnedAutomation/reviewLaunchEvidence.nl","producerPath":["decision","basis"]},{"checks":["returnedActivationDecision"],"rootPath":["decision","reason"],"producerSourceSuffix":"activateOwnedAutomation/reviewLaunchEvidence.nl","producerPath":["decision","reason"]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=raw;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,raw,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(raw: unknown, invocation?: InvocationObservations) {
    const report=raw as Outcome|null;
    const outcome=report;
    const final=await observe();
    const rows=await missions.list();
    const ownedRows=rows.filter(row=>row.name===name);
    const visibleIds=new Set(rows.map(row=>row.missionId));
    const term=await missions.getDefault("workspace-updates");
    const nativeId=receipt?.missionId ?? existing?.missionId;
    const native=nativeId?await missions.get(nativeId):null;
    const runs=nativeId?(await missions.listRuns(nativeId,{limit:5})).items:[];
    const actual=native?projection(native):null;
    const commitWitness=journal.find(row=>row.service==="automationActivationCommit");
    const committed=commitWitness?.result as Awaited<ReturnType<typeof activate>>|undefined;
    const submittedPlan=commitWitness?.args[1] as Plan|null|undefined;
    const exactPlan=!commitWitness||!!submittedPlan&&submittedPlan.kind==="launch"&&submittedPlan.executor==="eval"&&submittedPlan.conversation==="fresh"&&submittedPlan.operations.length===0&&isDeepStrictEqual(submittedPlan.trigger,desired);
    const checks={
      exactRetainedActivationEvidence: !!observed &&
        observed.owner===owner && observed.current===stableSha256Hex(JSON.stringify(firstConsent)),
      exactOwnedActivationPlan: exactPlan===true,
      returnedActivationDecision: outcome?.decision?.basis===expectedBasis&&outcome.decision.action===(launches||profile==="moved"?"activate":"hold")&&Boolean(outcome.decision.reason?.trim())&&isDeepStrictEqual(outcome?.activation,commitWitness?.result??null),
      currentConsentEnforced: profile==="moved" ? moved && final.current!==observed?.current &&
        final.records[0]?.state==="withdrawn" && committed?.status==="moved" &&
        committed?.evidenceRevision===final.current && committed?.receipt===null && !!commitWitness
        : final.current===observed?.current && (launches ? committed?.status==="activated" &&
          !!commitWitness : !commitWitness),
      independentlyReadNativeDefinition: launches ? actual?.owner===owner && !!native && native.revision===1 &&
        native.revisionDigest===missionRevisionDigest(charter,native.authorityPlan.digest) &&
        isDeepStrictEqual(native.charter,charter) && actual.state==="active" &&
        actual.nextRunAt===(nativeTrigger.kind==="schedule"?futureAnchor:null) && isDeepStrictEqual(committed?.receipt,receipt) &&
        isDeepStrictEqual(capturedRead,actual)
        : !capturedRead &&
          (profile==="already-active"?!!existing&&isDeepStrictEqual(projection(existing),actual):native===null),
      deduplicatedLaunchAndNoDispatch: ownedRows.length===Number(launches||profile==="already-active") &&
        launchCalls===(profile==="retry"?2:launches?1:0) &&
        (receipt?.recovered ?? false)===(profile==="retry") && (native?.runCount??0)===0 && runs.length===0 &&
        (native?.nextRunAt===undefined || native.nextRunAt>now+20*day),
      protectedExistingAutomationDefinitions: initialMissionIds.every(existing=>visibleIds.has(existing)) &&
        term?.missionId===initialDefault.missionId && term.revisionDigest===initialDefault.revisionDigest,
    };
    return {
      outcomeContract:{effects:{checks:["exactRetainedActivationEvidence", "exactOwnedActivationPlan", "currentConsentEnforced", "independentlyReadNativeDefinition", "deduplicatedLaunchAndNoDispatch", "protectedExistingAutomationDefinitions"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["returnedActivationDecision"],required:!launches,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],
caseId:world.id,contextId,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      evidence:observed,final,actual,receipt,launchCalls,runs,initialMissionIds,ownedRows,journal:structuredClone(journal)};
  }

  async function qualify() {
    const evidence=await services.automationActivationEvidence.observe();
    const choice:Choice={action:launches||profile==="moved"?"activate":"hold",basis:expectedBasis,
      consent:launches||profile==="moved"?evidence.records[0]!:null,reason:"Use the current exact owner decision for this private activation."};
    const plan:Plan|null=expectsPlan?{kind:"launch",executor:"eval",conversation:"fresh",operations:[],trigger:desired}:null;
    const retired={...choice,action:"activate" as const,basis:"authorized",consent:evidence.records.at(-1)!};
    const wrong=await activate(evidence.current,plan??{kind:"hold",reason:"held"},retired);
    const activation=choice.action==="activate"&&plan?await services.automationActivationCommit.activate(evidence.current,plan,choice):null;
    const readback=activation?.receipt?await services.automationActivationReadback.read(activation.receipt):null;
    let rejectedReceiptAlias=true;
    if(activation?.receipt) {
      try {
        await services.automationActivationReadback.read({...activation.receipt,missionId:"different-owned-job"});
        rejectedReceiptAlias=false;
      } catch { /* Exact receipt mismatch. */ }
    }
    const report={decision:{action:choice.action,basis:choice.basis,reason:choice.reason},activation};
    const proof=await verify(report);
    const rejectedChangedClaim=!(await verify({...report,activation:{...(activation??{}),receipt:{missionId:"different-owned-job"}}})).outcomeDimensions.returnedValue.passed;
    const rejectedApprovalAliases=wrong.status==="held"&&wrong.receipt===null&&rejectedReceiptAlias&&rejectedChangedClaim;
    return {...proof,outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedApprovalAliases"]}},passed:proof.passed&&rejectedApprovalAliases,checks:{...proof.checks,rejectedApprovalAliases},report};
  }
  return {services,verify,qualify,close};
}
