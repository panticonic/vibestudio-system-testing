import {observedContentReviewInput} from '/home/werg/vibe-native-recovery-review-bindings/scripts/lib/observed-content-admission.mjs';
/** Reference-call projection supplies its actual reference return at the existing capture boundary. This is not a teacher Root witness.
 * Component native ports execute real fixture operations over immutable snapshots and actual hashed bytes. */
import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('@workspace/runtime',()=>({contextId:'archive-owner',vcs:{},blobstore:{}}));
import {prepareContentArchive} from './open-goal-content-archive-managed.js';
import {openContentArchiveWorlds} from './open-goal-content-archive-worlds.js';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
function ports(){
 let serial=0,head='head-0';const snapshots=new Map<string,Map<string,any>>([['head-0',new Map()]]),bytes=new Map<string,Uint8Array>(),trees=new Map<string,any[]>();
 const state=(eventId:string)=>({kind:'event',eventId});const contentBytes=(c:any)=>c.kind==='text'?new TextEncoder().encode(c.text):Uint8Array.from(Buffer.from(c.base64,'base64'));
 const put=async(b:Uint8Array)=>{const digest=hash(b);bytes.set(digest,b.slice());return{digest,size:b.length};};
 const vcs={status:async()=>({contextId:'archive-owner',mainEventId:'protected-main',workingHead:state(head)}),resolveRepository:async({state:s,repoPath}:any)=>snapshots.get(s.eventId)!.has(repoPath)?{repositoryId:repoPath,repoPath}:null,
 listFiles:async({state:s,repositoryId}:any)=>({state:s,repositoryId,nextCursor:null,files:[...snapshots.get(s.eventId)!.get(repositoryId).values()]}),
 readFile:async({state:s,repositoryId,file}:any)=>snapshots.get(s.eventId)!.get(repositoryId).get(file.path)??null,
 edit:async(input:any)=>{expect(input.contextId).toBe('archive-owner');if(input.expectedWorkingHead.eventId!==head)throw Error('Native CAS mismatch');const next=structuredClone(snapshots.get(head)!);const ids:string[]=[];
  for(const c of input.changes){ids.push(crypto.randomUUID());if(c.kind==='repository-create'){const files=new Map();for(const f of c.files)files.set(f.path,{...f,repositoryId:c.repoPath,fileId:crypto.randomUUID(),contentHash:hash(contentBytes(f.content))});next.set(c.repoPath,files);}else{const repo=next.get(c.repositoryId);if(c.kind==='file-create')repo.set(c.path,{path:c.path,repositoryId:c.repositoryId,fileId:crypto.randomUUID(),mode:c.mode,content:c.content,contentHash:hash(contentBytes(c.content))});else{const old=[...repo.values()].find((f:any)=>f.fileId===c.fileId) as any;if(!old)throw Error('Unknown native file');repo.set(old.path,{...old,mode:c.mode??old.mode,content:c.content,contentHash:hash(contentBytes(c.content))});}}}
  head='head-'+(++serial);snapshots.set(head,next);return{workingHead:state(head),applicationId:crypto.randomUUID(),changeIds:ids};}};
 const blobs={putBytes:put,getBytes:async(d:string)=>bytes.get(d)?.slice()??null,
 putPathTree:async(entries:Record<string,any>)=>{const rows=[];for(const[path,value]of Object.entries(entries)){const member=typeof value==='string'?{digest:(await put(new TextEncoder().encode(value))).digest,mode:33188}:value;rows.push({kind:'file',path,contentHash:member.digest,mode:member.mode});}rows.sort((a,b)=>a.path.localeCompare(b.path));const ref='manifest:'+hash(JSON.stringify(rows));trees.set(ref,rows);return{stateHash:ref};},
 listTree:async(ref:string,o:any)=>{const rows=trees.get(ref);if(!rows)return null;const start=Number(o.cursor??0),end=Math.min(start+o.limit,rows.length);return{basis:{ref,prefix:'',order:'tree-preorder-v1',rootTreeHash:ref.slice(9)},entries:structuredClone(rows.slice(start,end)),completeness:end===rows.length?'complete':'partial',nextCursor:end===rows.length?undefined:String(end)};},
 readFileAtTree:async(ref:string,path:string)=>structuredClone(trees.get(ref)?.find(row=>row.path===path)??null)};
 return{contextId:'archive-owner',vcs,blobs};
}
for(const world of openContentArchiveWorlds)it('checks exact native archive effects and literal answer obligations: '+world.id,async()=>{
 const fixture=await prepareContentArchive({contextId:'archive-owner',caseId:world.id},world,ports() as never);const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(observedContentReviewInput({...proof,actualResult:proof.report},world)).toEqual(proof.semanticReviewInput);expect(proof.outcomeContract.returnedValue.required).toBe(world.requestedReturnRequired);const absent=await fixture.verify(undefined);expect(absent.outcomeDimensions.returnedValue.passed).toBe(false);if(world.requestedReturnRequired)expect(absent.passed).toBe(false);
});
it('admits a reversed exact atomic write set and fresh post-write observation',async()=>{
 const world=openContentArchiveWorlds[0],fixture=await prepareContentArchive({contextId:'archive-owner',caseId:world.id},world,ports() as never),s=fixture.services,a=await s.contentArchiveEvidence.discover(),o=await s.contentArchiveEvidence.inspect(a.id);
 const receipt=await s.contentArchiveChange.restore(a.id,a.primary,o.workingRevision,[...a.permitted].reverse());expect(receipt.status).toBe('restored');const fresh=await s.contentArchiveEvidence.inspect(a.id);expect(fresh.workingRevision).not.toBe(o.workingRevision);expect((await fixture.verify({explanation:'The exact reviewed files are restored together locally; protected main is unchanged.',files:fresh.working})).passed).toBe(true);await expect(s.contentArchiveChange.restore('foreign',a.primary,fresh.workingRevision,a.permitted)).rejects.toThrow();
});
