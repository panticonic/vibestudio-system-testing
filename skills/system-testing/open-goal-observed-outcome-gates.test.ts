import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {sha256HexSyncText} from '@vibestudio/content-addressing';
import {openTemplateMigrationWorlds} from './open-goal-template-migration-worlds.js';
import {prepareOpenTemplateMigration} from './open-goal-template-migration-managed.js';
import {openCompoundRecoveryWorlds} from './open-goal-compound-recovery-worlds.js';
import {prepareCompoundRecoveryHandoff} from './open-goal-compound-recovery-managed.js';
const nested=vi.hoisted(()=>({recovery:null as any}));
vi.mock('./open-goal-eval-handoff-managed.js',()=>({prepareOpenEvalHandoff:async()=>nested.recovery}));

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
 const status={workspaceAppVersion:'test-version',checks:[{source:{url:'git+https://github.com/panticonic/vibestudio-template-examples.git',commit:'installed'},target:{commit:'incoming'},status:'available',checkedAt:1}]};
 return{contextId:'owned-context',fs,vcs,rpc,templates:{checkUpdates:async()=>status,updateStatus:async()=>status,prepareUpdate:async()=>{throw Error('No native candidate authorized');},reviewUpdate:async()=>null}} as any;
}
describe('migration checks requested meaning against bound evidence',()=>{
 it('audits every unchanged world with explicit answer requirements',()=>{
  expect(openTemplateMigrationWorlds).toHaveLength(20);
  expect(openTemplateMigrationWorlds.filter(w=>w.split==='test')).toHaveLength(5);
  for(const world of openTemplateMigrationWorlds)expect(typeof world.requestedAnswerRequired).toBe('boolean');
 });
 it('accepts alternative report labels only subject to mandatory bound meaning review',async()=>{
  const world=openTemplateMigrationWorlds.find(w=>w.id.endsWith('recovered-receipt-wrong-channel'))!;
  const fixture=await prepareOpenTemplateMigration({contextId:'owned-context',caseId:world.id},migrationPorts());
  const observed=await fixture.services.templateMigration.discover();
  await fixture.services.templateMigration.read(observed.revision,world.expected.reads);
  const actual=process.env.NATLANG_TEST_MIGRATION_NATIVE_PACKET
   ? JSON.parse(readFileSync(process.env.NATLANG_TEST_MIGRATION_NATIVE_PACKET,'utf8')).natlangTeacher.applicationResult
   : {status:'draft-only',candidateId:'return-review',handoff:null,answer:'No. The Returns Logistics receipt belongs to another owner and event. It does not prove Return Desk adoption.'};
  const proof=await fixture.verify(actual);
  expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
  expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(actual);
  expect(proof.semanticReviewInput.expected.observations.journal.map(row=>row.result)).toEqual(proof.journal.map(row=>row.result));
 expect(proof.semanticReviewInput.actual.attemptedArguments.map(row=>row.arguments)).toEqual(proof.journal.filter(row=>typeof row.method==="string"&&Array.isArray(row.args)).map(row=>row.args));
  expect(proof.semanticReviewInput.actual.artifacts).toEqual({handoff:null,receiptText:null});
  expect(JSON.stringify(proof.semanticReviewInput)).toContain('Returns Logistics');
  expect((await fixture.verify({...actual,answer:''})).passed).toBe(false);
  // A false adoption claim remains review-required, never auto-accepted semantically.
  const falseClaim=await fixture.verify({...actual,answer:'Yes, the foreign receipt proves our current adoption.'});
  expect(falseClaim.semanticReviewRequired).toBe(true);
  expect(falseClaim.semanticReviewInput.actual.requestedReturn.answer).toContain('Yes,');
 });
 for(const [suffix,required] of [['handoff-draft-does-not-prove-deployment',true],['pointed-to-foreign-retained-artifact',false]] as const)
 it(`retained native handoff preserves explicit answer requirement: ${suffix}`,async()=>{
  const world=openTemplateMigrationWorlds.find(w=>w.id.endsWith(suffix))!;
  const fixture=await prepareOpenTemplateMigration({contextId:'owned-context',caseId:world.id},migrationPorts());
  const observed=await fixture.services.templateMigration.discover();
  await fixture.services.templateMigration.read(observed.revision,world.expected.reads);
  const handoff=await fixture.services.templateMigration.stageHandoff(observed.revision,world.handoff!.candidateId,required?world.expected.status:'draft-only',world.handoff!.recipient);
  expect(handoff).not.toBeNull();
  const proof=await fixture.verify(undefined);
  expect(proof.outcomeDimensions.effects.passed).toBe(true);
  expect(proof.outcomeContract.returnedValue.required).toBe(required);
  expect(proof.passed).toBe(!required);
  expect(proof.semanticReviewRequired).toBe(true);
 });
 it('still rejects missing required source observations',async()=>{
  const world=openTemplateMigrationWorlds.find(w=>w.id.endsWith('recovered-receipt-wrong-channel'))!;
  const fixture=await prepareOpenTemplateMigration({contextId:'owned-context',caseId:world.id},migrationPorts());
  await fixture.services.templateMigration.discover();
  expect((await fixture.verify({answer:'No, current adoption is unproven.'})).checks.readExactOwnedMigrationSources).toBe(false);
 });
});

const archive=process.env.NATLANG_TEST_COMPOUND_NATIVE_PACKET;
it.skipIf(!archive)('replays the actual rescission chronology; harmless null stage does not become a route ban',async()=>{
 const packet=JSON.parse(readFileSync(archive!,'utf8')),prior=packet.openGoalVerification;
 const world=openCompoundRecoveryWorlds.find(w=>w.id===prior.caseId)!;
 async function replay(early:boolean,skipReadback=false){
  const files=new Map<string,string>();
  nested.recovery={services:Object.fromEntries(['openEvalCatalog','openEvalReentry','evalRecoveryJournal','evalRecoveryReadback'].map(service=>[service,Object.fromEntries(prior.effects.filter((e:any)=>e.service===service).map((e:any)=>[e.method,async()=>structuredClone(e.result)]))])),verifyObserved:async()=>prior.evalProof,close:async()=>{}};
  const ports:any={contextId:prior.contextId,fs:{mkdtemp:async()=>'/private/compound',writeFile:async(p:string,s:string)=>{files.set(p,s);},readFile:async(p:string)=>files.get(p),readdir:async()=>[]},vcs:{status:async()=>({mainEventId:'main',workingHead:{kind:'event',eventId:'head'}})},native:{readText:async()=>null},readBytes:async(p:string)=>new TextEncoder().encode(files.get(p)!)};
  const fixture=await prepareCompoundRecoveryHandoff({contextId:prior.contextId,caseId:world.id},world,ports);
  if(early)await fixture.services.scratchHandoffRead.read('recovered-result');
  for(const e of prior.effects)if(!skipReadback||e.service!=='evalRecoveryReadback')await (fixture.services as any)[e.service][e.method](...e.args);
  return fixture.verify(packet.natlangTeacher.applicationResult);
 }
 expect((await replay(false)).passed).toBe(true);
 expect((await replay(true)).checks.honoredPrerequisiteAndOrder).toBe(false);
 expect((await replay(false,true)).checks.honoredPrerequisiteAndOrder).toBe(false);
});
