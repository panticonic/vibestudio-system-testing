import { expect,it,vi } from "vitest";
import { prepareOpenCapabilityPlan } from "./open-goal-capability-plan-managed.js";
import { capabilityPlanWorlds } from "./open-goal-capability-plan-worlds.js";
vi.mock("@vibestudio/service-schemas/mainRpc",()=>({mainRpcMethods:new Proxy({},{get:(_target,key)=>key})}));
vi.mock("@workspace-skills/scratch-handoff-bindings",()=>({bindScratchHandoff:()=>({scratchHandoffWrite:{}})}));

it("describes an exact known native capability repeatedly without first searching for it",async()=>{
  const id="service:workspace.listSkills";
  const schema={type:"object"};
  const call=vi.fn(async(_target:string,method:string,args:unknown[])=>{
    if(method==="docs.describe")return args[0]===id?{id,surface:"service",qualifiedName:"workspace.listSkills",title:"Skills",argsSchema:schema,returnsSchema:schema}:null;
    if(method==="docs.getSchema")return {argsSchema:schema,returnsSchema:schema};
    throw new Error("Unrequested native method: "+method);
  });
  const prepared=await prepareOpenCapabilityPlan({contextId:"owned",caseId:capabilityPlanWorlds[0]!.id},{contextId:"owned",
    fs:{mkdtemp:async()=>"/owned",writeFile:async()=>{},readdir:async()=>[]} as never,
    vcs:{status:async()=>({workingHead:{},mainEventId:"event"})} as never,rpc:{call} as never});
  for(let index=0;index<8;index++)expect(await prepared.services.docPlanCatalog.describe(id)).toMatchObject({id});
  expect(await prepared.services.docPlanCatalog.describe("service:unknown.method")).toBeNull();
  expect(call.mock.calls.some(([,method])=>method==="docs.search")).toBe(false);
});
