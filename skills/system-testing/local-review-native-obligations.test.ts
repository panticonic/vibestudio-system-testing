import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({contextId:null,fs:{},rpc:{},vcs:{},panelTree:{}}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:()=>{throw Error("No live reader in component test");}}));
vi.mock("@workspace-skills/scratch-handoff-bindings",()=>({bindScratchHandoff:(fs:any)=>({scratchHandoffWrite:{stage:async(text:string)=>{const path="/.tmp/owned-scene/handoff.json";await fs.writeFile(path,text);return{path};}}})}));
import {validateScene,sceneDocument} from "@workspace/living-canvas";
import {prepareOpenGrimoireScene} from "./open-goal-grimoire-scene-managed.js";
import {openGrimoireSceneWorlds} from "./open-goal-grimoire-scene-worlds.js";

async function fixture(id="two-lantern-stops"){
 const world=openGrimoireSceneWorlds.find(w=>w.id==="grimoire-scene-"+id)!;
 const ownerId="natlang-scene-00000000-0000-4000-8000-000000000001";
 const resident=(id:string)=>({id,name:id,form:"resident",activity:"resting",x:100,y:200});
 const habitat=(id:string)=>({id,name:id,water:1,shade:1,shelter:1,x:300,y:400});
 const game={seated:null,pending:null,game:{turn:0,history:[],scene:{code:"ctx.fillRect(0,0,10,10);",description:"The current garden is shown.",assets:[]},life:{garden:{day:0,weather:"clear",residents:[resident("sol"),resident("pip")],habitats:[habitat("hollow"),habitat("bank"),habitat("meadow")]}}}};
 const files=new Map<string,string>();
 const ports={contextId:"ctx",fs:{writeFile:async(p:string,s:string)=>{files.set(p,s);},readdir:async()=>files.size?["owned-scene"]:[],rm:async()=>{files.clear();}},status:async()=>({mainEventId:"main",workingHead:{kind:"event",eventId:"main"}}),readBytes:async(p:string)=>new TextEncoder().encode(files.get(p)!),advanceFixture:async()=>{throw Error("No clock advance requested in this control");}};
 const installed={owner:()=>({read:async()=>structuredClone(game),catalog:async()=>({})}),validateScene,sceneDocument};
 const prepared=await prepareOpenGrimoireScene({contextId:"ctx",caseId:world.id,grimoireEstateKey:ownerId},world,installed as never,ports as never);
 const svc=prepared.services,card=(await svc.grimoireScene.discover())[0]!,view=await svc.grimoireScene.view(card.id);await svc.grimoireScene.readScope(card.id);
 return{prepared,svc,card,view,files,game};
}
it("retains five actual owned anchors without rewriting a valid description or inventing a planner report",async()=>{
 const {prepared,svc,card,view}=await fixture();await svc.grimoireScene.confirm(card.id,view.frontier);
 const receipt=await svc.grimoireHandoff.stage(card.id,view.frontier,{action:"stage-scene",finding:"",proposedIds:view.anchors.map(a=>a.id),description:view.description});
 expect(receipt).not.toBeNull();const proof=await prepared.verify(undefined);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();expect(proof.semanticReviewInput.actual.observations.current).toEqual(view);
 expect(JSON.parse(proof.body!).facts).toHaveLength(5);
});
it("establishes a read-only answer without a write lease or actor reread and without an opaque action label",async()=>{
 const {prepared}=await fixture("read-no-artifact");const result={finding:"The owned current scene is already installed; no candidate file was created."};
 const proof=await prepared.verify(result);expect(proof.passed).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(result);expect(proof.journal.some(r=>r.method==="confirm"||r.method==="readback")).toBe(false);
 const missing=await prepared.verify(undefined);expect(missing.outcomeDimensions.returnedValue.passed).toBe(false);
});
for(const kind of ["foreign","duplicate"] as const)it("refuses "+kind+" anchor authority at publication",async()=>{
 const {prepared,svc,card,view}=await fixture();await svc.grimoireScene.confirm(card.id,view.frontier);
 const ids=kind==="foreign"?["unknown-native-id"]:[view.anchors[0]!.id,view.anchors[0]!.id];
 expect(await svc.grimoireHandoff.stage(card.id,view.frontier,{action:"stage-scene",finding:"",proposedIds:ids,description:view.description})).toBeNull();expect((await prepared.verify(undefined)).passed).toBe(false);
});
it("rejects changed persisted bytes independently of an earlier successful native receipt",async()=>{
 const {prepared,svc,card,view,files}=await fixture();await svc.grimoireScene.confirm(card.id,view.frontier);
 const receipt=await svc.grimoireHandoff.stage(card.id,view.frontier,{action:"stage-scene",finding:"",proposedIds:["sol","hollow"],description:view.description});expect(receipt).not.toBeNull();
 files.set(receipt!.path,JSON.stringify({foreign:true}));expect((await prepared.verify(receipt)).passed).toBe(false);
});

