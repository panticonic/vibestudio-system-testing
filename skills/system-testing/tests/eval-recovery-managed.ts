import type { TestCase } from "../types.js";
import type { ManagedEvalRecoveryReceiver } from "../eval-recovery-managed.js";
import { managedEvalRecoveryWorlds } from "../eval-recovery-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedEvalRecoveryReceiver["runManagedEvalRecoveryTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedEvalRecoveryReceiver["qualifyManagedEvalRecovery"]>
>;
const qualified = (proof: Qualification) =>
  proof.verification.passed && proof.rejectsAnotherDigest && proof.rejectsUnprovenReadback;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
};

export const managedEvalRecoveryTests: TestCase[] =
  managedEvalRecoveryWorlds.map((world) => ({
    ...settings,
    name: `eval-recovery-live-${world.id}`,
    description: "Recover an assigned side effect after eval",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedEvalRecovery(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang eval recovery review");
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
          managedEvalRecovery: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedEvalRecovery"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedEvalRecoveryTests.push({
  ...settings,
  name: "eval-recovery-oracle-qualification",
  description:
    "Qualify original eval journals and independent readback without model calls",
  prompt: "Check the assigned eval operation journal and independent effect.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedEvalRecoveryWorlds) {
      const run = await runner.runManagedEvalRecovery(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Eval recovery qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { evalRecoveryQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["evalRecoveryQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedEvalRecoveryWorlds.length &&
        checks.every(qualified),
      details: { checks },
    };
  },
});

managedEvalRecoveryTests.push(...managedEvalRecoveryWorlds
  .filter(({ journalCase }) => journalCase)
  .map((world): TestCase => ({
    ...settings,
    name: `eval-recovery-oracle-${world.id}`,
    description: "Check the actual eval journal and reject an unproven readback",
    prompt: world.goal,
    async orchestrate({runner, signal}) {
      const started = Date.now();
      const run = await runner.runManagedEvalRecovery(world.id, true, signal);
      if (run.kind !== "reference") throw new Error("Expected model-free eval recovery");
      return { messages: [], duration: Date.now() - started, diagnostics: { evalRecoveryCase: run.result } };
    },
    validate(result) {
      const proof = result.diagnostics?.["evalRecoveryCase"] as Qualification | undefined;
      return { passed: Boolean(proof && qualified(proof)), details: proof?.verification.checks };
    },
  }))
);
