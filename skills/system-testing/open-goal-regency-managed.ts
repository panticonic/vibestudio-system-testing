import {assessObservedApplicationOutcome} from "@workspace/application-outcomes/observed-application-outcome";
import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { contextId, fs, panelTree, rpc, vcs } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { Horizon, RegencyAdvance, RegencyClaim, RegencyFinding, RegencyForecast, RegencyIndex,
  RegencyMemo, RegencyNote, RegencyReport, RegencySnapshot, RealmFinding, RealmReadback } from "@workspace-skills/open-regency-briefing/types";
import { createOwnedHeadlessChannel } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { openRegencyWorlds } from "./open-goal-regency-worlds.js";
import { bindRegencyFixturePlayer, type RegencyFixtureIdentity } from "./regency-fixture-player.js";

type View = {game:{world:unknown;programs:unknown};pending:{id:string}|null;painting:boolean};
type RealmStore = {
  read():Promise<View>;
  preview(months:Horizon):Promise<{basis:unknown;forecast:unknown}>;
};
type ReviewInput = {kind:"settlement";check:unknown;current:RealmReadback} |
  {kind:"compare";check:unknown;before:RealmReadback;after:RealmReadback;basis:"forecast"|"observed";assertCommitted:boolean};
type Installed = {
  owner(realm:string):RealmStore;
  readback(id:string,world:unknown):RealmReadback;
  review(input:ReviewInput):RealmFinding;
};
type Input = {contextId:string;caseId:string;regencyFixture?:RegencyFixtureIdentity};
type Ports = {contextId:string|null;fs:typeof fs;status:typeof vcs.status;open:typeof createOwnedHeadlessChannel;
  player:Awaited<ReturnType<typeof bindRegencyFixturePlayer>>;
  readBytes(path:string,max:number):Promise<Uint8Array>};
async function livePorts(input:Input):Promise<Ports> {
  const fixture=input.regencyFixture;
  if(!fixture)throw new Error("The owned Regency realm needs a player renderer");
  return {contextId,fs,status:input=>vcs.status(input),open:createOwnedHeadlessChannel,
    player:await bindRegencyFixturePlayer(panelTree.get(fixture.panelId),input.contextId,fixture),
    readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)};
}
const maxBytes=12*1024;

