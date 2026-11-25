import { expect, it } from "vitest";
import { AUTHORED_START_BOUNDARY, AuthoredLifecycles, authoredLifecycleFailure, authoredHarnessSource, instrumentAuthoredStart } from "./authored-lifecycle.js";
import { openGoalTeacherCode } from "./authored-teacher.js";

it("authenticates the finite Eval and retains a monotonic boundary until release", () => {
  const runs = new AuthoredLifecycles();
  const release = runs.register("run", "eval:owned");
  expect(runs.evidence("run")?.teacherStarted).toBe(false);
  expect(() => runs.start("run", "eval:foreign")).toThrow("another finite Eval");
  expect(runs.evidence("run")?.teacherStarted).toBe(false);
  runs.start("run", "eval:owned");
  runs.start("run", "eval:owned");
  expect(runs.evidence("run")?.teacherStarted).toBe(true);
  expect(() => runs.register("run", "eval:other")).toThrow("already registered");
  release();
  expect(runs.evidence("run")).toBeUndefined();
  expect(() => runs.start("run", "eval:owned")).toThrow("another finite Eval");
});

it("does not certify uninstrumented sources or ambiguous boundaries", () => {
  expect(instrumentAuthoredStart("await unrelated();", "start();")).toBeNull();
  expect(() => instrumentAuthoredStart(AUTHORED_START_BOUNDARY.repeat(2), "start();"))
    .toThrow("one authored start boundary");
});

it("runs the real generated boundary after fixture binding and before any assigned load", async () => {
  for (const failure of ["fixture", "load", "root", null]) {
    const events: string[] = [];
    const runs = new AuthoredLifecycles();
    runs.register("run", "eval:owned");
    const code = openGoalTeacherCode({
      executorModel: "TEST-only:no-provider",
      bindingCode: `events.push("fixture"); if (failure === "fixture") throw Error("fixture failed"); const assignedServices={};`,
      goal: "TEST-only assigned result",
      entry: { program: "skills/test/review.nl", callable: "review", arguments: {goal:"TEST-only assigned result"},
        inputValues: ["TEST-only assigned result"], parameterNames: ["goal"], resultType: "string" },
    }, "run");
    const instrumented = instrumentAuthoredStart(code, 'events.push("start"); runs.start("run", "eval:owned");');
    expect(instrumented).not.toBeNull();
    const natlang = {
      captureModelTurns() { events.push("capture"); },
      async load() { events.push("load"); if (failure === "load") throw Error("load failed"); return async () => {
        events.push("root"); if (failure === "root") throw Error("root failed"); return "actual";
      }; },
      async calls() { return []; },
    };
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    try {
      const result = await new AsyncFunction("events", "failure", "runs", "natlang", instrumented + "\nreturn utilityValue;")(events, failure, runs, natlang);
      expect(failure).not.toBe("fixture");
      expect(result.executionError === null).toBe(failure === null);
    } catch (error) {
      if (failure !== "fixture") throw error;
      expect(String(error)).toContain("fixture failed");
    }
    expect(events[0]).toBe("fixture");
    expect(runs.evidence("run")?.teacherStarted).toBe(failure !== "fixture");
    if (failure === "fixture") expect(events).toEqual(["fixture"]);
    else expect(events.slice(0, 4)).toEqual(["fixture", "start", "capture", "load"]);
  }
});

it("carries runner evidence through canonical RPC and bounded failure serialization, overriding guest fields", async () => {
  const { serializeRpcFailure, deserializeRpcFailure } = await import("@vibestudio/rpc");
  const { systemTestFailure } = await import("../../skills/system-testing/structured-error.js");
  const runs = new AuthoredLifecycles();
  const guest = Object.assign(new Error("original failure"), {errorData:{authoredLifecycle:{teacherStarted:false}}});
  const unknown = systemTestFailure("orchestration", deserializeRpcFailure(serializeRpcFailure(authoredLifecycleFailure(runs, "unknown", guest))));
  expect(unknown.error.errorData).toEqual({authoredLifecycle:null});
  expect(unknown.error.cause?.errorData).toEqual(guest.errorData);
  runs.register("run", "eval:owned");
  runs.start("run", "eval:owned");
  const wrapped = authoredLifecycleFailure(runs, "run", guest);
  const failure = systemTestFailure("orchestration", deserializeRpcFailure(serializeRpcFailure(wrapped)));
  expect(failure.error.errorData).toEqual({authoredLifecycle:{
    schema:"vibestudio.authored-lifecycle/1",runId:"run",runtimeId:"eval:owned",boundary:"assigned-program-load",teacherStarted:true,
  }});
  expect(failure.error.cause?.message).toBe("original failure");
  expect(failure.error.cause?.errorData).toEqual(guest.errorData);
});

it("compiles the actual outcome utility with its typed marker import outside the nested capture block", async () => {
  const {openGoalOutcomeCode} = await import("./authored-teacher.js");
  const {createRequire} = await import("node:module");
  const {resolve} = await import("node:path");
  const {transform} = createRequire(resolve(process.env["VIBESTUDIO_APP_ROOT"] ?? process.cwd(), "package.json"))("esbuild");
  const source = authoredHarnessSource(openGoalOutcomeCode({
    executorModel:"TEST-only:no-provider", bindingCode:"const assignedServices={};const prepared={};",
    goal:"TEST-only goal",entry:{program:"skills/test/review.nl",callable:"review",arguments:{goal:"TEST-only goal"},
      inputValues:["TEST-only goal"],parameterNames:["goal"],resultType:"string"},
  }, "run"), "worker:owned", "run")!;
  const result = await transform(source, {loader:"ts",format:"esm",target:"es2022"});
  expect(result.code).toContain("markAssignedProgramStarted");
});
