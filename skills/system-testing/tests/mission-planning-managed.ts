import type { TestCase } from "../types.js";
import type { ManagedMissionPlanningReceiver } from "../mission-planning-contract.js";
import { managedMissionPlanningWorlds } from "../mission-planning-worlds.js";

type Exercise = Awaited<
  ReturnType<ManagedMissionPlanningReceiver["runManagedMissionPlanningTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedMissionPlanningReceiver["qualifyManagedMissionPlanning"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    "workers/mission-planning-fixture",
    "skills/mission-planning-runtime",
  ],
  authorityPolicy: {
    authority: [
      {
        ruleId: "use-assigned-mission-planning-store",
        capability: {
          kind: "exact" as const,
          key: "workspace-service:mission-planning-fixture",
        },
        resource: {
          kind: "prefix" as const,
          prefix:
            "do:workers/mission-planning-fixture:MissionPlanningFixtureStore:natlang-mission-planning-",
        },
        tier: "gated" as const,
        decision: "once" as const,
      },
    ],
  },
};

export const managedMissionPlanningTests: TestCase[] =
  managedMissionPlanningWorlds.map(({ id, request }) => ({
    ...settings,
    name: `mission-planning-live-${id}`,
    description:
      "Reconcile dependencies, readiness, and project assignment of Mission Control cards",
    prompt: request.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedMissionPlanning(
        id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error(
          "Expected an authored Mission Control planning workflow",
        );
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
          managedMissionPlanning: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Exercise["teacher"]
        | undefined;
      const exercise = result.diagnostics?.["managedMissionPlanning"] as
        | Omit<Exercise, "teacher">
        | undefined;
      return teacher?.trainingEligible === true &&
        exercise?.verification.passed === true
        ? { passed: true, details: exercise.verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the actual revision-bound Mission Control effects.",
            details: exercise?.verification,
          };
    },
  }));

managedMissionPlanningTests.push({
  ...settings,
  name: "mission-planning-managed-oracle-qualification",
  timeoutMs: 15 * 60_000,
  description:
    "Qualify actual Mission Control planning effects without a model",
  prompt:
    "Check real card updates, stale revision rejection, and exact planning receipts.",
  async orchestrate(context) {
    const started = Date.now();
    const rows: Qualification[] = [];
    for (const { id } of managedMissionPlanningWorlds) {
      try {
        const run = await context.runner.runManagedMissionPlanning(
          id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Qualification invoked a teacher");
        rows.push(run.result);
      } catch (cause) {
        throw new Error(
          `Mission Control planning qualification failed for ${id}`,
          {
            cause,
          },
        );
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { missionPlanningQualification: rows },
    };
  },
  validate(result) {
    const rows = result.diagnostics?.["missionPlanningQualification"] as
      | Qualification[]
      | undefined;
    return rows?.length === managedMissionPlanningWorlds.length &&
      rows.every(
        ({ verification, rejectsStale, rejectsWrongReceipt }) =>
          verification.passed && rejectsStale && rejectsWrongReceipt,
      )
      ? { passed: true, details: { checkedCases: rows.length, modelCalls: 0 } }
      : {
          passed: false,
          reason: "The planning effects or revision checks did not match.",
          details: { rows },
        };
  },
});
