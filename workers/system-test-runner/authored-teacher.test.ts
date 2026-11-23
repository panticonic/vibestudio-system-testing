import { expect, it } from "vitest";
import { authoredTeacherCode, openGoalTeacherCode } from "./authored-teacher.js";
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
  expect(value.trainingEligible).toBe(false);
  expect(value.calls).toHaveLength(1);
});
it("still requires successful root completion and exact teacher identity for full success eligibility", async () => {
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
  const natlang={captureModelTurns(){},load:async()=>({default:review,wrong:()=>{throw Error("Wrong export");}}),
    calls:async({after}:{after?:string})=>after?[]:[{callId:"root",parentCallId:null}],
    trace:async()=>({callId:"root",summary:{run_id:"run",owner_key:"owned",owner_kind:"eval"},record:{call_id:"root",parent_call_id:null,definition:{name:"review",id:"ts:review.ts#default",source:"review.ts"},executor:{kind:"crisp"},outcome:"done",model_turns:[]}})};
  const value=await new Function("natlang",`return (async()=>{${code};return utilityValue;})()`)(natlang);
  expect(called).toBe(1);expect(value.trainingEligible).toBe(true);expect(value.applicationResult).toEqual({answer:entry.arguments.goal});
  natlang.load=async()=>({default:async function wrong(){called++;return {};},wrong:()=>{throw Error("Wrong export");}}) as any;
  const rejected=await new Function("natlang",`return (async()=>{${code};return utilityValue;})()`)(natlang);
  expect(rejected.executionError.message).toMatch(/differs from the assigned callable/);expect(called).toBe(1);
});
