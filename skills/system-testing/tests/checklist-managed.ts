import type { TestAuthorityPolicy, TestCase } from "../types.js";
import type { ManagedChecklistReceiver } from "../checklist-contract.js";
import {
  checklistSource,
  managedChecklistWorlds,
} from "../checklist-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedChecklistReceiver["runManagedChecklistTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedChecklistReceiver["qualifyManagedChecklist"]>
>;

const authorityPolicy: TestAuthorityPolicy = {
  authority: [
    {
      ruleId: "launch-assigned-release-checklist",
      capability: { kind: "exact", key: "terminal-apps.run" },
      resource: { kind: "exact", key: `terminal-app:${checklistSource}` },
      tier: "gated",
      decision: "task",
    },
  ],
};
const requiresUnits = [checklistSource, "extensions/shell"];
export const managedChecklistTests: TestCase[] = managedChecklistWorlds.map(
  (world) => ({
    name: `terminal-checklist-live-${world.id}`,
    category: "terminal-apps",
    description:
      "Read, edit, and continue the release checklist in a live workspace terminal",
    prompt: world.request.goal,
    explicitOnly: true,
    requiresUnits,
    authorityPolicy,
    validation: "harness",
    async orchestrate(context) {
      const started = Date.now();
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedChecklist(world.id);
      if (observed.kind !== "teacher")
        throw new Error("Missing authored terminal checklist result");
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
          managedChecklist: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const review = result.diagnostics?.["managedChecklist"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return teacher?.trainingEligible && review?.verification.passed
        ? { passed: true, details: review.verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the live terminal screens and session lifecycle.",
            details: review?.verification,
          };
    },
  }),
);

managedChecklistTests.push({
  name: "terminal-checklist-managed-oracle-qualification",
  category: "terminal-apps",
  description:
    "Verify the live release checklist and terminal lifecycle without a model",
  prompt:
    "Qualify screen readback, resize, reattachment, durable restart, and session cleanup.",
  explicitOnly: true,
  requiresUnits,
  authorityPolicy,
  validation: "harness",
  async orchestrate(context) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedChecklistWorlds) {
      context.signal.throwIfAborted();
      const observed = await context.runner.runManagedChecklist(id, true);
      if (observed.kind !== "reference")
        throw new Error("Checklist qualification ran a teacher");
      checks.push(observed.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { managedChecklistQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["managedChecklistQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedChecklistWorlds.length &&
      checks.every(
        ({ accepted, rejectedDifferentPty }) =>
          accepted.passed && rejectedDifferentPty,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "The terminal readback or lifecycle did not match the assigned checklist task.",
          details: { checks },
        };
  },
});
