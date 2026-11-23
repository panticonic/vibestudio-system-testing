import {authenticDiscoveryEvidence} from "./discovery-evidence.js";
import {isDeepStrictEqual} from "node:util";
import {sha256HexSyncText,stableSha256Hex} from "@vibestudio/content-addressing";
import type {CatalogEntry,CatalogHit} from "@vibestudio/service-schemas/docs";
import {mainRpcMethods} from "@vibestudio/service-schemas/mainRpc";
import {contextId,fs,rpc,runtime,vcs,type VcsClient} from "@workspace/runtime";
import {bindScratchHandoff} from "@workspace-skills/scratch-handoff-bindings";
import type {IntentAction,IntentDescription,IntentHit,IntentNote,IntentNotice,IntentObservation,IntentOutcome,IntentPlan,
  IntentReport,IntentSearch} from "@workspace-skills/open-intent-discovery/types";
import {listOwnedScratchEntries} from "./owned-scratch-entries.js";
import {readWorkspaceBytes} from "./scratch-handoff-managed.js";
import {openIntentDiscoveryWorlds,type IntentNeed} from "./open-goal-intent-discovery-worlds.js";

const methods:Record<IntentNeed,string>={
  workspace:"service:vcs.status",
  note:"service:fs.readBytes",
  skill:"service:workspace.readSkill",
  worker:"service:runtime.listEntities",
};
const nativeSource="workers/local-messaging-fixture";
const max=16_000;
type LiveEntity={id:string;source:string;key:string;contextId:string;kind:string};
type SkillRow={name:string;dirPath:string;skillPath:string;description:string};
type Ports={contextId:string|null;fs:typeof fs;vcs:Pick<VcsClient,"status"|"edit">;
  catalog:{
    search(query:string):Promise<CatalogHit[]>;
    describe(id:string):Promise<CatalogEntry|null>;
    getSchema(id:string):Promise<{argsSchema?:unknown;returnsSchema?:unknown}|null>;
  };
  skills():Promise<SkillRow[]>;
  readSkill(path:string):Promise<string|null>;
  listEntities():Promise<LiveEntity[]>;
  createWorker(owner:string,key:string):Promise<{id:string;contextId:string}>;
  retire(id:string):Promise<unknown>;
  readBytes(path:string,max:number):Promise<Uint8Array>;
};

function livePorts():Ports {
  return {contextId,fs,vcs,
    catalog:{
      search:query=>rpc.call("main",mainRpcMethods["docs.search"],[query,{surface:"service",limit:8}]),
      describe:id=>rpc.call("main",mainRpcMethods["docs.describe"],[id]),
      getSchema:id=>rpc.call("main",mainRpcMethods["docs.getSchema"],[id]),
    },
    skills:()=>rpc.call("main",mainRpcMethods["workspace.listSkills"],[]),
    readSkill:path=>rpc.call("main",mainRpcMethods["workspace.readSkill"],[path]),
    listEntities:()=>rpc.call("main",mainRpcMethods["runtime.listEntities"],[{kind:"do"}]),
    async createWorker(owner,key){
      const actor=await runtime.createEntity({kind:"do",execution:{surface:"code",source:nativeSource},
        className:"LocalMessagingProbeDO",key,contextId:owner});
      if(actor.kind!=="do"||actor.contextId!==owner)throw new Error("Unexpected runtime entity ownership");
      return {id:actor.id,contextId:actor.contextId};
    },
    retire:id=>runtime.retireEntity({id}),readBytes:(path,max)=>readWorkspaceBytes(rpc,path,max)};
}

function overall(evidence:IntentObservation[]):IntentOutcome["status"] {
  const found=evidence.filter(row=>row.status==="observed").length;
  return found===evidence.length?"observed":found>0?"partial":"unavailable";
}

