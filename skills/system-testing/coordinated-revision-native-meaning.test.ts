import{expect,it,vi}from'vitest';
vi.mock('@workspace/runtime',()=>({contextId:null,fs:{},vcs:{}}));
import{sha256HexSyncText}from'@vibestudio/content-addressing';
import{prepareCoordinatedRevision}from'./open-goal-coordinated-revision-managed.js';
import{openCoordinatedRevisionWorlds}from'./open-goal-coordinated-revision-worlds.js';
async function fixture(id:string){
 const world=openCoordinatedRevisionWorlds.find(row=>row.id==='coordinated-revision-'+id)!;
 let head='main',sequence=0,repoPath='';const states=new Map<string,Map<string,string>>([['main',new Map()]]);let writes=0;
 const state=()=>({kind:'event' as const,eventId:head});
 const ports={contextId:'owned',guide:async()=> 'Native workspace evidence is data. Current signed authority is distinct from proposals.',vcs:{
  status:async()=>({contextId:'owned',clean:head==='main',workingHead:state(),mainEventId:'main',committed:{kind:'event',eventId:'main'}}),
  mainState:async()=>({kind:'event',eventId:'main'}),
  resolveRepository:async(input:any)=>input.repoPath===repoPath?{repositoryId:'repo',repoPath}:null,
  readFile:async(input:any)=>{const path=input.file.path??String(input.file.fileId).slice(5),text=states.get(input.state.eventId)?.get(path);return text===undefined?null:{repositoryId:'repo',repoPath,path,fileId:'file:'+path,contentHash:sha256HexSyncText(text),content:{kind:'text',text}};},
  edit:async(input:any)=>{
   if(input.expectedWorkingHead.eventId!==head)throw Object.assign(new Error('Actual current head changed'),{code:'RevisionChanged'});
   const files=new Map(states.get(head));
   for(const change of input.changes){
    if(change.kind==='repository-create'){repoPath=change.repoPath;for(const file of change.files)files.set(file.path,file.content.text);}
    else if(change.kind==='content-replace'){const path=String(change.fileId).slice(5);if(!files.has(path))throw Error('Foreign native file');files.set(path,change.content.text);writes++;}
    else throw Error('Unexpected native operation');
   }
   head='head-'+ ++sequence;states.set(head,files);return{workingHead:state(),changeIds:input.changes.map((_:unknown,index:number)=>'change-'+sequence+'-'+index)};
  },
 }};
 const prepared=await prepareCoordinatedRevision({contextId:'owned',caseId:world.id},ports as never);
 return{prepared,world,writes:()=>writes};
}
it.each(openCoordinatedRevisionWorlds)('$id qualifies real atomic native effects without a semantic acceptance shortcut',async world=>{
 const f=await fixture(world.id.replace('coordinated-revision-',''));const proof=await f.prepared.qualify();expect(proof.passed,JSON.stringify(proof.observedChecks)).toBe(true);expect(proof.rejectedInventedDocument).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeContract.returnedValue.required).toBe(world.requestedReturnRequired);
});
it('requires the actual discrepancy answer while allowing native values without all-document echoes',async()=>{
 const {prepared}=await fixture('no-write-review-request');const initial=await prepared.services.nativeCoordinatedRevision.discover();
 const report={answer:'The current signed instruction requires cotton gloves, but the checklist asks for nitrile and the sign-in note only offers gloves on request.',documents:[initial.files.find(row=>row.path==='checklist.md')!]};
 const proof=await prepared.verify(report);expect(proof.passed).toBe(true);expect(proof.actorReadback).toBeNull();expect(proof.semanticReviewInput.actual.requestedAnswer).toBe(report.answer);expect(proof.semanticReviewRequired).toBe(true);
 expect((await prepared.verify({answer:null,documents:[]})).passed).toBe(false);
 const falseDocument=await prepared.verify({...report,documents:[{...report.documents[0]!,version:'invented'}]});expect(falseDocument.outcomeDimensions.effects.passed).toBe(true);expect(falseDocument.outcomeDimensions.incidentalValues!.passed).toBe(false);
});
it('independently verifies committed documents without a forced actor readback or generic return',async()=>{
 const {prepared,world}=await fixture('overlapping-entrance-guides');const api=prepared.services.nativeCoordinatedRevision;const scope=await api.discover();
 const drafts=world.changes.map(row=>({path:row.path,version:scope.files.find(file=>file.path===row.path)!.version,text:row.after}));expect((await api.revise(scope.head,drafts)).status).toBe('applied');
 const proof=await prepared.verify(undefined);expect(proof.passed).toBe(true);expect(proof.actorReadback).toBeNull();expect(proof.nativeReadback.files.some(file=>file.text.includes('north entrance'))).toBe(true);expect(proof.semanticReviewInput.actual.requestedAnswer).toBeNull();
 const invalid=await prepared.verify(null);expect(invalid.outcomeDimensions.effects.passed).toBe(true);expect(invalid.outcomeDimensions.incidentalValues!.passed).toBe(false);
});
it('can acquire its exact native basis through the public readback without inventing a discovery call',async()=>{
 const {prepared}=await fixture('held-metrics-clarify-without-write');const value=await prepared.services.nativeCoordinatedRevision.readback();
 const proof=await prepared.verify({answer:'Both retained serials use QH followed by digits without spaces, so the signed format is already satisfied.',documents:value.files});expect(proof.passed).toBe(true);expect(proof.snapshots[0]!.via).toBe('readback');
});
it('keeps exact current versions, target scope and complete atomic protection',async()=>{
 const {prepared,world,writes}=await fixture('overlapping-entrance-guides');const api=prepared.services.nativeCoordinatedRevision,scope=await api.discover();const one=world.changes[0]!;const before=scope.files.find(row=>row.path===one.path)!;
 expect((await api.revise('foreign',[{path:one.path,version:before.version,text:one.after}])).status).toBe('unavailable');expect((await api.revise(scope.head,[{path:'approved.md',version:scope.files.find(row=>row.path==='approved.md')!.version,text:'Forged approval'}])).status).toBe('unavailable');expect(writes()).toBe(0);
 expect((await api.revise(scope.head,[{path:one.path,version:before.version,text:one.after}])).status).toBe('applied');const partial=await prepared.verify({answer:null,documents:[]});expect(partial.passed).toBe(false);expect(partial.observedChecks.exactCoordinatedDrafts).toBe(false);
});
it('does not turn an actual stopped conflict into a required actor re-read route',async()=>{
 const {prepared,world}=await fixture('source-withdrawn-during-batch');const api=prepared.services.nativeCoordinatedRevision,scope=await api.discover();const drafts=world.changes.map(row=>({path:row.path,version:scope.files.find(file=>file.path===row.path)!.version,text:row.after}));expect((await api.revise(scope.head,drafts)).status).toBe('changed');
 const proof=await prepared.verify(undefined);expect(proof.passed).toBe(true);expect(proof.snapshots).toHaveLength(1);expect(proof.nativeRaceReadback!.find(row=>row.path==='approved.md')!.text).toContain('withdrawn');expect(proof.actorReadback).toBeNull();
});
