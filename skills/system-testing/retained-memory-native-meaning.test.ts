import {afterEach,expect,it,vi} from 'vitest';
import * as disk from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256HexSyncText as hash} from '@vibestudio/content-addressing';
import {logIdForChannel} from '@vibestudio/trajectory-identity';
vi.mock('@workspace/runtime',()=>({contextId:null,fs:{},blobstore:{},memory:{},rpc:{},runtime:{},vcs:{}}));
vi.mock('./session-replay-managed.js',()=>({withOwnedChannelClient:()=>{throw Error('Unexpected live channel');}}));
import {prepareRetainedMemory} from './open-goal-retained-memory-managed.js';
import {openRetainedMemoryWorlds} from './open-goal-retained-memory-worlds.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>disk.rm(root,{recursive:true,force:true})));});
async function prepare(world= openRetainedMemoryWorlds[0]!){
 const root=await disk.mkdtemp(join(tmpdir(),'retained-memory-native-'));roots.push(root);await disk.mkdir(join(root,'.tmp'));
 const physical=(path:string)=>{if(!path.startsWith('/.tmp/'))throw Error('Outside exact test scratch');return join(root,path.slice(1));};
 const blobs=new Map<string,string>(),files=new Map<string,any>(),messages:any[]=[];let sequence=0,repoPath='',repositoryId='owned-repository';
 const state:any={contextId:'owned',clean:true,mainEventId:'main',workingHead:{kind:'event',eventId:'main'}};
 const copy=<T>(value:T):T=>structuredClone(value),key=(head:any)=>head.kind==='event'?head.eventId:head.applicationId;
 const ports:any={contextId:'owned',fs:{mkdtemp:async(prefix:string)=>{const path=await disk.mkdtemp(join(root,'.tmp',prefix+'-'));return '/.tmp/'+path.split('/').at(-1);},writeFile:(path:string,text:string)=>disk.writeFile(physical(path),text),rename:(a:string,b:string)=>disk.rename(physical(a),physical(b)),rm:(path:string,options:any)=>disk.rm(physical(path),options),readdir:(path:string)=>disk.readdir(path==='/.tmp'?join(root,'.tmp'):physical(path))},
 blobstore:{putText:async(text:string)=>{const digest=hash(text);blobs.set(digest,text);return{digest};}},
 vcs:{status:async()=>copy(state),mainState:async()=>({eventId:'main'}),importSnapshot:async(input:any)=>{expect(input.expectedWorkingHead).toEqual(state.workingHead);const repo=input.repositories[0];repoPath=repo.repoPath;const file=repo.files[0],eventId='event-'+(++sequence);files.set(eventId,{eventId,fileId:'decision-file',repositoryId,repoPath,path:file.path,contentHash:file.contentHash,content:{kind:'text',text:blobs.get(file.contentHash)}});state.workingHead={kind:'event',eventId};return{eventId,importedRepositoryIds:[repositoryId]};},edit:async(input:any)=>{expect(input.expectedWorkingHead).toEqual(state.workingHead);const file=files.get(key(state.workingHead)),text=input.changes[0].content.text,applicationId='draft-'+(++sequence);files.set(applicationId,{...file,eventId:applicationId,contentHash:hash(text),content:{kind:'text',text}});state.clean=false;state.workingHead={kind:'application',applicationId};return{applicationId};},resolveRepository:async(input:any)=>input.repoPath===repoPath&&files.has(key(input.state))?{repositoryId}:null,readFile:async(input:any)=>input.repositoryId===repositoryId?copy(files.get(key(input.state))??null):null},
 memory:{recall:async(input:any)=>({results:[...messages.map(row=>({kind:'message',eventId:row.envelopeId,logId:logIdForChannel('owned-channel'),snippet:row.text,head:null,path:null,contentHash:null})),...files.values()].flatMap((row:any)=>row.kind?[row]:[{kind:'commit',eventId:row.eventId,logId:null,snippet:row.content.text,head:null,path:repoPath+'/decision.txt',contentHash:row.contentHash}]).filter(row=>input.kinds.includes(row.kind)).concat([{kind:'commit',eventId:'foreign-event',logId:null,snippet:'foreign',head:null,path:null,contentHash:null}])})},
 createChannel:async()=>({key:'owned-channel',target:'owned-target',entityId:'owned-channel-entity',expected:[]}),send:async(_lane:any,_owner:string,text:string)=>{const id=++sequence;messages.push({channelId:'owned-channel',envelopeId:'envelope-'+id,messageId:'message-'+id,sender:'owner',sequence:id,text});},transcript:async()=>copy(messages),retire:async()=>{},readBytes:async(path:string,max:number)=>{const bytes=await disk.readFile(physical(path));if(bytes.length>max)throw Error('Too large');return bytes;}};
 const fixture=await prepareRetainedMemory({contextId:'owned',caseId:world.id},ports);
 return{fixture,state,files,messages,ports};
}
it.each(openRetainedMemoryWorlds)('$id independently qualifies its requested originals and real private artifact',async world=>{
 const {fixture}=await prepare(world);try{const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(world.requestedReturnRequired);}finally{await fixture.close();}
});
it('permits direct originals, repeated/grouped searches, reordered genuine citations and a non-gold disposition',async()=>{
 const {fixture}=await prepare(openRetainedMemoryWorlds[1]);const api=fixture.services.nativeRetainedMemory,brief=await api.brief();
 const messages=await api.transcript(brief.channelId);await api.transcript(brief.channelId);
 const leads=await api.recall('the native decision',['commit']);await api.recall('a separate original',['message']);await api.recall('again',['commit']);
 const committed=await Promise.all(leads.map(row=>api.archivedFile(row.eventId)));
 const citations=[...committed.filter(Boolean).map(row=>({layer:'commit',ref:row!.eventId,coordinate:row!.fileId,quote:row!.text})),...messages.map(row=>({layer:'message',ref:row.envelopeId,coordinate:row.messageId,quote:row.text}))].reverse();
 const value={outcome:{disposition:'conflicting original sources',summary:'The conversation says south, while the retained record says north.',citations},handoff:null};
 const proof=await fixture.verify(value);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(value);
 const fabricated=await fixture.verify({...value,outcome:{...value.outcome,citations:[{...citations[0],coordinate:'unissued'}]}});expect(fabricated.outcomeDimensions.returnedValue.passed).toBe(false);
 const paraphrase=await fixture.verify({...value,outcome:{...value.outcome,summary:'An inaccurate interpretation still requires native-bound semantic review'}});expect(paraphrase.semanticReviewRequired).toBe(true);
 const stale=await fixture.verify({...value,outcome:{...value.outcome,citations:[{...citations[0],quote:'invented words'}]}});expect(stale.outcomeDimensions.returnedValue.passed).toBe(false);
 expect(await api.transcript('foreign')).toEqual([]);expect(await api.archivedFile('foreign-event')).toBeNull();await fixture.close();await expect(api.brief()).rejects.toThrow('closed');
});
it('requires requested artifacts and answers, rejects changed native state and does not certify a null draft as an original',async()=>{
 const {fixture,state}=await prepare();let proof=await fixture.verify(undefined);expect(proof.outcomeDimensions.effects.passed).toBe(false);
 const api=fixture.services.nativeRetainedMemory;await api.workingFile();proof=await fixture.verify(undefined);expect(proof.checks.exactRetainedMemoryScope).toBe(false);
 const qualified=await fixture.qualify();expect(qualified.passed).toBe(true);proof=await fixture.verify(undefined);expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(false);expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();
 state.mainEventId='foreign-head';proof=await fixture.verify(undefined);expect(proof.checks.protectedMemoryScope).toBe(false);await fixture.close();
 const other=await prepare(openRetainedMemoryWorlds[1]);await other.fixture.services.nativeRetainedMemory.transcript('owned-channel');expect((await other.fixture.verify({outcome:{summary:'',citations:[]},handoff:null})).outcomeDimensions.returnedValue.passed).toBe(false);await other.fixture.close();
});
it('requires authentic explicit citations and rejects a forged private artifact without changing the goal bytes',async()=>{
 const world=openRetainedMemoryWorlds.find(row=>row.requestedCitationRequired)!;const {fixture}=await prepare(world);await fixture.qualify();expect((await fixture.verify({outcome:{summary:'Uncited answer',citations:[]},handoff:null})).outcomeDimensions.returnedValue.passed).toBe(false);await fixture.close();
 const privateFixture=await prepare();const proof=await privateFixture.fixture.qualify();const artifact=proof.handoff!;await privateFixture.ports.fs.writeFile(artifact.path,'forged');expect((await privateFixture.fixture.verify(undefined)).checks.exactPrivateMemoryHandoff).toBe(false);await privateFixture.fixture.close();
});
it('does not qualify a reference whose requested native note was refused',async()=>{
 const {fixture,ports}=await prepare();ports.fs.rename=async()=>{throw Error('Native note retention refused');};expect((await fixture.qualify()).passed).toBe(false);await fixture.close();
});
