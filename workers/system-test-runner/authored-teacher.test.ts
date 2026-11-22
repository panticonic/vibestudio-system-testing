import { describe, expect, it } from "vitest";
import { authoredTeacherCode, composedTeacherCode, domainTeacherCode, domainTeacherQualificationCode, openGoalOutcomeCode, openGoalTeacherCode } from "./authored-teacher.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const entry = (goal: string) => ({
  program: "skills/application/reviseDocument.nl", callable: "reviseDocument", arguments: { goal },
  parameterNames: ["goal"], inputValues: [goal], resultType: "Revision",
});
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

it.each([undefined, "Private fixture goal"] as const)(
  "passes only the catalog goal when the adapter supplies %s",
  async (adapterGoal) => {
    const goal = 'Update the notice titled "Approved decision".\nKeep the footer intact.';
    const code = openGoalTeacherCode({
      executorModel: "provider:teacher",
      entry: entry(goal),
      goal,
      bindingCode: `const prepared=${JSON.stringify({ goal: adapterGoal })}, assignedServices={};`,
    }, "run-one");
    const rows = [{ callId: "root", parentCallId: null }, { callId: "edit", parentCallId: "root" }];
    const report = { status: "edited", path: "notice.md" };
    const result = await new AsyncFunction("natlang", code + "\nreturn utilityValue;")({
      captureModelTurns() {},
      load: async (path: string) => {
        expect(path).toBe(entry(goal).program);
        return async (...args: unknown[]) => {
          expect(args).toEqual([goal]);
          return report;
        };
      },
      calls: async ({ after }: { after?: string }) => after ? [] : rows,
      trace: async (id: string) => ({
        callId: id,
        summary: { run_id: "run-one", owner_key: "owner", owner_kind: "test" },
        record: {
          call_id: id,
          parent_call_id: id === "root" ? null : "root",
          definition: { name: id === "root" ? "reviseDocument" : "reviseWorkspaceDocument" },
          outcome: "done",
        },
      }),
    });
    expect(result).toMatchObject({ report, trainingEligible: true, rootCallIds: ["root"] });
    expect(result.calls).toHaveLength(2);
  },
);

it.each([[false, false], [true, false], [false, true], [true, true]])(
  "keeps captured teacher records after verifier failure (%s) or retirement failure (%s)",
  async (failVerification, failRetirement) => {
    const code = openGoalOutcomeCode({
      executorModel: "provider:teacher",
      goal: "Confirm the stored result.",
      entry: entry("Confirm the stored result."),
      bindingCode: "const assignedServices = {}, actualContextId = 'context';",
    }, "run-one");
    const report = { disposition: "confirmed" };
    const verification = { contextId: "context", passed: true };
    let retired = false;
    const prepared = {
      async verify(value: unknown) {
        expect(value).toEqual(report);
        if (failVerification) throw new TypeError("missing evidence");
        return verification;
      },
      async close() {
        retired = true;
        if (failRetirement) throw new Error("owner lost");
      },
    };
    const result = await new AsyncFunction("natlang", "prepared", "assessSemanticOutcome", "applicationVerifierValue", code.replace(/import \{ assessSemanticOutcome, applicationVerifierValue \} from [^;]+;/u, "") + "\nreturn utilityValue;")({
      captureModelTurns() {},
      load: async () => async () => report,
      calls: async ({ after }: { after?: string }) => after ? [] : [{ callId: "root", parentCallId: null }],
      trace: async () => ({
        callId: "root",
        summary: { run_id: "run-one", owner_key: "owner", owner_kind: "test" },
        record: { call_id: "root", parent_call_id: null, definition: { name: "reviseDocument" }, outcome: "done" },
      }),
    }, prepared, (value: unknown) => value, (_entry: unknown, value: unknown) => value);
    expect(retired).toBe(true);
    expect(result).toMatchObject({
      contextId: "context",
      teacher: { report, calls: [{ callId: "root" }], trainingEligible: true },
      verification: failVerification ? null : verification,
      verificationErrors: [
        ...(failVerification ? [{ phase: "verification", message: "missing evidence" }] : []),
        ...(failRetirement ? [{ phase: "retirement", message: "owner lost" }] : []),
      ],
    });
  },
);

it("rejects an absent catalog goal before generating teacher code", () => {
  expect(() => openGoalTeacherCode({ executorModel: "provider:teacher", bindingCode: "", goal: " ", entry: entry(" ") }, "run-one"))
    .toThrow("needs the catalog's user goal");
});