export async function prepareOpenRegency(input:Input,installed:Installed,injected?:Ports) {
  const ports=injected??await livePorts(input);
  const world=openRegencyWorlds.find(row=>row.id===input.caseId);
  if(!world||!input.contextId||input.contextId!==ports.contextId)throw new Error("Regency assignment needs its owned context");
  const realm=input.regencyFixture?.realm;
  if(!realm)throw new Error("Missing assigned Regency realm");
  const lane=await ports.open(input.contextId,"Private Regency review");
  const store=installed.owner(realm);
  const before=await ports.status();
  const inPlay=[];
  const revision=(view:View)=>stableSha256Hex({realm,world:view.game.world,programs:view.game.programs,
    pending:view.pending?.id??null,painting:view.painting});
  function snapshot(view:View):RegencySnapshot {
    const id=revision(view);
    return {realm,revision:id,accounts:installed.readback(`${realm}:saved:${id}`,view.game.world),pending:view.pending?.id??null};
  }

  async function move(months:number,keepPending:boolean) {
    const id=`settlement-${crypto.randomUUID()}`;
    const old=snapshot(await store.read());
    await ports.player.advance(id,months);
    const result=await store.read();
    if(result.pending?.id!==id||snapshot(result).accounts.month!==old.accounts.month+months)
      throw new Error("Native Regency advancement did not persist its owned receipt");
    // With no council advisors, this closes only narration and leaves settlement committed.
    if(!keepPending)await ports.player.cancel();
    const saved=await store.read();
    if(snapshot(saved).accounts.month!==old.accounts.month+months||(!keepPending&&saved.pending))
      throw new Error("Regency cancellation changed the settled ledger");
    inPlay.push({id,months,start:old.accounts.month,end:snapshot(saved).accounts.month,keptPending:keepPending});
    return {id,saved};
  }

  const openingGame=await store.read();
  if(snapshot(openingGame).accounts.month!==0||openingGame.pending||openingGame.painting)
    throw new Error("The private Regency realm did not start from original data");
  let ready=false;
  async function seat() {
    if(!ready) {
      // A real owned channel supplies the inert seat. No advisor can receive work.
      await ports.player.seat(lane);
      ready=true;
    }
  }
  if(world.initial.month) {
    await seat();
    await move(world.initial.month,world.initial.pending===true);
  }
  const start=await store.read();
  const first=snapshot(start);
  const initialIndex:Omit<RegencyIndex,"memo">={realm,title:world.realmTitle,originalMonth:first.accounts.month,allowedHorizons:[1,2,3],
    routes:first.accounts.routes.map(route=>route.id),regions:first.accounts.regions.map(region=>region.id)};
  const dir=await ports.fs.mkdtemp("regency-review");
  const policyPath=`${dir}/policy.md`;
  await ports.fs.writeFile(policyPath,"The council's evidence is private to the assigned fictional realm. Preview and committed state are distinct.");
  const memoPath=`${dir}/council-draft.md`;
  if(world.memo)await ports.fs.writeFile(memoPath,world.memo);
  const memoDigest=world.memo?sha256HexSyncText(world.memo):null;
  async function readMemo():Promise<RegencyMemo|null> {
    if(!memoDigest)return null;
    const text=new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(memoPath,4096));
    const digest=sha256HexSyncText(text);
    if(digest!==memoDigest)throw new Error("Retained council draft does not match its receipt");
    return {path:memoPath,digest,basis:first.revision,text};
  }
  const originalFiles=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What does the current Regency evidence support?"],
    sources:[{id:"private-council-scope",path:policyPath}]},ports.readBytes).scratchHandoffWrite;

  let index:RegencyIndex|null=null;
  let busy=false;
  let claimed=false;
  let advance:RegencyAdvance|null=null;
  let note:RegencyNote|null=null;
  const frontiers:RegencySnapshot[]=[];
  const forecasts:RegencyForecast[]=[];
  async function preview(months:Horizon,scope:RegencySnapshot) {
    const observation=await store.preview(months);
    const current=await store.read();
    if(revision(current)!==scope.revision||!isDeepStrictEqual(observation.basis,current.game.world))
      throw new Error("Regency forecast basis changed during observation");
    const accounts=installed.readback(`${realm}:forecast:${scope.revision}:${months}`,observation.forecast);
    if(accounts.month!==scope.accounts.month+months)throw new Error("Native Regency forecast returned the wrong calendar");
    return {realm,basis:scope.revision,months,accounts};
  }
  function evidence(claim:RegencyClaim,opening:RegencySnapshot,current:RegencySnapshot,projections:RegencyForecast[]) {
    function account(key:"opening"|"current"|Horizon) {
      if(key==="opening")return opening.accounts;
      if(key==="current")return current.accounts;
      return projections.find(row=>row.months===key)?.accounts;
    }
    if(claim.kind==="settlement") {
      const current=account(claim.source);
      return current?{kind:"settlement",check:claim.check,current} as const:null;
    }
    const before=account(claim.from),after=account(claim.to);
    return before&&after?{kind:"compare",check:claim.check,before,after,assertCommitted:claim.assertCommitted,
      basis:typeof claim.from==="number"||typeof claim.to==="number"?"forecast" as const:"observed" as const} as const:null;
  }
  function finding(claim:RegencyClaim,opening:RegencySnapshot,current:RegencySnapshot,projections:RegencyForecast[]):RegencyFinding {
    const requested=evidence(claim,opening,current,projections);
    const review=requested?installed.review(requested):{decision:"not-observed" as const,finding:"missing-source",evidenceIds:[]};
    return {claim,review};
  }
  const body=(report:RegencyReport)=>JSON.stringify({scope:"private-local",realm,opening:report.opening,current:report.current,
    forecasts:report.forecasts,findings:report.findings,advance:report.advance,decision:report.decision},null,2);

  let stagedText:string|null=null;
  const services={
    regencyAssignment:{async list(){
      index={...initialIndex,memo:await readMemo()};
      return structuredClone(index);
    }},
    regencySaved:{async read(key:string){
      if(key!==realm||busy)return null;
      if(frontiers.length>=2)return structuredClone(frontiers.at(-1)!);
      index??={...initialIndex,memo:await readMemo()};
      busy=true;
      try {
        if(frontiers.length===1&&world.initial.between){await seat();await move(world.initial.between,false);}
        const result=snapshot(await store.read());
        frontiers.push(result);
        return structuredClone(result);
      } finally {busy=false;}
    }},
    regencyForecast:{async preview(key:string,basis:string,months:Horizon){
      const current=frontiers[1];
      if(key!==realm||!current||basis!==current.revision||busy||claimed||
        ![1,2,3].includes(months)||forecasts.length>=3||forecasts.some(row=>row.months===months))
        return null;
      busy=true;
      try {
        if(revision(await store.read())!==basis)return null;
        const result=await preview(months,current);
        forecasts.push(result);
        return structuredClone(result);
      } finally {busy=false;}
    }},
    regencyAdvance:{async commit(key:string,basis:string,months:Horizon){
      const current=frontiers[1];
      if(key!==realm||!current||basis!==current.revision||busy||claimed||months!==world.plan.advance||current.pending)
        return null;
      busy=true;
      try {
        const proposal=forecasts.find(row=>row.months===months);
        if(!proposal||proposal.accounts.treasury<(world.plan.treasuryFloor??Number.NEGATIVE_INFINITY)||
          revision(await store.read())!==basis)return null;
        const prerequisites=world.plan.claims.filter(claim=>claim.kind==="settlement"&&
          (claim.check.kind==="crossing-reopened"||claim.check.kind==="has-debt"));
        if(prerequisites.some(claim=>finding(claim,frontiers[0],current,forecasts).review.decision!==
          (claim.check.kind==="has-debt"?"contradicted":"supported")))return null;
        if(!isDeepStrictEqual(proposal,await preview(months,current)))return null;
        claimed=true;
        await seat();
        const native=await move(months,false);
        advance={id:native.id,realm,basis,months,committed:snapshot(native.saved)};
        return structuredClone(advance);
      } finally {busy=false;}
    }},
    regencyNote:{async stage(report:RegencyReport){
      if(!world.plan.localNote||note||busy||!report?.decision?.explanation||report.decision.explanation.length>700||
        report.note!==null||!(report.decision.action==="stage"||report.decision.action==="advance"&&advance)||
        !isDeepStrictEqual(report.advance,advance)||!isDeepStrictEqual(report.opening,frontiers[0])||
        !isDeepStrictEqual(report.current,frontiers[1])||!isDeepStrictEqual(report.forecasts,forecasts)||
        !isDeepStrictEqual(report.plan,world.plan))return null;
      busy=true;
      try {
        const current=snapshot(await store.read());
        if(current.revision!==(advance?.committed?.revision??frontiers[1].revision))return null;
        const findings=world.plan.claims.map(claim=>finding(claim,report.opening,report.current,report.forecasts));
        if(!isDeepStrictEqual(report.findings,findings)||findings.some(item=>item.review.decision==="not-observed"))return null;
        const text=body(report);
        if(new TextEncoder().encode(text).length>maxBytes)return null;
        const file=(stagedText=text,await writer.stage(text));
        if(!file)return null;
        note={path:file.path,digest:sha256HexSyncText(text),realm,revision:current.revision};
        return structuredClone(note);
      } finally {busy=false;}
    }},
  };

  async function verify(raw:unknown,invocation?:InvocationObservations) {
    const report=raw as RegencyReport|null;
    const outcome=report;
    const [opening,current]=frontiers;
    const currentExpected=world.initial.month+(world.initial.between??0);
    const after=snapshot(await store.read());
    const result=outcome?.decision;
    const selectedForecast=forecasts.find(row=>row.months===world.plan.advance);
    const nativeVerification=advance||!current?[]:await Promise.all(forecasts.map(row=>preview(row.months,current)));
    const witnesses=opening&&current?world.plan.claims.map(claim=>({claim,request:evidence(claim,opening,current,forecasts),
      result:finding(claim,opening,current,forecasts)})):[];
    const findings=witnesses.map(item=>item.result);
    const neededAdvance=world.action==="advance"?world.plan.advance??0:0;
    const neededNote=world.plan.localNote&&(world.action==="stage"||world.action==="advance");
    const files=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!originalFiles.has(name));
    const artifact=note?new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(note.path,maxBytes)):null;
    const status=await ports.status();
    const other=crypto.randomUUID();
    const artifactDecision=(()=>{try{return artifact?JSON.parse(artifact)?.decision:null;}catch{return null;}})();
    const checks={
      returnedArtifactReceipt:isDeepStrictEqual(outcome?.note,note),
      exactRegencyAssignment:index?.realm===realm,
      independentlyReadRegencyMemo:!!index&&isDeepStrictEqual(index.memo,await readMemo()),
      exactSavedRegencyFrontiers:frontiers.length===2&&isDeepStrictEqual(opening,first)&&opening.accounts.month===world.initial.month&&
        current.accounts.month===currentExpected&&!!current.pending===(world.initial.pending===true),
      returnedRegencyForecasts:isDeepStrictEqual(forecasts,outcome?.forecasts),
      exactRegencyForecasts:isDeepStrictEqual(forecasts.map(row=>row.months),world.plan.horizons)&&forecasts.every(row=>row.basis===current.revision&&row.realm===realm)&&
        (advance?!!selectedForecast:isDeepStrictEqual(forecasts,nativeVerification)),
      exactInstalledRegencyFindings:outcome?.findings?.length===findings.length&&
        isDeepStrictEqual(findings.map(item=>item.review.decision),world.expected),
      groundedRegencyAction:result?.action===world.action&&typeof result.explanation==="string"&&result.explanation.length<=700&&
        world.terms.every(term=>result.explanation.toLowerCase().includes(term.toLowerCase())),
      returnedRegencyAdvance:isDeepStrictEqual(outcome?.advance,advance),
      verifiedRegencyAdvance:after.accounts.month===currentExpected+neededAdvance&&
        (neededAdvance?!!advance&&!!selectedForecast&&advance.months===neededAdvance&&advance.basis===current.revision&&
          isDeepStrictEqual(advance.committed,after)&&isDeepStrictEqual(
            {...after.accounts,id:selectedForecast.accounts.id},selectedForecast.accounts)&&inPlay.at(-1)?.id===advance.id:
          advance===null&&isDeepStrictEqual(after,current)),
      verifiedPrivateRegencyNote:neededNote?!!(artifactDecision?.action===world.action&&typeof artifactDecision.explanation==="string"&&artifactDecision.explanation.length<=700&&world.terms.every(term=>artifactDecision.explanation.toLowerCase().includes(term.toLowerCase())))&&!!note&&!!artifact&&files.length===1&&
        note.path===`/.tmp/${files[0]}/handoff.json`&&note.revision===after.revision&&
        artifact===stagedText&&note.digest===sha256HexSyncText(artifact):
        note===null&&files.length===0,
      preservedRegencyWorkspace:status.mainEventId===before.mainEventId&&isDeepStrictEqual(status.workingHead,before.workingHead),
      rejectedRegencyRetarget:await services.regencySaved.read(other)===null&&
        await services.regencyForecast.preview(other,"different",1)===null&&
        await services.regencyAdvance.commit(other,"different",1)===null&&
        await services.regencyNote.stage({decision:{action:"stage"}} as RegencyReport)===null,
    };
    const findingChecks=Object.fromEntries(findings.map((finding,index)=>[`exactRegencyFinding${index}`,isDeepStrictEqual(outcome?.findings?.[index],finding)]));
    Object.assign(checks,findingChecks);
    const contract:SemanticOutcomeContract={"effects": {"checks": ["exactRegencyForecasts", "verifiedRegencyAdvance", "exactRegencyAssignment", "independentlyReadRegencyMemo", "exactSavedRegencyFrontiers", "verifiedPrivateRegencyNote", "preservedRegencyWorkspace", "rejectedRegencyRetarget"], "rationale": "Native observations, scoped authority, retained bytes and protected state establish application effects independently."}, "returnedValue": {"checks": ["returnedRegencyForecasts", "exactInstalledRegencyFindings", ...Object.keys(findingChecks), "groundedRegencyAction", "returnedRegencyAdvance"], "required": neededAdvance===0, "rationale": "The returned domain findings are required for queries; completed mutations are established independently."}, "incidentalValues": {"checks": ["returnedArtifactReceipt"], "rationale": "Receipt echoes are optional presentation of independently verified native artifacts."}};
    return assessObservedApplicationOutcome({contextId:input.contextId,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      index,frontiers,plan:world.plan,forecasts,witnesses,decision:result??null,advance,note,artifact},contract,raw,invocation,[...findings.map((_,index)=>({checks:[`exactRegencyFinding${index}`],rootPath:["findings",index],producerSourceSuffix:"workOnRegencyBriefing/qualifyRegencyClaim.nl",producerPath:[]})),{"checks":["groundedRegencyAction"],"rootPath":["decision"],"producerSourceSuffix":"workOnRegencyBriefing/decideRegencyAction.nl","producerPath":[]}]);
  }
  async function qualify() {
    await services.regencyAssignment.list();
    const opening=await services.regencySaved.read(realm),current=await services.regencySaved.read(realm);
    if(!opening||!current)throw new Error("Both exact Regency receipts required");
    for(const months of world.plan.horizons)await services.regencyForecast.preview(realm,current.revision,months);
    const findings=world.plan.claims.map(claim=>finding(claim,opening,current,forecasts));
    const decision={action:world.action,explanation:world.terms.join(" / ")};
    const report:RegencyReport={plan:world.plan,opening,current,forecasts,findings,decision,advance:null,note:null};
    if(decision.action==="advance")report.advance=await services.regencyAdvance.commit(realm,current.revision,world.plan.advance!);
    if((decision.action==="advance"&&report.advance||decision.action==="stage")&&world.plan.localNote)
      report.note=await services.regencyNote.stage(report);
    return verify({forecasts:report.forecasts,findings:report.findings,decision:report.decision,advance:report.advance,note:report.note});
  }
  return {services,verify,qualify};
}
