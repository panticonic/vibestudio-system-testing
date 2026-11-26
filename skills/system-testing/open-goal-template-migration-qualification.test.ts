import {it,expect} from "vitest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {openTemplateMigrationWorlds} from "./open-goal-template-migration-worlds.js";
import {prepareOpenTemplateMigration} from "./open-goal-template-migration-managed.js";
function migrationPorts(){
 const files=new Map<string,string>(),blobs=new Map<string,string>();
 let head:any={kind:'event',eventId:'initial'},sequence=0,repoPath='';
 const fs={mkdtemp:async()=>'/private/migration',writeFile:async(p:string,s:string)=>{files.set(p,s);},readdir:async(p:string)=>[...files.keys()].filter(k=>k.startsWith(p+'/')).map(k=>k.slice(p.length+1))};
 const vcs={status:async()=>({mainEventId:'protected-main',workingHead:head}),importSnapshot:async(input:any)=>{
  repoPath=input.repositories[0].repoPath;
  for(const f of input.repositories[0].files)files.set(f.path,blobs.get(f.contentHash)!);
  head={kind:'event',eventId:'owned-'+(++sequence)};return{eventId:head.eventId,importedRepositoryIds:['owned-repository']};
 }};
 const rpc={call:async(_target:string,method:any,args:any[])=>{
  if(method.name==='blobstore.putText'){const digest=sha256HexSyncText(args[0]);blobs.set(digest,args[0]);return{digest};}
  if(method.name==='vcs.resolveRepository')return{repositoryId:'owned-repository',repoPath,state:head};
  if(method.name==='vcs.readFile'){const path=args[0].file.path,text=files.get(path)!;return{repositoryId:'owned-repository',path,content:{kind:'text',text},contentHash:sha256HexSyncText(text)};}
  if(method.name==='fs.readBytes'){const bytes=new TextEncoder().encode(files.get(args[0])!);return{base64:Buffer.from(bytes).toString('base64'),start:0,end:bytes.length,totalBytes:bytes.length,truncated:false};}
  throw Error('Unexpected native test method '+method.name);
 }};
 const status={workspaceEpoch:7,workspaceAppVersion:'test-version',checks:[{source:{url:'git+https://github.com/panticonic/vibestudio-template-examples.git',commit:'1'.repeat(40)},target:{url:'git+https://github.com/panticonic/vibestudio-template-examples.git',commit:'2'.repeat(40)},status:'available',checkedAt:1,targetEpoch:7}]};
 let prepared:any=null;
 return{contextId:'owned-context',fs,vcs,rpc,templates:{checkUpdates:async()=>status,updateStatus:async()=>status,prepareUpdate:async(input:any)=>{prepared={operationId:input.commandId,sourceUrl:input.sourceUrl,target:input.target,contextId:'native-candidate',mainEventId:'protected-main',status:'review',repositories:[],conflicts:[]};return prepared;},reviewUpdate:async()=>prepared}} as any;
}

for(const world of openTemplateMigrationWorlds)it(`reference verifies actual migration obligations: ${world.id}`,async()=>{
 const fixture=await prepareOpenTemplateMigration({contextId:"owned-context",caseId:world.id},migrationPorts());
 const proof=await fixture.qualify();
 expect(proof.passed).toBe(true);
 expect(proof.checks.rejectedForeignCandidateAuthority).toBe(true);
 expect(proof.checks.rejectedMissingRequestedAnswer).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
});
it("does not reintroduce the unrequested candidate-ID echo gate or waive a requested answer",async()=>{
 const world=openTemplateMigrationWorlds.find(w=>w.id.endsWith("recovered-receipt-wrong-channel"))!;
 const fixture=await prepareOpenTemplateMigration({contextId:"owned-context",caseId:world.id},migrationPorts());
 const live=await fixture.services.templateMigration.discover();await fixture.services.templateMigration.read(live.revision,world.expected.reads);
 const answer={status:"draft-only",candidateId:"incidental-alternative",handoff:null,answer:"The foreign-owner receipt does not prove this deployment."};
 const proof=await fixture.verify(answer);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect((await fixture.verify({...answer,answer:""})).passed).toBe(false);
 expect(await fixture.services.templateMigration.authorizeStage(live.revision,"unowned-native-candidate")).toBeNull();
});
