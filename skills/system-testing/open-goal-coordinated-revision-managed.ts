import { sameEvidenceMembers } from "./semantic-evidence.js";
import { isDeepStrictEqual as equal } from "node:util";
import { compareUtf16CodeUnits } from "@vibestudio/content-addressing";
import { contextId, fs, vcs, type VcsClient } from "@workspace/runtime";
import type {
  CoordinatedRevisionResult, RevisionDraft, RevisionFile, RevisionPlan, RevisionReadback,
  RevisionReceipt, RevisionScope,
} from "@workspace-skills/open-coordinated-revision/types";
import { serializeSystemTestError } from "./structured-error.js";
import { guideRevision } from "./open-goal-workspace-claims-managed.js";
import { openCoordinatedRevisionWorlds } from "./open-goal-coordinated-revision-worlds.js";

const guidePath="skills/vibestudio-workflows/evidence/checkSupport/skills/workspace-evidence/SKILL.md";
type Ports={contextId:string|null;guide:()=>Promise<string>;vcs:Pick<VcsClient,"status"|"mainState"|"edit"|"resolveRepository"|"readFile">};
type State=Awaited<ReturnType<VcsClient["status"]>>["workingHead"];
const key=(state:State)=>state.kind==="event"?state.eventId:state.applicationId;
const ordered=(paths:string[])=>[...paths].sort(compareUtf16CodeUnits);

