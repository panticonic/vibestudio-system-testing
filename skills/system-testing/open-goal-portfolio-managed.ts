import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import type {SemanticOutcomeContract} from "./semantic-outcome-contract.js";
import type {InvocationObservations} from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText, stableSha256Hex } from "@vibestudio/content-addressing";
import { contextId, fs, panelTree, rpc, vcs } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { AcceptanceCard, GardenCriterion, GardenResult, GardenState, Horizon, PortfolioDecision, PortfolioFinding, PortfolioFrame,
  PortfolioIndex, PortfolioNote, PortfolioPlan, PortfolioProjection, PortfolioReport, RealmCriterion, RealmResult, RealmState } from "@workspace-skills/open-demo-portfolio/types";
import { createOwnedHeadlessChannel } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { openPortfolioWorlds, type GardenAction } from "./open-goal-portfolio-worlds.js";
import { advanceOwnedGrimoirePanel, assertOwnedGrimoirePanel, visitOwnedGrimoirePanel, type GrimoireClock } from "./grimoire-fixture-player.js";
import { bindRegencyFixturePlayer, type RegencyFixtureIdentity } from "./regency-fixture-player.js";

type RealmView={game:{world:unknown;programs:unknown};pending:{id:string}|null;painting:boolean};
type GardenView={garden:unknown;pending:unknown;seated:boolean};
type Installed={
  garden(id:string):{read():Promise<GardenView>};
  readGarden(id:string,garden:unknown):GardenState;
  reviewGarden(review:unknown):PortfolioFinding;
  realm:{
    owner(id:string):{read():Promise<RealmView>;preview(months:Horizon):Promise<{basis:unknown;forecast:unknown}>};
    readback(id:string,world:unknown):RealmState;
    review(review:unknown):PortfolioFinding;
  };
};
export type PortfolioFixtureIdentity = {gardenPanelId:string;gardenId:string;regency:RegencyFixtureIdentity};
type Input = {contextId:string;caseId:string;portfolioFixture?:PortfolioFixtureIdentity};
type Ports={contextId:string|null;fs:typeof fs;status:typeof vcs.status;open:typeof createOwnedHeadlessChannel;
  gardenPlayer:{pulse(before:GrimoireClock):Promise<void>;visit(before:GrimoireClock,name:string):Promise<void>};
  realmPlayer:Awaited<ReturnType<typeof bindRegencyFixturePlayer>>;
  readBytes(path:string,limit:number):Promise<Uint8Array>};
async function livePorts(input:Input):Promise<Ports> {
  const fixture=input.portfolioFixture;
  if(!fixture)throw new Error("The portfolio needs both owned player panels");
  const garden=panelTree.get(fixture.gardenPanelId);
  const ownedGarden={contextId:input.contextId,estateKey:fixture.gardenId};
  await assertOwnedGrimoirePanel(garden,ownedGarden);
  return {contextId,fs,status:input=>vcs.status(input),open:createOwnedHeadlessChannel,
    gardenPlayer:{
      pulse:before=>advanceOwnedGrimoirePanel(garden,ownedGarden,before),
      visit:(before,name)=>visitOwnedGrimoirePanel(garden,ownedGarden,before,name),
    },
    realmPlayer:await bindRegencyFixturePlayer(panelTree.get(fixture.regency.panelId),input.contextId,fixture.regency),
    readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)};
}
const maxBytes=24*1024;
const clock=(garden:GardenState)=>garden.day*4+garden.phase;

