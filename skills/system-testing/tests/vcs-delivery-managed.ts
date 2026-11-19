import type { TestCase } from "../types.js";
import type { ManagedVcsDeliveryReceiver } from "../vcs-delivery-managed.js";
import { managedVcsDeliveryWorlds } from "../vcs-delivery-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedVcsDeliveryReceiver["runManagedVcsDeliveryTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedVcsDeliveryReceiver["qualifyManagedVcsDelivery"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/vibestudio-vcs"],
};

export const managedVcsDeliveryTests: TestCase[] = managedVcsDeliveryWorlds.map(
  (world) => ({
    ...settings,
    name: `vcs-delivery-live-${world.id}`,
    description: "Review delivery of an assigned semantic VCS file",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedVcsDelivery(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang VCS delivery review");
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
          managedVcsDelivery: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedVcsDelivery"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedVcsDeliveryTests.push({
  ...settings,
  name: "vcs-delivery-oracle-qualification",
  description:
    "Qualify assigned semantic VCS revision reads without model calls",
  prompt:
    "Check the assigned file across the working, committed, and protected-main revisions.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedVcsDeliveryWorlds) {
      const run = await runner.runManagedVcsDelivery(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("VCS delivery qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { vcsDeliveryQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["vcsDeliveryQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedVcsDeliveryWorlds.length &&
        checks.every(
          ({ verification, rejectsOtherAssignment }) =>
            verification.passed && rejectsOtherAssignment,
        ),
      details: { checks },
    };
  },
});
