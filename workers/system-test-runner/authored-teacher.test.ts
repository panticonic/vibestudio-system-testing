import { expect, it } from "vitest";
import { openGoalTeacherCode } from "./authored-teacher.js";
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
