import {beforeEach,describe,it,expect,vi} from "vitest";
import {createTestDO} from "@vibestudio/durable/test-utils";
const calls=vi.hoisted(()=>({seed:vi.fn(),close:vi.fn()}));
vi.mock("@workspace-skills/system-testing/open-goal-scheduled-recovery-managed",()=>({seedOwnedScheduledRecovery:calls.seed,closeOwnedScheduledRecovery:calls.close}));
import {SystemTestRunnerDO} from "./index.js";
import {openScheduledRecoveryWorlds} from "../../skills/system-testing/open-goal-scheduled-recovery-worlds.js";
const world=openScheduledRecoveryWorlds.find(world=>world.id==="scheduled-recovery-retime-without-release")!;
const input={contextId:"owned-context",caseId:world.id,goal:world.goal,executorModel:"openai-codex:gpt-6-luna",qualification:true,startupDiagnostic:{epoch:"native_epoch_123"}};
describe("native startup diagnostic receiver",()=>{
 beforeEach(()=>{calls.seed.mockReset();calls.close.mockReset();});
 it("seeds the real selected world before the same utility fork and cleans it without qualification",async()=>{
  const events:string[]=[];
  const items=[{record:{missionId:"owned",state:"paused"}},{record:{missionId:"neighbor",state:"paused"}},{record:{missionId:"dependency",state:"active"}}];
  calls.seed.mockImplementation(async()=>{events.push("seed");return {items};});calls.close.mockImplementation(async()=>{events.push("close");});
  const {instance}=await createTestDO(SystemTestRunnerDO,{} as never);
  const utility=vi.fn(async(kind:string,producer:(runId:string,scope:string)=>string)=>{
   events.push("utility");expect(kind).toBe("teacher");
   const code=producer("system-test-runner:teacher:owned","finite-owned");
   expect(code).not.toContain("prepared.qualify");expect(code).not.toContain("executorModel");
   return new Function("actualContextId",code.replace(/import[^;]+;/,"")+"return utilityValue;")("owned-context");
  });
  Object.assign(instance,{integrationFixtureIdentity:async()=>({contextId:"owned-context"}),runHarnessUtility:utility});
  const result=await instance.runOpenGoalTeacher(input);
  expect(events).toEqual(["seed","utility","close"]);expect(calls.seed.mock.calls[0][1]).toBe(world);
  expect(result).toMatchObject({teacher:null,verification:null,diagnosticOnly:true,startupDiagnostic:{epoch:"native_epoch_123",runId:"system-test-runner:teacher:owned",evalScope:"finite-owned",modelCallsRequested:0}});
  expect(calls.close.mock.calls[0][1]).toBe(items);
 });
 it("rejects invalid epochs before seeding and cleans seeded missions when child bootstrap fails",async()=>{
  const {instance}=await createTestDO(SystemTestRunnerDO,{} as never);
  Object.assign(instance,{integrationFixtureIdentity:async()=>({contextId:"owned-context"}),runHarnessUtility:async()=>{throw new Error("child startup failed");}});
  await expect(instance.runOpenGoalTeacher({...input,qualification:false})).rejects.toThrow("exact scheduled world");expect(calls.seed).not.toHaveBeenCalled();
  const items=[{record:{missionId:"owned",state:"paused"}}];calls.seed.mockResolvedValue({items});calls.close.mockResolvedValue(undefined);
  await expect(instance.runOpenGoalTeacher(input)).rejects.toThrow("child startup failed");expect(calls.close.mock.calls[0][1]).toBe(items);
 });
});
