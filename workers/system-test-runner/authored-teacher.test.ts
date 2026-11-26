import { expect, it } from "vitest";
import { observeNativeActions } from "@workspace/application-outcomes/native-action-journal";
import { authoredTeacherCode, openGoalTeacherCode, openGoalOutcomeCode } from "./authored-teacher.js";
async function capture(outcome: string, model = "Luna") {
  const code = openGoalTeacherCode(
    {
      executorModel: "Luna",
      bindingCode: "const assignedServices={};",
      goal: "Review the owned value",
      entry: {
        program: "skills/domain/review.nl",
        callable: "review",
        arguments: { goal: "Review the owned value" },
        inputValues: ["Review the owned value"],
        parameterNames: ["goal"],
        resultType: "Review",
      },
    },
    "run",
  );
  const natlang = {
    captureModelTurns() {},
    load: async () => async () => ({ answer: "actual" }),
    calls: async ({ after }: { after?: string }) =>
      after ? [] : [{ callId: "root", parentCallId: null }],
    trace: async () => ({
      callId: "root",
      summary: { run_id: "run", owner_key: "owned", owner_kind: "eval" },
      record: {
        call_id: "root",
        parent_call_id: null,
        definition: { name: "review" },
        outcome,
        model_turns: [
          {
            kind: "generation",
            reply: { raw_response: { vibestudio: { model } } },
          },
        ],
      },
    }),
  };
  const run = new Function(
    "natlang",
    `return (async()=>{${code};return utilityValue;})()`,
  );
  return run(natlang);
}
it("keeps failed authored execution distinct from evidence corruption", async () => {
  const value = await capture("error");
  expect(value.rootOutcome).toBe("error");
  expect(value.captureErrors).toEqual([]);
  expect(value.executionError).toMatchObject({
    name: "AuthoredExecutionFailure",
  });
  expect(value.trainingEligible).toBe(true);
  expect(value.calls).toHaveLength(1);
});
it("keeps capture eligibility independent of completion while requiring exact teacher identity", async () => {
  expect((await capture("done")).trainingEligible).toBe(true);
  const wrong = await capture("done", "Sol");
  expect(wrong.captureErrors).toContain(
    "Teacher reply came from another actual model",
  );
  expect(wrong.trainingEligible).toBe(false);
});

it("captures the actual shared return without prescribing NL child calls", async () => {
  const result = { results: [{ kind: "repairPanel", report: { changed: true } }], remaining: [] };
  const code = authoredTeacherCode({ skill: "repairPanel", serviceNames: [], executorModel: "Luna", request: { goal: "Repair the owned panel" }, bindingCode: "const assignedService={};" }, "run");
  const natlang = {
    captureModelTurns() {}, load: async () => async () => result,
    calls: async ({after}: {after?: string}) => after ? [] : [{ callId: "root", parentCallId: null }],
    trace: async () => ({callId:"root",summary:{run_id:"run",owner_key:"owned",owner_kind:"eval"},record:{call_id:"root",parent_call_id:null,definition:{name:"runWorkflow"},outcome:"done",model_turns:[]}}),
  };
  const value = await new Function("natlang", `return (async()=>{${code};return utilityValue;})()`)(natlang);
  expect(value.trainingEligible).toBe(true);
  expect(value.applicationResult).toEqual(result);
  expect(value.report).toEqual(result.results[0].report);
});

it("invokes only the exact named TS default export and retains its crisp authored root",async()=>{
  const entry={program:"skills/domain/review.ts",callable:"review",arguments:{goal:"Review the owned value"},inputValues:["Review the owned value"],parameterNames:["goal"],resultType:"Review"};
  const code=openGoalTeacherCode({executorModel:"reference:offline",bindingCode:"const assignedServices={};",goal:entry.arguments.goal,entry},"run");
  let called=0;
  const review=async function review(goal:string){called++;return {answer:goal};};
  // ProgramLoader preserves the declared name explicitly; Vite may rename this
  // local mock's function expression while transforming the test module.
  Object.defineProperty(review,"name",{value:entry.callable});
  const natlang={captureModelTurns(){},load:async()=>({default:review,wrong:()=>{throw Error("Wrong export");}}),
    calls:async({after}:{after?:string})=>after?[]:[{callId:"root",parentCallId:null}],
    trace:async()=>({callId:"root",summary:{run_id:"run",owner_key:"owned",owner_kind:"eval"},record:{call_id:"root",parent_call_id:null,definition:{name:"review",id:"ts:review.ts#default",source:"review.ts"},executor:{kind:"crisp"},outcome:"done",model_turns:[]}})};
  const value=await new Function("natlang",`return (async()=>{${code};return utilityValue;})()`)(natlang);
  expect(value.executionError).toBeNull();expect(called).toBe(1);expect(value.trainingEligible).toBe(true);expect(value.applicationResult).toEqual({answer:entry.arguments.goal});
  natlang.load=async()=>({default:async function wrong(){called++;return {};},wrong:()=>{throw Error("Wrong export");}}) as any;
  const rejected=await new Function("natlang",`return (async()=>{${code};return utilityValue;})()`)(natlang);
  expect(rejected.executionError.message).toMatch(/differs from the assigned callable/);expect(called).toBe(1);
});

