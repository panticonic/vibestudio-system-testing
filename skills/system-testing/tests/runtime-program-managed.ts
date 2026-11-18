import type { TestCase } from "../types.js";
import type { ManagedRuntimeProgramReceiver } from "../runtime-program-contract.js";
import { managedRuntimeProgramWorlds } from "../runtime-program-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedRuntimeProgramReceiver["runManagedRuntimeProgramTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedRuntimeProgramReceiver["qualifyManagedRuntimeProgram"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/runtime-evidence-review"],
};

export const managedRuntimeProgramTests: TestCase[] =
  managedRuntimeProgramWorlds.map((world) => ({
    ...settings,
    name: `runtime-program-live-${world.id}`,
    description:
      "Review an actual typed program compilation or execution receipt",
    prompt: world.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedRuntimeProgram(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored runtime program review");
      const { contextId, teacher, verification } = run.result;
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId,
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
        },
        diagnostics: {
          natlangTeacher: teacher,
          managedRuntimeProgram: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedRuntimeProgram"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "The next step must match the actual compiler outcome or owned execution receipt.",
            details: verification,
          };
    },
  }));

managedRuntimeProgramTests.push({
  ...settings,
  name: "runtime-program-oracle-qualification",
  description: "Qualify compiler and execution evidence without model calls",
  prompt:
    "Compile assigned source and verify the exact execution receipts for the cases that run.",
  async orchestrate(context) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const world of managedRuntimeProgramWorlds) {
      try {
        const run = await context.runner.runManagedRuntimeProgram(
          world.id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Runtime program qualification invoked a teacher");
        checks.push(run.result);
      } catch (cause) {
        throw new Error(
          `Runtime program qualification failed for ${world.id}`,
          {
            cause,
          },
        );
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { runtimeProgramQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["runtimeProgramQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedRuntimeProgramWorlds.length &&
      checks.every(
        ({ verification, rejectedWrongReceipt }) =>
          verification.passed && rejectedWrongReceipt,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "The compiler or execution evidence differed from the assigned task.",
          details: { checks },
        };
  },
});