export async function prepareOpenPortfolio(input:Input,installed:Installed,injected?:Ports) {
  const ports=injected??await livePorts(input);
  const world=openPortfolioWorlds.find(entry=>entry.id===input.caseId);
  if(!world||!input.contextId||input.contextId!==ports.contextId)throw new Error("Portfolio assignment needs its owned Examples context");
  const fixture=input.portfolioFixture;
  if(!fixture || !/^natlang-garden-[a-f0-9-]{36}$/u.test(fixture.gardenId))
    throw new Error("Portfolio needs its exact assigned garden");
  const scope=fixture.gardenId.slice("natlang-garden-".length);
  const id=`portfolio-${scope}`;
  const gardenId=fixture.gardenId;
  const realmId=fixture.regency.realm;
  if(realmId!==`natlang-realm-${scope}`||fixture.regency.panelId===fixture.gardenPanelId)
    throw new Error("Portfolio player panels do not belong to the same fixture pair");
  const garden=installed.garden(gardenId);
  const realm=installed.realm.owner(realmId);
  const before=await ports.status();
  const index:PortfolioIndex={id,gardenId,realmId,title:"Examples demo portfolio",allowedHorizons:[1,2,3]};
  const initialGarden=await garden.read();
  const initialRealm=await realm.read();
  const gardenState=(view:GardenView)=>installed.readGarden(`${gardenId}:observed:${stableSha256Hex(view.garden)}`,view.garden);
  const realmState=(view:RealmView)=>installed.realm.readback(`${realmId}:saved:${stableSha256Hex(view.game)}`,view.game.world);
  if(initialGarden.pending||initialGarden.seated||gardenState(initialGarden).day!==1||gardenState(initialGarden).phase!==2||
    initialRealm.pending||initialRealm.painting||realmState(initialRealm).month!==0) throw new Error("Expected the untouched paired demos");

  const appliedGarden:{kind:"pulse"|"visit";resident?:string;before:number;after:number}[]=[];
  async function applyGarden(actions:GardenAction[]) {
    for(const action of actions) {
      if(typeof action!=="number") {
        const old=gardenState(await garden.read());
        const resident=old.residents.find(row=>row.id===action);
        if(!resident)throw new Error("The assigned resident is absent from the live garden");
        await ports.gardenPlayer.visit(old,resident.name);
        const view=await garden.read();
        const now=gardenState(view);
        if(view.pending||view.seated||clock(now)!==clock(old))throw new Error("A visit changed the observation clock");
        appliedGarden.push({kind:"visit",resident:action,before:clock(old),after:clock(now)});
        continue;
      }
      if(!Number.isInteger(action)||action<1||action>12)throw new Error("Invalid assigned quiet pulses");
      for(let step=0;step<action;step++) {
        const old=gardenState(await garden.read());
        await ports.gardenPlayer.pulse(old);
        const view=await garden.read();
        const now=gardenState(view);
        if(view.pending||view.seated||clock(now)!==clock(old)+1)throw new Error("Quiet pulse did not persist its phase without narration");
        appliedGarden.push({kind:"pulse",before:clock(old),after:clock(now)});
      }
    }
  }

  let seatRegistered=false;
  async function moveRealm(months:number) {
    if(!months)return;
    if(!seatRegistered) {
      const channel=await ports.open(input.contextId,"Paired demo inert fixture seat");
      await ports.realmPlayer.seat(channel);
      seatRegistered=true;
    }
    const old=realmState(await realm.read());
    const move=`paired-settlement-${crypto.randomUUID()}`;
    await ports.realmPlayer.advance(move,months);
    const result=await realm.read();
    if(result.pending?.id!==move||realmState(result).month!==old.month+months)
      throw new Error("Missing native portfolio realm advancement");
    await ports.realmPlayer.cancel();
    const saved=await realm.read();
    if(saved.pending||saved.painting||!isDeepStrictEqual(realmState(saved),realmState(result)))
      throw new Error("The quiet closure changed settled portfolio accounts");
  }
  await applyGarden(world.opening??[]);
  await moveRealm(world.realm??0);

  const directory=await ports.fs.mkdtemp("paired-demo-review");
  const policyPath=`${directory}/scope.md`;
  await ports.fs.writeFile(policyPath,"Private paired Examples evidence only. Capture the current card and honest saved or forecast provenance.");
  const beforePath=`${directory}/acceptance-before.md`;
  const currentPath=`${directory}/acceptance-current.md`;
  if(world.card) {
    await ports.fs.writeFile(beforePath,world.card.earlier);
    await ports.fs.writeFile(currentPath,world.card.current);
  }
  const originalFiles=new Set(await listOwnedScratchEntries(ports.fs));
  const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What can both installed Examples demos substantiate?"],
    sources:[{id:"private-pair",path:policyPath}]},ports.readBytes).scratchHandoffWrite;
  async function readCard(stage:"opening"|"current"):Promise<AcceptanceCard|null> {
    if(!world.card)return null;
    const path=stage==="opening"?beforePath:currentPath;
    const text=new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(path,4096));
    if(text!==(stage==="opening"?world.card.earlier:world.card.current))throw new Error("Acceptance card revision drifted");
    return {title:world.card.title,path,text,digest:sha256HexSyncText(text)};
  }

  async function readFrame(stage:"opening"|"current"):Promise<PortfolioFrame> {
    const [g,r,card]=await Promise.all([garden.read(),realm.read(),readCard(stage)]);
    if(g.pending||g.seated||r.pending||r.painting)throw new Error("A paired demo is not an owned quiet fixture");
    const gardenReadback=gardenState(g),realmReadback=realmState(r);
    return {portfolio:id,id:stableSha256Hex({id,gardenReadback,realmReadback,card}),garden:gardenReadback,realm:realmReadback,card};
  }
  const initial=await readFrame("opening");
  let running=false;
  let receipt:PortfolioNote|null=null;
  let projection:PortfolioProjection|null=null;
  const frames:PortfolioFrame[]=[];
  async function preview(months:Horizon,frame:PortfolioFrame):Promise<PortfolioProjection> {
    const value=await realm.preview(months);
    const currentRealm=await realm.read();
    if(!isDeepStrictEqual(value.basis,currentRealm.game.world)||!isDeepStrictEqual(frame,await readFrame("current")))
      throw new Error("Portfolio projection used a different native basis");
    const accounts=installed.realm.readback(`${realmId}:forecast:${frame.id}:${months}`,value.forecast);
    if(accounts.month!==frame.realm.month+months)throw new Error("Incorrect paired forecast horizon");
    return {portfolio:id,basis:frame.id,months,accounts};
  }

  const planFor=(frame:PortfolioFrame):PortfolioPlan=>({...world.plan,criteriaBasis:frame.card?.digest??null});
  const gardenRequest=(criterion:GardenCriterion,opening:PortfolioFrame,current:PortfolioFrame)=>
    criterion.kind==="habitat"?{kind:"habitat",check:criterion.check,current:current.garden}:
      {kind:"transition",check:criterion.check,before:opening.garden,after:current.garden};
  function realmRequest(criterion:RealmCriterion,opening:PortfolioFrame,current:PortfolioFrame,preview:PortfolioProjection|null) {
    const after=criterion.basis==="saved"?current.realm:preview?.accounts;
    if(!after)return null;
    return criterion.kind==="settlement"?{kind:"settlement",check:criterion.check,current:after}:
      {kind:"compare",check:criterion.check,before:criterion.basis==="saved"?opening.realm:current.realm,after,
        basis:criterion.basis==="saved"?"observed":"forecast",assertCommitted:criterion.assertCommitted};
  }
  function evaluate(opening:PortfolioFrame,current:PortfolioFrame,preview:PortfolioProjection|null) {
    const gardenWitness=world.plan.garden.map(criterion=>{
      const request=gardenRequest(criterion,opening,current);
      const result:GardenResult={criterion,review:installed.reviewGarden(request)};
      return {request,result};
    });
    const realmWitness=world.plan.realm.map(criterion=>{
      const request=realmRequest(criterion,opening,current,preview);
      const result:RealmResult={criterion,review:request?installed.realm.review(request):
        {decision:"not-observed",finding:"missing-preview",evidenceIds:[]}};
      return {request,result};
    });
    const gardenResults=gardenWitness.map(item=>item.result);
    const realmResults=realmWitness.map(item=>item.result);
    const decisions=[...gardenResults,...realmResults].map(item=>item.review.decision);
    const status=decisions.includes("contradicted")?"blocked":decisions.includes("not-observed")?"incomplete":"ready";
    const write=world.plan.note==="decision"||world.plan.note==="ready-only"&&status==="ready";
    return {gardenWitness,realmWitness,gardenResults,realmResults,status,write};
  }

  const body=(report:PortfolioReport)=>JSON.stringify({scope:"private-local",portfolio:id,opening:report.opening.id,current:report.current.id,
    acceptedCard:report.current.card,forecast:report.projection,readings:{garden:report.garden,realm:report.realm},decision:report.decision},null,2);
  let stagedText:string|null=null;
  const services={
    demoPortfolioIndex:{async list(){return structuredClone(index);}},
    demoPortfolioState:{async read(portfolio:string){
      if(portfolio!==id)return null;
      if(frames.length>=2)return structuredClone(frames.at(-1)!);
      if(running)return null;
      running=true;
      try {
        const stage=frames.length?"current":"opening";
        if(stage==="current") {
          await applyGarden(world.garden);
          await moveRealm(world.drift??0);
        }
        const value=await readFrame(stage);
        frames.push(value);
        return structuredClone(value);
      } finally {running=false;}
    }},
    demoPortfolioForecast:{async preview(portfolio:string,basis:string,months:Horizon){
      if(portfolio!==id||!frames[1]||basis!==frames[1].id||!index.allowedHorizons.includes(months)||projection||running)
        return null;
      running=true;
      try {
        if(!isDeepStrictEqual(frames[1],await readFrame("current")))return null;
        projection=await preview(months,frames[1]);
        return structuredClone(projection);
      } finally {running=false;}
    }},
    demoPortfolioHandoff:{async stage(report:PortfolioReport){
      if(!report?.decision?.write||!report.decision.explanation||report.decision.explanation.length>650||receipt||
        running||world.plan.note==="none"||!frames[1]||report.note!==null||
        !isDeepStrictEqual(report.opening,frames[0])||!isDeepStrictEqual(report.current,frames[1])||
        !isDeepStrictEqual(report.plan,planFor(frames[1]))||!isDeepStrictEqual(report.projection,projection))return null;
      running=true;
      try {
        const latest=await readFrame("current");
        if(!isDeepStrictEqual(latest,frames[1])||latest.card&&!report.plan.criteriaBasis)return null;
        const prepared=evaluate(frames[0],latest,projection);
        if(!prepared.write||prepared.status!==report.decision.status||
          !isDeepStrictEqual(report.garden,prepared.gardenResults)||!isDeepStrictEqual(report.realm,prepared.realmResults))return null;
        const status=await ports.status();
        if(status.mainEventId!==before.mainEventId||!isDeepStrictEqual(status.workingHead,before.workingHead))return null;
        const text=body(report);
        if(new TextEncoder().encode(text).length>maxBytes)return null;
        const saved=(stagedText=text,await writer.stage(text));
        if(!saved)return null;
        receipt={path:saved.path,digest:sha256HexSyncText(text),portfolio:id,basis:latest.id};
        return structuredClone(receipt);
      } finally {running=false;}
    }},
  };

  async function verify(raw:unknown,invocation?:InvocationObservations) {
    const report=raw as PortfolioReport|null;
    const outcome=report;
    const [opening,current]=frames;
    const final=await readFrame("current");
    const findings=opening&&current?evaluate(opening,current,projection):null;
    const decision=outcome?.decision;
    const nativeProjection=projection&&current?await preview(projection.months,current):null;
    const g0=gardenState(initialGarden);
    let expectedClock=clock(g0);
    const visits=new Map<string,Set<number>>();
    const expectedActions:(number|string)[]=[];
    for(const action of [...(world.opening??[]),...world.garden]) {
      if(typeof action==="number") {
        expectedClock+=action;
        for(let step=0;step<action;step++)expectedActions.push(1);
      } else {
        const days=visits.get(action)??new Set<number>();
        days.add(Math.floor(expectedClock/4));
        visits.set(action,days);
        expectedActions.push(action);
      }
    }
    const facts=final.garden.residents.every(resident=>{
      const seed=g0.residents.find(row=>row.id===resident.id);
      if(!seed)return false;
      const days=[...(visits.get(resident.id)??[])];
      const gained=days.filter(day=>day!==seed.lastVisit).length;
      return Math.abs(resident.attachment-Math.min(1,seed.attachment+0.1*gained))<1e-8&&
        resident.lastVisit===(days.at(-1)??seed.lastVisit);
    });
    const changesAgree=clock(final.garden)===expectedClock&&facts&&final.garden.residents.length===g0.residents.length&&
      isDeepStrictEqual(expectedActions,appliedGarden.map(entry=>entry.kind==="pulse"?1:entry.resident));
    const saved=await ports.status();
    const files=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!originalFiles.has(name));
    const artifact=receipt?new TextDecoder("utf-8",{fatal:true}).decode(await ports.readBytes(receipt.path,maxBytes)):null;
    const other=crypto.randomUUID();
    const checks={
      returnedArtifactReceipt:isDeepStrictEqual(outcome?.note,receipt),
      exactOwnedPair:index.gardenId.slice("natlang-garden-".length)===index.realmId.slice("natlang-realm-".length)&&
        opening?.portfolio===id&&current?.portfolio===id,
      independentlyReadPortfolioCards:frames.length===2&&isDeepStrictEqual(opening.card,await readCard("opening"))&&
        isDeepStrictEqual(current.card,await readCard("current"))&&(!world.card||opening.card?.digest!==current.card?.digest),
      settledPortfolioGarden:changesAgree&&frames.length===2&&isDeepStrictEqual(opening.garden,initial.garden)&&
        isDeepStrictEqual(current.garden,final.garden),
      settledPortfolioRealm:frames.length===2&&opening.realm.month===(world.realm??0)&&
        current.realm.month===(world.realm??0)+(world.drift??0)&&isDeepStrictEqual(opening.realm,initial.realm)&&
        isDeepStrictEqual(final.realm,current.realm),
      exactCurrentPortfolioPlan:!!current&&frames.length===2,
      exactPortfolioForecast:isDeepStrictEqual(outcome?.projection,projection)&&isDeepStrictEqual(nativeProjection,projection)&&
        (projection?.months??null)===world.plan.months,
      exactInstalledGardenCriteria:!!findings&&isDeepStrictEqual(outcome?.garden,findings.gardenResults)&&
        isDeepStrictEqual(findings.gardenResults.map(row=>row.review.decision),world.readings[0]),
      exactInstalledRealmCriteria:!!findings&&isDeepStrictEqual(outcome?.realm,findings.realmResults)&&
        isDeepStrictEqual(findings.realmResults.map(row=>row.review.decision),world.readings[1]),
      groundedPortfolioDecision:!!findings&&decision?.status===world.status&&decision.status===findings.status&&
        decision.write===findings.write&&typeof decision.explanation==="string"&&decision.explanation.length<=650&&
        world.words.every(word=>decision.explanation.toLowerCase().includes(word.toLowerCase())),
      verifiedPrivatePortfolioHandoff:findings?.write?!!receipt&&!!artifact&&files.length===1&&
        receipt.path===`/.tmp/${files[0]}/handoff.json`&&receipt.basis===final.id&&artifact===stagedText&&
        receipt.digest===sha256HexSyncText(artifact):
        receipt===null&&files.length===0,
      preservedPortfolioWorkspace:saved.mainEventId===before.mainEventId&&isDeepStrictEqual(saved.workingHead,before.workingHead),
      rejectedPortfolioRetarget:await services.demoPortfolioState.read(other)===null&&
        await services.demoPortfolioForecast.preview(other,final.id,1)===null&&
        await services.demoPortfolioHandoff.stage({decision:{write:true}} as PortfolioReport)===null,
    };
    const contract:SemanticOutcomeContract={"effects": {"checks": ["exactOwnedPair", "independentlyReadPortfolioCards", "settledPortfolioGarden", "settledPortfolioRealm", "exactCurrentPortfolioPlan", "verifiedPrivatePortfolioHandoff", "preservedPortfolioWorkspace", "rejectedPortfolioRetarget"], "rationale": "Native observations, scoped authority, retained bytes and protected state establish application effects independently."}, "returnedValue": {"checks": ["exactPortfolioForecast", "exactInstalledGardenCriteria", "exactInstalledRealmCriteria", "groundedPortfolioDecision"], "required": true, "rationale": "The returned domain findings are required for queries; completed mutations are established independently."}, "incidentalValues": {"checks": ["returnedArtifactReceipt"], "rationale": "Receipt echoes are optional presentation of independently verified native artifacts."}};
    return assessObservedApplicationOutcome({contextId:input.contextId,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      index,frames,plan:current?planFor(current):null,projection,garden:findings?.gardenWitness??[],realm:findings?.realmWitness??[],
      decision:decision??null,note:receipt,artifact},contract,raw,invocation);
  }

  async function qualify() {
    await services.demoPortfolioIndex.list();
    const opening=await services.demoPortfolioState.read(id),current=await services.demoPortfolioState.read(id);
    if(!opening||!current)throw new Error("Both owned portfolio frames are required");
    const plan=planFor(current);
    if(plan.months)await services.demoPortfolioForecast.preview(id,current.id,plan.months);
    const expected=evaluate(opening,current,projection);
    const decision:PortfolioDecision={status:world.status,write:expected.write,explanation:world.words.join(" / ")};
    const report:PortfolioReport={plan,opening,current,projection,garden:expected.gardenResults,realm:expected.realmResults,decision,note:null};
    if(decision.write)report.note=await services.demoPortfolioHandoff.stage(report);
    return verify({projection:report.projection,garden:report.garden,realm:report.realm,decision:report.decision,note:report.note});
  }
  return {services,verify,qualify};
}
