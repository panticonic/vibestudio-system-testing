import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({call:vi.fn(),resolveService:vi.fn()}));
vi.mock("@workspace/runtime",()=>{throw new Error("Health leaf must consume native ports, not load the runtime implementation");});
vi.mock("./stages.js",()=>{throw new Error("Doctor must consume native catalog data without importing test implementations");});
import {systemTestDoctor} from "../../packages/system-test-health/src/index.js";
const route={primaryModel:"openai-codex:gpt-6-luna",fallbackModel:null,fallbackThinkingLevel:null,fallbackScope:null};
const ports={rpc:{call:mocks.call},workers:{resolveService:mocks.resolveService}};
describe("minimal doctor",()=>{
 beforeEach(()=>{
  mocks.call.mockReset();mocks.resolveService.mockResolvedValue({kind:"durable-object",targetId:"models"});
  mocks.call.mockImplementation(async(_target,method,args)=>{
   if(method.name==="build.listUnits")return[{name:"workers/agent-worker",kind:"worker",status:"ready"}];
   if(method.name==="workspace.getConfig")return{extensions:[]};
   if(method.name==="fs.readFile")return"standalone native config";
   if(method.name==="inspectModels")return{models:args[0].map((ref:string)=>({ref,availability:{state:"ready"}}))};
   return{observed:true};
  });
 });
 it("performs every native health check using actual supplied registry names without fixture code",async()=>{
  const result=await systemTestDoctor(route,["registered-a","registered-b"],ports);
  expect(result.ok).toBe(true);expect(result.checks.map(check=>check.name)).toEqual(["test-catalog","server","system-testing-build","agent-worker","required-extensions","workspace-configuration","model"]);
  expect(result.checks[0]).toMatchObject({ok:true,detail:"2 tests discovered"});
  expect(mocks.call.mock.calls.some(call=>call[1].name==="workspace.validateConfig")).toBe(true);
  expect(mocks.call.mock.calls.some(call=>call[1].name==="inspectModels")).toBe(true);
  expect(mocks.call.mock.calls.every(call=>!["run","complete","stream"].includes(call[1].name))).toBe(true);
 });
 it("does not turn an empty or duplicated registry into healthy readiness",async()=>{
  expect((await systemTestDoctor(route,[],ports)).checks[0].ok).toBe(false);
  expect((await systemTestDoctor(route,["same","same"],ports)).checks[0].ok).toBe(false);
 });
});