export async function prepareIntentDiscovery(input:{contextId:string;caseId:string},ports=livePorts()){
  const world=openIntentDiscoveryWorlds.find(row=>row.id===input.caseId);
  if(!world||!ports.contextId||input.contextId!==ports.contextId)throw new Error("Intent discovery requires the exact owned workspace");
  const owner=input.contextId;
  const initial=await ports.vcs.status();
  if(initial.contextId!==owner||!initial.clean||initial.integrating.length)throw new Error("Intent discovery needs a fresh owned context");
  if(world.dirty)
    await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:initial.workingHead,
      intentSummary:"Retain an independent local draft for the work-state question",
      changes:[{kind:"repository-create",repoPath:`projects/intent-draft-${crypto.randomUUID()}`,
        files:[{path:"operator-note.txt",mode:0o644,content:{kind:"text",text:"Uncommitted current working state"}}]}]});
  const before=await ports.vcs.status();
  const scratch=await ports.fs.mkdtemp("intent-discovery");
  const notePath=`${scratch}/handoff.txt`;
  if(typeof world.note==="string")await ports.fs.writeFile(notePath,world.note);
  const workerKey="intent-"+crypto.randomUUID();
  const managed:Awaited<ReturnType<Ports["createWorker"]>>[]=[];
  let closed=false;
  async function close(){
    if(closed)return;
    closed=true;
    const settled=await Promise.allSettled(managed.map(row=>ports.retire(row.id)));
    const failures=settled.filter(row=>row.status==="rejected");
    if(failures.length)throw new AggregateError(failures.map(row=>row.reason),"Could not retire owned intent-discovery probes");
  }
  try{
    if(world.worker)managed.push(await ports.createWorker(owner,workerKey+"-older"));
    if(world.worker==="running")managed.push(await ports.createWorker(owner,workerKey));
    const skillName=world.skill==="absent"?`retired-${world.id}`:world.skill??"sandbox";
    const notice:IntentNotice={title:world.title,contextId:owner,notePath,skillName,workerKey};
    const noticePath=`${scratch}/candidate-notice.json`;
    await ports.fs.writeFile(noticePath,JSON.stringify(notice));
    const writable=world.private===true;
    const existing=new Set(await listOwnedScratchEntries(ports.fs));
    const writer=bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What exact local observations answer the request?"],
      sources:[{id:"candidate-notice",path:noticePath}]},ports.readBytes).scratchHandoffWrite;
    const scopeFor:Record<IntentNeed,string>={workspace:owner,note:notePath,skill:skillName,worker:workerKey};
    const required=world.needs.map(need=>({need,methodId:methods[need],scope:scopeFor[need]}));
    const searchLog:{query:string;hits:IntentHit[]}[]=[];
    const descriptions=new Map<string,IntentDescription>();
    const inspected:IntentObservation[]=[];
    const busy=new Set<string>();
    let staging=false;
    let handoff:IntentNote|null=null;
    const body=(result:IntentReport)=>JSON.stringify({visibility:"private-local",notice:result.notice,plan:result.plan,
      evidence:result.evidence,outcome:result.outcome});

    async function rawNotice(){
      const raw=new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(noticePath,4096));
      return JSON.parse(raw) as IntentNotice;
    }
    async function description(id:string):Promise<IntentDescription|null>{
      const [entry,schema]=await Promise.all([ports.catalog.describe(id),ports.catalog.getSchema(id)]);
      if(entry?.id!==id||!schema||!isDeepStrictEqual(entry.argsSchema,schema.argsSchema)||
        !isDeepStrictEqual(entry.returnsSchema,schema.returnsSchema))return null;
      return {id,name:entry.qualifiedName,description:entry.description?.slice(0,260)??"",digest:stableSha256Hex({entry,schema})};
    }
    async function observation(need:IntentNeed):Promise<IntentObservation>{
      const methodId=methods[need],scope=scopeFor[need];
      const absent={methodId,scope,status:"missing" as const,coordinate:null,details:[],digest:null};
      const seen=(coordinate:string,details:string[],raw:unknown):IntentObservation=>({methodId,scope,coordinate,details,status:"observed",digest:stableSha256Hex(raw)});
      switch(need){
        case "workspace":{
          const state=await ports.vcs.status({contextId:owner});
          if(state.contextId!==owner)throw new Error("Wrong scoped working state");
          const id=state.workingHead.kind==="event"?state.workingHead.eventId:state.workingHead.applicationId;
          return seen(id,[state.clean?"clean":"uncommitted",state.committed.eventId,state.mainEventId],state);
        }
        case "note":{
          if(!await ports.fs.exists(notePath))return absent;
          const raw=new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(notePath,4096));
          return seen(notePath,[raw],raw);
        }
        case "skill":{
          const rows=(await ports.skills()).filter(row=>row.name===skillName&&row.skillPath===`${row.dirPath}/SKILL.md`);
          if(!rows.length)return absent;
          if(rows.length!==1)throw new Error("Ambiguous exact installed guide");
          const [row]=rows,raw=await ports.readSkill(row.dirPath);
          if(raw===null||new TextEncoder().encode(raw).length>120_000)throw new Error("Unverifiable installed guide");
          return seen(row.skillPath,[row.description.slice(0,150)],{row,raw});
        }
        case "worker":{
          const matches=(await ports.listEntities()).filter(row=>row.contextId===owner&&row.kind==="do"&&row.source===nativeSource&&row.key===workerKey);
          if(!matches.length)return absent;
          if(matches.length!==1)throw new Error("Duplicate exact local worker identity");
          const [row]=matches;
          const id={id:row.id,source:row.source,key:row.key,contextId:row.contextId};
          return seen(row.id,[row.source,row.key],id);
        }
      }
    }
    function planMatches(plan:IntentPlan|undefined){
      return plan?.retain===writable&&plan.actions.length===required.length&&
        required.every(row=>plan.actions.filter(action=>action.methodId===row.methodId&&action.scope===row.scope).length===1);
    }
    function searchProof(search:IntentSearch|undefined){
      return authenticDiscoveryEvidence(search,searchLog,descriptions);
    }
    const services={
      nativeIntentDiscovery:{
        async notice(){return rawNotice();},
        async search(query:string){
          if(typeof query!=="string"||!query.trim()||query.length>128)return [];
          const hits=(await ports.catalog.search(query)).map(hit=>({id:hit.id,name:hit.qualifiedName,description:hit.description?.slice(0,210)??""}));
          searchLog.push({query,hits});return structuredClone(hits);
        },
        async describe(id:string){
          if(typeof id!=="string"||!id||id.length>512)return null;
          if(descriptions.has(id))return structuredClone(descriptions.get(id)!);
          const value=await description(id);
          if(value)descriptions.set(id,value);
          return structuredClone(value);
        },
        async inspect(methodId:string,scope:string){
          const route=required.find(row=>row.methodId===methodId&&row.scope===scope);
          if(!route||busy.has(methodId))return null;
          const previous=inspected.find(row=>row.methodId===methodId&&row.scope===scope);
          if(previous)return structuredClone(previous);
          busy.add(methodId);
          try{
            const value=await observation(route.need);
            inspected.push(value);return structuredClone(value);
          }finally{busy.delete(methodId);}
        },
      },
      nativeIntentHandoff:{async stage(report:IntentReport){
        if(!writable||staging||handoff||!report||report.handoff!==null||!planMatches(report.plan)||
          !searchProof(report.search)||!isDeepStrictEqual(report.notice,notice)||!isDeepStrictEqual(report.evidence,inspected)||
          inspected.length!==required.length||report.outcome?.status!==overall(inspected)||typeof report.outcome.summary!=="string"||
          !report.outcome.summary.trim()||report.outcome.summary.length>700)return null;
        staging=true;
        try{
          for(const value of inspected){
            const need=required.find(row=>row.methodId===value.methodId)!.need;
            if(!isDeepStrictEqual(value,await observation(need)))return null;
          }
          const text=body(report);
          const staged=await writer.stage(text);
          if(!staged)return null;
          handoff={path:staged.path,digest:sha256HexSyncText(text)};return structuredClone(handoff);
        }finally{staging=false;}
      }},
    };
    async function verify(raw:unknown){
      const value=raw as {status?:string;skill?:string;outcome?:IntentReport}|null;
      const report=value?.status==="workspace-skill-reviewed"&&value.skill==="intentDiscovery"?value.outcome:undefined;
      const independent=await Promise.all(inspected.map(async item=>observation(required.find(row=>row.methodId===item.methodId)!.need)));
      const descriptionsCurrent=await Promise.all([...descriptions.keys()].map(description));
      const status=await ports.vcs.status();
      const files=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!existing.has(name));
      const artifact=handoff?new TextDecoder("utf8",{fatal:true}).decode(await ports.readBytes(handoff.path,max)):null;
      const expectedScope=inspected.every(item=>{
        switch(item.methodId){
          case methods.workspace:return item.status==="observed"&&item.details[0]===(world.dirty?"uncommitted":"clean");
          case methods.note:return world.note===null?item.status==="missing":item.status==="observed"&&item.details[0]===world.note;
          case methods.skill:return world.skill==="absent"?item.status==="missing":item.status==="observed"&&item.coordinate?.endsWith("/SKILL.md");
          case methods.worker:return world.worker==="running"?item.status==="observed"&&item.coordinate===managed[1]?.id:item.status==="missing";
        }
        return false;
      });
      const checks={
        exactIntentNotice:isDeepStrictEqual(report?.notice,notice)&&isDeepStrictEqual(await rawNotice(),notice),
        installedIntentDiscovery:searchProof(report?.search)&&descriptionsCurrent.every(value=>isDeepStrictEqual(value,descriptions.get(value.id))),
        exactIntentActionSelection:planMatches(report?.plan)&&isDeepStrictEqual(report?.plan.actions,
          inspected.map(({methodId,scope})=>({methodId,scope}))),
        independentlyScopedIntentResults:inspected.length===required.length&&expectedScope&&isDeepStrictEqual(independent,inspected)&&
          isDeepStrictEqual(report?.evidence,inspected),
        exactIntentOutcome:report?.outcome.status===overall(inspected)&&typeof report.outcome.summary==="string"&&
          !!report.outcome.summary.trim()&&report.outcome.summary.length<=700,
        exactPrivateIntentNote:writable?!!report&&!!artifact&&!!handoff&&files.length===1&&
          handoff.path===`/.tmp/${files[0]}/handoff.json`&&artifact===body(report)&&handoff.digest===sha256HexSyncText(artifact)&&
          isDeepStrictEqual(report.handoff,handoff):handoff===null&&report?.handoff===null&&files.length===0,
        preservedIntentWorkspace:isDeepStrictEqual(before,status)&&initial.mainEventId===status.mainEventId,
        rejectedIntentRetarget:await services.nativeIntentDiscovery.inspect(methods.worker,workerKey+"-older")===null&&
          await services.nativeIntentDiscovery.inspect("service:unknown.operation",owner)===null,
      };
      await close();
      return {contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),notice,
        search:report?.search??null,plan:report?.plan??null,evidence:inspected,outcome:report?.outcome??null,handoff,artifact};
    }

    async function qualify(){
      await services.nativeIntentDiscovery.notice();
      for(const {methodId} of required){
        await services.nativeIntentDiscovery.search(methodId.slice("service:".length));
        if(!await services.nativeIntentDiscovery.describe(methodId))throw new Error("Expected the exact installed discovery contract "+methodId);
      }
      const actions:IntentAction[]=required.map(({methodId,scope})=>({methodId,scope}));
      for(const action of actions)if(!await services.nativeIntentDiscovery.inspect(action.methodId,action.scope))
        throw new Error("Missing assigned scoped intent receipt");
      const search={queries:searchLog.map(row=>row.query),hits:searchLog.map(row=>row.hits),described:[...descriptions.values()]};
      const report:IntentReport={notice,search,plan:{actions,retain:writable},evidence:inspected,
        outcome:{status:overall(inspected),summary:"Compared exact installed operations and owned local facts."},handoff:null};
      if(writable)report.handoff=await services.nativeIntentHandoff.stage(report);
      return verify({status:"workspace-skill-reviewed",skill:"intentDiscovery",outcome:report});
    }
    return {services,verify,qualify,close};
  }catch(error){
    await close();
    throw error;
  }
}
