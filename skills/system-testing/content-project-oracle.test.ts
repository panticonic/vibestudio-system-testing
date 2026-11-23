import {expect,it} from "vitest";
import {verifyContentProject} from "./content-project-oracle.js";
function fixture(){
 const before={clean:true,mainEventId:"main",committed:{kind:"event",eventId:"before"},workingHead:{kind:"event",eventId:"before"}};
 const current={...before,clean:false,workingHead:{kind:"application",applicationId:"private-draft"}};
 const request={goal:"Prepare a private visitor procedure for local review.",audience:"Facilitators",documentRoles:["Session procedure","Privacy restrictions"],facts:[{id:"session",text:"Run one participant at a time."},{id:"privacy",text:"Retain no participant names."}]};
 const files=[{path:"handbook.md",text:"# Local session\nRun one participant at a time.\n\n# Privacy\nRetain no participant names."},{path:"sources.json",text:JSON.stringify(request.facts)}];
 const vcs={status:async()=>current,resolveRepository:async({state}:{state:{kind:string}})=>state.kind==="application"?{repositoryId:"owned"}:null,
  listFiles:async()=>({files:files.map((f,index)=>({fileId:String(index),path:f.path})),nextCursor:null}),
  readFile:async({file}:{file:{fileId:string}})=>({fileId:file.fileId,path:files[Number(file.fileId)]!.path,content:{kind:"text",text:files[Number(file.fileId)]!.text}})};
 return {vcs,before,current,request,files};
}
it("does not require synthetic fact markers, exact headings or one file per role, and still requires semantic content review",async()=>{
 const x=fixture();const proof=await verifyContentProject(x.vcs as never,{contextId:"private",repoPath:"projects/owned",request:x.request,before:x.before as never,disposition:"draft"});
 expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput?.expected).toEqual(x.request);
 expect(proof.semanticReviewInput?.actual.documents).toEqual(x.files);
});
it("retains actual private-state, immutable source and broken navigation checks",async()=>{
 const x=fixture();x.current.mainEventId="foreign";x.files[0]!.text+="\n[Missing](not-here.md)";
 const proof=await verifyContentProject(x.vcs as never,{contextId:"private",repoPath:"projects/owned",request:x.request,before:x.before as never,disposition:"draft"});
 expect(proof.passed).toBe(false);expect(proof.reasons).toContain("Require clean initial context and unchanged protected main");expect(proof.reasons).toContain("Broken project link in handbook.md");
});
