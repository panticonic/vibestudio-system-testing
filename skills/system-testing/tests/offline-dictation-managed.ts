import type { TestCase } from "../types.js";
import type { ManagedDictationReceiver } from "../offline-dictation-managed.js";
import { managedDictationWorlds } from "../offline-dictation-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedDictationReceiver["runManagedDictationTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedDictationReceiver["qualifyManagedDictation"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["extensions/speech"],
};

export const managedDictationTests: TestCase[] = managedDictationWorlds.map(
  (world) => ({
    ...settings,
    name: `offline-dictation-live-${world.id}`,
    description: "Review the assigned offline dictation capture",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedDictation(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang offline dictation review");
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
          managedDictation: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedDictation"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedDictationTests.push({
  ...settings,
  name: "offline-dictation-oracle-qualification",
  description:
    "Qualify installed speech readiness and audio admission without model calls",
  prompt:
    "Check the assigned offline recording and actual speech extension status.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedDictationWorlds) {
      const run = await runner.runManagedDictation(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Dictation qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { dictationQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["dictationQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedDictationWorlds.length &&
        checks.every(
          ({ verification, rejectsUnassignedTranscription }) =>
            verification.passed && rejectsUnassignedTranscription,
        ),
      details: { checks },
    };
  },
});
