import {localMessagingWorlds} from "../../skills/system-testing/local-messaging/worlds.js";
import {authoredTeacherCode} from "./authored-teacher.js";
import type {LocalMessagingInput} from "@workspace-skills/system-testing/local-messaging-contract";
export function localMessagingTeacherCode(selected:LocalMessagingInput,runId:string){
 const world=localMessagingWorlds.find(value=>value.id===selected.caseId);
 if(!world)throw new Error("Select an authored local messaging scenario");
 return `
 import {runtime,rpc,contextId as actualContextId} from "@workspace/runtime";
 import {createLocalMessagingFixture} from "@workspace-skills/system-testing/local-messaging";
 const selected=${JSON.stringify(selected)};
 if(actualContextId!==selected.contextId)throw new Error("Messaging fixture belongs to another owned context");
 const owned=await createLocalMessagingFixture({contextId:selected.contextId,caseId:selected.caseId,runtime,rpc}),assignedService=owned.assignedService;
 let captured=null,checked=null;const cleanupErrors=[];
 try{
 ${authoredTeacherCode({skill:"routeMessage",executorModel:selected.executorModel,serviceNames:["localMessagingRead","localMessagingSend"],request:world.request,bindingCode:""},runId)}
 captured=utilityValue;
 if(captured.report)checked=await owned.verify(captured.report);
 }finally{try{await owned.close();}catch(error){cleanupErrors.push(String(error));}}
 let utilityValue={teacher:captured,world:{kind:"local-messaging",contextId:selected.contextId,caseId:selected.caseId},verification:checked?.verification??{passed:false},evidence:checked?.evidence??null,cleanupErrors};
 `;
}
