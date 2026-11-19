import type { TestCase } from "../types.js";
import type { ManagedReleaseReviewHandoffReceiver } from "../release-review-handoff-contract.js";
import { managedReleaseReviewHandoffWorlds } from "../release-review-handoff-worlds.js";

type Teacher = Awaited<
  ReturnType<
    ManagedReleaseReviewHandoffReceiver["runManagedReleaseReviewHandoffTeacher"]
  >
>;
type Qualification = Awaited<
  ReturnType<
    ManagedReleaseReviewHandoffReceiver["qualifyManagedReleaseReviewHandoff"]
  >
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: [
    "skills/extensiondev",
    "skills/capabilities",
    "skills/scratch-handoff",
  ],
};

export const managedReleaseReviewHandoffTests: TestCase[] =
  managedReleaseReviewHandoffWorlds.map((world) => ({
    ...settings,
    name: `release-review-handoff-live-${world.id}`,
    description:
      "Join release and authority evidence into an exact staged handoff",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedReleaseReviewHandoff(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected a composed release handoff");
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
          managedReleaseReviewHandoff: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.[
        "managedReleaseReviewHandoff"
      ] as Teacher["verification"] | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedReleaseReviewHandoffTests.push({
  ...settings,
  name: "release-review-handoff-oracle-qualification",
  description:
    "Qualify staged release handoffs and dependency gates without model calls",
  prompt:
    "Join the assigned extension and authority observations into a local artifact.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedReleaseReviewHandoffWorlds) {
      const run = await runner.runManagedReleaseReviewHandoff(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Release handoff qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { releaseReviewHandoffQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["releaseReviewHandoffQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedReleaseReviewHandoffWorlds.length &&
        checks.every(
          ({
            verification,
            earlyReadDenied,
            earlyWriteDenied,
            earlyAuthorityDenied,
          }) =>
            verification.passed &&
            earlyReadDenied &&
            earlyWriteDenied &&
            earlyAuthorityDenied,
        ),
      details: { checks },
    };
  },
});