export async function prepareCoordinatedRevision(input:{contextId:string;caseId:string},ports:Ports={contextId,vcs,guide:()=>fs.readFile(guidePath,"utf8")}) {
  const world=openCoordinatedRevisionWorlds.find(row=>row.id===input.caseId);
  if(!world||ports.contextId!==input.contextId)throw new Error("Document revision needs its assigned context");
  const owner=input.contextId;
  const guide=guideRevision(await ports.guide());
  const initialStatus=await ports.vcs.status();
  const protectedMain=await ports.vcs.mainState();
  if(!initialStatus.clean||initialStatus.contextId!==owner||initialStatus.mainEventId!==protectedMain.eventId)
    throw new Error("Document revision needs a clean owned context on an exact main basis");

  const repoPath="projects/revision-"+crypto.randomUUID();
  const original={...Object.fromEntries(world.changes.map(({path,before})=>[path,before])),
    "approved.md":world.facts,"earlier-review.md":world.drafts};
  const names=ordered(Object.keys(original));
  const created=await ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:initialStatus.workingHead,
    intentSummary:"Retain exact disposable editorial records",changes:[{kind:"repository-create",repoPath,
      files:names.map(path=>({path,mode:0o644,content:{kind:"text",text:original[path]!}}))}]});
  const baseStatus=await ports.vcs.status();
  const base=baseStatus.workingHead;
  const repo=await ports.vcs.resolveRepository({state:base,repoPath});
  if(!repo||!equal(base,created.workingHead))throw new Error("No exact owned document repository");
  const repositoryId=repo.repositoryId;
  const writable=new Set(world.changes.map(({path})=>path));

  async function observe(state:State):Promise<RevisionFile[]> {
    return Promise.all(names.map(async path=>{
      const file=await ports.vcs.readFile({state,repositoryId,file:{kind:"path",path}});
      if(!file||file.content.kind!=="text"||file.repositoryId!==repositoryId||file.path!==path||file.repoPath!==repoPath)
        throw new Error("Native document origin changed at "+path);
      return {path,version:file.contentHash,text:file.content.text,fileId:file.fileId};
    }));
  }
  async function scope(state:State):Promise<RevisionScope> {
    return {subject:world.subject,head:key(state),files:await observe(state)};
  }
  async function edit(state:State,files:RevisionFile[],pair:Record<string,string>,summary:string) {
    return ports.vcs.edit({contextId:owner,commandId:crypto.randomUUID(),expectedWorkingHead:state,intentSummary:summary,
      changes:ordered(Object.keys(pair)).map(path=>{
        const previous=files.find(row=>row.path===path);
        if(!previous)throw new Error("Document change escaped its exact read");
        return {kind:"content-replace",repositoryId,fileId:previous.fileId,content:{kind:"text",text:pair[path]!}};
      })});
  }

  type Snapshot={state:State;scope:RevisionScope};
  const snapshots:Snapshot[]=[];
  const attempts:{head:string;drafts:RevisionDraft[];receipt:RevisionReceipt}[]=[];
  let inFlight=false;
  let finalRead:RevisionReadback|null=null;
  let reporterRaceState:State|null=null;
  let consumedConflict=false;
  const mark=(status:RevisionReceipt["status"],state:State,paths:string[]=[]):RevisionReceipt=>({status,head:key(state),paths});
  const services={
    nativeCoordinatedRevision:{
      async discover(){
        const {workingHead}=await ports.vcs.status();
        const seen=await scope(workingHead);
        if(!snapshots.some(snapshot=>equal(snapshot.state,workingHead))) snapshots.push({state:workingHead,scope:seen});
        return structuredClone(seen);
      },
      async revise(head:string,drafts:RevisionDraft[]){
        const last=snapshots.at(-1);
        if(inFlight||!last||last.scope.head!==head||
          !Array.isArray(drafts)||drafts.length===0||world.initial||attempts.at(-1)?.receipt.status==="applied")
          return mark("unavailable",(await ports.vcs.status()).workingHead);
        const paths=drafts.map(({path})=>path);
        if(new Set(paths).size!==paths.length||drafts.some(row=>{
          const old=last.scope.files.find(file=>file.path===row.path);
          return !writable.has(row.path)||old?.version!==row.version||typeof row.text!=="string"||
            row.text.length>8192||row.text===old?.text;
        }))return mark("unavailable",(await ports.vcs.status()).workingHead);
        inFlight=true;
        let receipt:RevisionReceipt;
        try{
          if(world.concurrent&&!consumedConflict){
            consumedConflict=true;
            const race=await edit(last.state,last.scope.files,world.concurrent,"Retain an independent concurrent editorial change");
            reporterRaceState=race.workingHead;
          }
          try{
            const result=await edit(last.state,last.scope.files,Object.fromEntries(drafts.map(row=>[row.path,row.text])),
              "Apply one authorized coordinated workspace revision");
            if(result.changeIds.length!==drafts.length)throw new Error("Native revision did not apply its complete batch");
            receipt=mark("applied",result.workingHead,paths);
          }catch(error){
            const current=await ports.vcs.status();
            if(serializeSystemTestError(error).code!=="RevisionChanged"||equal(current.workingHead,last.state))throw error;
            receipt=mark("changed",current.workingHead);
          }
          attempts.push({head,drafts:structuredClone(drafts),receipt});
          return structuredClone(receipt);
        }finally{inFlight=false;}
      },
      async readback():Promise<RevisionReadback>{
        const [status,main]=await Promise.all([ports.vcs.status(),ports.vcs.mainState()]);
        finalRead={head:key(status.workingHead),protectedMain:main.eventId,files:await observe(status.workingHead)};
        return structuredClone(finalRead);
      },
    },
  };

  function expectedDrafts(observed:RevisionScope,updated:boolean){
    if(!updated&&world.initial)return [];
    if(updated&&world.next?.status!=="ready")return [];
    return ordered([...writable]).flatMap(path=>{
      const row=world.changes.find(item=>item.path===path)!;
      const file=observed.files.find(item=>item.path===path)!;
      if(updated&&world.concurrent?.[path]!==undefined&&world.next?.edits?.[path]===undefined)return [];
      const text=updated?world.next?.edits?.[path]??row.after:row.after;
      return file.text===text?[]:[{path,version:file.version,text}];
    });
  }
  async function verify(raw:unknown) {
    const value=raw as CoordinatedRevisionResult|null;
    const report=value;
    const status=await ports.vcs.status();
    const actual=await observe(status.workingHead);
    const first=snapshots[0];
    const after=reporterRaceState?snapshots.find(snapshot=>equal(snapshot.state,reporterRaceState)):undefined;
    const initialPlan=world.initial??"ready";
    const changedByOther=world.concurrent??{};
    const finalEdits=world.concurrent?(after?expectedDrafts(after.scope,true):[]):first?expectedDrafts(first.scope,false):[];
    const finalExpected={...original,...changedByOther,...Object.fromEntries(finalEdits.map(({path,text})=>[path,text]))};
    const firstDrafts=first?expectedDrafts(first.scope,false):[];
    const actualRace=reporterRaceState?await observe(reporterRaceState):null;
    const expectedRace={...original,...changedByOther};
    const snapshotBytes=(rows:RevisionFile[],expected:Record<string,string>)=>equal(Object.fromEntries(rows.map(({path,text})=>[path,text])),expected);
    const checks={
      exactCoordinatedDocumentScope:!!first&&equal(first.state,base)&&snapshotBytes(first.scope.files,original),
      exactCoordinatedAuthority:report?.status===(world.next?.status ?? initialPlan),
      exactCoordinatedDrafts:attempts.filter(attempt=>attempt.receipt.status==="applied").every(attempt=>sameEvidenceMembers(attempt.drafts,finalEdits)),
      exactNativeRevisionRace:world.concurrent?!!after&&!!actualRace&&snapshotBytes(actualRace,expectedRace)&&equal(after.scope.files,actualRace)&&equal(after.state,reporterRaceState):!after&&!actualRace,
      exactAtomicRevisionBasis:world.concurrent?
        (world.next?.status==="ready"?attempts.some(attempt=>attempt.receipt.status==="applied"&&sameEvidenceMembers(attempt.drafts,finalEdits)&&attempt.head===after?.scope.head):attempts.every(attempt=>attempt.receipt.status!=="applied")):
        (initialPlan==="ready"?attempts.some(attempt=>attempt.head===first?.scope.head&&attempt.receipt.status==="applied"&&sameEvidenceMembers(attempt.drafts,firstDrafts)):attempts.every(attempt=>attempt.receipt.status!=="applied")),
      independentlyVerifiedRevisionBatch:!!finalRead&&report?.head===finalRead.head&&equal(report?.documents,finalRead.files.map(({path,version})=>({path,version})))&&
        typeof report?.explanation==="string"&&!!report.explanation.trim()&&equal(actual,finalRead.files)&&finalRead.head===key(status.workingHead)&&snapshotBytes(actual,finalExpected)&&actual.every(file=>first?.scope.files.some(old=>old.path===file.path&&old.fileId===file.fileId)),
      exactRevisionEvidenceGuide:guide===guideRevision(await ports.guide()),
      protectedRevisionMain:equal(await ports.vcs.mainState(),protectedMain)&&
        finalRead?.protectedMain===protectedMain.eventId&&status.mainEventId===protectedMain.eventId&&
        equal(status.committed,baseStatus.committed),
    };
    return {contextId:owner,caseId:world.id,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      report:report??null,attempts,guideRevision:guide};
  }

  async function qualify() {
    const api=services.nativeCoordinatedRevision;
    const initial=await api.discover();
    const plan=(seen:RevisionScope,status:RevisionPlan["status"],updated:boolean):RevisionPlan=>({status,
      destinations:status==="ready"?expectedDrafts(seen,updated):[],explanation:"Compared exact observed authority and native revision facts."});
    const initialPlan=plan(initial,world.initial??"ready",false);
    const first=initialPlan.status==="ready"?await api.revise(initial.head,initialPlan.destinations):null;
    const updated=first?.status==="changed"?await api.discover():null;
    const reconciled=updated?plan(updated,world.next!.status,true):null;
    const final=updated&&reconciled?.status==="ready"?await api.revise(updated.head,reconciled.destinations):null;
    const readback=await api.readback();
    const result={status:(reconciled ?? initialPlan).status,head:readback.head,documents:readback.files.map(({path,version})=>({path,version})),explanation:(reconciled ?? initialPlan).explanation};
    const proof=await verify(result);
    const rejectedInventedDocument=!(await verify({...result,documents:[{path:"invented",version:"invented"}]})).passed;
    return {...proof,passed:proof.passed&&rejectedInventedDocument,rejectedInventedDocument};
  }
  return {services,verify,qualify};
}
