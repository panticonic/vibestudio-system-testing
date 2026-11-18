import type { TestCase } from "../types.js";
import type { ManagedLocalComparisonReceiver } from "../local-model-comparison-contract.js";
import {
  localModelComparisonWorlds,
  localModelSkill,
} from "../local-model-comparison-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedLocalComparisonReceiver["runManagedLocalComparisonTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedLocalComparisonReceiver["qualifyManagedLocalComparison"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    localModelSkill,
    "skills/local-model-task-bindings",
    "extensions/local-models",
  ],
};

export const managedLocalComparisonTests: TestCase[] =
  localModelComparisonWorlds.map((world) => ({
    ...settings,
    name: `local-model-compare-live-${world.id}`,
    description: "Compare assigned candidates using real local model inventory",
    prompt: world.request.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedLocalComparison(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored local model comparison");
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
          managedLocalComparison: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedLocalComparison"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "The comparison must match the actual inventory, exact candidate order, and requested handoff.",
            details: verification,
          };
    },
  }));

managedLocalComparisonTests.push({
  ...settings,
  name: "local-model-compare-oracle-qualification",
  description: "Qualify actual local model comparison without model execution",
  prompt:
    "Read the installed catalog and reject a report for an unassigned model.",
  async orchestrate(context) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const world of localModelComparisonWorlds) {
      try {
        const run = await context.runner.runManagedLocalComparison(
          world.id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error(
            "Local model comparison qualification invoked a teacher",
          );
        checks.push(run.result);
      } catch (cause) {
        throw new Error(
          `Local model comparison qualification failed for ${world.id}`,
          {
            cause,
          },
        );
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { localComparisonQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["localComparisonQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === localModelComparisonWorlds.length &&
      checks.every(
        ({ verification, rejectedDifferentModel }) =>
          verification.passed && rejectedDifferentModel,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "The local model catalog readback or candidate handoff differed from the task.",
          details: { checks },
        };
  },
});
