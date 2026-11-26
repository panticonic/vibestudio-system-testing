import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({contextId:null,fs:{},rpc:{},vcs:{}}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:()=>{throw Error("No live reader in component test");}}));
vi.mock("@workspace-skills/scratch-handoff-bindings",async(original)=>({...await original<Record<string,unknown>>(),bindScratchHandoff:(fs:any)=>({scratchHandoffWrite:{stage:async(text:string)=>{const path="/.tmp/evidence-handoff-test/handoff.json";await fs.writeFile(path,text);return{path};}}})}));
import {prepareOpenExamplesAdoption} from "./open-goal-examples-adoption-managed.js";
import {openExamplesAdoptionWorlds} from "./open-goal-examples-adoption-worlds.js";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
async function fixture(id="settings-two-slots"){
 const world=openExamplesAdoptionWorlds.find(w=>w.id==="examples-adoption-"+id)!;
 const blobs=new Map<string,string>(), files=new Map<string,string>();
 const baseline=new Map([['meta/vibestudio.yml','systemEpoch: 0\nservices:\n  - name: regency\n    source: workers/regency-realm\n  - name: grimoire\n    source: workers/grimoire-world\n'],[world.unit+'/package.json',JSON.stringify({name:'@workspace-panels/grimoire'})]]);
 const states=new Map<string,Map<string,string>>([['main',baseline]]);let head='main',main='main',next=0;
 const ports={contextId:'ctx',putText:async(text:string)=>{const hash=sha256HexSyncText(text);blobs.set(hash,text);return hash;},
  fs:{writeFile:async(path:string,text:string)=>{files.set(path,text);},readdir:async()=>files.size?['evidence-handoff-test']:[]},
  readBytes:async(path:string)=>{if(!files.has(path))throw Error('Missing retained bytes');return new TextEncoder().encode(files.get(path)!);},
  vcs:{status:async()=>({mainEventId:main,workingHead:{kind:'event',eventId:head}}),
   resolveRepository:async({repoPath}:any)=>({repoPath,repositoryId:repoPath}),
   readFile:async({state,repositoryId,file}:any)=>{const text=states.get(state.eventId)?.get(repositoryId+'/'+file.path);return text===undefined?null:{content:{kind:'text',text},contentHash:sha256HexSyncText(text)};},
   importSnapshot:async({expectedWorkingHead,repositories}:any)=>{expect(expectedWorkingHead.eventId).toBe(head);const data=new Map(states.get(head)!);for(const repo of repositories)for(const f of repo.files)data.set(repo.repoPath+'/'+f.path,blobs.get(f.contentHash)!);head='event-'+ ++next;states.set(head,data);return{eventId:head,importedRepositoryIds:repositories.map((r:any)=>r.repoPath)};}}};
 const prepared=await prepareOpenExamplesAdoption({contextId:'ctx',caseId:world.id},world,ports as never);
 const svc=prepared.services;const card=(await svc.adoptionReview.discover())[0]!;await svc.adoptionReview.installed(card.id);const composition=await svc.adoptionReview.compose(card.id,card.event);await svc.adoptionReview.confirm(card.id,card.event);
 const plan={disposition:'record-private' as const,finding:'The effective model is openai-codex:gpt-6.1-sol and thinking level is medium.',proof:[composition.privateFiles.find(p=>p.endsWith('review-candidate.ts'))!,...composition.settings]};
 return{prepared,svc,card,plan,files,setMain:()=>{main='foreign-main';}};
}
it('accepts an extra accurate source with both requested settings and a later exact readback',async()=>{
 const {prepared,svc,card,plan}=await fixture();await svc.adoptionReview.readback(card.id,null);
 const receipt=await svc.adoptionHandoff.record(card.id,card.event,plan);expect(receipt).not.toBeNull();await svc.adoptionReview.readback(card.id,receipt!.path);
 const proof=await prepared.verify(receipt);expect(proof.checks.actualPrivateDisposition).toBe(true);expect(proof.checks.independentReadbackAndPreservedMain).toBe(true);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.journal.filter((r:any)=>r.method==='readback').map((r:any)=>r.result.digest)).toEqual([null,receipt!.digest]);
});
it('uses independent native bytes without requiring an extra actor readback',async()=>{
 const {prepared,svc,card,plan}=await fixture();const receipt=await svc.adoptionHandoff.record(card.id,card.event,plan);const proof=await prepared.verify(receipt);expect(proof.passed).toBe(true);expect(proof.journal.some((r:any)=>r.method==='readback')).toBe(false);
});
it('rejects changed retained bytes even after a successful actor readback',async()=>{
 const {prepared,svc,card,plan,files}=await fixture();const receipt=await svc.adoptionHandoff.record(card.id,card.event,plan);await svc.adoptionReview.readback(card.id,receipt!.path);files.set(receipt!.path,'changed');expect((await prepared.verify(receipt)).passed).toBe(false);
});
it('refuses a foreign proof item at the native publication boundary',async()=>{
 const {prepared,svc,card,plan}=await fixture();expect(await svc.adoptionHandoff.record(card.id,card.event,{...plan,proof:[...plan.proof,'foreign/source.ts']})).toBeNull();expect((await prepared.verify(null)).checks.actualPrivateDisposition).toBe(false);
});
it('keeps a requested but missing private artifact failed',async()=>{
 const {prepared}=await fixture();expect((await prepared.verify(null)).checks.actualPrivateDisposition).toBe(false);
});
it('refuses protected-main changes despite an earlier valid actor readback',async()=>{
 const {prepared,svc,card,plan,setMain}=await fixture();const receipt=await svc.adoptionHandoff.record(card.id,card.event,plan);await svc.adoptionReview.readback(card.id,receipt!.path);setMain();await expect(prepared.verify(receipt)).rejects.toThrow('preserve protected main');
});

it('treats a refused artifact request as no effect while preserving the actual readonly answer and alternate diagnostic category',async()=>{
 const {prepared,svc,card,plan,files}=await fixture("regency-owner-only");
 expect(await svc.adoptionHandoff.record(card.id,card.event,plan)).toBeNull();expect(files.size).toBe(0);
 const proof=await prepared.verify({disposition:"hold-authority",finding:"The actual composed owner is Examples; no new artifact was retained."});
 expect(proof.checks.actualPrivateDisposition).toBe(true);expect(proof.checks.returnedAdoptionValue).toBe(true);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.journal.some(row=>row.service==='adoptionHandoff'&&row.result===null)).toBe(true);
 files.set('/.tmp/evidence-handoff-test/handoff.json','unrequested artifact');expect((await prepared.verify({disposition:"explain-only",finding:"The composed owner is Examples."})).passed).toBe(false);
});
