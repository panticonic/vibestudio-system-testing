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

it("distinguishes the unchanged baseline commit from creating a new commit for a working draft",async()=>{
 const x=fixture();const result=await verifyContentProject(x.vcs as never,{contextId:"private",repoPath:"projects/owned",request:x.request,before:x.before as never,disposition:"draft"});
 const actual=result.semanticReviewInput!.actual;
 expect(actual).not.toHaveProperty("committedEvent");
 expect(actual.lifecycle.baseline.committedEvent).toEqual(x.before.committed);
 expect(actual.lifecycle.current.committedEvent).toEqual(x.before.committed);
 expect(actual.lifecycle.delta).toEqual({committedEventChanged:false,workingHeadChanged:true,protectedMainChanged:false});
 expect(actual.lifecycle.requestedDisposition).toBe("draft");
});
function committedFixture(){
 const x=fixture();x.current.clean=true;x.current.committed={kind:'event',eventId:'after'};x.current.workingHead={kind:'event',eventId:'after'} as never;
 const effects:Record<string,unknown[]>={create:[{kind:'repository-placement',repositoryId:'owned',beforePath:null,afterPath:'projects/owned'},{kind:'placement',fileId:'temporary',before:null,after:{repositoryId:'owned',path:'temporary.md'}}],repair:[{kind:'repository-placement',repositoryId:'owned',beforePath:null,afterPath:null},{kind:'placement',fileId:'temporary',before:{repositoryId:'owned',path:'temporary.md'},after:null}]};
 const vcs={...x.vcs,resolveRepository:async({state}:{state:{eventId?:string}})=>state.eventId==='before'?null:{repositoryId:'owned'},inspect:async({node}:{node:{kind:string;applicationId?:string;workUnitId?:string}})=>{
  if(node.kind==='event')return {node:{kind:'event',value:{parentEventIds:['before'],applicationIds:['create','repair']}}};
  if(node.kind==='application')return {node:{kind:'application',value:{workUnitId:node.applicationId,appliedChangeCount:1,appliedChanges:[{appliedEffects:effects[node.applicationId!]!}]}}};
  return {node:{kind:'work-unit',value:{authorContextId:'private',kind:node.workUnitId==='create'?'lifecycle':'edit'}}};
 }};
 return {...x,vcs,effects};
}
it('allows actual owned project repairs, no-op repository effects and removed intermediate pages',async()=>{
 const x=committedFixture();const proof=await verifyContentProject(x.vcs as never,{contextId:'private',repoPath:'projects/owned',request:x.request,before:x.before as never});
 expect(proof.passed).toBe(true);expect(proof.semanticReviewInput!.actual.lifecycle.delta.committedEventChanged).toBe(true);
});
it('still rejects foreign repository movement during a repair',async()=>{
 const x=committedFixture();x.effects.repair!.push({kind:'placement',fileId:'temporary',before:{repositoryId:'owned',path:'temporary.md'},after:{repositoryId:'foreign',path:'leak.md'}});
 const proof=await verifyContentProject(x.vcs as never,{contextId:'private',repoPath:'projects/owned',request:x.request,before:x.before as never});
 expect(proof.passed).toBe(false);expect(proof.reasons).toContain('File moved outside assigned repository');
});
