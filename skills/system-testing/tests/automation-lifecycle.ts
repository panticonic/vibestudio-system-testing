import type { TestCase } from "../types.js";
import type { ManagedAutomationReceiver } from "../automation-lifecycle-contract.js";
import { managedAutomationWorlds } from "../automation-lifecycle-worlds.js";

type Exercise = Awaited<
  ReturnType<ManagedAutomationReceiver["runManagedAutomationTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedAutomationReceiver["qualifyManagedAutomation"]>
>;
const fixtureEditAuthority: NonNullable<TestCase["authorityPolicy"]> = {
  authority: [
    {
      ruleId: "edit-owned-automation-fixture",
      capability: {
        kind: "prefix",
        prefix: "userland:workers/missions/missions.edit#",
      },
      resource: {
        kind: "exact",
        key: "mission:do:workers/missions:MissionsDO:workspace-missions",
      },
      tier: "gated",
      decision: "once",
    },
  ],
};
export const managedAutomationTests: TestCase[] = managedAutomationWorlds.map(
  (world) => ({
    name: `automation-lifecycle-live-${world.id}`,
    category: "project-lifecycle",
    description:
      "Apply or hold owner-scoped scheduling in the real Missions service",
    prompt: world.goal,
    explicitOnly: true,
    ...(world.problem === "revised-before-review" ||
    world.problem === "revision-race" ||
    world.problem === "revision-after-effect"
      ? { authorityPolicy: fixtureEditAuthority }
      : {}),
    validation: "harness",
    async orchestrate(context) {
      context.signal.throwIfAborted();
      const started = Date.now();
      const observed = await context.runner.runManagedAutomation(world.id);
      if (observed.kind !== "teacher")
        throw new Error("Missing authored automation workflow");
      context.signal.throwIfAborted();
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
          contextId: observed.result.contextId,
        },
        diagnostics: {
          natlangTeacher: observed.result.teacher,
          managedAutomation: {
            contextId: observed.result.contextId,
            verification: observed.result.verification,
          },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Exercise["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verified = (
        result.diagnostics?.["managedAutomation"] as
          | Omit<Exercise, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible === true &&
        verified?.passed &&
        verified.expectedStatus === world.status
        ? { passed: true, details: verified.checks }
        : {
            passed: false,
            reason:
              "The authored workflow and independent Missions readback must both pass",
            details: verified?.checks,
          };
    },
  }),
);
managedAutomationTests.push({
  name: "automation-lifecycle-managed-qualification",
  category: "project-lifecycle",
  description:
    "Verify real guarded pause and resume, stale revision refusal, and no run admission without a model",
  prompt:
    "Qualify reversible owner-scoped automation scheduling and the stale revision guard.",
  explicitOnly: true,
  authorityPolicy: fixtureEditAuthority,
  validation: "harness",
  async orchestrate(context) {
    const started = Date.now();
    const qualifications = [];
    for (const { id } of managedAutomationWorlds) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedAutomation(id, true);
      if (observed.kind !== "reference")
        throw new Error("Qualification called a teacher");
      qualifications.push(observed.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { managedAutomationQualification: qualifications },
    };
  },
  validate(result) {
    const observed = result.diagnostics?.["managedAutomationQualification"] as
      | Qualification[]
      | undefined;
    return observed?.length === managedAutomationWorlds.length &&
      managedAutomationWorlds.every((world, index) => {
        const row = observed[index];
        return (
          row?.verification.caseId === world.id &&
          row.verification.passed &&
          (world.problem !== "stale" || row.staleControllerGuard)
        );
      })
      ? {
          passed: true,
          details: {
            checkedCases: observed.length,
            modelCalls: 0,
          },
        }
      : {
          passed: false,
          reason: "Real mission controller qualification did not pass",
          details: { observed },
        };
  },
});
