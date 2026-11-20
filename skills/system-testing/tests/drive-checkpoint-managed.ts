import type { ManagedDriveCheckpointReceiver } from "../drive-checkpoint-contract.js";
import { managedDriveCheckpointWorlds } from "../drive-checkpoint-worlds.js";
import type { TestCase } from "../types.js";

type Teacher = Awaited<
  ReturnType<ManagedDriveCheckpointReceiver["runManagedDriveCheckpointTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedDriveCheckpointReceiver["qualifyManagedDriveCheckpoint"]>
>;
const settings = {
  category: "oauth",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 5 * 60_000,
  requiresUnits: ["skills/google-drive", "packages/google-workspace"],
};
const handoffSettings = {
  ...settings,
  requiresUnits: [
    ...settings.requiresUnits,
    "skills/scratch-handoff",
    "skills/scratch-handoff-bindings",
  ],
};

export const managedDriveCheckpointTests: TestCase[] =
  managedDriveCheckpointWorlds.map((world) => ({
    ...(world.handoff ? handoffSettings : settings),
    name: `drive-checkpoint-live-${world.id}`,
    description: world.handoff
      ? "Stage the retained Drive checkpoint and write disposition for the next shift"
      : "Continue a bounded Drive feed and verify the durable checkpoint in a real workspace",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedDriveCheckpoint(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Drive checkpoint review");
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
          managedDriveCheckpoint: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const review = result.diagnostics?.["managedDriveCheckpoint"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return {
        passed: Boolean(
          teacher?.trainingEligible && review?.verification.passed,
        ),
        details: review?.verification.checks,
      };
    },
  }));

function checkpointQualification(handoff: boolean): TestCase {
  const worlds = managedDriveCheckpointWorlds.filter(
    (world) => world.handoff === handoff,
  );
  return {
    ...(handoff ? handoffSettings : settings),
    name: handoff
      ? "drive-checkpoint-handoff-qualification"
      : "drive-checkpoint-oracle-qualification",
    description: handoff
      ? "Check the verified Drive checkpoint handoff in the live workspace"
      : "Check full, unavailable and concurrently changed feeds without a model",
    prompt: "Verify the observed Drive continuation and retained checkpoint.",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const checks = [];
      for (const { id } of worlds) {
        const run = await runner.runManagedDriveCheckpoint(id, true, signal);
        if (run.kind !== "reference")
          throw new Error("Drive qualification invoked a teacher");
        checks.push({ caseId: id, ...run.result });
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { driveCheckpointQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["driveCheckpointQualification"] as
        | Qualification[]
        | undefined;
      return {
        passed:
          checks?.length === worlds.length &&
          checks.every(
            ({ verification, earlyRejected }) =>
              verification.passed && earlyRejected,
          ),
        details: { checks },
      };
    },
  };
}

managedDriveCheckpointTests.push(
  checkpointQualification(false),
  checkpointQualification(true),
);
