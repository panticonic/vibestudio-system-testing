import {
  PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
  type TestCase,
} from "../types.js";
import type { ManagedProvenanceHistoryReceiver } from "../provenance-history-contract.js";
import type { qualifyManagedProvenanceHistory } from "../provenance-history-managed.js";
import { managedProvenanceHistoryWorlds } from "../provenance-history-worlds.js";

type Teacher = Awaited<
  ReturnType<
    ManagedProvenanceHistoryReceiver["runManagedProvenanceHistoryTeacher"]
  >
>;
type Qualification = Awaited<ReturnType<typeof qualifyManagedProvenanceHistory>>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/provenance-orientation"],
  workspaceRepoFixture: PROVENANCE_RECORD_WORKSPACE_REPO_FIXTURE,
};

export const managedProvenanceHistoryTests: TestCase[] =
  managedProvenanceHistoryWorlds.map((world) => ({
    ...settings,
    name: `provenance-history-live-${world.id}`,
    description: "Review actual recorded cause, cohort, and reversals",
    prompt: world.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedProvenanceHistory(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored provenance history review");
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
          managedProvenanceHistory: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedProvenanceHistory"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the exact file, walk scope, and source receipts.",
            details: verification,
          };
    },
  }));

managedProvenanceHistoryTests.push({
  ...settings,
  name: "provenance-history-oracle-qualification",
  description: "Qualify native VCS provenance walks without model calls",
  prompt: "Read assigned provenance walks and reject unrelated coordinates.",
  async orchestrate(context) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const world of managedProvenanceHistoryWorlds) {
      try {
        const run = await context.runner.runManagedProvenanceHistory(
          world.id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Provenance history qualification invoked a teacher");
        checks.push(run.result);
      } catch (cause) {
        throw new Error(
          `Provenance history qualification failed for ${world.id}`,
          {
            cause,
          },
        );
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { provenanceHistoryQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["provenanceHistoryQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedProvenanceHistoryWorlds.length &&
      checks.every(
        ({ verification, rejectedWrongCoordinate }) =>
          verification.passed && rejectedWrongCoordinate,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason: "The observed VCS history differed from the task.",
          details: { checks },
        };
  },
});
