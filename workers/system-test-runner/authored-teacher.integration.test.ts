/** Offline runtime reference, never corpus/training input and never a provider request. */
import {expect,it} from "vitest";
import vm from "node:vm";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {createEvalNatlang} from "@workspace/natlang";
import {createTestDO} from "@workspace/runtime/worker/test-utils";
import {NatlangRecordsDO} from "@workspace-workers/natlang-records";
import {natlangRecordsRpcMethods} from "@workspace/natlang-records/contract";
import {makeTestCatalogEntry} from "@workspace/model-catalog/testing";
import {tameRealmCodegen} from "@vibestudio/shared/evalConfinement";
import type {AuthenticatedCaller} from "@vibestudio/rpc";
import {openGoalTeacherCode} from "./authored-teacher.js";
class ReferenceRecords extends NatlangRecordsDO {
  protected override get caller():AuthenticatedCaller|null{return {callerId:"offline-reference",callerKind:"worker"} as AuthenticatedCaller;}
}
it("captures an actual TS default root with real typed NL descendants through the authored harness",async()=>{
  const {instance:records}=await createTestDO(ReferenceRecords);
  const handlers=Object.fromEntries(Object.keys(natlangRecordsRpcMethods).map(method=>[method,(input:any)=>(records as any)[method](input)]));
  const model=makeTestCatalogEntry({ref:"test:executor-small",id:"executor-small",name:"Offline reference",provider:"test",baseUrl:"http://unused.invalid/v1"});
  let turns=0;
  const rpc={async call(target:string,method:{name:string},args:unknown[]){
    const input=args[0] as any;
    if(target==="main")return {kind:"durable-object",source:input,className:input,objectKey:"k",targetId:`do:${input}`};
    if(target==="do:vibestudio.natlang.v1")return handlers[method.name]!(input);
    if(target==="do:vibestudio.models.v1")return method.name==="resolveRole"?{role:input,ref:model.ref,source:"local",model}:method.name==="getModel"?model:null;
    if(target==="do:vibestudio.model-gateway.v1"&&method.name==="turn"){
      turns++;
      const message={role:"assistant",content:[{type:"toolCall",id:"offline-return",name:"return_result",arguments:{status:"success",value:"checked"}}],api:"openai-completions",provider:"test",model:"executor-small",usage:{input:11,output:7,cacheRead:0,cacheWrite:0,totalTokens:18,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"toolUse",timestamp:0};
      return {status:"completed",turnId:input.turnId,message,model:input.model,usage:message.usage,attribution:{callerId:"offline-reference",callerKind:"do"}};
    }
    throw Error(`Unexpected offline RPC ${target}.${method.name}`);
  }};
  const files:Record<string,string>={
    "skills/reference/review.ts":'import judge from "./judge.nl"; export default async function review(goal:string):Promise<{answer:string;count:number}>{return {answer:await judge(goal),count:goal.length};}',
    "skills/reference/judge.nl":"---\nargs: { goal: string }\nreturns: string\n---\nJudge the supplied goal.\n",
  };
  const realm=vm.createContext({});tameRealmCodegen(vm.runInContext("globalThis",realm));
  const newFunction=(body:string,name:string,...names:string[])=>vm.runInContext(`(function ${name.replace(/\W/g,"_")}(${names.join(",")}){${body}\n})`,realm);
  const runtime=createEvalNatlang({newFunction,owner:{kind:"user",objectKey:"offline-ts-root-reference"},bindings:{rpc,fs:{
    stat:async(p:string)=>({isDirectory:()=>!Object.hasOwn(files,p)}),
    readdir:async()=>Object.keys(files).map(p=>({name:path.basename(p),isDirectory:()=>false})),readFile:async(p:string)=>files[p]!,
  }}});
  const goal="Review the reference value";
  const entry={program:"skills/reference/review.ts",callable:"review",arguments:{goal},inputValues:[goal],parameterNames:["goal"],resultType:"{answer:string;count:number}"};
  const code=openGoalTeacherCode({executorModel:model.ref,bindingCode:"const assignedServices={};",goal,entry},"offline-ts-reference");
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  try{
    const lowered=runtime.lowerCell(`${code};return utilityValue;`,{fileName:"reference.ts",jsx:false,ambientNames:[],scopeValues:{}});
    expect(lowered.diagnostics).toEqual([]);
    const execute=new AsyncFunction("nl","natlang","__natlang",lowered.code);
    const result=await runtime.runCell(()=>execute(runtime.ambient.nl,runtime.ambient.natlang,runtime.ambient.__natlang),{runId:"offline-ts-reference",signal:new AbortController().signal});
    const captured=result.value as any;
    expect(captured.executionError).toBeNull();expect(captured.captureErrors).toEqual([]);expect(captured.trainingEligible).toBe(true);
    expect(captured.applicationResult).toEqual({answer:"checked",count:goal.length});expect(turns).toBe(1);
    expect(captured.calls).toHaveLength(2);
    const root=captured.calls.find((item:any)=>item.callId===captured.rootCallIds[0]);
    const child=captured.calls.find((item:any)=>item.record.parent_call_id===root.callId);
    expect(root.record.executor.kind).toBe("crisp");expect(root.record.definition.id).toBe("ts:review.ts#default");
    expect(root.record.definition.params).toEqual([{name:"goal",type:"string"}]);
    expect(child.record.definition.name).toBe("judge");expect(child.record.model_turns).toHaveLength(1);
    if(process.env.NATLANG_TS_ENTRY_REFERENCE_OUT){
      await mkdir(process.env.NATLANG_TS_ENTRY_REFERENCE_OUT,{recursive:true});
      await writeFile(path.join(process.env.NATLANG_TS_ENTRY_REFERENCE_OUT,"actual-capture.json"),JSON.stringify({purpose:"offline-runtime-reference-not-training-data",goal,entry,captured},null,2));
    }
  }finally{runtime.close();}
});
