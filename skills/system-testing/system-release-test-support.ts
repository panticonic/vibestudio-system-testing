/** TEST-only independent retained record/artifact ports. */
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {prepareSystemRelease} from "./open-goal-system-release-managed.js";
import {seedSystemRelease} from "./open-goal-system-release-records.js";
import {openSystemReleaseWorlds} from "./open-goal-system-release-worlds.js";
export async function releaseFixture(world: (typeof openSystemReleaseWorlds)[number], beforeRead?: (name:string)=>Promise<void>) {
 const owner="TEST-only-concurrent-release-owner",texts=new Map<string,string>(),headers=new Map<string,any>(),entries=new Map<string,any[]>(),files=new Map<string,string>(),reads:string[]=[];
 const seed=await seedSystemRelease(owner,world,{async put(text){const digest=sha256HexSyncText(text);texts.set(digest,text);return{digest,size:new TextEncoder().encode(text).length};},async persist(id,header,refs){headers.set(id,structuredClone(header));entries.set(id,structuredClone(refs));}});
 const ports={contextId:owner,async inspect(id:string){const h=headers.get(id);if(!h)throw new Error("No durable system-test record exists for "+id);return{...structuredClone(h.summary),config:structuredClone(h.config),provenance:structuredClone(h.provenance),startedAt:h.startedAt,updatedAt:h.updatedAt,completedAt:h.completedAt,diagnostics:{}};},async read(id:string,name:string,offset:number,limit:number){reads.push(name);await beforeRead?.(name);const ref=entries.get(id)?.find(x=>x.testName===name);if(!ref)throw new Error("Run "+id+" has no test named "+name);const text=texts.get(ref.digest)!;return{length:text.length,encoding:"plain-string",chunk:text.slice(offset,offset+limit)};},artifact:{async directory(){return"TEST-only-private-release";},async write(path:string,text:string){files.set(path,text);},async read(path:string,limit:number){return new TextEncoder().encode(files.get(path)??"").slice(0,limit);},async entries(path:string){return[...files.keys()].filter(x=>x.startsWith(path+"/")).map(x=>x.slice(path.length+1));}}};
 const f=await prepareSystemRelease({contextId:owner,caseId:world.id},world,seed,"TEST-only-native-target",ports);
 return{f,seed,headers,ports,reads,files,texts,entries};
}
