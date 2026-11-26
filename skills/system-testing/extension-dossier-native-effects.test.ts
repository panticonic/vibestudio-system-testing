/** Actual fixture with isolated current VCS, immutable package reads and retained bytes; no model/network. */
import {expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const {requireDevelopmentTemplateCheckout}=createRequire(resolve(process.cwd(),'package.json'))('./src/dev/developmentTemplateConfig.cjs');
const base=process.env.VIBE_BASE_TEMPLATE??requireDevelopmentTemplateCheckout(process.cwd(),'base');
import {createHash} from 'node:crypto';
vi.mock('@workspace/runtime',()=>({contextId:'owned',vcs:{},fs:{},rpc:{},extensions:{}}));
import {prepareExtensionDossier} from './open-goal-extension-dossier-managed.js';
import {openExtensionDossierWorlds} from './open-goal-extension-dossier-worlds.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function fixture(id:string){
 const world=openExtensionDossierWorlds.find(w=>w.id.endsWith(id))!;
 let config:string|undefined;for(const root of [base,process.env.VIBE_SYSTEM_TEMPLATE].filter(Boolean))try{config=await readFile(root+'/'+world.source+'/package.json','utf8');break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(!config)throw Error('Missing selected native unit '+world.source);
 let state={kind:'event',eventId:'working'},working=config,code='export const candidate=true;';
 const content=new Map<string,string>(),dirs=new Set<string>();
 const client={status:async()=>({mainEventId:'main',workingHead:state}),resolveRepository:async()=>({repositoryId:'owned-repo'}),readFile:async(input:any)=>{const text=input.file.path==='package.json'?(input.state.eventId==='main'?config:working):code;return{repositoryId:'owned-repo',fileId:input.file.path,path:input.file.path,contentHash:hash(text),content:{kind:'text',text}};},edit:async(input:any)=>{for(const c of input.changes){if(c.fileId==='package.json')working=c.content.text;else code=c.content.text;}state={kind:'event',eventId:'candidate'};return{workingHead:state};}};
 const files={mkdtemp:async(prefix:string)=>{const p='/.tmp/'+prefix+'-'+crypto.randomUUID().replaceAll('-','');dirs.add(p);return p;},writeFile:async(p:string,t:string)=>{content.set(p,t);},rename:async(a:string,b:string)=>{content.set(b,content.get(a)!);content.delete(a);},rm:async(p:string)=>{dirs.delete(p);for(const f of content.keys())if(f.startsWith(p+'/'))content.delete(f);},readdir:async(p:string)=>p==='/.tmp'?[...dirs].map(d=>d.slice(6)):[]};
 const manifest=(text:string)=>{const c=JSON.parse(text);return{hash:hash(text),activation:c.vibestudio.extension.activationEvents[0]==='*'?'startup':'on-invoke',methods:Object.keys(c.vibestudio.extension.methodAuthority).sort()};};
 const binder=()=>{const operationId=crypto.randomUUID();return{request:{goal:world.goal,method:world.method,operationId},services:{extensionReleaseRead:{source:async()=>({operationId,contextId:'owned',name:world.name,source:world.source,workingRevision:state.eventId,mainRevision:'main',working:manifest(working),published:manifest(config),workingTree:hash(working+code),publishedTree:hash(config+'export const candidate=true;')}),runtime:async()=>({operationId,name:world.name,source:world.source,status:'idle',pendingApproval:false,hasError:false,activeEv:null,identity:null,methods:[]})}}};};
 const ports={contextId:'owned',vcs:client,fs:files,binder,extensionStatus:async()=>({name:world.name,source:world.source,identity:null,activeBundleKey:null,activeEv:null}),versions:async()=>({current:null,previous:[{releaseId:world.name,buildKey:'retained-build',effectiveVersion:'retained-ev',version:'1'}],retentionLimit:3}),metadata:async(key:string)=>key==='retained-build'?{kind:'extension',name:world.name,sourcePath:world.source,buildKey:key,ev:'retained-ev'}:null,readBytes:async(p:string,limit:number)=>{const bytes=new TextEncoder().encode(content.get(p)??'');if(bytes.length>limit)throw Error('Exceeded real bounded read');return bytes;}};
 return{world,native:await prepareExtensionDossier({contextId:'owned',caseId:world.id},world,ports as never),content};
}
it('records an owner-refused stage as a diagnostic rather than a persisted dossier or forbidden route',async()=>{
 const {native}=await fixture('speech-rehearsal-remains-local-without-note-grant');const s=native.services,a=await s.extensionDossierRead.discover(),id=a.request.operationId;
 await Promise.all([s.extensionReleaseRead.source(id),s.extensionReleaseRead.runtime(id),s.extensionDossierRead.candidate(id),s.extensionDossierRead.history(id)]);
 expect(await s.extensionDossierWrite.stage('verify-local-candidate')).toBeNull();
 const proof=await native.verify({explanation:'The current local tree still requires verification; no note grant exists.',dossier:null});
 expect(proof.checks.boundOriginalOwnerScope).toBe(true);expect(proof.checks.verifiedExactDossier).toBe(true);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.effects.filter(e=>e.service==='extensionDossierWrite')).toEqual([expect.objectContaining({method:'stage',result:null})]);
 expect(proof.semanticReviewInput.expected.observations.effects.map(row=>row.result)).toEqual(proof.effects.map(row=>row.result));
 expect(proof.semanticReviewInput.actual.attemptedArguments.map(row=>row.arguments)).toEqual(proof.effects.filter(row=>typeof row.method==="string"&&Array.isArray(row.args)).map(row=>row.args));
});
it('does not treat an available local grant as a requirement to create an unrequested artifact',async()=>{
 const {native}=await fixture('image-dependency-separate-runtime-and-candidate');const s=native.services,a=await s.extensionDossierRead.discover(),id=a.request.operationId;
 await Promise.all([s.extensionReleaseRead.source(id),s.extensionReleaseRead.runtime(id),s.extensionDossierRead.candidate(id),s.extensionDossierRead.history(id)]);
 const proof=await native.verify({explanation:'The candidate differs and needs verification.',dossier:null});expect(proof.checks.verifiedExactDossier).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 // This literal goal does request a note. Only mandatory meaning review judges
 // that missing requested effect; native permission alone does not establish it.
});
it('still rejects an unrecorded file masquerading as a retained owned dossier',async()=>{
 const {native,content}=await fixture('speech-rehearsal-remains-local-without-note-grant');const s=native.services,a=await s.extensionDossierRead.discover(),id=a.request.operationId;
 await Promise.all([s.extensionReleaseRead.source(id),s.extensionReleaseRead.runtime(id),s.extensionDossierRead.candidate(id),s.extensionDossierRead.history(id)]);
 const proof=await native.verify({explanation:'Claimed note.',dossier:{path:'/.tmp/foreign/handoff.json',bytes:4,sha256:hash('fake')}});expect(proof.checks.respectedLocalReleaseDecision).toBe(false);expect(content.has('/.tmp/foreign/handoff.json')).toBe(false);
});

for(const world of openExtensionDossierWorlds)it('qualifies actual dossier Native scope and persisted bytes: '+world.id,async()=>{const {native}=await fixture(world.id);const proof=await native.qualify();expect(proof.passed,JSON.stringify(proof.checks)).toBe(true);expect(proof.checks.referenceArtifact).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeContract.returnedValue.required).toBe(world.requestedReturnRequired);});
