import { describe, expect, it } from "vitest";
import { ownedOperationsRequestSchema } from "@workspace/natlang-services";
import { ownedOperationsInputSchema } from "./owned-operations-contract.js";
import { ownedOperationsInventory, ownedOperationsWorlds } from "./owned-operations-worlds.js";
describe("operational scenario data integrity", () => {
 it("admits every declared case through the actual receiver and publishes stable unique lineage", () => {
  expect(new Set(ownedOperationsInventory.map(row=>row.id)).size).toBe(ownedOperationsWorlds.length);
  expect(new Set(ownedOperationsInventory.map(row=>row.sourceGroup)).size).toBe(ownedOperationsWorlds.length);
  for(const row of ownedOperationsInventory){
   expect(ownedOperationsInputSchema.safeParse({contextId:"owned",caseId:row.id,executorModel:"provider:teacher"}).success).toBe(true);
   expect(row.sourceGroup.startsWith("vibestudio:owned-operations:")).toBe(true);
   expect(row.split).toBe("train");
  }
 });
 it.each(ownedOperationsWorlds)("keeps $id oracle evidence coherent with the actual request", world => {
  const request=ownedOperationsRequestSchema.parse(world.request),roles=world.expected.roles;
  if(request.kind==="incident-handoff"&&"impact"in roles&&"recovery"in roles){
   const assigned=[...roles.impact.evidenceIds,...roles.recovery.evidenceIds];
   expect(new Set(assigned).size).toBe(assigned.length);
   expect([...assigned].sort()).toEqual(request.signals.map(row=>row.id).sort());
   expect(world.expected.decision).toBe(roles.impact.decision==="ready"&&roles.recovery.decision==="ready"?"ready":"blocked");
  } else if(request.kind==="release-continuation"&&"release"in roles){
   const decisions=[request.before,request.after].map(gates=>gates.every(gate=>gate.state==="approved")?"ready":"blocked");
   expect(roles.release.decisions).toEqual(decisions);
   expect(world.expected.decision).toBe(decisions[1]);
   for(const gates of [request.before,request.after])expect(gates.map(row=>row.id).sort()).toEqual([...roles.release.evidenceIds].sort());
  } else throw new Error("Request/oracle role mismatch");
 });
 it("covers independent role boundaries, every readiness transition, and explicit rejected-gate recovery", () => {
  const pairs=new Set<string>(),transitions=new Set<string>();let rejectedRecovery=false;
  for(const world of ownedOperationsWorlds){
   const roles=world.expected.roles;
   if("impact"in roles&&"recovery"in roles)pairs.add(`${roles.impact.decision}/${roles.recovery.decision}`);
   if("release"in roles)transitions.add(roles.release.decisions.join("/"));
   const request=ownedOperationsRequestSchema.parse(world.request);
   if(request.kind==="release-continuation")rejectedRecovery ||= request.before.some(gate=>gate.state==="rejected")&&request.after.every(gate=>gate.state==="approved");
  }
  expect([...pairs].sort()).toEqual(["blocked/blocked","blocked/ready","ready/blocked","ready/ready"]);
  expect([...transitions].sort()).toEqual(["blocked/blocked","blocked/ready","ready/blocked","ready/ready"]);
  expect(rejectedRecovery).toBe(true);
 });
});
