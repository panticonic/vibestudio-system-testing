import {expect,it,vi} from "vitest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
vi.mock("@workspace/runtime",()=>({fs:{},vcs:{},rpc:{}}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:()=>{throw Error("Use the assigned test filesystem");}}));
vi.mock("./session-replay-managed.js",()=>({createOwnedHeadlessChannel:()=>{throw Error("No boundary channel in this test");}}));
import {prepareDeployedInterfaceGoal} from "./open-goal-deployed-interface-managed.js";
import {openDeployedInterfaceWorlds} from "./open-goal-deployed-interface-worlds.js";
it.each(["local-review","inspect-only"] as const)("does not turn %s permission into a requested artifact",async grant=>{
 const original=openDeployedInterfaceWorlds.find(row=>row.id==="deployed-interface-agent-metadata-is-not-model-work")!;
 const world={...original,grant};
 const head={kind:"event",eventId:"native-head"};
 const files=new Map<string,string>();let sequence=0;
 const directories=new Set<string>();
 const filesystem={
  async mkdtemp(prefix:string){const path=`/.tmp/${prefix}-${String(++sequence).padStart(32,"a")}`;directories.add(path);return path;},
  async writeFile(path:string,text:string){files.set(path,text);},
  async rename(from:string,to:string){files.set(to,files.get(from)!);files.delete(from);},
  async rm(path:string){directories.delete(path);for(const key of files.keys())if(key.startsWith(path+"/"))files.delete(key);},
  async readdir(path:string){return [...directories].filter(row=>row.startsWith(path+"/")).map(row=>row.slice(path.length+1));},
 };
 const bytes=async(path:string,limit:number)=>{const text=files.get(path);if(text===undefined)throw Error("Missing native bytes");const value=new TextEncoder().encode(text);if(value.length>limit)throw Error("Native byte limit");return value;};
 const vcs={async status(){return {mainEventId:head.eventId,workingHead:head};},async resolveRepository({repoPath}:{repoPath:string}){return {repositoryId:repoPath};},async readFile({repositoryId}:{repositoryId:string}){const text=JSON.stringify({name:"@workspace-workers/agent-worker",vibestudio:{entry:"index.ts",agent:{},durable:{classes:[{className:"AiChatWorker"}]}}});return {repositoryId,path:"package.json",contentHash:sha256HexSyncText(text),content:{kind:"text",text}};}};
 const ports={contextId:"native-interface",fs:filesystem,vcs,readBytes:bytes,architecture:vi.fn(),createOwnedChannel:vi.fn(),extensionStatus:vi.fn(),runningObjects:vi.fn(),metadata:vi.fn()};
 const fixture=await prepareDeployedInterfaceGoal({contextId:ports.contextId,caseId:world.id},world,ports as never);
 const survey=await fixture.services.interfaceEvidence.discover();
 const selected=survey.subjects.find(row=>row.source===world.target.source)!;
 const observation=await fixture.services.interfaceEvidence.inspect(selected.id);
 const report={finding:{decision:"reviewable",reason:"The installed agent declares index.ts and receiver AiChatWorker. No live deployment claim or launch is made."},handoff:null};
 const proof=await fixture.verify(report as never);
 expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.outcomeDimensions.returnedValue.required).toBe(true);
 expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);
 expect(proof.handoff).toBeNull();
 expect(proof.observation.classes).toEqual(["AiChatWorker"]);
 if(grant==="local-review"){
  const receipt=await fixture.services.interfaceReviewHandoff.stage(observation,"reviewable");
  expect(receipt).not.toBeNull();
  expect((await fixture.verify({...report,handoff:receipt} as never)).passed).toBe(true);
  files.set(receipt!.path,"tampered native artifact");
  expect((await fixture.verify({...report,handoff:receipt} as never)).checks.verifiedExactLocalHandoff).toBe(false);
 }else{
  expect(await fixture.services.interfaceReviewHandoff.stage(observation,"reviewable")).toBeNull();
 }
});
