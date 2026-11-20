import type { ManagedRegencyReceiver } from "../regency-review-contract.js";
import { managedRegencyWorlds } from "../regency-review-worlds.js";
import type { TestCase } from "../types.js";

type Teacher = Awaited<
  ReturnType<ManagedRegencyReceiver["runManagedRegencyTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedRegencyReceiver["qualifyManagedRegency"]>
>;
const settings = {
  category: "adventure",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 5 * 60_000,
  requiresUnits: [
    "workers/regency-realm",
    "skills/examples-review",
    "skills/examples-review-fixtures",
  ],
  authorityPolicy: {
    authority: [
      {
        ruleId: "read-owned-realm",
        capability: {
          kind: "exact" as const,
          key: "workspace-service:regency",
        },
        resource: {
          kind: "prefix" as const,
          prefix: "do:workers/regency-realm:RegencyGameDO:natlang-realm-",
        },
        tier: "gated" as const,
        decision: "task" as const,
      },
    ],
  },
};

export const managedRegencyReviewTests: TestCase[] = managedRegencyWorlds.map(
  (world) => ({
    ...settings,
    name: `regency-review-live-${world.id}`,
    description:
      "Review saved realm accounts and a read-only forecast using the live settlement worker",
    prompt: world.request.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedRegency(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Regency review");
      const { contextId, verification, teacher } = run.result;
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
          managedRegencyReview: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const review = result.diagnostics?.["managedRegencyReview"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return {
        passed: Boolean(
          teacher?.trainingEligible && review?.verification.passed,
        ),
        details: review?.verification.checks,
      };
    },
  }),
);

managedRegencyReviewTests.push({
  ...settings,
  name: "regency-review-oracle-qualification",
  description:
    "Verify the installed policy preview and untouched realm without a model",
  prompt:
    "Check the saved accounts and assigned projection without advancing the realm.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedRegencyWorlds) {
      const run = await runner.runManagedRegency(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Regency qualification invoked a teacher");
      checks.push({ caseId: id, ...run.result });
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { regencyReviewQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["regencyReviewQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedRegencyWorlds.length &&
        checks.every(
          ({ verification, wrongHorizonDenied, rejectedAlteredEvidence }) =>
            verification.passed &&
            wrongHorizonDenied &&
            rejectedAlteredEvidence,
        ),
      details: { checks },
    };
  },
});