import {prepareOpenSystemCandidate} from "./open-goal-system-candidate-managed.js";
import {openSystemCandidateWorlds} from "./open-goal-system-candidate-worlds.js";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
async function systemFixture(id="shared-mobile-label"){
 const world=openSystemCandidateWorlds.find(w=>w.id==="system-candidate-"+id)!;
 const blobs=new Map<string,string>(),files=new Map<string,string>(),states=new Map<string,Map<string,string>>();let head="main",next=0,delta:any;
 states.set(head,new Map([[world.unit+"/package.json",JSON.stringify({name:"@workspace-owned/test"})]]));
 const ports={contextId:"ctx",putText:async(text:string)=>{const hash=sha256HexSyncText(text);blobs.set(hash,text);return hash;},getText:async(hash:string)=>blobs.get(hash)??null,
 fs:{writeFile:async(p:string,s:string)=>{files.set(p,s);},readdir:async()=>files.size?["owned-scene"]:[],rm:async()=>{files.clear();}},readBytes:async(p:string)=>new TextEncoder().encode(files.get(p)!),
 vcs:{status:async()=>({mainEventId:"main",workingHead:{kind:"event",eventId:head}}),resolveRepository:async({repoPath}:any)=>({repoPath,repositoryId:repoPath}),
 readFile:async({state,repositoryId,file}:any)=>{const text=states.get(state.eventId)?.get(repositoryId+"/"+file.path);return text===undefined?null:{content:{kind:"text",text},contentHash:sha256HexSyncText(text)};},
 importSnapshot:async({expectedWorkingHead,repositories}:any)=>{expect(expectedWorkingHead.eventId).toBe(head);const data=new Map(states.get(head)!);for(const repo of repositories){for(const key of data.keys())if(key.startsWith(repo.repoPath+"/"))data.delete(key);for(const f of repo.files)data.set(repo.repoPath+"/"+f.path,blobs.get(f.contentHash)!);}head="event-"+ ++next;states.set(head,data);return{eventId:head,importedRepositoryIds:repositories.map((r:any)=>r.repoPath)};},
 registerExternalDelta:async(input:any)=>{delta=input;return{deltaId:"delta"};},
 compare:async({target,source}:any)=>{const before=new Map(delta.oldFiles.map((f:any)=>[f.path,f.contentHash])),incoming=new Map(delta.newFiles.map((f:any)=>[f.path,f.contentHash]));const paths=new Set<string>([...before.keys(),...incoming.keys()] as string[]);const coordinates=[...paths].map(p=>{const ours=states.get(target.eventId)?.get(delta.repoPath+"/"+p);const digest=ours===undefined?undefined:sha256HexSyncText(ours);const theirs=incoming.get(p),base=before.get(p);const status=digest===theirs?"convergent":digest===base?"adopt":theirs===base?"resolved":"conflict";return{coordinate:{kind:"file",id:"file:"+p,paths:{base:p,ours:p,theirs:p}},status,aspects:[{aspect:"content"}]};});return{target,source,nextCursor:null,coordinates};}}};
 const prepared=await prepareOpenSystemCandidate({contextId:"ctx",caseId:world.id},world,ports as never),svc=prepared.services;
 const card=(await svc.systemCandidateRead.discover())[0]!,frontier=await svc.systemCandidateRead.compare(card.id,card.workingEvent),coordinate=frontier.coordinates.find(c=>c.path===card.usual)!,preview=await svc.systemCandidateRead.preview(card.id,card.workingEvent,coordinate.id);
 return{prepared,svc,card,coordinate,preview,files};
}
it("establishes an actual read-only System finding without actor confirmation or a fixed classification",async()=>{
 const {prepared}=await systemFixture();const proof=await prepared.verify({finding:"Both exact file sides contain the same retained wording."});expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.journal.some(r=>r.method==="confirm")).toBe(false);expect((await prepared.verify(undefined)).outcomeDimensions.returnedValue.passed).toBe(false);
});
it("accepts a deduplicated set of actual source digests and independently reads the retained diagnosis",async()=>{
 const {prepared,svc,card,coordinate,preview}=await systemFixture("converged-release-rationale");await svc.systemCandidateRead.confirm(card.id,card.workingEvent,coordinate.id);
 const proof=[...new Set([preview.base.digest,preview.ours.digest,preview.theirs.digest].filter((s):s is string=>s!==null))];expect(proof).toHaveLength(2);
 const receipt=await svc.systemCandidateHandoff.record(card.id,card.workingEvent,coordinate.id,{decision:"keep-converged",record:true,finding:"The two retained sides made the same change.",proof});expect(receipt).not.toBeNull();
 const result=await prepared.verify(undefined);expect(result.passed).toBe(true);expect(result.semanticReviewInput.actual.requestedReturn).toBeNull();expect(result.semanticReviewInput.actual.artifacts.body).toContain("same change");expect(result.journal.some(r=>r.method==="readback")).toBe(false);
});
it("rejects a foreign System evidence digest before creating any diagnosis bytes",async()=>{
 const {prepared,svc,card,coordinate,files}=await systemFixture("converged-release-rationale");await svc.systemCandidateRead.confirm(card.id,card.workingEvent,coordinate.id);
 expect(await svc.systemCandidateHandoff.record(card.id,card.workingEvent,coordinate.id,{decision:"keep-converged",record:true,finding:"A diagnosis",proof:["foreign-content-digest"]})).toBeNull();expect(files.size).toBe(0);expect((await prepared.verify(undefined)).passed).toBe(false);
});

it("accepts genuine no-artifact System observations after an explicitly refused nullable stage",async()=>{
 const {prepared,svc,card,coordinate,files}=await systemFixture();
 expect(await svc.systemCandidateHandoff.record(card.id,card.workingEvent,coordinate.id,{decision:"keep-converged",record:true,finding:"The two current sides agree.",proof:[]})).toBeNull();expect(files.size).toBe(0);
 const proof=await prepared.verify({finding:"The exact local and incoming drafts use the same confirmation wording; no choice or artifact was retained."});expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.journal.some(row=>row.service==='systemCandidateHandoff'&&row.result===null)).toBe(true);
 files.set('/.tmp/owned-scene/handoff.json','unrequested artifact');expect((await prepared.verify({finding:"No artifact was authorized."})).passed).toBe(false);
});
