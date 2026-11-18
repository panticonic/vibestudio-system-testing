import { describe, expect, it } from "vitest";
import { authoredTeacherCode, composedTeacherCode, domainTeacherCode } from "./authored-teacher.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const options = { skill: "repairPanel" as const, serviceNames: ["assigned", "assignedEdit"], executorModel: "provider:teacher", request: { goal: "task" }, bindingCode: "const assignedService={};" };
async function capture(rootOutcome: string, childParent = "root", wrongModel = false) {
  const rows = [{ callId: "root", parentCallId: null }, { callId: "skill", parentCallId: "root" }, { callId: "child", parentCallId: "skill" }];
  return new AsyncFunction("natlang", authoredTeacherCode(options, "run-one") + "\nreturn utilityValue;")({
    captureModelTurns() {}, load: async (path: string, binding: {services:Record<string,object>}) => {
      expect(path).toBe("skills/vibestudio-workflows/runWorkflow.nl");
      expect(Object.keys(binding.services)).toEqual(["assigned", "assignedEdit"]);
      expect(binding.services["assigned"]).toBe(binding.services["assignedEdit"]);
      return async (input: unknown) => {
        expect(input).toEqual({goal:"task",work:[{kind:"repairPanel",input:{goal:"task"}}]});
        return {results:[{kind:"repairPanel",report:{status:"verified"}}],remaining:[]};
      };
    },
    calls: async ({ after }: { after?: string }) => after ? [] : rows,
    trace: async (id: string) => ({ callId: id, summary: { run_id: "run-one", owner_key: "owner", owner_kind: "test" },
      events: [{ kind: "action", outcome: "error" }],
      record: { call_id: id, parent_call_id: id === "root" ? null : id === "skill" ? childParent : "skill",
        definition: { name: id === "root" ? "runWorkflow" : id === "skill" ? "repairPanel" : "reproduce" }, outcome: id === "root" ? rootOutcome : id === "skill" ? "done" : "error",
        model_turns: [{ kind: "generation", reply: { raw_response: { vibestudio: { model: wrongModel ? "other:model" : "provider:teacher" } } } }] } }),
  });
}
describe("authored teacher capture eligibility", () => {
  it("retains recovered failed children and actions when the authored root succeeds", async () => {
    const result = await capture("done");
    expect(result.trainingEligible).toBe(true);
    expect(result.calls).toHaveLength(3);
    expect(result.calls[2].record.outcome).toBe("error");
    expect(result.calls[0].events[0].outcome).toBe("error");
  });
  it("excludes a failed root while preserving its available records", async () => {
    const result = await capture("error");
    expect(result.trainingEligible).toBe(false);
    expect(result.calls).toHaveLength(3);
  });
  it("rejects inconsistent lineage", async () => { expect((await capture("done", "missing")).trainingEligible).toBe(false); });
  it("rejects another actual teacher", async () => { expect((await capture("done", "root", true)).trainingEligible).toBe(false); });
});

it("qualifies a composed route only when the actual prerequisite completes first", async () => {
  const options = {
    executorModel: "provider:teacher",
    workflowRequest: {goal: "Ready the release and prepare the handoff", work: [
      {kind: "deliverProject", input: {goal: "Prepare after readiness"}},
      {kind: "operate", input: {goal: "Establish readiness"}},
    ]},
    requiredOrder: ["operate", "deliverProject"],
    bindingCode: "const assignedServices={};",
  } as const;
  const generated = composedTeacherCode({
    ...options,
    workflowRequest: {...options.workflowRequest, work: [...options.workflowRequest.work]},
    requiredOrder: [...options.requiredOrder],
  }, "run-one");
  const root = {callId:"root",parentCallId:null};
  const release = {callId:"operate",parentCallId:"root"};
  const project = {callId:"deliverProject",parentCallId:"root"};
  const at = (second: number) => new Date(second * 1000).toISOString();
  const run = (projectStarted: number) => new AsyncFunction("natlang", generated + "\nreturn utilityValue;")({
    captureModelTurns() {},
    load: async () => async () => ({results:[{kind:"operate",report:{ready:true}},{kind:"deliverProject",report:{committed:true}}],remaining:[]}),
    calls: async ({ after }: { after?: string }) => after ? [] : [root, project, release],
    trace: async (id: string) => ({
      callId: id,
      summary: {run_id:"run-one",owner_key:"owner",owner_kind:"test"},
      record: {
        call_id:id,parent_call_id:id==="root"?null:"root",definition:{name:id==="root"?"runWorkflow":id},
        outcome:"done",
        started_at:at(id==="root"?0:id==="operate"?1:projectStarted),
        ended_at:at(id==="operate"?3:5),
      },
    }),
  });
  expect((await run(4)).trainingEligible).toBe(true);
  const failure = await run(2);
  expect(failure.trainingEligible).toBe(false);
  expect(failure.captureErrors).toContain("A dependent skill began before its prerequisite completed");
});

it("binds a domain result to its submitted domain and direct recorded operation", async () => {
  const generated = domainTeacherCode(
    {
      executorModel: "provider:teacher",
      work: {
        kind: "domain",
        domain: "scratchHandoff",
        operation: "assembleHandoff",
        input: { goal: "unused descriptor" },
      },
      inputCode: "seeded",
      bindingCode:
        'const seeded={goal:"task", sources:["real scratch path"]}, assignedServices={};',
    },
    "domain-one",
  );
  const rows = [
    { callId: "root", parentCallId: null },
    { callId: "handoff", parentCallId: "root" },
  ];
  const run = (domain: string) =>
    new AsyncFunction("natlang", generated + "\nreturn utilityValue;")({
      captureModelTurns() {},
      load: async () => async (request: { work: { input: unknown }[] }) => {
        expect(request.work[0]?.input).toEqual({
          goal: "task",
          sources: ["real scratch path"],
        });
        return {
          results: [
            {
              kind: "domain",
              domain,
              operation: "assembleHandoff",
              report: { status: "staged" },
            },
          ],
          remaining: [],
        };
      },
      calls: async ({ after }: { after?: string }) => (after ? [] : rows),
      trace: async (id: string) => ({
        callId: id,
        summary: {
          run_id: "domain-one",
          owner_key: "owned",
          owner_kind: "test",
        },
        record: {
          call_id: id,
          parent_call_id: id === "root" ? null : "root",
          definition: {
            name: id === "root" ? "runWorkflow" : "assembleHandoff",
          },
          outcome: "done",
        },
      }),
    });
  expect((await run("scratchHandoff")).trainingEligible).toBe(true);
  expect((await run("other")).trainingEligible).toBe(false);
});
