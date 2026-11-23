import {isDeepStrictEqual} from "node:util";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {createWorkspaceStateClient} from "@vibestudio/service-schemas/clients/workspaceStateClient";
import {mainRpcMethod} from "@vibestudio/service-schemas/mainRpc";
import {decodePanelStateArgs} from "@vibestudio/shared/panelStateArgs";
import {contextId,fs,openPanel,rpc,vcs,type PanelHandle} from "@workspace/runtime";
import {bindAuthorityReview} from "@workspace-skills/capabilities/workflow";
import {bindScratchHandoff} from "@workspace-skills/scratch-handoff-bindings";
import type {LaunchAuthorityReport,LaunchAuthorityRequest,LaunchDecision,LaunchEffect,LaunchIndex,LaunchNote,LaunchPatch,
  LaunchPlan,LaunchReport,LaunchSnapshot,LaunchState,LaunchVerdict} from "@workspace-skills/open-panel-launch-state/types";
import {readWorkspaceBytes} from "./scratch-handoff-managed.js";
import {listOwnedScratchEntries} from "./owned-scratch-entries.js";
import {openLaunchStateWorlds,type OpenLaunchStateWorld} from "./open-goal-launch-state-worlds.js";

const source="panels/launch-state-fixture";
const stateAuthority="workspace.runtime-state.manage";
type Basis=Omit<LaunchSnapshot,"digest">;
type Panel=Pick<PanelHandle,"id"|"stateArgs"|"archive"|"navigate">;
type Binding=ReturnType<typeof bindAuthorityReview>;
type Ports={contextId:string|null;fs:typeof fs;status:typeof vcs.status;
  open:(owner:string,state:LaunchState)=>Promise<Panel>;
  state:(panelId:string)=>Promise<Basis|null>;
  readBytes:(path:string,max:number)=>Promise<Uint8Array>;
  bindAuthority:typeof bindAuthorityReview};

function livePorts():Ports {
  const client=createWorkspaceStateClient((_service,method,args)=>
    rpc.call("main",mainRpcMethod(`workspace-state.${method}`),args));
  return {contextId,fs,status:input=>vcs.status(input),
    open:(owner,state)=>openPanel(source,{contextId:owner,ref:`ctx:${owner}`,parentId:null,focus:false,stateArgs:state}),
    async state(panelId){
      const detail=await client.getPanelDetail(panelId);
      if(!detail)return null;
      const {currentHistory,entity,slot}=detail;
      if(currentHistory.source!==source||slot.current_entry_key!==currentHistory.entry_key||!entity.activeBuildKey)
        throw new Error("Native launch slot is missing its owned active build");
      return {panelId,entryKey:currentHistory.entry_key,entityId:entity.id,contextId:currentHistory.context_id,
        buildKey:entity.activeBuildKey,state:decodePanelStateArgs(currentHistory.state_args) as LaunchState};
    },
    readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max),bindAuthority:bindAuthorityReview};
}

function stable(value:unknown):unknown {
  if(Array.isArray(value))return value.map(stable);
  if(value!==null&&typeof value==="object")
    return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,stable(entry)]));
  return value;
}
function snapshot(basis:Basis):LaunchSnapshot {
  return {...basis,digest:sha256HexSyncText(JSON.stringify(stable(basis)))};
}
function sameIdentity(a:LaunchSnapshot,b:LaunchSnapshot) {
  return a.panelId===b.panelId&&a.entryKey===b.entryKey&&a.entityId===b.entityId&&a.contextId===b.contextId&&
    a.buildKey===b.buildKey&&a.state.owner===b.state.owner;
}
function overlaps(a:unknown,b:unknown,patch:LaunchPatch) {
  const old=a&&typeof a==="object"?a as LaunchPatch:{},after=b&&typeof b==="object"?b as LaunchPatch:{};
  return Object.entries(patch).some(([key,change])=>change&&typeof change==="object"&&!Array.isArray(change)?
    overlaps(old[key],after[key],change as LaunchPatch):!isDeepStrictEqual(old[key],after[key]));
}
function setupState(title:string,owner:string):LaunchState {
  return {title,owner,label:"temporary record",mode:"summary",count:3,
    settings:{order:"asc",side:"west",pins:["current","review"],lastNote:"outdated"}};
}
function plainExpected(state:LaunchState,world:OpenLaunchStateWorld):LaunchState {
  // A small coordinate oracle independent of the production's recursive merge/validate path.
  const expected=structuredClone(state);
  for(const [key,value] of Object.entries(world.patch)){
    if(key==="settings"){
      for(const [name,entry] of Object.entries(value as LaunchPatch)){
        if(entry===null) delete (expected.settings as LaunchPatch)[name];
        else (expected.settings as LaunchPatch)[name]=structuredClone(entry);
      }
    }else if(value===null) delete (expected as LaunchPatch)[key];
    else (expected as LaunchPatch)[key]=key==="count"?Number(value):structuredClone(value);
  }
  return expected;
}

