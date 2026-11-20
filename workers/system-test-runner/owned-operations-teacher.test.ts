import {ownedContentDependencyCode} from "./owned-operations-dependency.js";
import { describe, expect, it } from "vitest";
import { parse } from "@babel/parser";
import { ownedOperationsTeacherCode, qualifyHeldReleaseDossierCode } from "./owned-operations-teacher.js";
import { ownedOperationsInputSchema } from "@workspace-skills/system-testing/owned-operations-contract";
import { ownedOperationsWorlds, ownedOperationsComposedWorlds } from "@workspace-skills/system-testing/owned-operations-worlds";
describe("owned operational scenario boundary", () => {
 it.each(ownedOperationsWorlds)("compiles generated lifecycle code for $id without model execution", world => {
  const selected=ownedOperationsInputSchema.parse({contextId:"owned-context",caseId:world.id,executorModel:"provider:teacher"});
  const code=ownedOperationsTeacherCode(selected,"exact-eval-run");
  expect(()=>parse(code,{sourceType:"module",allowAwaitOutsideFunction:true,plugins:["typescript"]})).not.toThrow();
  expect(code).toContain(`const workflow=await root(${JSON.stringify({goal:world.request.goal,work:[{kind:"operate",input:world.request}]})})`);
  expect(code).not.toContain(`"input":${JSON.stringify(world)}`);
  expect(code).toContain("finally { try {await owned.close();}");
 });
 it("requires an exact supported world and resolved teacher identity", () => {
  expect(ownedOperationsInputSchema.safeParse({contextId:"owned",caseId:"arbitrary",executorModel:"provider:teacher"}).success).toBe(false);
  expect(ownedOperationsInputSchema.safeParse({contextId:"owned",caseId:ownedOperationsWorlds[0]!.id,executorModel:"executor"}).success).toBe(false);
 });
});

describe("composed operations and content prerequisite",()=>{
 it.each(ownedOperationsComposedWorlds)("binds both real skill services and typed work for $id",world=>{
  const code=ownedOperationsTeacherCode({contextId:"owned-context",caseId:world.id,executorModel:"provider:teacher"},"joint-run");
  expect(()=>parse(code,{sourceType:"module",allowAwaitOutsideFunction:true,plugins:["typescript"]})).not.toThrow();
  expect(code).toContain("const assignedServices={ownedOperations:dependency.service,projectWorkspace:project,projectWorkspaceEdit:project}");
  expect(code).toContain("verifyContentProject(vcs");
  expect(code).toContain(JSON.stringify({goal:world.goal,work:[{kind:"deliverProject",input:world.content},{kind:"operate",input:world.operations.request}]}));
  expect(code).toContain(`expectedRemaining=${JSON.stringify(world.heldReason ? [world.heldReason] : [])}`);
  if (world.heldReason) {
    const qualification = qualifyHeldReleaseDossierCode({contextId:"owned-context",caseId:world.id});
    expect(()=>parse(qualification,{sourceType:"module",allowAwaitOutsideFunction:true,plugins:["typescript"]})).not.toThrow();
    expect(qualification).not.toContain("captureModelTurns");
    expect(qualification).toContain("await service.restart(handle)");
  }
 });
 it("blocks early effects, stale reads and wrong outcomes; admits only ready read, cleanup, then exact effect order",async()=>{
  const expected={decision:"ready",roles:{release:{decisions:["blocked","ready"],evidenceIds:["gate"]}}};
  const handle={id:"actual-worker",role:"release"},snapshot={revision:2,checkpoints:[{revision:1,assessment:{role:"release",decision:"blocked",evidenceIds:["gate"]}},{revision:2,assessment:{role:"release",decision:"ready",evidenceIds:["gate"]}}]};
  let state=structuredClone(snapshot),closed=false,called=0;
  const owned={service:{read:async()=>structuredClone(state),close:async()=>{closed=true;return {retiredIds:["actual-worker"]};}},audit:()=>({restarts:[{}],programRequestedCleanup:closed,remainingEntityIds:closed?[]:["actual-worker"],remainingContextIds:closed?[]:["actual-context"],snapshots:[{phase:"before-cleanup",handle,value:structuredClone(state)}]})};
  const dependency=new Function("return ("+ownedContentDependencyCode+")")()(owned,expected);
  const project=dependency.wrapProject({prepare:async()=>{called++;return {head:"prepared"};},writeDocuments:async()=>({head:"written"}),commit:async()=>({eventId:"committed"})});
  await expect(project.prepare("initial")).rejects.toThrow("Read the actual ready");expect(called).toBe(0);
  state.checkpoints[1]!.assessment.decision="blocked";
  await dependency.service.read(handle);await dependency.service.close();await expect(project.prepare("initial")).rejects.toThrow();
  state=structuredClone(snapshot);await expect(project.prepare("initial")).rejects.toThrow();
  closed=false;const positive=new Function("return ("+ownedContentDependencyCode+")")()(owned,expected);
  const goodProject=positive.wrapProject({prepare:async()=>{called++;return {head:"prepared"};},writeDocuments:async()=>({head:"written"}),commit:async()=>({eventId:"committed"})});
  await positive.service.read(handle);await positive.service.close();await goodProject.prepare("initial");await goodProject.writeDocuments("prepared",[]);await goodProject.commit("written","message");
  expect(called).toBe(1);expect(positive.audit().passed).toBe(true);
  expect(positive.audit().events.slice(-5).map((e:{kind:string})=>e.kind)).toEqual(["operationOutcomeRead","operationCleanup","projectPrepared","projectWritten","projectCommitted"]);
 });
});
