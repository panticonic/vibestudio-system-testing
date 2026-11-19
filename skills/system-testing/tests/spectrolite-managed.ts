import type { TestCase } from "../types.js";
import type { ManagedSpectroliteReceiver } from "../spectrolite-contract.js";
import {
  managedSpectroliteWorlds,
  spectrolitePanel,
} from "../spectrolite-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Teacher = Awaited<
  ReturnType<ManagedSpectroliteReceiver["runManagedSpectroliteTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedSpectroliteReceiver["qualifyManagedSpectrolite"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    spectrolitePanel,
    "skills/spectrolite-review",
    "skills/spectrolite-review-fixtures",
  ],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("observe-real-spectrolite"),
};

export const managedSpectroliteTests: TestCase[] = managedSpectroliteWorlds.map(
  (world) => ({
    ...settings,
    name: `spectrolite-live-${world.id}`,
    description:
      "Review an assigned canonical MDX document and its live Spectrolite editor",
    prompt: world.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedSpectrolite(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Spectrolite review");
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
          managedSpectrolite: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedSpectrolite"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the canonical files, installed editor and requested check order.",
            details: verification,
          };
    },
  }),
);

for (const draft of [false, true]) {
  const worlds = managedSpectroliteWorlds.filter(
    (world) => Boolean(world.draft) === draft,
  );
  managedSpectroliteTests.push({
    ...settings,
    name: draft
      ? "spectrolite-managed-draft-qualification"
      : "spectrolite-managed-oracle-qualification",
    description:
      "Qualify the actual Spectrolite editor and canonical document checks without a model",
    prompt:
      "Verify ordered document and preview checks and reject different-revision evidence.",
    async orchestrate(context) {
      const started = Date.now();
      const checks: Qualification[] = [];
      for (const world of worlds) {
        try {
          const run = await context.runner.runManagedSpectrolite(
            world.id,
            true,
            context.signal,
          );
          if (run.kind !== "reference")
            throw new Error("Spectrolite qualification invoked a teacher");
          checks.push(run.result);
        } catch (cause) {
          throw new Error(`Spectrolite qualification failed for ${world.id}`, {
            cause,
          });
        }
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { spectroliteQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["spectroliteQualification"] as
        | Qualification[]
        | undefined;
      return checks?.length === worlds.length &&
        checks.every(
          ({ verification, rejectedDifferentRevision }) =>
            verification.passed && rejectedDifferentRevision,
        )
        ? {
            passed: true,
            details: { checkedCases: checks.length, modelCalls: 0 },
          }
        : {
            passed: false,
            reason:
              "The installed editor readback or evidence binding differed from the task.",
            details: { checks },
          };
    },
  });
}
