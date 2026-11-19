import type { TestCase } from "../types.js";
import type { ManagedAuthorityReviewReceiver } from "../authority-review-managed.js";
import { managedAuthorityReviewWorlds } from "../authority-review-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedAuthorityReviewReceiver["runManagedAuthorityReviewTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedAuthorityReviewReceiver["qualifyManagedAuthorityReview"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/capabilities"],
};

export const managedAuthorityReviewTests: TestCase[] =
  managedAuthorityReviewWorlds.map((world) => ({
    ...settings,
    name: `authority-review-live-${world.id}`,
    description:
      "Compare live operation preflights with the assigned resource ceiling",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedAuthorityReview(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang authority preflight review");
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
          managedAuthorityReview: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedAuthorityReview"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedAuthorityReviewTests.push({
  ...settings,
  name: "authority-review-oracle-qualification",
  description:
    "Qualify live host preflights and exact scope checks without model calls",
  prompt: "Compare the host leaves with the assigned exact resource ceiling.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedAuthorityReviewWorlds) {
      const run = await runner.runManagedAuthorityReview(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Authority review qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { authorityReviewQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["authorityReviewQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedAuthorityReviewWorlds.length &&
        checks.every(
          ({ verification, rejectedForeignOperation, rejectedWrongCeiling }) =>
            verification.passed &&
            rejectedForeignOperation &&
            rejectedWrongCeiling,
        ),
      details: { checks },
    };
  },
});
