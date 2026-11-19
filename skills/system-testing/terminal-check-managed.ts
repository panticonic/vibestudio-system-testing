import { isDeepStrictEqual } from "node:util";
import { bindTerminalChecks } from "@workspace-skills/terminal/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { terminalCheckWorld } from "./terminal-check-worlds.js";

type Services = ReturnType<typeof bindTerminalChecks>["services"];
type Plan = Awaited<ReturnType<Services["terminalCheckRead"]["observe"]>>;
type Outcome = Awaited<ReturnType<Services["terminalCheckRun"]["execute"]>>;
type Report = {
  assignmentReceipt: string;
  outcomes: { result: Outcome; status: string }[];
  held: string[];
};
const limits = { timeoutMs: 5000, maxOutputBytes: 1024 };

export function prepareManagedTerminalChecks(
  contextId: string,
  caseId: string,
) {
  const world = terminalCheckWorld(caseId);
  const { request, services: bound } = bindTerminalChecks({
    goal: world.goal,
    checks: world.checks.map(({ id, purpose, prerequisites, intent }) => ({
      id,
      purpose,
      prerequisites,
      intent,
      ...limits,
    })),
  });
  let observedPlan: Plan | null = null;
  const results: Outcome[] = [];
  const services: Services = {
    terminalCheckRead: {
      async observe(id) {
        const plan = await bound.terminalCheckRead.observe(id);
        observedPlan = structuredClone(plan);
        return plan;
      },
    },
    terminalCheckRun: {
      async execute(receipt, id) {
        const result = await bound.terminalCheckRun.execute(receipt, id);
        results.push(structuredClone(result));
        return result;
      },
    },
  };
  const expectedPlan = world.checks.map(
    ({ id, purpose, prerequisites, intent }) => ({
      id,
      purpose,
      prerequisites,
      mode: intent.kind,
    }),
  );
  const held = world.checks
    .filter((check) => !check.expected)
    .map(({ id }) => id);
  const expectedOrder = world.checks
    .filter((check) => check.expected)
    .map(({ id }) => id);

  function verify(report: Report | null) {
    const expectedIds = new Set(expectedOrder);
    const earlier = new Set<string>();
    const checks = {
      plan:
        observedPlan?.receipt === request.operationId + ":plan" &&
        isDeepStrictEqual(observedPlan.checks, expectedPlan),
      processes:
        results.length === expectedIds.size &&
        results.every((result) => {
          const check = world.checks.find(({ id }) => id === result.id);
          if (
            !check?.expected ||
            !expectedIds.delete(result.id) ||
            !check.prerequisites.every((id) => earlier.has(id))
          )
            return false;
          earlier.add(result.id);
          const expected = check.expected;
          return (
            result.receipt === request.operationId + ":check:" + result.id &&
            result.status === "complete" &&
            result.exitCode === expected.exitCode &&
            result.timedOut === false &&
            result.truncated === (expected.status === "output-truncated") &&
            result.stdout === expected.stdout &&
            result.stderr === ""
          );
        }),
      report:
        observedPlan !== null &&
        report?.assignmentReceipt === observedPlan.receipt &&
        isDeepStrictEqual(report.held, held) &&
        Array.isArray(report.outcomes) &&
        report.outcomes.length === results.length &&
        report.outcomes.every(
          ({ result, status }, i) =>
            isDeepStrictEqual(result, results[i]) &&
            world.checks.find(({ id }) => id === results[i]?.id)?.expected
              ?.status === status,
        ),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request,
      plan: observedPlan,
      results,
      checks,
    };
  }

  async function qualify() {
    const plan = await services.terminalCheckRead.observe(request.operationId);
    const outcomes: Report["outcomes"] = [];
    for (const check of world.checks) {
      if (check.expected) {
        outcomes.push({
          result: await services.terminalCheckRun.execute(
            plan.receipt,
            check.id,
          ),
          status: check.expected.status,
        });
      }
    }
    let rejectedHeld = false;
    try {
      await services.terminalCheckRun.execute(plan.receipt, held[0]!);
    } catch (error) {
      rejectedHeld =
        error instanceof Error && /completed prerequisites/.test(error.message);
    }
    return {
      verification: verify({ assignmentReceipt: plan.receipt, outcomes, held }),
      rejectedHeld,
    };
  }
  return { request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedTerminalChecks>;
type Input = { caseId: string; contextId: string };
export interface ManagedTerminalCheckReceiver {
  runManagedTerminalCheckTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedTerminalCheck(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedTerminalCheckMethods =
  createReceiverRpcMethods<ManagedTerminalCheckReceiver>([
    "runManagedTerminalCheckTeacher",
    "qualifyManagedTerminalCheck",
  ]);
