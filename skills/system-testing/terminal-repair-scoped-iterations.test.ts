/** Real createUnitRepair plumbing over deterministic native VCS/build ports;
 * this tests fixture authority and CAS, not a native compiler or model. */
import {expect,it} from "vitest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {prepareOpenTerminalAppRepair} from "./open-goal-terminal-app-repair-managed.js";
import {terminalAppRepairWorlds} from "./open-goal-terminal-app-repair-worlds.js";

async function fixture(mode:"repair"|"hold-moved"|"hold-edit"|"hold-test"="repair") {
 const original=terminalAppRepairWorlds.find(world=>world.mode===mode)!;
 const blobs=new Map<string,string>(),files=new Map<string,string>();
 let version=0,unit="",builds=0,writes=0;
 const head=()=>({kind:"event" as const,eventId:`native-${version}`});
 const vcs={
  status:async()=>({workingHead:head(),mainEventId:"protected-main"}),
  importSnapshot:async(input:any)=>{
   const repository=input.repositories[0]; unit=repository.path??repository.repoPath;
   for(const file of repository.files)files.set(file.path,blobs.get(file.contentHash)!);
   version++; return {eventId:head().eventId,importedRepositoryIds:["owned-repository"]};
  },
  resolveRepository:async(input:any)=> input.repoPath===unit?{repositoryId:"owned-repository"}:null,
  listFiles:async()=>({files:[...files.keys()].map(path=>({path})),nextCursor:null}),
  readFile:async(input:any)=> files.has(input.file.path)?{repositoryId:"owned-repository",fileId:input.file.path,content:{kind:"text",text:files.get(input.file.path)}}:null,
  edit:async(input:any)=>{
   if(JSON.stringify(input.expectedWorkingHead)!==JSON.stringify(head()))throw Error("Revision changed");
   for(const change of input.changes){
    if(change.repositoryId!=="owned-repository")throw Error("foreign repository");
    const before=files.get(change.fileId)!;
    for(const edit of change.edits){if(edit.start!==0||edit.end!==before.length)throw Error("invalid source replacement");files.set(change.fileId,edit.text);}
   }
   writes++;version++;return {workingHead:head()};
  },
 };
 const prepared=await prepareOpenTerminalAppRepair("owned-context",original,{
  vcs:vcs as never,
  putText:async(text:string)=>{const digest=sha256HexSyncText(text);blobs.set(digest,text);return {digest};},
  getBuildReport:async()=>{builds++;return {stateHash:`state-${version}`,repoPath:unit,kind:"terminal",status:"failed",diagnostics:[],builds:[]};},
  verifyTests:async()=>{throw Error("A failed build cannot run native tests");},
 });
 const [app]=await prepared.services.terminalRepairCatalog.list();
 return {...prepared,app:app!,files,counts:()=>({builds,writes})};
}
it("supports fresh observations, repeated verification, and multiple observed CAS edits without accepting forged or stale revisions",async()=>{
 const f=await fixture(); const service=f.services;
 const first=await service.terminalRepairObserve.read(f.app.id);
 const repeated=await service.terminalRepairObserve.read(f.app.id);
 expect(repeated).toEqual(first);expect(f.counts().builds).toBe(3);
 const source=first.observed.sources.find(row=>row.path.endsWith("/index.ts"))!;
 const edit=(before:string,after:string)=>[{path:source.path,before,after}];
 await expect(service.terminalRepairApply.edit(f.app.id,"forged",edit(source.text,source.text+"\n// first"))).rejects.toThrow("observed source");
 const one=await service.terminalRepairApply.edit(f.app.id,first.observed.revision,edit(source.text,source.text+"\n// first"));
 await expect(service.terminalRepairApply.edit(f.app.id,first.observed.revision,edit(source.text,"stale"))).rejects.toThrow("Revision changed");
 const checked=await service.terminalRepairFinal.verify(f.app.id,one.revision);
 expect(await service.terminalRepairFinal.verify(f.app.id,one.revision)).toEqual(checked);
 const current=checked.observed.sources.find(row=>row.path===source.path)!;
 await expect(service.terminalRepairApply.edit(f.app.id,one.revision,[{path:f.app.path+"/index.test.ts",before:"",after:""}])).rejects.toThrow("editable production source");
 const two=await service.terminalRepairApply.edit(f.app.id,one.revision,edit(current.text,current.text+"\n// second"));
 await expect(service.terminalRepairArtifact.read(f.app.id,one.revision)).rejects.toThrow("independently verified");
 const latest=await service.terminalRepairObserve.read(f.app.id);
 expect(latest.observed.revision).toBe(two.revision);expect(latest.observed.sources.find(row=>row.path===source.path)?.text).toContain("// second");
 await service.terminalRepairFinal.verify(f.app.id,two.revision);
 const proof=await f.verify(null);
 expect(proof.checks.authorizedRepairOrHold).toBe(true);
 expect(proof.checks.exactOwnedTerminalSource).toBe(true);
 expect(proof.checks.protectedOriginalTestAndMain).toBe(true);
 expect(proof.checks.exactNativeTestAndArtifact).toBe(false); // Failed compiler cannot become a successful repair.
 expect(f.counts().writes).toBe(2);
 await expect(service.terminalRepairObserve.read("foreign")).rejects.toThrow("currently owned");
});
it("preserves the explicitly reviewed-draft stop after an independent coauthor moves the actual CAS head",async()=>{
 const f=await fixture("hold-moved");const first=await f.services.terminalRepairObserve.read(f.app.id);
 const source=first.observed.sources.find(row=>row.path.endsWith("/index.ts"))!;
 expect((await f.services.terminalRepairApply.edit(f.app.id,first.observed.revision,[{path:source.path,before:source.text,after:"replacement"}])).status).toBe("moved");
 const fresh=await f.services.terminalRepairObserve.read(f.app.id);
 await expect(f.services.terminalRepairApply.edit(f.app.id,fresh.observed.revision,[{path:source.path,before:fresh.observed.sources.find(row=>row.path===source.path)!.text,after:"overwrite"}])).rejects.toThrow("authority");
 await expect(f.services.terminalRepairFinal.verify(f.app.id,fresh.observed.revision)).rejects.toThrow("exact observed");
 expect(f.counts().writes).toBe(1); // Only the independently authored replacement.
});
it.each(["hold-edit","hold-test"] as const)("retains %s authority through repeated observations",async mode=>{
 const f=await fixture(mode);const first=await f.services.terminalRepairObserve.read(f.app.id);await f.services.terminalRepairObserve.read(f.app.id);
 const source=first.observed.sources.find(row=>row.path.endsWith("/index.ts"))!;
 await expect(f.services.terminalRepairApply.edit(f.app.id,first.observed.revision,[{path:source.path,before:source.text,after:"unauthorized"}])).rejects.toThrow("authority");
 expect(f.counts().writes).toBe(0);
});
