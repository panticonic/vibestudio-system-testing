import type { TestCase } from "../types.js";
import type { ManagedGadReviewReceiver } from "../gad-review-managed.js";
import { managedGadReviewWorlds } from "../gad-review-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedGadReviewReceiver["runManagedGadReviewTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedGadReviewReceiver["qualifyManagedGadReview"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/gad-context", "workers/pubsub-channel"],
};

export const managedGadReviewTests: TestCase[] = managedGadReviewWorlds.map(
  (world) => ({
    ...settings,
    name: `gad-review-live-${world.id}`,
    description:
      world.view === "triage"
        ? "Confirm an absent roster independently of durable integrity"
        : "Review the exact latest user question in the durable conversation",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedGadReview(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang channel review");
      const { contextId, teacher, verification } = run.result;
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId,
          channelId: verification.channelId,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
        },
        diagnostics: {
          natlangTeacher: teacher,
          managedGadReview: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedGadReview"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedGadReviewTests.push({
  ...settings,
  name: "gad-review-oracle-qualification",
  description:
    "Qualify the GAD readbacks and reject foreign evidence without model calls",
  prompt:
    "Verify the owned channel's roster and the exact latest published question.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedGadReviewWorlds) {
      const run = await runner.runManagedGadReview(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("GAD qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { gadReviewQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["gadReviewQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedGadReviewWorlds.length &&
        checks.every(
          ({ verification, rejectedForeignReceipt }) =>
            verification.passed && rejectedForeignReceipt,
        ),
      details: { checks },
    };
  },
});
