import type { ManagedDriveSharingReceiver } from "../drive-sharing-contract.js";
import { managedDriveSharingWorlds } from "../drive-sharing-worlds.js";
import type { TestCase } from "../types.js";

type Teacher = Awaited<
  ReturnType<ManagedDriveSharingReceiver["runManagedDriveSharingTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedDriveSharingReceiver["qualifyManagedDriveSharing"]>
>;
const settings = {
  category: "oauth",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 5 * 60_000,
  requiresUnits: ["skills/google-drive", "packages/google-workspace"],
};

export const managedDriveSharingTests: TestCase[] =
  managedDriveSharingWorlds.map((world) => ({
    ...settings,
    name: `drive-sharing-live-${world.id}`,
    description:
      "Confirm the assigned file through the live Drive client before auditing its direct sharing",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedDriveSharing(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Drive sharing review");
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
          managedDriveSharing: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const fixture = result.diagnostics?.["managedDriveSharing"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return {
        passed: Boolean(
          teacher?.trainingEligible && fixture?.verification.passed,
        ),
        details: fixture?.verification.checks,
      };
    },
  }));

managedDriveSharingTests.push({
  ...settings,
  name: "drive-sharing-oracle-qualification",
  description:
    "Qualify the assigned inventory and permission audit without a model",
  prompt: "Check the live client reads and the complete inventory requirement.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedDriveSharingWorlds) {
      const run = await runner.runManagedDriveSharing(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Drive sharing qualification invoked a teacher");
      checks.push({ caseId: id, ...run.result });
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { driveSharingQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["driveSharingQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedDriveSharingWorlds.length &&
        checks.every(
          ({ verification, earlyRejected }) =>
            verification.passed && earlyRejected,
        ),
      details: { checks },
    };
  },
});
