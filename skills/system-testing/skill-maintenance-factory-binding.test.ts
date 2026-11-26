import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {prepareSkillMaintenance} from './open-goal-skill-maintenance-managed.js';
import {openSkillMaintenanceWorlds} from './open-goal-skill-maintenance-worlds.js';
import {expectedBuildUnitName,BUILDABLE_UNIT_DIRS} from '@vibestudio/workspace-contracts/sourceDirs';
function ports(){
 type Repo={repositoryId:string;path:string;files:Map<string,{fileId:string;text:string}>};
 let count=0;const states=new Map<string,Repo[]>();states.set('v0',[]);let head={kind:'event',eventId:'v0'};
 const snapshot=(state=head)=>structuredClone(states.get(state.eventId)!);
 const commit=(repos:Repo[])=>{head={kind:'event',eventId:'v'+(++count)};states.set(head.eventId,structuredClone(repos));return{workingHead:head,applicationId:'app'+count,changeIds:['change'+count]};};
 const vcs:any={status:async()=>({workingHead:head,mainEventId:'protected-main',clean:false,committed:[]}),
 resolveRepository:async({state,repoPath}:any)=>{const r=snapshot(state).find(r=>r.path===repoPath);return r?{repositoryId:r.repositoryId,repoPath:r.path}:null;},
 readFile:async({state,repositoryId,file}:any)=>{const r=snapshot(state).find(r=>r.repositoryId===repositoryId);const entry=r?.files.get(file.path);return entry?{repositoryId,path:file.path,fileId:entry.fileId,content:{kind:'text',text:entry.text},contentHash:createHash('sha256').update(entry.text).digest('hex')}:null;},
 edit:async({expectedWorkingHead,changes}:any)=>{expect(expectedWorkingHead).toEqual(head);const repos=snapshot();for(const change of changes){if(change.kind==='repository-create'){const id='repo:'+change.repoPath;repos.push({repositoryId:id,path:change.repoPath,files:new Map(change.files.map((f:any)=>[f.path,{fileId:id+'/'+f.path,text:f.content.text}]))});}else if(change.kind==='content-replace'){const repo=repos.find(r=>r.repositoryId===change.repositoryId)!;const f=[...repo.files.values()].find(f=>f.fileId===change.fileId)!;f.text=change.content.text;}else throw Error('Unimplemented edit '+change.kind);}return commit(repos);},
 move:async({expectedWorkingHead,moves}:any)=>{expect(expectedWorkingHead).toEqual(head);const repos=snapshot();for(const m of moves){expect(repos.some(r=>r.path===m.destinationPath)).toBe(false);repos.find(r=>r.repositoryId===m.repositoryId)!.path=m.destinationPath;}return commit(repos);}};
 vcs.listFiles=async({state,repositoryId}:any)=>({files:[...snapshot(state).find(r=>r.repositoryId===repositoryId)!.files].map(([path])=>({path})),nextCursor:null});
 const native={contextId:'owned-panel',vcs,panel:async(source:string)=>{const r=snapshot().find(r=>r.path===source);if(!r||BUILDABLE_UNIT_DIRS.find(u=>u.dir===source.split('/')[0])?.kind!=='panel')return null;const m=JSON.parse(r.files.get('package.json')!.text);return m.name===expectedBuildUnitName(source)?{source,title:m.vibestudio.title,stateArgs:m.vibestudio.stateArgs}:null;}};
 return native;
}
it('actual prepared Native verifier uses its report parameter and preserves failed original observations',async()=>{
 const world=openSkillMaintenanceWorlds[0]!;const p=ports();let retainedChecks=0;
 const factory=await prepareSkillMaintenance({contextId:'owned-panel',caseId:world.id},world,{...p,describe:async()=>{throw Error('No authoring read or final observation has occurred');},native:{observe:async(path:string,revision:string,criterion:any)=>({check:{path,revision,runId:'TEST-only-retained',runDigest:'TEST-only-run',resultDigest:'TEST-only-result',satisfied:false,failures:['Deliberately failed Native observer'],...criterion},retained:{testOnly:true}}),retained:async()=>{retainedChecks++;return false;},close:async()=>{}}} as never);
 try{for(const report of [undefined,null,{action:'hold-evidence',reason:'No actual authoring or final Native check has been performed.'}]){
  const proof=await factory.verify(report);expect(proof.passed).toBe(false);expect(proof.checks.exactSkillSourceAndOriginalWitness).toBe(false);expect(proof.checks.exactInstalledAuthoringReview).toBe(false);expect(proof.checks.exactSkillCompilerReadback).toBe(false);
 }expect(retainedChecks).toBe(0);}finally{await factory.close();}
});
