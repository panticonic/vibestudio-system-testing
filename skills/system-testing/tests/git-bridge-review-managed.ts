import type { TestCase } from "../types.js";
import type { ManagedGitBridgeReviewReceiver } from "../git-bridge-review-managed.js";
import { managedGitBridgeReviewWorlds } from "../git-bridge-review-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedGitBridgeReviewReceiver["runManagedGitBridgeReviewTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedGitBridgeReviewReceiver["qualifyManagedGitBridgeReview"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["extensions/git-bridge"],
};

export const managedGitBridgeReviewTests: TestCase[] =
  managedGitBridgeReviewWorlds.map((world) => ({
    ...settings,
    name: `git-bridge-review-live-${world.id}`,
    description: "Review the assigned live Git Bridge upstream",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedGitBridgeReview(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang Git Bridge review");
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
          managedGitBridgeReview: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedGitBridgeReview"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedGitBridgeReviewTests.push({
  ...settings,
  name: "git-bridge-review-oracle-qualification",
  description:
    "Qualify the assigned Git Bridge upstream and protected source without model calls",
  prompt: "Check the assigned upstream status and protected repository basis.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedGitBridgeReviewWorlds) {
      const run = await runner.runManagedGitBridgeReview(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Git Bridge qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { gitBridgeReviewQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["gitBridgeReviewQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedGitBridgeReviewWorlds.length &&
        checks.every(
          ({ verification, rejectsOtherRepository }) =>
            verification.passed && rejectsOtherRepository,
        ),
      details: { checks },
    };
  },
});
