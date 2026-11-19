import { localMessagingWorlds } from "../../skills/system-testing/local-messaging/worlds.js";
import { authoredTeacherCode } from "./authored-teacher.js";
import type {
  LocalMessagingInput,
  LocalMessagingQualification,
} from "@workspace-skills/system-testing/local-messaging-contract";

const serviceNames = ["localMessagingRead", "localMessagingSend"];

function localMessagingFixtureCode(selected: LocalMessagingQualification, exercise: string) {
  return `
    import {runtime,rpc,contextId as actualContextId} from "@workspace/runtime";
    import {createLocalMessagingFixture} from "@workspace-skills/system-testing/local-messaging";
    const selected=${JSON.stringify({ contextId: selected.contextId, caseId: selected.caseId })};
    if(actualContextId!==selected.contextId)throw new Error("Messaging fixture belongs to another owned context");
    const owned=await createLocalMessagingFixture({contextId:selected.contextId,caseId:selected.caseId,runtime,rpc});
    const assignedService=owned.assignedService;
    let captured=null,checked=null;
    const cleanupErrors=[];
    try {
      ${exercise}
    } finally {
      try { await owned.close(); } catch(error) { cleanupErrors.push(String(error)); }
    }
    let utilityValue={teacher:captured,world:{kind:"local-messaging",contextId:selected.contextId,caseId:selected.caseId},verification:checked?.verification??{passed:false},evidence:checked?.evidence??null,cleanupErrors};
  `;
}

export function localMessagingTeacherCode(selected: LocalMessagingInput, runId: string) {
  const world = localMessagingWorlds.find(({ id }) => id === selected.caseId);
  if (!world) throw new Error("Select an authored local messaging scenario");
  return localMessagingFixtureCode(selected, `
    ${authoredTeacherCode({
      skill: "routeMessage",
      executorModel: selected.executorModel,
      serviceNames,
      request: world.request,
      bindingCode: "",
    }, runId)}
    captured=utilityValue;
    if(captured.report)checked=await owned.verify(captured.report);
  `);
}

export function localMessagingQualificationCode(selected: LocalMessagingQualification) {
  return localMessagingFixtureCode(selected, `
    const services=Object.fromEntries(${JSON.stringify(serviceNames)}.map(name=>[name,assignedService]));
    const root=await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services});
    if(typeof root.routeMessage!=="function") throw new Error("Missing shared local messaging workflow");
    checked=await owned.qualify();
  `);
}
