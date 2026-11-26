/** TEST ONLY: owned immutable VCS adapter for the native fixture boundary, not a model or goal oracle. */
import {createHash} from 'node:crypto';
import {vcsSearchInputSchema} from '@vibestudio/service-schemas/vcs';
import {expect} from 'vitest';
import type {ProvenanceQuestionWorld} from './open-goal-provenance-question-worlds.js';
type Change={id:string;path:string;before:string;after:string;work:string};
export function recordedQuestionPorts(world:ProvenanceQuestionWorld){
 const contextId='context-'+world.id,repositoryId='owned-repository';
 const blobs=new Map<string,string>(),files=new Map<string,string>(),ids=new Map<string,string>();
 const snapshots=new Map<string,Map<string,string>>(),works=new Map<string,{intent:string;changes:Change[]}>();
 const changes=new Map<string,Change>(),counteractions:{original:Change;work:string;reason:string}[]=[];
 const calls:{method:string;input:unknown}[]=[];
 let current='initial',revision=0,scope='',searchError:Error|undefined;
 const state=()=>({kind:'event' as const,eventId:current});
 const save=()=>{snapshots.set(current,new Map(files));};save();
 function context(input:{contextId:string}){expect(input.contextId).toBe(contextId);}
 function basis(input:{expectedWorkingHead:unknown}){expect(input.expectedWorkingHead).toEqual(state());}
 function work(intent:string,list:Omit<Change,'id'|'work'>[]){const id='work-'+(works.size+1);const actual=list.map((c,i)=>({...c,id:id+'-change-'+i,work:id}));works.set(id,{intent,changes:actual});for(const c of actual){changes.set(c.id,c);files.set(c.path,c.after);}current='pending-'+(++revision);save();return {workUnitId:id,changeIds:actual.map(c=>c.id),workingHead:state()};}
 const vcs={
  async mainState(){return {event:{kind:'event',eventId:'protected-main'}};},
  async status(input:{contextId:string}){context(input);return {clean:true,workingHead:state()};},
  async resolveRepository(input:{repoPath:string;state:unknown}){expect(input.repoPath).toBe(scope);expect(input.state).toEqual(state());return {repositoryId};},
  async importSnapshot(input:any){context(input);basis(input);expect(input.repositories).toHaveLength(1);scope=input.repositories[0].repoPath;for(const f of input.repositories[0].files){const text=blobs.get(f.contentHash);expect(text).toBeTypeOf('string');files.set(f.path,text!);ids.set(f.path,'file-'+ids.size);}current='imported';save();return {eventId:current,importedRepositoryIds:[repositoryId]};},
  async readFile(input:any){expect(input.repositoryId).toBe(repositoryId);expect(input.file.kind).toBe('path');const snapshot=snapshots.get(input.state.eventId);expect(snapshot).toBeDefined();const text=snapshot!.get(input.file.path);if(text===undefined)return null;return {repositoryId,fileId:ids.get(input.file.path),path:input.file.path,contentHash:createHash('sha256').update(text).digest('hex'),content:{kind:'text',text}};},
  async edit(input:any){context(input);basis(input);return work(input.intentSummary,input.changes.map((c:any)=>{expect(c.kind).toBe('text-edit');expect(c.repositoryId).toBe(repositoryId);const path=[...ids].find(([,id])=>id===c.fileId)?.[0];expect(path).toBeDefined();const before=files.get(path!)!;expect(c.edits).toHaveLength(1);expect([c.edits[0].start,c.edits[0].end]).toEqual([0,before.length]);return {path:path!,before,after:c.edits[0].text};}));},
  async commit(input:any){context(input);basis(input);current='committed-'+(++revision);save();return {event:state()};},
  async revert(input:any){context(input);basis(input);const originals=input.changeIds.map((id:string)=>{const c=changes.get(id);expect(c).toBeDefined();return c!;});const result=work(input.intentSummary,originals.map((c:Change)=>({path:c.path,before:files.get(c.path)!,after:c.before})));for(const original of originals)counteractions.push({original,work:result.workUnitId,reason:input.intentSummary});return result;},
  async query(input:any){context(input);calls.push({method:'query',input});const match=/work_unit_id = '([^']+)'/.exec(input.query);expect(match).not.toBeNull();const id=match![1];const row=works.get(id);expect(row).toBeDefined();let rows:unknown[][];
   if(input.query.startsWith('SELECT change_id, result_path'))rows=row!.changes.map(c=>[c.id,c.path]);
   else if(input.query.startsWith('SELECT result_path, count'))rows=[...new Set(row!.changes.map(c=>c.path))].sort().map(path=>[path,row!.changes.filter(c=>c.path===path).length]);
   else if(input.query.includes('FROM prov_counteractions'))rows=counteractions.filter(c=>c.original.work===id).map(c=>[c.original.path,c.work]);
   else throw Error('Unexpected native query');
   return {state:state(),rows,truncated:false,refusal:null};
  },
  async search(input:any){context(input);vcsSearchInputSchema.parse(input);calls.push({method:'search',input});if(searchError)throw searchError;const text=input.text.toLowerCase();const hits=[...works].filter(([,w])=>w.intent.toLowerCase().includes(text)).map(([id,w])=>({node:{kind:'work-unit',workUnitId:id},intent:{text:w.intent,tier:'stated'},excerpt:w.intent}));return {text:input.text,indexMode:'fts',hits,truncated:false};},
  async walk(input:any){context(input);expect([input.walk,input.scope,input.subject.kind,input.subject.repositoryId,input.subject.state]).toEqual(['rejections','work-unit','file',repositoryId,state()]);calls.push({method:'walk',input});const path=[...ids].find(([,id])=>id===input.subject.fileId)?.[0];expect(path).toBeDefined();return {state:state(),nextCursor:null,omitted:[],entries:counteractions.filter(c=>c.original.path===path).map(c=>({group:'counteractions',node:{kind:'work-unit',workUnitId:c.work},intent:{text:c.reason,tier:'stated'},detail:works.get(c.original.work)!.intent}))};},
 };
 const ports={contextId,upload:async(text:string)=>{const digest=createHash('sha256').update(text).digest('hex');blobs.set(digest,text);return digest;},vcs};
 return {ports,calls,controls:{headChanged(){current='foreign-current';save();},corruptProtectedBytes(){files.set('desk/other-note.txt','Unrequested foreign edit');save();},failSearch(error:Error){searchError=error;}}};
}