export async function prepareLaunchState(input:{contextId:string;caseId:string},ports=livePorts()) {
  const world=openLaunchStateWorlds.find(row=>row.id===input.caseId);
  if(!world||!input.contextId||ports.contextId!==input.contextId)throw new Error("Launch state is restricted to its owned context");
  const owner=input.contextId;
  const initial=await ports.status();
  const active=await ports.open(owner,setupState(world.title,"current-operator"));
  let alternate:Panel;
  try {
    alternate=await ports.open(owner,{...setupState(world.title,"archive-operator"),label:"newer archived label"});
  } catch(error){
    await active.archive();
    throw error;
  }
  let closed=false;
  async function close(){
    if(closed)return;
    closed=true;
    const results=await Promise.allSettled([active.archive(),alternate.archive()]);
    const failures=results.filter(result=>result.status==="rejected");
    if(failures.length)throw new AggregateError(failures.map(result=>result.reason),"Could not archive local launch slots");
  }
  async function native(panel:Panel,joinHandle=false){
    const row=await ports.state(panel.id);
    if(!row||row.panelId!==panel.id||row.contextId!==owner)throw new Error("Native launch slot escaped the assigned context");
    if(joinHandle&&!isDeepStrictEqual(await panel.stateArgs.get(),row.state))
      throw new Error("PanelHandle state and workspace owner snapshot disagree");
    return snapshot(row);
  }

  try {
    const [baseline,archive]=await Promise.all([native(active,true),native(alternate,true)]);
    const index:LaunchIndex=[{panelId:alternate.id,title:archive.state.title,purpose:"archive"},
      {panelId:active.id,title:baseline.state.title,purpose:"active"}];
    const plan:LaunchPlan={panelId:active.id,direction:world.policy==="readonly"?"read":world.policy==="test-rejection"?"test":"write",
      retain:world.note===true,patch:world.patch};
    const frames:LaunchSnapshot[]=[];
    let busy=false;
    let binding:Binding|null=null;
    let witness:Awaited<ReturnType<Binding["services"]["assignedAuthorityRead"]["preflight"]>>|null=null;
    let effect:LaunchEffect|null=null,readback:LaunchSnapshot|null=null,handoff:LaunchNote|null=null;
    const scratch=await ports.fs.mkdtemp("launch-state");
    const policy=`${scratch}/change-scope.txt`;
    await ports.fs.writeFile(policy,"Only retain a local note about the selected active launch entry and its exact saved scope.");
    const scratchBefore=new Set(await listOwnedScratchEntries(ports.fs));
    const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What did the current launch-state owner save?"],
      sources:[{id:"launch-scope",path:policy}]},ports.readBytes).scratchHandoffWrite;
    const body=(report:LaunchReport)=>JSON.stringify({visibility:"private-local",opening:report.opening,current:report.current,
      readback:report.readback,effect:report.effect,result:report.result});
    const authorized=()=>frames.length===2&&plan.direction!=="read"&&sameIdentity(frames[0],frames[1])&&
      !overlaps(frames[0].state,frames[1].state,plan.patch);

    const services={
      launchStateRead:{
        async enumerate(){return structuredClone(index);},
        async read(panelId:string){
          if(panelId!==active.id)return null;
          if(frames.length>=2)return structuredClone(frames.at(-1)!);
          if(busy)return null;
          busy=true;
          try {
            if(frames.length===1&&world.advance)await active.stateArgs.patch(world.advance);
            if(frames.length===1&&world.replaceEntry)
              await active.navigate(source,{contextId:owner,ref:`ctx:${owner}`,stateArgs:{...baseline.state,label:"owner-reopened"}});
            const row=await native(active,true);
            if(world.replaceEntry&&frames.length===1&&row.entryKey===baseline.entryKey)
              throw new Error("The requested owned navigation did not replace its launch entry");
            frames.push(row);return structuredClone(row);
          }finally{busy=false;}
        },
        async bind(panelId:string,basis:string,patch:LaunchPatch){
          if(binding||busy||panelId!==active.id||!authorized()||frames[1].digest!==basis||!isDeepStrictEqual(patch,plan.patch))return null;
          binding=ports.bindAuthority({goal:world.goal,operations:[{id:crypto.randomUUID(),label:"Exact native launch-state patch",
            service:"workspace-state",method:"slot.patchCurrentStateArgs",args:[active.id,patch]}],
            ceiling:[{capability:stateAuthority,resourceKey:stateAuthority}]});
          return structuredClone(binding.request);
        },
        async seal(panelId:string){
          if(panelId!==active.id||frames.length!==2||busy)return null;
          readback=await native(active);return structuredClone(readback);
        },
      },
      assignedAuthorityRead:{async preflight(operationId:string){
        if(witness||!binding||operationId!==binding.request.operations[0].id)throw new Error("Inspect only this exact launch patch");
        witness=await binding.services.assignedAuthorityRead.preflight(operationId);
        return structuredClone(witness);
      }},
      launchStateWrite:{
        async patch(panelId:string,basis:string,patch:LaunchPatch){
          if(!witness||witness.decision!=="allowed"||effect||busy||!authorized()||panelId!==active.id||frames[1].digest!==basis||
            !isDeepStrictEqual(patch,plan.patch))return null;
          busy=true;
          try{
            const saved=await native(active);
            if(saved.digest!==basis) {
              effect={panelId,basis,kind:"stale",state:null,message:"Current native slot basis changed before the patch."};
            }else{
              try{
                const state=await active.stateArgs.patch(patch) as LaunchState;
                effect={panelId,basis,kind:"saved",state,message:null};
              }catch(error){
                if(!(error instanceof Error))throw error;
                const code=(error as Error&{code?:string}).code;
                if(code!=="PANEL_STATE_ARGS_CONFLICT"&&!/Invalid stateArgs/u.test(error.message))throw error;
                effect={panelId,basis,kind:code==="PANEL_STATE_ARGS_CONFLICT"?"stale":"invalid",state:null,message:error.message.slice(0,400)};
              }
            }
            return structuredClone(effect);
          }finally{busy=false;}
        },
        async stage(report:LaunchReport){
          if(!world.note||!readback||handoff||busy||!report||report.handoff!==null||
            !isDeepStrictEqual(report.plan,plan)||!isDeepStrictEqual(report.opening,frames[0])||
            !isDeepStrictEqual(report.current,frames[1])||!isDeepStrictEqual(report.effect,effect)||
            !isDeepStrictEqual(report.readback,readback)||report.result?.status!==world.outcome||
            typeof report.result.summary!=="string"||!report.result.summary.trim()||report.result.summary.length>650)return null;
          busy=true;
          try {
            if(!isDeepStrictEqual(await native(active),readback))return null;
            const payload=body(report);
            const staged=await writer.stage(payload);
            if(!staged)return null;
            handoff={path:staged.path,digest:sha256HexSyncText(payload)};
            return structuredClone(handoff);
          }finally{busy=false;}
        },
      },
    };

    async function verify(raw:unknown){
      const value=raw as {status?:string;skill?:string;outcome?:LaunchReport}|null;
      const report=value?.status==="workspace-skill-reviewed"&&value.skill==="panelLaunchState"?value.outcome:undefined;
      const [final,archiveAfter,status]=await Promise.all([native(active,true),native(alternate,true),ports.status()]);
      const [opening,current]=frames;
      const shouldAttempt=world.outcome==="applied"||world.outcome==="rejected";
      const expected=world.outcome==="applied"&&current?plainExpected(current.state,world):current?.state;
      const written=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!scratchBefore.has(name));
      const artifact=handoff?new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(handoff.path,20_000)):null;
      const effectProof=effect as LaunchEffect|null,authorityWitness=witness as Awaited<ReturnType<Binding["services"]["assignedAuthorityRead"]["preflight"]>>|null;
      const authorityRequest=(binding as Binding|null)?.request??null;
      const checks={
        exactLaunchSlot:isDeepStrictEqual(report?.plan,plan)&&frames.length===2&&isDeepStrictEqual(opening,baseline)&&
          isDeepStrictEqual(report?.opening,opening)&&isDeepStrictEqual(report?.current,current),
        reconciledLaunchScope:!!current&&(!sameIdentity(opening,current))===Boolean(world.replaceEntry)&&
          report?.decision.attempt===shouldAttempt&&typeof report.decision.reason==="string"&&!!report.decision.reason.trim(),
        exactLaunchPreflight:shouldAttempt?!!authorityRequest&&authorityWitness?.decision==="allowed"&&
          authorityWitness.operationId===authorityRequest.operations[0].id&&
          isDeepStrictEqual(report?.preflight?.request,authorityRequest)&&report?.preflight?.report.status==="eligible"&&
          isDeepStrictEqual(report.preflight.report.reviews[0]?.observation,authorityWitness):report?.preflight===null&&authorityWitness===null,
        exactNativePatchResult:shouldAttempt?!!effectProof&&isDeepStrictEqual(report?.effect,effectProof)&&effectProof.basis===current?.digest&&
          (world.outcome==="applied"?effectProof.kind==="saved"&&isDeepStrictEqual(effectProof.state,expected):
            effectProof.kind==="invalid"&&effectProof.state===null):effectProof===null&&report?.effect===null,
        independentLaunchReadback:!!readback&&isDeepStrictEqual(final,readback)&&isDeepStrictEqual(report?.readback,final)&&
          !!current&&sameIdentity(current,final)&&isDeepStrictEqual(final.state,expected),
        exactLaunchDecision:report?.result?.status===world.outcome&&typeof report.result.summary==="string"&&
          !!report.result.summary.trim()&&report.result.summary.length<=650,
        protectedLaunchSiblings:isDeepStrictEqual(archive,archiveAfter)&&isDeepStrictEqual(status,initial),
        exactPrivateLaunchNote:world.note?!!report&&!!artifact&&!!handoff&&written.length===1&&
          handoff.path===`/.tmp/${written[0]}/handoff.json`&&artifact===body(report)&&handoff.digest===sha256HexSyncText(artifact)&&
          isDeepStrictEqual(handoff,report.handoff):handoff===null&&report?.handoff===null&&written.length===0,
        rejectedLaunchRetarget:await services.launchStateRead.read(alternate.id)===null&&
          await services.launchStateRead.seal(alternate.id)===null&&await services.launchStateWrite.patch(alternate.id,baseline.digest,plan.patch)===null,
      };
      await close();
      return {contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),index,plan,frames,readback,
        request:authorityRequest,witness:authorityWitness,decision:report?.decision??null,effect:effectProof,result:report?.result??null,handoff,artifact};
    }
    async function qualify(){
      await services.launchStateRead.enumerate();
      const opening=await services.launchStateRead.read(active.id),current=await services.launchStateRead.read(active.id);
      if(!opening||!current)throw new Error("Independent opening and current launch state are required");
      const decision:LaunchDecision={attempt:authorized(),reason:"Checked the exact current slot and authorized patch coordinates."};
      let preflight:LaunchReport["preflight"]=null,receipt:LaunchEffect|null=null;
      if(decision.attempt){
        const request=await services.launchStateRead.bind(active.id,current.digest,plan.patch) as LaunchAuthorityRequest|null;
        if(!request)throw new Error("Could not bind exact launch authorization");
        const observation=await services.assignedAuthorityRead.preflight(request.operations[0].id);
        const protectedLeaves=observation.leaves.filter(row=>row.tier!=="open").map(({capability,resourceKey})=>({capability,resourceKey}));
        const report:LaunchAuthorityReport={status:"eligible",held:[],protectedLeaves,
          reviews:[{observation,outside:[],disposition:"eligible"}]};
        preflight={request,report};
        receipt=await services.launchStateWrite.patch(active.id,current.digest,plan.patch);
      }
      const persisted=await services.launchStateRead.seal(active.id);
      if(!persisted)throw new Error("Missing independent workspace-owner readback");
      const result:LaunchVerdict={status:world.outcome,summary:"Read the outcome from the native persisted launch entry."};
      const report:LaunchReport={plan,opening,current,decision,preflight,effect:receipt,readback:persisted,result,handoff:null};
      if(world.note)report.handoff=await services.launchStateWrite.stage(report);
      return verify({status:"workspace-skill-reviewed",skill:"panelLaunchState",outcome:report});
    }
    return {services,verify,qualify,close};
  }catch(error){
    await close();
    throw error;
  }
}
