import type { TestCase } from "../types.js";
import type { ManagedProblemDraftReceiver } from "../problem-draft-managed.js";
import { managedProblemDraftWorlds } from "../problem-draft-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedProblemDraftReceiver["runManagedProblemDraftTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedProblemDraftReceiver["qualifyManagedProblemDraft"]>
>;
const settings = {
  category: "problem-reporting",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/problem-reporting"],
};

export const managedProblemDraftTests: TestCase[] =
  managedProblemDraftWorlds.map((world) => ({
    ...settings,
    name: `problem-draft-live-${world.id}`,
    description:
      "Save or preserve the assigned local report at its exact revision",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedProblemDraft(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang problem draft result");
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
          managedProblemDraft: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedProblemDraft"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedProblemDraftTests.push({
  ...settings,
  name: "problem-draft-oracle-qualification",
  description:
    "Qualify local problem draft writes and revision checks without model calls",
  prompt: "Verify the saved report and preserve the stale draft.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedProblemDraftWorlds) {
      const run = await runner.runManagedProblemDraft(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Problem draft qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { problemDraftQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["problemDraftQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedProblemDraftWorlds.length &&
        checks.every(
          ({ verification, rejectedForeignScope, rejectedWrongRevision }) =>
            verification.passed &&
            rejectedForeignScope &&
            rejectedWrongRevision,
        ),
      details: { checks },
    };
  },
});
