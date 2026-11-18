import type {TestCase} from "../types.js";
import {contentProjectWorlds} from "../content-project-worlds.js";

export const contentProjectTests:TestCase[]=contentProjectWorlds.map(world=>({
  name:`content-project-${world.id}`,category:"project-lifecycle",explicitOnly:true,validation:"harness",
  description:"Author and locally commit a grounded content project using actual workspace preparation and independently inspected state",
  prompt:world.request.goal,
  async orchestrate(context){
    context.signal.throwIfAborted();const started=Date.now();
    const observed=await context.runner.runContentProject(world.request);
    if(observed.kind!=="teacher")throw new Error("Content teacher returned a reference result");
    context.signal.throwIfAborted();
    return {messages:[],duration:Date.now()-started,provenance:{channelId:null,branchId:null,agentEntityId:null,agentTargetId:null,contextId:observed.result.world.contextId},diagnostics:{natlangTeacher:observed.result.teacher,contentProjectWorld:observed.result.world,contentProjectVerification:observed.result.verification}};
  },
  validate(result){
    const teacher=result.diagnostics?.["natlangTeacher"] as {report?:{status?:string};trainingEligible?:boolean;calls?:Array<{record?:{definition?:{name?:string}}}>}|undefined;
    const verification=result.diagnostics?.["contentProjectVerification"] as {passed?:boolean;semanticReviewRequired?:boolean;reasons?:string[]}|undefined;
    const names=new Set(teacher?.calls?.map(c=>c.record?.definition?.name));
    const nested=["deliverProject","analyzeRequest","planDocuments","draftDocuments","writePage","reviewCandidate"].every(name=>names.has(name));
    return teacher?.report?.status==="committed"&&teacher.trainingEligible===true&&verification?.passed&&nested
      ?{passed:true,details:{independentCommittedState:true,authoredNestedStages:[...names],semanticReviewRequired:true}}
      :{passed:false,reason:"Authored project workflow and independent committed-state verification must both succeed",details:{reasons:verification?.reasons,authoredNestedStages:[...names],semanticReviewRequired:true}};
  },
}));
contentProjectTests.push({
  name:"content-project-oracle-qualification",category:"project-lifecycle",explicitOnly:true,validation:"harness",
  description:"Use actual owned content projects to qualify reference, omitted-fact negative and renamed identity/value alias without model calls",
  prompt:"Qualify the structural content-project verifier without claiming prose quality or collecting teacher data.",
  async orchestrate(context){
    const started=Date.now(),world=contentProjectWorlds[0]!;
    const checks=[];
    for(const variant of ["reference","negative","alias"] as const){
      context.signal.throwIfAborted();
      const request=variant==="alias"?{...world.request,audience:"A second release team",facts:world.request.facts.map(f=>({id:`other-${f.id}`,text:f.text.replaceAll("Mina","Tao")}))}:world.request;
      const observed=await context.runner.runContentProject(request,variant==="negative"?"negative":"reference");
      if(observed.kind!=="reference")throw new Error("Content qualification returned a teacher result");
      checks.push({variant,verdict:observed.result});
    }
    return {messages:[],duration:Date.now()-started,diagnostics:{contentProjectOracleQualification:checks}};
  },
  validate(result){
    const checks=result.diagnostics?.["contentProjectOracleQualification"] as Array<{variant:string;verdict:{passed:boolean}}>|undefined;
    const byName=new Map(checks?.map(c=>[c.variant,c.verdict.passed]));
    return checks?.length===3&&byName.get("reference")===true&&byName.get("negative")===false&&byName.get("alias")===true
      ?{passed:true,details:{actualOwnedWorlds:3,modelCalls:0,semanticReviewRequired:true}}
      :{passed:false,reason:"Actual content verifier reference, negative and alias did not qualify"};
  },
});
