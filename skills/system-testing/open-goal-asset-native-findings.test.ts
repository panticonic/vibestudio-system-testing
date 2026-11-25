/** Actual fixture/effect/verification implementation over snapshot VCS test ports
 * and real owned temporary filesystem. No production VCS/device/model claimed. */
import {expect,it} from "vitest";
import * as nfs from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {prepareOpenAssetIntegrity} from "./open-goal-asset-integrity-managed.js";
import {openAssetIntegrityWorlds} from "./open-goal-asset-integrity-worlds.js";
import {nativeAssetFindings} from "./asset-native-findings.js";
const hash=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
async function fixture(id:string){
 const world=openAssetIntegrityWorlds.find(w=>w.id==="asset-integrity-"+id)!;expect(world).toBeDefined();
 let ordinal=0,fileOrdinal=0,repoPath="",head={kind:"event",eventId:"initial"},committed=head;
 type File={id:string;path:string;mode:number;content:{kind:"text";text:string}|{kind:"bytes";base64:string}};
 const states=new Map<string,File[]>([[JSON.stringify(head),[]]]);
 const bytes=(file:File)=>file.content.kind==="text"?Buffer.from(file.content.text):Buffer.from(file.content.base64,"base64");
 const rows=(state:unknown)=>structuredClone(states.get(JSON.stringify(state))!);
 const publish=(files:File[])=>{head={kind:"event",eventId:"state-"+(++ordinal)};states.set(JSON.stringify(head),files);return structuredClone(head);};
 const vcs={status:async()=>({contextId:"asset-owned",mainEventId:"protected-main",workingHead:structuredClone(head),committed:structuredClone(committed)}),
  edit:async(input:any)=>{expect(input.expectedWorkingHead).toEqual(head);let files=rows(head);for(const change of input.changes){
   if(change.kind==="repository-create"){repoPath=change.repoPath;files=change.files.map((file:any)=>({...file,id:"file-"+(++fileOrdinal)}));}
   else if(change.kind==="file-create")files.push({id:"file-"+(++fileOrdinal),path:change.path,mode:change.mode,content:change.content});
   else if(change.kind==="file-delete")files=files.filter(file=>file.id!==change.fileId);
   else{const file=files.find(file=>file.id===change.fileId)!;if(change.kind==="content-replace")file.content=change.content;else if(change.kind==="file-mode")file.mode=change.mode;else throw Error("Unknown native test edit");}
  }return {workingHead:publish(files)};},
  commit:async(input:any)=>{expect(input.expectedWorkingHead).toEqual(head);committed=publish(rows(head));return {event:structuredClone(committed)};},
  move:async(input:any)=>{expect(input.expectedWorkingHead).toEqual(head);const files=rows(head);for(const move of input.moves)files.find(file=>file.id===move.fileId)!.path=move.destinationPath;return {workingHead:publish(files)};},
  resolveRepository:async()=>({repoPath,repositoryId:"owned-repository"}),
  listFiles:async({state}:any)=>({state,repositoryId:"owned-repository",nextCursor:null,files:rows(state).map(file=>({fileId:file.id,path:file.path,mode:file.mode,contentHash:hash(bytes(file)),byteLength:bytes(file).length,contentKind:file.content.kind}))}),
  readFile:async({state,file:{fileId}}:any)=>{const file=rows(state).find(row=>row.id===fileId);return file?{repoPath,repositoryId:"owned-repository",fileId,path:file.path,mode:file.mode,contentHash:hash(bytes(file)),content:file.content}:null;},
 };
 const fs={...nfs,mkdtemp:(prefix:string)=>nfs.mkdtemp(join(tmpdir(),prefix)),exists:(p:string)=>nfs.access(p).then(()=>true,()=>false)};
 const rpc={call:async(_target:unknown,_method:unknown,[path]:any[])=>{const bytes=await nfs.readFile(path);return {base64:bytes.toString("base64"),truncated:false,start:0,end:bytes.length,totalBytes:bytes.length};}};
 const prepared=await prepareOpenAssetIntegrity({contextId:"asset-owned",caseId:world.id},world,{contextId:"asset-owned",vcs:vcs as never,fs:fs as never,rpc:rpc as never});
 return {...prepared,world};
}
it("grounds a reused pathname in actual stable identities without expected flags, public IDs, status or all-edition read routes",async()=>{
 const f=await fixture("name-reused-after-deletion");try{
 const s=f.services.assetHistory,versions=await s.discover();
 for(const version of versions.filter(v=>v.edition!=="archive"))await s.listFiles(version.id);
 const proof=await f.verify({finding:"The old name now refers to a replacement workspace file, not the retained original.",recovery:null});
 expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);
 expect(proof.findings[0]!.differences).toEqual(["replaced"]);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput!.actual.observations.findings).toEqual(proof.findings);
 expect((await f.verify({finding:null,recovery:null})).outcomeDimensions.returnedValue.passed).toBe(false);
 expect((await f.verify({finding:"The original is absent.",recovery:{directory:"invented"}})).outcomeDimensions.returnedValue.passed).toBe(false);
 }finally{await f.close();}
});
it("retains real exact recovery bytes and modes for a permuted authorized selection while still requiring its requested findings",async()=>{
 const f=await fixture("complete-pair-different-drifts");try{
 const s=f.services,versions=await s.assetHistory.discover(),approved=versions.find(v=>v.edition==="approved")!,working=versions.find(v=>v.edition==="working")!;
 const files=await s.assetHistory.listFiles(approved.id);const inspected=await Promise.all(files.map(file=>s.assetHistory.inspect(approved.id,file.id)));await s.assetHistory.listFiles(working.id);
 const manifest=inspected.find(file=>file.manifest)!.manifest!;
 const selection=manifest.assets.map(claim=>({id:files.find(file=>file.path===claim.path)!.id,digest:claim.digest,output:claim.output})).reverse();
 const staged=await s.assetRecovery.stage(approved.id,working.id,selection);expect(staged.status).toBe("staged");if(staged.status!=="staged")throw Error("Expected actual recovery");
 const proof=await f.verify({finding:"The surface curve retained its identity after moving; the deep curve was replaced at its old name. Both signed originals are in the private kit.",recovery:staged.receipt});
 expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.outcomeDimensions.returnedValue.passed).toBe(true);
 expect((await f.verify({finding:null,recovery:staged.receipt})).outcomeDimensions.returnedValue.passed).toBe(false);
 await nfs.writeFile(join(staged.receipt.directory,selection[0]!.output),"corrupt");
 expect((await f.verify({finding:"Both recovered.",recovery:staged.receipt})).outcomeDimensions.effects.passed).toBe(false);
 }finally{await f.close();}
});
it("separates native digest/mode contradictions from stable identity, movement and equal-byte replacement",()=>{
 const original={id:"original",path:"sample.bin",digest:"signed-bytes",mode:420},claim={key:"sample",path:original.path,digest:original.digest,mode:original.mode};
 expect(nativeAssetFindings([claim],[original],[{...original,path:"moved.bin",mode:493}])[0]!.differences).toEqual(["moved","mode"]);
 expect(nativeAssetFindings([claim],[original],[{...original,id:"replacement"}])[0]!.differences).toEqual(["replaced"]);
 expect(nativeAssetFindings([{...claim,digest:"bad-claim"}],[original],[original])[0]!.differences).toEqual(["manifest"]);
 expect(nativeAssetFindings([claim],[],[])[0]!.differences).toEqual(["manifest"]);
});
