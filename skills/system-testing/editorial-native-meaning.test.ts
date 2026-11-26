import {expect,it,vi} from "vitest";
import {activate} from "@workspace-extensions/pdf-ingest";
import {prepareOpenEditorial} from "./open-goal-editorial-managed.js";
import {openEditorialWorlds} from "./open-goal-editorial-worlds.js";
vi.mock("@workspace/runtime",()=>({contextId:null,extensions:{},fs:{},rpc:{},vcs:{}}));
async function fixture(){
 const files=new Map<string,string>(),directories=new Set<string>(),revisions=new Map<string,Map<string,string>>();let revision=0;let live=new Map<string,string>();revisions.set("0",new Map());let repoPath="";
 const head=()=>({kind:"event" as const,eventId:String(revision)});
 const fs={mkdtemp:async(prefix:string)=>{const name=prefix+"-"+directories.size;directories.add(name);return "/.tmp/"+name;},writeFile:async(path:string,text:string)=>{files.set(path,text);},readFile:async(path:string)=>files.get(path),readdir:async()=>[...directories],rename:async(from:string,to:string)=>{files.set(to,files.get(from)!);files.delete(from);},rm:async()=>{}};
 const vcs={status:async()=>({mainEventId:"protected-main",committed:{root:"protected"},workingHead:head()}),resolveRepository:async()=>({repoPath,repositoryId:"owned-repo"}),readFile:async(input:any)=>{const text=revisions.get(input.state.eventId)?.get(input.file.path);return text===undefined?null:{fileId:input.file.path,content:{kind:"text",text}};},edit:async(input:any)=>{
  if(input.expectedWorkingHead.eventId!==String(revision)){const error=new Error("Native CAS changed") as Error&{code:string};error.code="RevisionChanged";throw error;}
  for(const change of input.changes){if(change.kind==="repository-create"){repoPath=change.repoPath;for(const file of change.files)live.set(file.path,file.content.text);}else{const before=live.get(change.fileId)!;let after=before;for(const edit of [...change.edits].reverse())after=after.slice(0,edit.start)+edit.text+after.slice(edit.end);live.set(change.fileId,after);}}
  revision++;revisions.set(String(revision),new Map(live));return {workingHead:head(),changeIds:["native-change-"+revision]};
 }};
 const pdf=await activate({storage:{mkdir:async()=>{},readFile:async(path:string)=>Buffer.from(files.get(path)??""),writeFile:async(path:string,data:string|Uint8Array)=>{files.set(path,typeof data==="string"?data:Buffer.from(data).toString());}},log:{info:()=>{}},health:{healthy:()=>{},degraded:()=>{}}},{engineStatus:async()=>[{id:"pdfjs",available:true,bundled:true,role:"text"}]});
 const openStore=async(_owner:string,title:string,description:string)=>{let mission={id:"owned-mission",title,description,revision:1,status:"active"};return{read:async()=>structuredClone(mission),list:async()=>[structuredClone(mission)],update:async(description:string)=>{mission={...mission,description,revision:mission.revision+1};return structuredClone(mission);}};};
 const ports={contextId:"editorial-owned",fs,vcs,pdf,readBytes:async(path:string,limit:number)=>{const value=new TextEncoder().encode(files.get(path)!);if(value.length>limit)throw Error("Bounded native bytes exceeded");return value;}};
 return {ports,openStore};
}
it.each(openEditorialWorlds)("$id retains exact original PDF, native CAS and protected copy independently of answer bookkeeping",async world=>{
 const f=await fixture();const prepared=await prepareOpenEditorial({contextId:"editorial-owned",caseId:world.id},f.openStore,f.ports as never);
 const proof=await prepared.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.expected.returnedDecisionRequired).toBe(world.requestedReturnRequired);
});
it("permits redundant editorial snapshots without additional PDF attestations or a reference disposition",async()=>{
 const f=await fixture();const world=openEditorialWorlds.find(world=>world.id==="editorial-packet-private-audit-source-card-single")!;
 const prepared=await prepareOpenEditorial({contextId:"editorial-owned",caseId:world.id},f.openStore,f.ports as never);const proof=await prepared.qualify();expect(proof.passed).toBe(true);
 const mission=proof.snapshots[0]!.mission;await prepared.services.editorialWorkspace.read(mission.id);await prepared.services.editorialWorkspace.read(mission.id);
 const value={document:{path:proof.stored.path,version:proof.stored.version},decision:{status:"held",write:false,explanation:"The stored payment label differs from the approved card instructions"},note:null};
 const result=await prepared.verify(value);expect(result.passed).toBe(true);expect(result.semanticReviewInput.actual.decision).toEqual(value.decision);expect(result.snapshots).toHaveLength(1);
});
it.each([
 ["editorial-packet-ready-candidate-without-note",true],
 ["editorial-packet-map-hours-new-window",false],
] as const)("%s keeps successful effects separate from the authored requested-answer obligation",async(id,required)=>{
 const f=await fixture();const prepared=await prepareOpenEditorial({contextId:"editorial-owned",caseId:id},f.openStore,f.ports as never);
 expect((await prepared.qualify()).passed).toBe(true);
 const proof=await prepared.verify(undefined);expect(proof.outcomeDimensions.effects.passed).toBe(true);
 expect(proof.outcomeDimensions.returnedValue.required).toBe(required);expect(proof.passed).toBe(!required);
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.decision).toBe(null);
});
it("accepts separately scoped field edits with real PDF evidence while refusing protected-copy changes and stale CAS",async()=>{
 const f=await fixture();const world=openEditorialWorlds.find(world=>world.id==="editorial-packet-ramp-captions-two-pages")!;
 const prepared=await prepareOpenEditorial({contextId:"editorial-owned",caseId:world.id},f.openStore,f.ports as never);
 const [mission]=await prepared.services.editorialMission.list();const opening=await prepared.services.editorialWorkspace.read(mission!.id);expect(opening).not.toBe(null);
 const plan={missionId:mission!.id,operation:"revise" as const,fields:world.fields.map(field=>field.label),note:world.note};
 const selection={attachment:"approved-proof.pdf",pages:[2,1],query:"The current entrance and ramp instructions"};
 const request=await prepared.services.editorialPdf.bind(opening!,plan,selection);expect(request).not.toBe(null);expect(request!.pages).toEqual([1,2]);
 const read=await prepared.services.pdfIntakeRead.read(request!.document,request!.pages,"embedded");
 const citations=read.pages.flatMap(page=>page.lines.map((line,index)=>({page:page.number,line:index,quote:line.text,bounds:line.bounds,source:line.source,confidence:line.confidence}))).reverse();
 const pdf={digest:read.digest,status:"verified" as const,readPages:request!.pages,remaining:[],unanswered:[],citations};
 const evidence=await prepared.services.editorialPdf.attest(pdf);expect(evidence.status).toBe("grounded");
 const [first,second]=world.fields;
 const partial={...opening!.candidate,text:opening!.candidate.text.replace(first!.before!,first!.after!)};
 const refused=await prepared.services.editorialRevision.apply(mission!.id,{...partial,text:partial.text.replace("Keep this accessibility and attribution paragraph unchanged.","Forged protected paragraph")});expect(refused.status).toBe("unavailable");
 const firstWrite=await prepared.services.editorialRevision.apply(mission!.id,partial);expect(firstWrite.status).toBe("written");
 const storedFirst=await prepared.services.editorialRevision.read(mission!.id);expect(storedFirst!.text).toContain(second!.before!);
 const stale=await prepared.services.editorialRevision.apply(mission!.id,{...partial,text:partial.text.replace(second!.before!,second!.after!)});expect(stale.status).toBe("changed");
 expect((await prepared.services.editorialRevision.read(mission!.id))!.text).toBe(storedFirst!.text);
 const finalProposal={...storedFirst!,text:storedFirst!.text.replace(second!.before!,second!.after!)};
 const secondWrite=await prepared.services.editorialRevision.apply(mission!.id,finalProposal);expect(secondWrite.status).toBe("written");
 const stored=await prepared.services.editorialRevision.read(mission!.id);expect(stored!.text).toContain(first!.after!);expect(stored!.text).toContain(second!.after!);
 const decision={status:"held" as const,write:false,explanation:"Both current native PDF instructions are stored; protected copy is unchanged"};
 const report={plan,opening:opening!,current:opening!,sources:[{selection,request,pdf,evidence}],edit:{proposed:partial,revised:finalProposal.text,attempts:[firstWrite,stale,secondWrite],stored:stored!},decision,note:null};
 const note=await prepared.services.editorialHandoff.stage(report);expect(note).not.toBe(null);
 const proof=await prepared.verify({document:{path:stored!.path,version:stored!.version},decision,note});expect(proof.passed).toBe(true);expect(proof.attempts.filter(attempt=>attempt.result.status==="written")).toHaveLength(2);
});
