import { beforeEach, expect, it, vi } from "vitest";
import { prepareOpenGoalSuite } from "./open-goal-suite-managed.js";
import { suiteGoalWorlds } from "./open-goal-suite-worlds.js";

const hooks = vi.hoisted(() => ({ stateHash: "initial-state", nativeRuns: 0 }));

vi.mock("@workspace/runtime", () => ({
  rpc: { async call(_target: string, _method: unknown, [target, , suite]: string[]) {
    return { protocol: "workspace-test-plan.v1", target, suite, stateHash: hooks.stateHash,
      runtime: suite === "native" ? "native" : "workerd" };
  } },
}));

vi.mock("@workspace-skills/native-suite-review-bindings", () => ({
  bindSuiteReview(input: { target: string; suite: string; testName: string | null }) {
    const plan = { target: input.target, suite: input.suite, stateHash: hooks.stateHash,
      runtime: input.suite === "native" ? "native" : "workerd", contextId: "owned" };
    return {
      request: { ...input, operationId: "binding" },
      services: {
        testSuitePlanRead: { resolve: async () => plan },
        testSuiteVerificationRun: { async run() {
          hooks.nativeRuns++;
          const noMatch = input.testName?.includes("retry");
          return { current: true, status: noMatch ? "no-tests" : "passed",
            receipt: { ...plan, operation: "test", ref: "ctx:owned" },
            reportDigest: "a".repeat(64), executionDigest: "b".repeat(64), artifactKey: "native:artifact",
            failed: 0, passed: noMatch ? 0 : 1 };
        } },
      },
    };
  },
}));

beforeEach(() => { hooks.stateHash = "initial-state"; hooks.nativeRuns = 0; });

it("discovers the actual alternatives and refuses a plan whose source changes", async () => {
  const world = suiteGoalWorlds[1]!;
  const prepared = prepareOpenGoalSuite({ contextId: "owned", caseId: world.id }, world);
  const { goalSuite } = prepared.services;
  expect(await goalSuite.prepare(world.expected.choice)).toBeNull();
  const routes = await goalSuite.discover();
  expect(routes.map(({ runtime }) => runtime)).toEqual(["workerd", "native"]);
  hooks.stateHash = "another-source";
  expect(await goalSuite.prepare(world.expected.choice)).toBeNull();
  expect(hooks.nativeRuns).toBe(0);
});

it("protects a planning-only goal and reports the declared approval", async () => {
  const world = suiteGoalWorlds[0]!;
  const prepared = prepareOpenGoalSuite({ contextId: "owned", caseId: world.id }, world);
  await prepared.services.goalSuite.discover();
  expect(await prepared.services.goalSuite.prepare({ ...world.expected.choice, mode: "verify" })).toBeNull();
  expect((await prepared.qualify()).passed).toBe(true);
  expect(hooks.nativeRuns).toBe(0);
});

it("retains a genuine no-match receipt and rejects an invented success", async () => {
  const world = suiteGoalWorlds[2]!;
  const prepared = prepareOpenGoalSuite({ contextId: "owned", caseId: world.id }, world);
  const proof = await prepared.qualify();
  expect(proof.passed).toBe(true);
  expect(proof.execution?.status).toBe("no-tests");
  expect(hooks.nativeRuns).toBe(1);
  const forged = await prepared.verify({ status: "suite-reviewed", selection: world.expected.choice, review: {
    plan: proof.plan, decision: { route: { runtime: "native", nativeApproval: true }, next: "run-assignment" },
    execution: proof.execution, result: { outcome: "verified" },
  } });
  expect(forged.checks.checkedSuiteReceipt).toBe(false);
});
