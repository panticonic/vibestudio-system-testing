import type { TestCase } from "../types.js";
import type { ManagedAuthoringReceiver } from "../authoring-contract.js";
import { managedAuthoringWorlds } from "../authoring-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedAuthoringReceiver["runManagedAuthoringTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedAuthoringReceiver["qualifyManagedAuthoring"]>
>;

export const managedAuthoringTests: TestCase[] = managedAuthoringWorlds.map(
  (world) => ({
    name: `authoring-live-${world.id}`,
    category: "project-lifecycle",
    description:
      "Review the exact compiled workspace programs and their public contract",
    prompt: world.request.goal,
    explicitOnly: true,
    validation: "harness",
    async orchestrate(context) {
      const started = Date.now();
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedAuthoring(world.id);
      if (observed.kind !== "teacher")
        throw new Error("Missing authored program review");
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
          managedAuthoring: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const review = result.diagnostics?.["managedAuthoring"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return teacher?.trainingEligible && review?.verification.passed
        ? { passed: true, details: review.verification.checks }
        : {
            passed: false,
            reason:
              "The review must match the independent compiler and source readbacks.",
            details: review?.verification,
          };
    },
  }),
);

managedAuthoringTests.push({
  name: "authoring-managed-oracle-qualification",
  category: "project-lifecycle",
  description: "Compile and verify the authored source cases without a model",
  prompt: "Qualify workspace Natlang compilation and exact source lineage.",
  explicitOnly: true,
  validation: "harness",
  async orchestrate(context) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedAuthoringWorlds) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedAuthoring(id, true);
      if (observed.kind !== "reference")
        throw new Error("Authoring qualification ran a teacher");
      checks.push(observed.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { authoringQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["authoringQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedAuthoringWorlds.length &&
      checks.every(
        ({ accepted, rejectedStaleRevision }) =>
          accepted.passed && rejectedStaleRevision,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "Compiler outcomes or verification did not match the authored cases.",
          details: { checks },
        };
  },
});
