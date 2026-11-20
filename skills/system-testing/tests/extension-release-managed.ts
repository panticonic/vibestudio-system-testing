import type { TestCase } from "../types.js";
import type { ManagedExtensionReleaseReceiver } from "../extension-release-managed.js";
import { managedExtensionReleaseWorlds } from "../extension-release-worlds.js";
import { managedUnitDesignWorlds } from "../unit-design-worlds.js";
import type { ManagedUnitDesignReceiver } from "../unit-design-managed.js";

type Teacher = Awaited<
  ReturnType<
    ManagedExtensionReleaseReceiver["runManagedExtensionReleaseTeacher"]
  >
>;
type Qualification = Awaited<
  ReturnType<ManagedExtensionReleaseReceiver["qualifyManagedExtensionRelease"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/extensiondev"],
};

type DesignTeacher = Awaited<ReturnType<ManagedUnitDesignReceiver["runManagedUnitDesignTeacher"]>>;
export const managedUnitDesignTests: TestCase[] = managedUnitDesignWorlds.flatMap(
  (world) => [false, true].map((qualification): TestCase => ({
    ...settings,
    name: `unit-design-${qualification ? "oracle" : "live"}-${world.id}`,
    description: "Review validation and publication of the assigned live extension manifest",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedUnitDesign(world.id, qualification, signal);
      const duration = Date.now() - started;
      if (run.kind === "reference") {
        if (!qualification) throw new Error("Expected a captured unit design review");
        return { messages: [], duration, diagnostics: { unitDesign: run.result } };
      }
      if (qualification) throw new Error("Qualification invoked a teacher");
      const { teacher, verification, contextId } = run.result;
      return {
        messages: [], duration,
        provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
        diagnostics: { natlangTeacher: teacher, unitDesign: verification },
      };
    },
    validate(result) {
      const verification = result.diagnostics?.["unitDesign"] as DesignTeacher["verification"] | undefined;
      const teacher = result.diagnostics?.["natlangTeacher"] as DesignTeacher["teacher"] | undefined;
      return {
        passed: verification?.passed === true && (qualification || teacher?.trainingEligible === true),
        details: verification?.checks,
      };
    },
  })),
);

export const managedExtensionReleaseTests: TestCase[] =
  managedExtensionReleaseWorlds.map((world) => ({
    ...settings,
    name: `extension-release-live-${world.id}`,
    description:
      "Inspect the installed extension against its exact publish and runtime state",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedExtensionRelease(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang extension release review");
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
          managedExtensionRelease: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedExtensionRelease"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedExtensionReleaseTests.push({
  ...settings,
  name: "extension-release-oracle-qualification",
  description:
    "Qualify live source and extension readbacks without model calls",
  prompt: "Join the assigned extension source and approved runtime.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedExtensionReleaseWorlds) {
      const run = await runner.runManagedExtensionRelease(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Extension release qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { extensionReleaseQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["extensionReleaseQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedExtensionReleaseWorlds.length &&
        checks.every(
          ({ verification, rejectedForeignScope, rejectedWrongDecision }) =>
            verification.passed &&
            rejectedForeignScope &&
            rejectedWrongDecision,
        ),
      details: { checks },
    };
  },
});
