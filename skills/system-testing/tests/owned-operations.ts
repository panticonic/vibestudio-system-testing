import {z} from "zod";
import type { TestCase } from "../types.js";
import { ownedOperationsWorlds, ownedOperationsComposedWorlds } from "../owned-operations-worlds.js";
import type { OwnedOperationsResult } from "../owned-operations-contract.js";
export const ownedOperationsTests: TestCase[] = ownedOperationsWorlds.map(world => ({
 name: `owned-operations-${world.id}`, category: "agent-orchestration", explicitOnly: true, validation: "harness",
 description: world.request.kind === "incident-handoff" ? "Coordinate separate owned impact/recovery workers and verify their durable handoff and cleanup" : "Persist a release checkpoint, restart the same real worker, continue from retained state and verify cleanup",
 prompt: world.request.goal,
 async orchestrate(context) {
  context.signal.throwIfAborted(); const started=Date.now();
  const observed=await context.runner.runOwnedOperations(world.id);
  context.signal.throwIfAborted();
  return {messages:[],duration:Date.now()-started,provenance:{channelId:null,branchId:null,agentEntityId:null,agentTargetId:null,contextId:observed.world.contextId},diagnostics:{natlangTeacher:observed.teacher,ownedOperationsWorld:observed.world,ownedOperationsVerification:observed.verification,ownedOperationsAudit:observed.audit,ownedOperationsCleanupErrors:observed.cleanupErrors}};
 },
 validate(result) {
  const teacher=result.diagnostics?.["natlangTeacher"] as OwnedOperationsResult["teacher"]|undefined;
  const verification=result.diagnostics?.["ownedOperationsVerification"] as OwnedOperationsResult["verification"]|undefined;
  const cleanupErrors=result.diagnostics?.["ownedOperationsCleanupErrors"] as string[]|undefined;
  const callSchema=z.object({record:z.object({definition:z.object({name:z.string()})})});
  const names=new Set(teacher?.calls?.map(call=>{const parsed=callSchema.safeParse(call);return parsed.success?parsed.data.record.definition.name:undefined;}));
  const stages=world.request.kind==="incident-handoff"?["operate","incident","assign","assess","synthesize"]:["operate","release","assessGate","handoff"];
  const nested=stages.every(name=>names.has(name));
  return teacher?.trainingEligible===true && verification?.passed===true && cleanupErrors?.length===0 && nested
    ? {passed:true,details:{independentPersistedState:true,ownedCleanup:true,authoredNestedStages:stages}}
    : {passed:false,reason:"Actual authored execution, persisted-state oracle, nested calls and exact owned cleanup must all succeed",details:{verification,cleanupErrors,authoredNestedStages:[...names]}};
 }
}));

for(const world of ownedOperationsComposedWorlds)ownedOperationsTests.push({
 name:`owned-operations-${world.id}`,category:"agent-orchestration",explicitOnly:true,validation:"harness",
 description:world.heldReason?"Reassess a restarted release and hold all dossier effects when a gate blocks it":"Compose an actual restarted release workflow and a dependent locally committed content project in one native call tree",
 prompt:world.goal,
 async orchestrate(context){context.signal.throwIfAborted();const started=Date.now();const observed=await context.runner.runOwnedOperations(world.id);context.signal.throwIfAborted();return {messages:[],duration:Date.now()-started,provenance:{channelId:null,branchId:null,agentEntityId:null,agentTargetId:null,contextId:observed.world.contextId},diagnostics:{natlangTeacher:observed.teacher,ownedOperationsWorld:observed.world,ownedOperationsVerification:observed.verification,ownedOperationsAudit:observed.audit,ownedOperationsCleanupErrors:observed.cleanupErrors,contentProjectWorld:observed.composition?.contentWorld,composedWorkflowWorld:observed.composition?.world,composedWorkflowVerification:observed.composition?.verification,contentProjectVerification:observed.composition?.contentVerification,dependencyAudit:observed.composition?.dependencyAudit}};},
 validate(result){
  const diagnostics=result.diagnostics,teacher=diagnostics?.["natlangTeacher"] as OwnedOperationsResult["teacher"]|undefined,composition=diagnostics?.["composedWorkflowVerification"] as {passed?:boolean}|undefined,cleanup=diagnostics?.["ownedOperationsCleanupErrors"] as string[]|undefined;
  const details={composition,cleanup,semanticReviewRequired:!world.heldReason};
  return teacher?.trainingEligible===true&&composition?.passed===true&&cleanup?.length===0
    ? {passed:true,details}
    : {passed:false,reason:"The restarted release, cleanup and expected dossier disposition must be independently verified",details};
 },
});

for (const world of ownedOperationsComposedWorlds.filter(({heldReason}) => heldReason)) {
  ownedOperationsTests.push({
    name: `owned-operations-oracle-${world.id}`,
    category: "agent-orchestration",
    explicitOnly: true,
    validation: "harness",
    description: "Qualify the live release restart and untouched dossier project",
    prompt: world.goal,
    async orchestrate({runner,signal}) {
      signal.throwIfAborted();
      const started = Date.now();
      const result = await runner.runOwnedOperations(world.id, true);
      signal.throwIfAborted();
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { heldReleaseDossierQualification: result },
      };
    },
    validate(result) {
      const details = result.diagnostics?.["heldReleaseDossierQualification"] as Omit<OwnedOperationsResult,"teacher"> | undefined;
      return {
        passed: details?.world.caseId === world.id && details.composition?.verification.passed === true,
        details: details?.composition?.verification.checks,
      };
    },
  });
}
