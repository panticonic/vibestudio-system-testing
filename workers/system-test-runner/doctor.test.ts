import {it,expect,vi} from "vitest";
import {createTestDO} from "@vibestudio/durable/test-utils";
import {SystemTestRunnerDO} from "./index.js";
import {allTests} from "../../skills/system-testing/stages.js";
it("native doctor passes its actual registry to the lean finite child",async()=>{
 const {instance}=await createTestDO(SystemTestRunnerDO,{} as never);
 const expected=allTests().map(test=>test.name);
 const health=vi.fn(async(model:{primaryModel:string;fallbackModel:null},names:string[])=>{
  expect(model.primaryModel).toBe("openai-codex:gpt-6-luna");expect(model.fallbackModel).toBeNull();expect(names).toEqual(expected);
  return{ok:true,checks:[{name:"test-catalog",ok:names.length>0,detail:`${names.length} tests discovered`}]};
 });
 Object.assign(instance,{runHarnessUtility:async(kind:string,code:string)=>{
  expect(kind).toBe("doctor");expect(code).toContain('@workspace/system-test-health');expect(code).not.toContain('@workspace-skills/system-testing/cli');
  return new Function("systemTestDoctor","rpc","workers","return(async()=>{"+code.replace(/^\s*import[^\n]+;\s*$/gm,"")+"return utilityValue;})();")(health,{},{} );
 }});
 expect((await instance.doctor("openai-codex:gpt-6-luna")).ok).toBe(true);expect(health).toHaveBeenCalledOnce();
});

it("native-reference doctor forwards explicit mode to the same finite health child",async()=>{
 const {instance}=await createTestDO(SystemTestRunnerDO,{} as never);
 const health=vi.fn(async(_model:unknown,_names:unknown,_ports:unknown,options:unknown)=>{
  expect(options).toEqual({nativeReference:true});return{ok:true,checks:[{name:"native-reference-mode",ok:true,detail:"No provider availability requested"}]};
 });
 Object.assign(instance,{runHarnessUtility:async(_kind:string,code:string)=>new Function("systemTestDoctor","rpc","workers","return(async()=>{"+code.replace(/^\s*import[^\n]+;\s*$/gm,"")+"return utilityValue;})();")(health,{},{} )});
 expect((await instance.doctor(null,{nativeReference:true})).ok).toBe(true);
 expect(health).toHaveBeenCalledOnce();
 await expect(instance.doctor("TEST:model",{nativeReference:true})).rejects.toThrow("mutually exclusive");
 expect(health).toHaveBeenCalledOnce();
});