async function captureObservedReturn(result: unknown, throws: boolean, resultType = "void", outcomeWrapper = false) {
  const entry = {program:"skills/domain/review.nl",callable:"review",arguments:{goal:"Correct the owned text"},inputValues:["Correct the owned text"],parameterNames:["goal"],resultType};
  const options = {executorModel:"Luna",bindingCode:"const assignedServices={};",goal:entry.arguments.goal,entry};
  let verified:unknown = "not invoked";
  const code = outcomeWrapper ? openGoalOutcomeCode({...options,bindingCode:"const assignedServices={};const prepared={verify:async value=>{observed(value);return {passed:true,checks:{actualEffect:true}};},close:async()=>{}};const actualContextId='ctx';"},"run").replace(/^    import .*;$/gm, "") : openGoalTeacherCode(options,"run");
  const natlang = {captureModelTurns(){}, load:async()=>async()=>{if(throws)throw new Error("after effect");return result;},
    calls:async({after}:{after?:string})=>after?[]:[{callId:"root",parentCallId:null}],
    trace:async()=>({callId:"root",summary:{run_id:"run",owner_key:"owned",owner_kind:"eval"},record:{call_id:"root",parent_call_id:null,definition:{name:"review"},outcome:throws?"error":"done",model_turns:[]}})};
  const captured = await new Function("natlang","observed","assessSemanticOutcome","observeInvocation","createNatlangRecordsClient","rpc","observeNativeActions",`return (async()=>{${code};return utilityValue;})()`)(natlang,(value:unknown)=>{verified=value;},(value:unknown)=>value,()=>({}),()=>({getValue(){}}),{},observeNativeActions);
  return {value:JSON.parse(JSON.stringify(captured)),raw:captured,verified};
}

it("distinguishes actual completed void, ordinary null, and no return after an exception",async()=>{
  const completed=(await captureObservedReturn(undefined,false)).value;
  expect(completed.entry.resultType).toBe("void");
  expect(completed.applicationResultKind).toBe("void");expect(completed.applicationResult).toBeNull();
  const ordinary=(await captureObservedReturn(null,false,"Review | null")).value;
  expect(ordinary.applicationResult).toBeNull();expect(Object.hasOwn(ordinary,"applicationResultKind")).toBe(false);
  const failure=await captureObservedReturn(undefined,true);
  const failed=failure.value;
  expect(Object.hasOwn(failure.raw,"applicationResult")).toBe(false);expect(Object.hasOwn(failure.raw,"applicationResultKind")).toBe(false);
  expect(failed.entry.resultType).toBe("void");expect(failed.executionError.message).toBe("after effect");
  expect(Object.hasOwn(failed,"applicationResult")).toBe(false);expect(Object.hasOwn(failed,"applicationResultKind")).toBe(false);
});

it("emits a void witness only for an observed successful undefined return",async()=>{
  const completed=await captureObservedReturn(undefined,false,"void",true);
  expect(completed.verified).toBeUndefined();
  for(const proof of [completed.raw.verification,completed.value.verification]){
    expect(Object.hasOwn(proof,"actualResult")).toBe(true);
    expect(proof.actualResult).toBeNull();expect(proof.actualResultKind).toBe("void");
  }
});

it("omits both independent return witnesses after void and nonvoid root exceptions",async()=>{
  for(const resultType of ["void","Review"]){
    const failed=await captureObservedReturn(undefined,true,resultType,true);
    expect(failed.verified).toBeUndefined();
    for(const packet of [failed.raw,failed.value]){
      expect(packet.verification.passed).toBe(true);
      expect(packet.teacher.executionError.message).toBe("after effect");
      expect(packet.teacher.rootOutcome).toBe("error");
      expect(packet.teacher.calls).toHaveLength(1);
      for(const field of ["actualResult","actualResultKind"])expect(Object.hasOwn(packet.verification,field)).toBe(false);
      for(const field of ["applicationResult","applicationResultKind"])expect(Object.hasOwn(packet.teacher,field)).toBe(false);
    }
  }
});

it("retains genuine null and ordinary values without a fabricated void marker",async()=>{
  for(const result of [null,{answer:"actual"}]){
    const completed=await captureObservedReturn(result,false,"Review | null",true);
    expect(completed.verified).toEqual(result);
    for(const packet of [completed.raw,completed.value]){
      expect(Object.hasOwn(packet.verification,"actualResult")).toBe(true);
      expect(packet.verification.actualResult).toEqual(result);
      expect(Object.hasOwn(packet.verification,"actualResultKind")).toBe(false);
      expect(Object.hasOwn(packet.teacher,"applicationResultKind")).toBe(false);
    }
  }
});
