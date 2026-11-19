import type { TestCase } from "../types.js";
import type { ManagedTestkitCleanupReceiver } from "../testkit-cleanup-contract.js";
import {
  managedTestkitCleanupWorlds,
  multiPhaseTestkitCleanupWorlds,
} from "../testkit-cleanup-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Teacher = Awaited<
  ReturnType<ManagedTestkitCleanupReceiver["runManagedTestkitCleanupTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedTestkitCleanupReceiver["qualifyManagedTestkitCleanup"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    "skills/session-test-review",
    "workers/local-messaging-fixture",
    "panels/chat",
  ],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("inspect-owned-testkit-panel"),
};

export const managedTestkitCleanupTests: TestCase[] =
  managedTestkitCleanupWorlds.map((world) => ({
    ...settings,
    name: `testkit-cleanup-live-${world.id}`,
    description:
      "Review actual Testkit deferred cleanup and remaining workspace resources",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedTestkitCleanup(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang cleanup review");
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
          managedTestkitCleanup: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const fixture = result.diagnostics?.["managedTestkitCleanup"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return teacher?.trainingEligible && fixture?.verification.passed
        ? { passed: true, details: fixture.verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the Testkit result, release order and live inventory.",
            details: fixture?.verification,
          };
    },
  }));

function cleanupQualification(
  name: string,
  worlds: readonly { id: string }[],
): TestCase {
  return {
    ...settings,
    name,
    description:
      "Qualify actual Testkit outcomes and live cleanup inventory without a model",
    prompt:
      "Read back the test outcome, deferred cleanup and remaining resources.",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const checks: Qualification[] = [];
      for (const { id } of worlds) {
        try {
          const run = await runner.runManagedTestkitCleanup(id, true, signal);
          if (run.kind !== "reference")
            throw new Error("Testkit cleanup qualification ran a teacher");
          checks.push(run.result);
        } catch (cause) {
          throw new Error(`Failed to qualify Testkit cleanup case ${id}`, {
            cause,
          });
        }
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { cleanupQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["cleanupQualification"] as
        | Qualification[]
        | undefined;
      return checks?.length === worlds.length &&
        checks.every(
          ({ verified, rejectedForeignReceipt }) =>
            verified.passed && rejectedForeignReceipt,
        )
        ? { passed: true, details: { cases: checks.length, modelCalls: 0 } }
        : {
            passed: false,
            reason:
              "The Testkit run or cleanup inventory differed from the assignment.",
            details: { checks },
          };
    },
  };
}

managedTestkitCleanupTests.push(
  cleanupQualification(
    "testkit-cleanup-managed-qualification",
    managedTestkitCleanupWorlds,
  ),
  cleanupQualification(
    "testkit-cleanup-multi-phase-qualification",
    multiPhaseTestkitCleanupWorlds,
  ),
);
