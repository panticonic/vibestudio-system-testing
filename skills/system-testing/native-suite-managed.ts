import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { rpc } from "@workspace/runtime";
import { bindSuiteReview } from "@workspace-skills/native-suite-review-bindings";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedNativeSuiteWorlds } from "./native-suite-worlds.js";

type Services = ReturnType<typeof bindSuiteReview>["services"];
type Plan = Awaited<ReturnType<Services["testSuitePlanRead"]["resolve"]>>;
type Execution = Awaited<
  ReturnType<Services["testSuiteVerificationRun"]["run"]>
>;
type Report = {
  plan: Plan;
  decision: {
    route: { runtime: string; nativeApproval: boolean; explanation: string };
    next: string;
  };
  execution: Execution | null;
  result: { outcome: string; followUp: string } | null;
};

export function prepareManagedNativeSuite(contextId: string, caseId: string) {
  const scenario = requireAssignedWorld(
    managedNativeSuiteWorlds,
    caseId,
    "Unknown assigned suite verification",
  );
  const { goal, target, suite, file, testName, mode, runtime } = scenario;
  const bound = bindSuiteReview({
    goal,
    target,
    suite,
    file,
    mode,
    testName,
  });
  let observed: Plan | undefined;
  let executed: Execution | null = null;
  const services: Services = {
    testSuitePlanRead: {
      async resolve(id) {
        if (observed)
          throw new Error("The assigned suite plan was already observed");
        const plan = await bound.services.testSuitePlanRead.resolve(id);
        observed = structuredClone(plan);
        return plan;
      },
    },
    testSuiteVerificationRun: {
      async run(id, hash) {
        const execution = await bound.services.testSuiteVerificationRun.run(
          id,
          hash,
        );
        executed = structuredClone(execution);
        return execution;
      },
    },
  };

  async function verify(report: Report | null) {
    const current = await rpc.call(
      "main",
      mainRpcMethods["build.resolveTestSuite"],
      [target, `ctx:${contextId}`, suite],
    );
    const checks = {
      plan:
        observed?.contextId === contextId &&
        current.runtime === runtime &&
        observed.runtime === runtime &&
        current.target === target &&
        observed.target === target &&
        current.suite === suite &&
        observed.suite === suite &&
        observed.stateHash === current.stateHash &&
        isDeepStrictEqual(report?.plan, observed),
      route:
        report?.decision.route.runtime === runtime &&
        report.decision.route.nativeApproval === (runtime === "native") &&
        !!report.decision.route.explanation.trim() &&
        report.decision.next ===
          (mode === "verify" ? "run-assignment" : "report-plan"),
      execution:
        isDeepStrictEqual(report?.execution, executed) &&
        (scenario.mode === "inspect"
          ? executed === null && report?.result === null
          : executed?.current === true &&
            executed.status === scenario.expectedStatus &&
            executed.receipt?.operation === "test" &&
            executed.receipt.target === target &&
            executed.receipt.suite === suite &&
            executed.receipt.runtime === runtime &&
            executed.receipt.contextId === contextId &&
            executed.receipt.ref === `ctx:${contextId}` &&
            executed.receipt.stateHash === observed?.stateHash &&
            executed.failed === 0 &&
            (scenario.expectedStatus === "no-tests"
              ? executed.passed === 0
              : (executed.passed ?? 0) > 0) &&
            !!executed.artifactKey &&
            /^[a-f0-9]{64}$/u.test(executed.executionDigest ?? "") &&
            /^[a-f0-9]{64}$/u.test(executed.reportDigest ?? "") &&
            (runtime === "native") ===
              executed.artifactKey.startsWith("native:") &&
            report?.result?.outcome === scenario.expectedOutcome &&
            !!report?.result?.followUp.trim()),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      observed,
      executed,
      checks,
    };
  }

  async function qualify() {
    const plan = await services.testSuitePlanRead.resolve(
      bound.request.operationId,
    );
    let rejectsWrongAssignment = false;
    try {
      await services.testSuiteVerificationRun.run(
        bound.request.operationId,
        "wrong-state",
      );
    } catch (error) {
      rejectsWrongAssignment =
        error instanceof Error &&
        error.message.includes("caller-assigned test plan");
    }
    const execution =
      mode === "verify"
        ? await services.testSuiteVerificationRun.run(
            bound.request.operationId,
            plan.stateHash,
          )
        : null;
    return {
      verification: await verify({
        plan,
        decision: {
          route: {
            runtime,
            nativeApproval: runtime === "native",
            explanation: "Use the installed declaration.",
          },
          next: mode === "verify" ? "run-assignment" : "report-plan",
        },
        execution,
        result: scenario.mode === "verify"
          ? { outcome: scenario.expectedOutcome, followUp: "Inspect the typed run result." }
          : null,
      }),
      rejectsWrongAssignment,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedNativeSuite>;
type Input = { contextId: string; caseId: string };
export interface ManagedNativeSuiteReceiver {
  runManagedNativeSuiteTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedNativeSuite(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedNativeSuiteMethods =
  createReceiverRpcMethods<ManagedNativeSuiteReceiver>([
    "runManagedNativeSuiteTeacher",
    "qualifyManagedNativeSuite",
  ]);
