import {expect,it} from "vitest";
import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {prepareOpenCapabilityPlan} from "./open-goal-capability-plan-managed.js";
it("binds actual optional knowledge and useful extra live methods without a hidden gold count, while rejecting fabricated native claims",async()=>{
 const quote="Actual live descriptions establish callable argument names and immutable content identities. ".repeat(6).trim();
 const state={kind:"event",eventId:"owned-head"},skill="skills/actual-guide",text="# Content identities\n\n"+quote;
 const schema={argsSchema:{type:"array",items:[{type:"string"}]},returnsSchema:{type:"string"}};
 const entries=new Map(["putText","getText","stat"].map(name=>{const id="service:blobstore."+name;return [id,{id,surface:"service",qualifiedName:"blobstore."+name,title:name,description:"Actual live method",argumentNames:[name==="putText"?"text":"hash"],...schema}];}));
 let writes=0;
 const f=await prepareOpenCapabilityPlan({contextId:"owned",caseId:"plan-content-addressed-citation"},{contextId:"owned",fs:{mkdtemp:async()=>"/.tmp/open-capability-owned",readdir:async()=>[],writeFile:async()=>{writes++;throw Error("Read-only goal");}} as never,vcs:{status:async()=>({workingHead:state,mainEventId:"protected-main"})} as never,rpc:{call:async(_target:any,method:any,args:any[])=>{
  const name=method.name;
  if(name==="workspace.listSkills")return [{name:"Actual guide",description:"Content identities",dirPath:skill,skillPath:skill+"/SKILL.md"}];
  if(name==="workspace.readSkill")return args[0]===skill?text:null;
  if(name==="docs.describe")return entries.get(args[0])??null;
  if(name==="docs.getSchema")return entries.has(args[0])?schema:null;
  if(name==="vcs.resolveRepository")return args[0].repoPath===skill?{repositoryId:"guide-repository",repoPath:skill,state}:null;
  if(name==="vcs.readFile")return {repositoryId:"guide-repository",repoPath:skill,path:"SKILL.md",fileId:"actual-guide-file",contentHash:sha256HexSyncText(text),content:{kind:"text",text}};
  throw Error("Unexpected native operation: "+name);
 }} as never});
 const opening=await f.services.docPlanContext.observe();
 const steps=[];
 for(const id of entries.keys()){
  const entry=(await f.services.docPlanCatalog.describe(id))!;
  steps.push({id,sha256:entry.sha256,argumentNames:entry.argumentNames,signature:entry.signature,purpose:"Useful actual native operation "+"with explanatory context ".repeat(18)});
 }
 const loaded=(await f.services.docPlanSkills.load(skill,["content","identities"]))!;
 expect(loaded).not.toBeNull();
 const plan={status:"ready",sourceRevision:opening.sourceRevision,steps,knowledge:[{skillPath:loaded.skillPath,sha256:loaded.sha256,revision:loaded.revision,quote}],missing:[],rationale:"The actual requested content identity and recovery interface. "+"Detailed grounded explanation. ".repeat(25),memoDisposition:"none",overview:null};
 const assessed=await f.verify({plan,handoff:null});
 expect(assessed.outcomeDimensions.effects.passed).toBe(true);
 expect(assessed.outcomeDimensions.returnedValue.passed).toBe(true);
 expect(assessed.semanticReviewRequired).toBe(true); // Native grounding is not a goal-meaning verdict.
 expect(assessed.semanticReviewInput).not.toBeNull();
 expect(writes).toBe(0);
 expect(await f.services.docPlanHandoff.stage(plan as never)).toBeNull(); // No native write grant.
 const badNames=await f.verify({plan:{...plan,steps:[{...steps[0],argumentNames:["invented"]},...steps.slice(1)]},handoff:null});
 expect(badNames.outcomeDimensions.returnedValue.passed).toBe(false);
 const badKnowledge=await f.verify({plan:{...plan,knowledge:[{...plan.knowledge[0],quote:"Invented source quote"}]},handoff:null});
 expect(badKnowledge.outcomeDimensions.returnedValue.passed).toBe(false);
 const falseMissing=await f.verify({plan:{...plan,missing:[{kind:"method",name:"blobstore.putText"}]},handoff:null});
 expect(falseMissing.outcomeDimensions.returnedValue.passed).toBe(false);
 const stale=await f.verify({plan:{...plan,sourceRevision:{kind:"event",eventId:"stale"}},handoff:null});
 expect(stale.outcomeDimensions.returnedValue.passed).toBe(false);
});
