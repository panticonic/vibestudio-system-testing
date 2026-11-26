import {describe,it,expect} from "vitest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {prepareSystemRelease} from "./open-goal-system-release-managed.js";
import {seedSystemRelease} from "./open-goal-system-release-records.js";
import {openSystemReleaseWorlds} from "./open-goal-system-release-worlds.js";

async function fixture(world: (typeof openSystemReleaseWorlds)[number], beforeRead?: (name:string)=>Promise<void>) {
 const owner="TEST-only-concurrent-release-owner",texts=new Map<string,string>(),headers=new Map<string,any>(),entries=new Map<string,any[]>(),files=new Map<string,string>(),reads:string[]=[];
 const seed=await seedSystemRelease(owner,world,{async put(text){const digest=sha256HexSyncText(text);texts.set(digest,text);return{digest,size:new TextEncoder().encode(text).length};},async persist(id,header,refs){headers.set(id,structuredClone(header));entries.set(id,structuredClone(refs));}});
 const ports={contextId:owner,async inspect(id:string){const h=headers.get(id);if(!h)throw new Error("No durable system-test record exists for "+id);return{...structuredClone(h.summary),config:structuredClone(h.config),provenance:structuredClone(h.provenance),startedAt:h.startedAt,updatedAt:h.updatedAt,completedAt:h.completedAt,diagnostics:{}};},async read(id:string,name:string,offset:number,limit:number){reads.push(name);await beforeRead?.(name);const ref=entries.get(id)?.find(x=>x.testName===name);if(!ref)throw new Error("Run "+id+" has no test named "+name);const text=texts.get(ref.digest)!;return{length:text.length,encoding:"plain-string",chunk:text.slice(offset,offset+limit)};},artifact:{async directory(){return"TEST-only-private-release";},async write(path:string,text:string){files.set(path,text);},async read(path:string,limit:number){return new TextEncoder().encode(files.get(path)??"").slice(0,limit);},async entries(path:string){return[...files.keys()].filter(x=>x.startsWith(path+"/")).map(x=>x.slice(path.length+1));}}};
 const f=await prepareSystemRelease({contextId:owner,caseId:world.id},world,seed,"TEST-only-native-target",ports);
 return{f,seed,headers,ports,reads,files};
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}

describe("independent retained System release reads",()=>{
 it("accepts the actual failed Promise.all completion/witness composition and joins duplicate reads",async()=>{
  const world=openSystemReleaseWorlds.find(w=>w.id==="system-release-desk-review-only")!,gates=new Map(world.required.map(name=>[name,deferred()]));
  const {f,seed,reads}=await fixture(world,name=>gates.get(name)!.promise);
  const a=await f.services.systemReleaseEvidence.discover();await f.services.systemReleaseEvidence.compare(a.id);
  const first=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[0]!);
  const duplicate=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[0]!);
  const second=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[1]!);
  expect(reads).toEqual(world.required);gates.get(world.required[1]!)!.resolve();const witness=await second;expect(witness.name).toBe(world.required[1]);
  gates.get(world.required[0]!)!.resolve();const [completion,again]=await Promise.all([first,duplicate]);expect(again).toEqual(completion);
  const proof=await f.verify({assessment:{reason:"The actual two retained checks support this exact release."},handoff:null});expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 });
 it("refuses a handoff until every read settles and keeps foreign/case/header guards",async()=>{
  const world=openSystemReleaseWorlds.find(w=>w.id==="system-release-bulletin-current-verifies-exact-edition")!,gate=deferred();
  const {f,seed,headers,files}=await fixture(world,name=>name===world.required[1]?gate.promise:Promise.resolve());
  const a=await f.services.systemReleaseEvidence.discover();await f.services.systemReleaseEvidence.compare(a.id);
  const complete=await f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[0]!);
  const pending=f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,world.required[1]!);
  await expect(f.services.systemReleaseHandoff.stage(a.id,seed.current,"stage-acceptance",[complete])).rejects.toThrow();expect(files.size).toBe(0);
  await expect(f.services.systemReleaseEvidence.inspectCase("foreign",seed.current,world.required[0]!)).rejects.toThrow();
  await expect(f.services.systemReleaseEvidence.inspectCase(a.id,"foreign",world.required[0]!)).rejects.toThrow();
  await expect(f.services.systemReleaseEvidence.inspectCase(a.id,seed.current,"unassigned-case")).rejects.toThrow();
  gate.resolve();const witness=await pending;headers.get(seed.current).provenance.systemTestingBuild.buildKeys.production="changed-current-build";
  await expect(f.services.systemReleaseHandoff.stage(a.id,seed.current,"stage-acceptance",[complete,witness])).rejects.toThrow(/changed/);expect(files.size).toBe(0);
 });
 for(const world of openSystemReleaseWorlds)it("keeps native reference guards for "+world.id,async()=>{
  const {f}=await fixture(world);const result=await f.qualify();expect(result.passed).toBe(true);
 });
});
