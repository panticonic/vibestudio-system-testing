import { authoredTeacherCode } from "./authored-teacher.js";
import type { OwnedOperationsInput } from "@workspace-skills/system-testing/owned-operations-contract";
import { ownedOperationsWorlds } from "@workspace-skills/system-testing/owned-operations-worlds";
export function ownedOperationsTeacherCode(selected: OwnedOperationsInput, runId: string) {
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
 ${authoredTeacherCode({programPath:"skills/agents/operational-handoff/operate.nl",rootName:"operate",serviceNames:["ownedOperations"],executorModel:selected.executorModel,request:world.request,bindingCode:""},runId)}
 captured=utilityValue;
 } finally { try {await owned.close();} catch(error) {cleanupErrors.push(error instanceof Error?error.message:String(error));} }
 const audit=owned.audit();
 const verification=captured?.report?verifyOwnedOperations(audit,privateWorld.expected,captured.report):{passed:false,checks:{actualRootReport:false}};
 if(cleanupErrors.length)verification.passed=false;
 let utilityValue={teacher:captured,world:{kind:"owned-operations",contextId:selected.contextId,caseId:selected.caseId,request:privateWorld.request},verification,audit,cleanupErrors};
 `;
}
