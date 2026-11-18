import type { TestCase } from "../types.js";
import type { VerifiedMemoryReceiver } from "../verified-memory-contract.js";
import { managedMemoryWorlds } from "../verified-memory-worlds.js";

type Teacher = Awaited<
  ReturnType<VerifiedMemoryReceiver["runManagedMemoryTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<VerifiedMemoryReceiver["qualifyManagedMemory"]>
>;

export const managedMemoryTests: TestCase[] = managedMemoryWorlds.map(
  (world) => ({
    name: `verified-memory-live-${world.id}`,
    category: "project-lifecycle",
    description:
      "Verify a recalled decision against its exact committed source in Personal",
    prompt: world.goal,
    explicitOnly: true,
    validation: "harness",
    async orchestrate(context) {
      const started = Date.now();
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedMemory(world.id);
      if (observed.kind !== "teacher")
        throw new Error("Missing authored memory review");
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
          managedMemory: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const review = result.diagnostics?.["managedMemory"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return teacher?.trainingEligible && review?.verification.passed
        ? { passed: true, details: review.verification.checks }
        : {
            passed: false,
            reason:
              "The answer must match the actual recall lead and immutable file read.",
            details: review?.verification,
          };
    },
  }),
);

managedMemoryTests.push({
  name: "verified-memory-managed-oracle-qualification",
  category: "project-lifecycle",
  description:
    "Verify Personal workspace memory and historical readbacks without a model",
  prompt:
    "Qualify actual workspace memory and exact committed decision sources in Personal.",
  explicitOnly: true,
  validation: "harness",
  async orchestrate(context) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedMemoryWorlds) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedMemory(id, true);
      if (observed.kind !== "reference")
        throw new Error("Memory qualification ran a teacher");
      checks.push(observed.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { managedMemoryQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["managedMemoryQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedMemoryWorlds.length &&
      checks.every(
        ({ accepted, rejectedUnboundEvidence }) =>
          accepted.passed && rejectedUnboundEvidence,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "Recall or historical readback did not match the assigned revision.",
          details: { checks },
        };
  },
});
