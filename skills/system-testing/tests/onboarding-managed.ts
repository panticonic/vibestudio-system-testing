import type { TestCase } from "../types.js";
import type { ManagedSetupReceiver } from "../onboarding-contract.js";
import { managedSetupWorlds } from "../onboarding-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedSetupReceiver["runManagedSetupTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedSetupReceiver["qualifyManagedSetup"]>
>;

export const managedSetupTests: TestCase[] = managedSetupWorlds.map(
  (world) => ({
    name: `onboarding-live-${world.id}`,
    category: "project-lifecycle",
    description:
      "Plan setup from live Personal owners and canonical catalog routes",
    prompt: world.goal,
    explicitOnly: true,
    validation: "harness",
    async orchestrate(context) {
      const started = Date.now();
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedSetup(world.id);
      if (observed.kind !== "teacher")
        throw new Error("Missing authored setup plan");
      context.signal.throwIfAborted();
      const { contextId, teacher, verification } = observed.result;
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
          contextId,
        },
        diagnostics: {
          natlangTeacher: teacher,
          managedSetup: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const review = result.diagnostics?.["managedSetup"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return teacher?.trainingEligible && review?.verification.passed
        ? { passed: true, details: review.verification.checks }
        : {
            passed: false,
            reason:
              "The plan must match the actual owner receipt and catalog route.",
            details: review?.verification,
          };
    },
  }),
);

managedSetupTests.push({
  name: "onboarding-managed-oracle-qualification",
  category: "project-lifecycle",
  description:
    "Verify live Personal onboarding state and catalog routes without a model",
  prompt:
    "Qualify current setup owner receipts and canonical selection routes in Personal.",
  explicitOnly: true,
  validation: "harness",
  async orchestrate(context) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedSetupWorlds) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedSetup(id, true);
      if (observed.kind !== "reference")
        throw new Error("Setup qualification ran a teacher");
      checks.push(observed.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { managedSetupQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["managedSetupQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedSetupWorlds.length &&
      checks.every(
        ({ accepted, rejectedStaleReceipt }) =>
          accepted.passed && rejectedStaleReceipt,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "The installed owner rows or catalog route did not match the assigned setup.",
          details: { checks },
        };
  },
});
