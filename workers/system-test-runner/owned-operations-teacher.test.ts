import { describe, expect, it } from "vitest";
import { parse } from "@babel/parser";
import { ownedOperationsTeacherCode } from "./owned-operations-teacher.js";
import { ownedOperationsInputSchema } from "@workspace-skills/system-testing/owned-operations-contract";
import { ownedOperationsWorlds } from "@workspace-skills/system-testing/owned-operations-worlds";
describe("owned operational scenario boundary", () => {
 it.each(ownedOperationsWorlds)("compiles generated lifecycle code for $id without model execution", world => {
  const selected=ownedOperationsInputSchema.parse({contextId:"owned-context",caseId:world.id,executorModel:"provider:teacher"});
  const code=ownedOperationsTeacherCode(selected,"exact-eval-run");
  expect(()=>parse(code,{sourceType:"module",allowAwaitOutsideFunction:true,plugins:["typescript"]})).not.toThrow();
  expect(code).toContain(`report=await root(${JSON.stringify(world.request)})`);
  expect(code).not.toContain(`report=await root(${JSON.stringify(world)})`);
  expect(code).toContain("finally { try {await owned.close();}");
 });
 it("requires an exact supported world and resolved teacher identity", () => {
  expect(ownedOperationsInputSchema.safeParse({contextId:"owned",caseId:"arbitrary",executorModel:"provider:teacher"}).success).toBe(false);
  expect(ownedOperationsInputSchema.safeParse({contextId:"owned",caseId:ownedOperationsWorlds[0]!.id,executorModel:"executor"}).success).toBe(false);
 });
});