it.each([false, true])("qualifies a composed route with a domain assignment (%s) only after its prerequisite", async (domain) => {
  const nextWork = domain
    ? {kind:"domain", domain:"scratchHandoff",operation:"assembleHandoff", input:{goal:"Prepare after readiness"}} as const
    : {kind:"deliverProject",input:{goal:"Prepare after readiness"}} as const;
  const nextOperation = domain ? "assembleHandoff" : "deliverProject";
  const options = {
    executorModel: "provider:teacher",
    workflowRequest: {goal: "Ready the release and prepare the handoff", work: [
      nextWork,
      {kind: "operate", input: {goal: "Establish readiness"}},
    ]},
    requiredOrder: ["operate", nextOperation],
    bindingCode: "const assignedServices={};",
  } as const;
  const generated = composedTeacherCode({
    ...options,
    workflowRequest: {...options.workflowRequest, work: [...options.workflowRequest.work]},
    requiredOrder: [...options.requiredOrder],
  }, "run-one");
  const root = {callId:"root",parentCallId:null};
  const release = {callId:"operate",parentCallId:"root"};
  const project = {callId:nextOperation,parentCallId:"root"};
  const at = (second: number) => new Date(second * 1000).toISOString();
  const run = (projectStarted: number) => new AsyncFunction("natlang", generated + "\nreturn utilityValue;")({
    captureModelTurns() {},
    load: async () => Object.assign(async () => ({results:[{kind:"operate",report:{ready:true}},{...nextWork,report:{committed:true}}],remaining:[]}), { domains: {scratchHandoff:{assembleHandoff() {}}} }),
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
  const run = (domain: string, mounted = true) =>
    new AsyncFunction("natlang", generated + "\nreturn utilityValue;")({
      captureModelTurns() {},
      load: async () => Object.assign(async (request: { work: { input: unknown }[] }) => {
        expect(mounted).toBe(true);
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
      }, { domains: mounted ? {scratchHandoff: {assembleHandoff() {}}} : {} }),
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
  const missing = await run("scratchHandoff", false);
  expect(missing.trainingEligible).toBe(false);
  expect(missing.executionError.message).toContain("no mounted callable scratchHandoff/assembleHandoff");
});

it("uses the same mounted operation check during model-free qualification", async () => {
  const generated = domainTeacherQualificationCode(
    [{domain: "capabilities", operation: "reviewAuthority"}],
    'const assignedServices={}, prepared={qualify:()=>({passed:true})};',
  );
  const run = (operation: string) =>
    new AsyncFunction("natlang", generated + "\nreturn utilityValue;")({
      load: async () => ({ domains: { capabilities: { [operation]() {} } } }),
    });
  await expect(run("reviewAuthority")).resolves.toEqual({passed:true});
  await expect(run("planAuthorityReview")).rejects.toThrow("no mounted callable capabilities/reviewAuthority");
});

it("captures a completed prerequisite and explicit hold without admitting the dependent call", async () => {
  const reason = "Release dossier held for security-signoff.";
  const generated = composedTeacherCode({
    executorModel: "provider:teacher",
    workflowRequest: { goal: "Commit the dossier only after a ready release", work: [
      { kind: "deliverProject", input: { goal: "Prepare a dossier" } },
      { kind: "operate", input: { goal: "Check current release gates" } },
    ] },
    bindingCode: "const assignedServices = {};",
    requiredOrder: ["operate"],
    heldAssignments: { deliverProject: reason },
  }, "hold-run");
  const execute = new AsyncFunction("natlang", generated + "\nreturn utilityValue;");
  const run = (remaining: string[], children: string[]) => execute({
    captureModelTurns() {},
    load: async () => async () => ({
      results: [{ kind: "operate", report: { decision: "blocked" } }],
      remaining,
    }),
    calls: async ({ after }: { after?: string }) => after ? [] : [
      { callId: "runWorkflow", parentCallId: null },
      ...children.map((callId) => ({ callId, parentCallId: "runWorkflow" })),
    ],
    trace: async (callId: string) => ({
      callId,
      summary: { run_id: "hold-run", owner_key: "owner", owner_kind: "test" },
      record: {
        call_id: callId,
        parent_call_id: callId === "runWorkflow" ? null : "runWorkflow",
        definition: { name: callId },
        outcome: "done",
        started_at: "2026-11-20T12:00:00Z",
        ended_at: "2026-11-20T12:00:01Z",
      },
    }),
  });
  expect((await run([reason], ["operate"])).trainingEligible).toBe(true);
  expect((await run([], ["operate"])).trainingEligible).toBe(false);
  expect((await run([reason], ["operate", "deliverProject"])).trainingEligible).toBe(false);
});

it("captures a direct application function with several typed inputs and no router", async () => {
  const task = {
    program: "skills/library/reconcileDraft.nl", callable: "reconcileDraft",
    arguments: { goal: "Keep the approved date", approved: { date: "2026-12-01" } },
    parameterNames: ["goal", "approved"], inputValues: ["Keep the approved date", { date: "2026-12-01" }],
    resultType: "ProposedRevision",
  };
  const resultValue = { changes: [{ path: "start", value: "2026-12-01" }] };
  const generated = openGoalTeacherCode({ entry: task, goal: task.arguments.goal, executorModel: "provider:teacher", bindingCode: "const assignedServices={};" }, "run-one");
  const captured = await new AsyncFunction("natlang", generated + "\nreturn utilityValue;")({
    captureModelTurns() {},
    load: async (program: string) => {
      expect(program).toBe(task.program);
      return async (...args: unknown[]) => {
        expect(args).toEqual(task.inputValues);
        return resultValue;
      };
    },
    calls: async ({ after }: { after?: string }) => after ? [] : [{ callId: "root", parentCallId: null }],
    trace: async () => ({ callId: "root", summary: { run_id: "run-one", owner_kind: "eval", owner_key: "owner" },
      record: { call_id: "root", parent_call_id: null, definition: { name: "reconcileDraft" }, outcome: "done" } }),
  });
  expect(captured.trainingEligible).toBe(true);
  expect(captured.report).toEqual(resultValue);
  expect(captured.entry).toEqual({ program: task.program, callable: task.callable, arguments: task.arguments });
  expect(captured.calls).toHaveLength(1);
});

it("refuses an argument list that differs from the declared application entry", () => {
  const task = { ...entry("original"), inputValues: ["rewritten"] };
  expect(() => openGoalTeacherCode({ entry: task, goal: "original", executorModel: "provider:teacher", bindingCode: "" }, "run-one"))
    .toThrow("exact application arguments");
});
