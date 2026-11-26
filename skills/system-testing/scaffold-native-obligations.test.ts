import {expect,it,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({contextId:null,vcs:{}}));
import {CURRENT_HOST_ABI} from "@vibestudio/workspace-contracts/clients";
import {buildProjectManifest,preflightProjectFiles} from "@workspace-skills/workspace-dev/project-manifest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {prepareOpenScaffold} from "./open-goal-scaffold-managed.js";
import {openScaffoldWorlds} from "./open-goal-scaffold-worlds.js";
async function fixture(id="mobile-workspace-starter"){
 const world=openScaffoldWorlds.find(w=>w.id==="scaffold-review-"+id)!;
 let head="initial";const repositories=new Map<string,Record<string,string>>();
 const states=new Map([[head,new Map<string,Record<string,string>>()]]);
 const ports={contextId:"ctx",vcs:{status:async()=>({mainEventId:"main",workingHead:{kind:"event",eventId:head}}),
 resolveRepository:async({state,repoPath}:any)=>states.get(state.eventId)?.has(repoPath)?{repositoryId:repoPath,repoPath}:null,
 listFiles:async({state,repositoryId}:any)=>({state,repositoryId,nextCursor:null,files:Object.entries(states.get(state.eventId)?.get(repositoryId)??{}).map(([path,text])=>({path,fileId:path,contentHash:sha256HexSyncText(text)}))}),
 readFile:async({state,repositoryId,file}:any)=>{const path=file.path??file.fileId,text=states.get(state.eventId)?.get(repositoryId)?.[path];return text===undefined?null:{path,content:{kind:"text",text},contentHash:sha256HexSyncText(text)};}}};
 const installed={preflightProjectFiles,prepareProjects:async(projects:any[],command:any)=>{
  expect(head).toBe(command.expectedWorkingHead.eventId);head="retained-native-client";
  return projects.map(project=>{expect(project.projectType).toBe("client");expect(project.runtime).toBe(CURRENT_HOST_ABI["react-native"]);
   const client={id:project.name,runtime:"react-native" as const,hostAbi:project.runtime,entry:"App.tsx",title:project.title,capabilities:{required:[],optional:[]},intents:[{name:"open",kind:"foreground" as const,title:"Open"}]};
   const files={"package.json":JSON.stringify(buildProjectManifest({projectType:"client",name:project.name,title:project.title,client})),"App.tsx":"export default function App(){return null;}"};
   const created="clients/"+project.name;repositories.set(created,files);states.set(head,new Map(repositories));
   return{created,files:Object.keys(files),preflight:preflightProjectFiles({projectType:"client",name:project.name,files}),preparation:{protocol:"project-preparation.v1",command:{commandId:command.commandId,contextId:"ctx"},workingHead:{kind:"event",eventId:head},publication:"unchanged",liveRuntime:"unchanged"}};
  });
 }};
 const prepared=await prepareOpenScaffold({contextId:"ctx",caseId:world.id},world,installed as never,ports as never);
 const svc=prepared.services,card=(await svc.scaffoldRead.discover())[0]!;await svc.scaffoldRead.options(card.id);
 return{prepared,svc,card,repositories};
}
it("requires the explicitly requested mobile authority answer even after exact native draft retention",async()=>{
 const {prepared,svc,card}=await fixture();const receipt=await svc.scaffoldPrepare.prepare(card.id,card.event,["native-client"]);expect(receipt).not.toBeNull();expect(receipt!.units[0]!.authority).toEqual(["context.boundary"]);
 const missing=await prepared.verify(undefined);expect(missing.outcomeDimensions.effects.passed,JSON.stringify(missing.checks)).toBe(true);expect(missing.outcomeDimensions.returnedValue.passed).toBe(false);expect(missing.passed).toBe(false);
 const proof=await prepared.verify(receipt);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(receipt);expect(proof.semanticReviewInput.actual.observations.units[0].authority).toEqual(["context.boundary"]);expect(proof.journal.some(r=>r.method==="readback")).toBe(false);
});
it("keeps unsupported returned authority claims visible beside actual native facts for mandatory meaning review",async()=>{
 const {prepared,svc,card}=await fixture();const receipt=await svc.scaffoldPrepare.prepare(card.id,card.event,["native-client"]);expect(receipt).not.toBeNull();
 const claimed={...receipt!,units:receipt!.units.map(unit=>({...unit,authority:["invented.authority"]}))};const proof=await prepared.verify(claimed);
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(claimed);expect(proof.semanticReviewInput.actual.observations.units[0].authority).toEqual(["context.boundary"]);
});
it("denies a foreign brief and a stale authoring basis without manufacturing a draft receipt",async()=>{
 const {svc,card,repositories}=await fixture();await expect(svc.scaffoldPrepare.prepare("foreign",card.event,["native-client"])).rejects.toThrow(/owned scaffold/);expect(await svc.scaffoldPrepare.prepare(card.id,"stale-basis",["native-client"])).toBeNull();expect(repositories.size).toBe(0);
});

it("keeps a refused draft boundary and real absence of files distinct from an actual prepared draft",async()=>{
 const {prepared,svc,card,repositories}=await fixture("advice-only-runtime");expect(await svc.scaffoldPrepare.prepare(card.id,card.event,["agentic"])).toBeNull();expect(repositories.size).toBe(0);
 const proof=await prepared.verify({finding:"A durable agent worker can retain the conversation and have a native test; no files were created."});expect(proof.checks.exactNativeScaffoldDraft).toBe(true);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.journal.some(row=>row.service==='scaffoldPrepare'&&row.result===null)).toBe(true);
});
