import type { TestCase } from "../types.js";
import type { ManagedIncidentContinuationReceiver } from "../incident-continuation-contract.js";
import { incidentContinuationWorlds } from "../incident-continuation-worlds.js";

type Teacher = Awaited<
  ReturnType<
    ManagedIncidentContinuationReceiver["runManagedIncidentContinuationTeacher"]
  >
>;
type Qualification = Awaited<
  ReturnType<
    ManagedIncidentContinuationReceiver["qualifyManagedIncidentContinuation"]
  >
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    "skills/system-investigation",
    "skills/system-investigation-live",
    "skills/local-model-task",
    "skills/local-model-task-bindings",
    "extensions/local-models",
  ],
  authorityPolicy: {
    authority: [
      {
        ruleId: "read-assigned-workspace-host-log",
        capability: { kind: "exact" as const, key: "server-logs.read" },
        resource: { kind: "exact" as const, key: "server-logs.read" },
        tier: "gated" as const,
        decision: "once" as const,
      },
    ],
  },
};

export const managedIncidentContinuationTests: TestCase[] =
  incidentContinuationWorlds.map((world) => ({
    ...settings,
    name: `incident-continuation-live-${world.id}`,
    description: "Verify an incident and compare models for the follow-up task",
    prompt: world.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedIncidentContinuation(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored incident continuation");
      const { contextId, teacher, verification, log, models } = run.result;
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
          managedIncidentContinuation: { contextId, verification },
          managedLogAudit: log,
          managedLocalComparison: models,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedIncidentContinuation"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "Both skill reports and their live read dependency must hold.",
            details: verification,
          };
    },
  }));

managedIncidentContinuationTests.push({
  ...settings,
  name: "incident-continuation-oracle-qualification",
  description:
    "Qualify the host-log-to-local-model read dependency without model execution",
  prompt:
    "Reject an early model read, then verify the assigned log and inventory receipts.",
  async orchestrate(context) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const world of incidentContinuationWorlds) {
      try {
        const run = await context.runner.runManagedIncidentContinuation(
          world.id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error(
            "Incident continuation qualification invoked a teacher",
          );
        checks.push(run.result);
      } catch (cause) {
        throw new Error(
          `Incident continuation qualification failed for ${world.id}`,
          {
            cause,
          },
        );
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { incidentContinuationQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["incidentContinuationQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === incidentContinuationWorlds.length &&
      checks.every(
        ({ verification, rejectedPrematureRead }) =>
          verification.passed && rejectedPrematureRead,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "The host log, local model inventory, or their read dependency differed from the task.",
          details: { checks },
        };
  },
});
