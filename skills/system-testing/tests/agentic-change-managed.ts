import type { TestCase } from "../types.js";
import type { ManagedAgenticChangeReceiver } from "../agentic-change-managed.js";
import { managedAgenticChangeWorlds } from "../agentic-change-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedAgenticChangeReceiver["runManagedAgenticChangeTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedAgenticChangeReceiver["qualifyManagedAgenticChange"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: [
    "skills/agentic-development",
    "panels/chat",
    "workers/pubsub-channel",
  ],
};

export const managedAgenticChangeTests: TestCase[] =
  managedAgenticChangeWorlds.map((world) => ({
    ...settings,
    name: `agentic-change-live-${world.id}`,
    description:
      "Plan an agentic stack change against the installed semantic revision",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedAgenticChange(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang agentic change plan");
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
          managedAgenticChange: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedAgenticChange"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

function qualifyAgenticChange(name: string, worlds: readonly { id: string }[]): TestCase {
  return {
    ...settings,
    name,
    timeoutMs: worlds.length === 1 ? settings.timeoutMs : null,
    description:
      "Qualify agentic source observations and exact revision checks without model calls",
    prompt: "Read the owned revision and check the change plan.",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const checks: Qualification[] = [];
      for (const { id } of worlds) {
        const run = await runner.runManagedAgenticChange(id, true, signal);
        if (run.kind !== "reference")
          throw new Error("Agentic change qualification invoked a teacher");
        checks.push(run.result);
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { agenticChangeQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["agenticChangeQualification"] as
        | Qualification[]
        | undefined;
      return {
        passed:
          checks?.length === worlds.length &&
          checks.every(
            ({ verification, rejectedForeignContext, rejectedWrongRevision }) =>
              verification.passed &&
              rejectedForeignContext &&
              rejectedWrongRevision,
          ),
        details: { checks },
      };
    },
  };
}

managedAgenticChangeTests.push(
  qualifyAgenticChange("agentic-change-oracle-qualification", managedAgenticChangeWorlds),
  ...managedAgenticChangeWorlds.map((world) =>
    qualifyAgenticChange(`agentic-change-oracle-${world.id}`, [world])
  ),
);
