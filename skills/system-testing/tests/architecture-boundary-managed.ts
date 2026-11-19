import type { TestCase } from "../types.js";
import type { ManagedArchitectureBoundaryReceiver } from "../architecture-boundary-managed.js";
import { managedArchitectureBoundaryWorlds } from "../architecture-boundary-worlds.js";

type Teacher = Awaited<
  ReturnType<
    ManagedArchitectureBoundaryReceiver["runManagedArchitectureBoundaryTeacher"]
  >
>;
type Qualification = Awaited<
  ReturnType<
    ManagedArchitectureBoundaryReceiver["qualifyManagedArchitectureBoundary"]
  >
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/architecture"],
};

export const managedArchitectureBoundaryTests: TestCase[] =
  managedArchitectureBoundaryWorlds.map((world) => ({
    ...settings,
    name: `architecture-boundary-live-${world.id}`,
    description:
      "Assess state ownership from the installed provider and declaration",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedArchitectureBoundary(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang architecture boundary review");
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
          managedArchitectureBoundary: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.[
        "managedArchitectureBoundary"
      ] as Teacher["verification"] | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedArchitectureBoundaryTests.push({
  ...settings,
  name: "architecture-boundary-oracle-qualification",
  description:
    "Qualify real provider evidence and ownership checks without model calls",
  prompt: "Join installed provider resolution to the assigned semantic source.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedArchitectureBoundaryWorlds) {
      const run = await runner.runManagedArchitectureBoundary(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Architecture qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { architectureBoundaryQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["architectureBoundaryQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedArchitectureBoundaryWorlds.length &&
        checks.every(
          ({ verification, rejectedUnboundDeclaration, rejectedWrongOwner }) =>
            verification.passed &&
            rejectedUnboundDeclaration &&
            rejectedWrongOwner,
        ),
      details: { checks },
    };
  },
});
