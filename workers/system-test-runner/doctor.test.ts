import {it,expect,vi} from "vitest";
import {createTestDO} from "@vibestudio/durable/test-utils";
import {SystemTestRunnerDO} from "./index.js";
import {allTests} from "../../skills/system-testing/stages.js";
it("native doctor passes its actual registry to the lean finite child",async()=>{
 const {instance}=await createTestDO(SystemTestRunnerDO,{} as never);
 const expected=allTests().map(test=>test.name);
 const health=vi.fn(async(model:string,names:string[])=>{
  expect(model).toBe("openai-codex:gpt-6-luna");expect(names).toEqual(expected);
  return{ok:true,checks:[{name:"test-catalog",ok:names.length>0,detail:`${names.length} tests discovered`}]};
 });
 Object.assign(instance,{runHarnessUtility:async(kind:string,code:string)=>{
  expect(kind).toBe("doctor");expect(code).toContain('@workspace-skills/system-testing/doctor');expect(code).not.toContain('@workspace-skills/system-testing/cli');
  return new Function("systemTestDoctor","return(async()=>{"+code.replace(/import[^;]+;/,"")+"return utilityValue;})();")(health);
 }});
 expect((await instance.doctor("openai-codex:gpt-6-luna")).ok).toBe(true);expect(health).toHaveBeenCalledOnce();
});
