import {localMessagingWorlds} from "./worlds.js";
import type { LocalMessagingResult } from "./contract.js";
import type {TestCase} from "../types.js";
export const localMessagingTests:TestCase[]=localMessagingWorlds.map(world=>({
 name:`messaging-${world.id}`,category:"local-messaging",description:"Resolve and verify a note within owned synthetic local channels",explicitOnly:true,validation:"harness",prompt:world.request.goal,
 async orchestrate(context){context.signal.throwIfAborted();const started=Date.now(),observed=await context.runner.runLocalMessaging(world.id,false,context.signal);context.signal.throwIfAborted();return {messages:[],duration:Date.now()-started,provenance:{channelId:null,branchId:null,agentEntityId:null,agentTargetId:null,contextId:observed.world.contextId},diagnostics:{natlangTeacher:observed.teacher,localMessagingWorld:observed.world,localMessagingVerification:observed.verification,localMessagingEvidence:observed.evidence,localMessagingCleanupErrors:observed.cleanupErrors}};},
 validate(result){const teacher=result.diagnostics?.["natlangTeacher"] as {trainingEligible?:boolean}|undefined;const verification=result.diagnostics?.["localMessagingVerification"] as {passed?:boolean}|undefined;const cleanup=result.diagnostics?.["localMessagingCleanupErrors"] as string[]|undefined;return {passed:teacher?.trainingEligible===true && verification?.passed===true && cleanup?.length===0,reason:"Original scoped notify, routing/absence and cleanup evidence is required"};},
}));

for (const world of localMessagingWorlds) {
  localMessagingTests.push({
    name: `messaging-oracle-${world.id}`,
    category: "local-messaging",
    description: "Qualify the canonical local resolver, delivery receipts and cleanup without a model",
    explicitOnly: true,
    validation: "harness",
    prompt: world.request.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const result = await runner.runLocalMessaging(world.id, true, signal);
      return { messages: [], duration: Date.now() - started, diagnostics: {
        localMessagingQualification: result,
      } };
    },
    validate(result) {
      const qualified = result.diagnostics?.["localMessagingQualification"] as LocalMessagingResult | undefined;
      return {
        passed: qualified?.teacher === null && qualified.verification.passed && qualified.cleanupErrors.length === 0,
        details: qualified?.verification,
      };
    },
  });
}
