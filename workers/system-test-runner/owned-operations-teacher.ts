import { ownedContentDependencyCode } from "./owned-operations-dependency.js";
import { authoredTeacherCode, composedTeacherCode } from "./authored-teacher.js";
import type { OwnedOperationsInput } from "@workspace-skills/system-testing/owned-operations-contract";
import { ownedOperationsWorlds, ownedOperationsComposedWorlds } from "@workspace-skills/system-testing/owned-operations-worlds";
export function ownedOperationsTeacherCode(selected: OwnedOperationsInput, runId: string) {
 const composed=ownedOperationsComposedWorlds.find(value=>value.id===selected.caseId);
 if(composed)return composedOwnedOperationsTeacherCode(selected,runId,composed);
 const world = ownedOperationsWorlds.find(value => value.id === selected.caseId);
 if (!world) throw new Error("Select an authored owned-operations scenario.");
 return `
 import {runtime,rpc,contextId as actualContextId} from "@workspace/runtime";
 import {createOwnedOperations,verifyOwnedOperations} from "@workspace/natlang-services";
 const selected=${JSON.stringify(selected)}, privateWorld=${JSON.stringify(world)};
 if(actualContextId!==selected.contextId)throw new Error("Owned teacher belongs to another context");
 const owned=createOwnedOperations({runtime,rpc}),assignedService=owned.service;
 let captured=null; const cleanupErrors=[];
 try {
 ${authoredTeacherCode({skill: "operate",serviceNames:["ownedOperations"],executorModel:selected.executorModel,request:world.request,bindingCode:""},runId)}
 captured=utilityValue;
 } finally { try {await owned.close();} catch(error) {cleanupErrors.push(error instanceof Error?error.message:String(error));} }
 const audit=owned.audit();
 const verification=captured?.report?verifyOwnedOperations(audit,privateWorld.expected,captured.report):{passed:false,checks:{actualRootReport:false}};
 if(cleanupErrors.length)verification.passed=false;
 let utilityValue={teacher:captured,world:{kind:"owned-operations",contextId:selected.contextId,caseId:selected.caseId,request:privateWorld.request},verification,audit,cleanupErrors};
 `;
}

function composedOwnedOperationsTeacherCode(selected:OwnedOperationsInput,runId:string,world:typeof ownedOperationsComposedWorlds[number]){
 const workflowRequest={goal:world.goal,work:[{kind:"deliverProject" as const,input:world.content},{kind:"operate" as const,input:world.operations.request}]};
 return `
 import {runtime,rpc,vcs,contextId as actualContextId} from "@workspace/runtime";
 import {prepareProjects} from "@workspace-skills/workspace-dev";
 import {createOwnedOperations,verifyOwnedOperations,createProjectDelivery} from "@workspace/natlang-services";
 import {verifyContentProject} from "@workspace-skills/system-testing/content-project-oracle";
 const selected=${JSON.stringify(selected)},privateWorld=${JSON.stringify(world)};
 if(actualContextId!==selected.contextId)throw new Error("Composed teacher belongs to another context");
 const before=await vcs.status({contextId:actualContextId});if(!before.clean)throw new Error("Composed teacher requires a clean owned context");
 const privateRequest=structuredClone(privateWorld.content);
 const owned=createOwnedOperations({runtime,rpc});
 const dependency=(${ownedContentDependencyCode})(owned,privateWorld.operations.expected);
 const project=dependency.wrapProject(createProjectDelivery({contextId:actualContextId,vcs,prepareProjects},{contextId:actualContextId,name:"release-dossier-"+crypto.randomUUID(),title:"Release readiness evidence dossier",request:privateRequest}));
 const projectBasis=await project.observe();if(projectBasis.repositoryId)throw new Error("Composed project must initially be absent");
 const assignedServices={ownedOperations:dependency.service,projectWorkspace:project,projectWorkspaceEdit:project};
 let captured=null;const cleanupErrors=[];
 try {
 ${composedTeacherCode({executorModel:selected.executorModel,workflowRequest,bindingCode:"",requiredOrder:["operate","deliverProject"]},runId)}
 captured=utilityValue;
 } finally {try{await owned.close();}catch(error){cleanupErrors.push(error instanceof Error?error.message:String(error));}}
 const audit=owned.audit();
 const operationReport=captured?.report?.results?.find(row=>row.kind==="operate")?.report;
 const verification=operationReport?verifyOwnedOperations(audit,privateWorld.operations.expected,operationReport):{passed:false,checks:{actualOperationReport:false}};
 const contentVerification=await verifyContentProject(vcs,{contextId:actualContextId,repoPath:projectBasis.repoPath,request:privateRequest,before});
 const contentAfter=await project.observe();
 const dependencyAudit=dependency.audit();
 const compositionChecks={operations:verification.passed,content:contentVerification.passed,dependency:dependencyAudit.passed,cleanup:cleanupErrors.length===0};
 let utilityValue={teacher:captured,world:{kind:"owned-operations",contextId:actualContextId,caseId:selected.caseId,request:privateWorld.operations.request},verification,audit,cleanupErrors,
 composition:{contentWorld:{kind:"content-project",contextId:actualContextId,repoPath:projectBasis.repoPath,before:projectBasis.head,after:contentAfter.head,request:privateRequest},world:{kind:"owned-operations-content",contextId:actualContextId,caseId:selected.caseId,sourceGroup:privateWorld.sourceGroup,repoPath:projectBasis.repoPath,before:projectBasis.head,request:${JSON.stringify(workflowRequest)}},verification:{passed:Object.values(compositionChecks).every(Boolean),checks:compositionChecks},contentVerification,dependencyAudit}};
 `;
}
