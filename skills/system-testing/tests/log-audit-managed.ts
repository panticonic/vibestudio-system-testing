import type { TestCase } from "../types.js";
import type { ManagedLogAuditReceiver } from "../log-audit-contract.js";
import {
  managedLogAuditWorlds,
  systemInvestigationSkill,
} from "../log-audit-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedLogAuditReceiver["runManagedLogAuditTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedLogAuditReceiver["qualifyManagedLogAudit"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [systemInvestigationSkill, "skills/system-investigation-live"],
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

export const managedLogAuditTests: TestCase[] = managedLogAuditWorlds.map(
  (world) => ({
    ...settings,
    name: `host-log-audit-live-${world.id}`,
    description: "Review diagnosed incidents from the actual host log",
    prompt: world.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedLogAudit(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored host log audit");
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
          managedLogAudit: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedLogAudit"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the assigned log windows and exact observed evidence.",
            details: verification,
          };
    },
  }),
);

managedLogAuditTests.push({
  ...settings,
  name: "host-log-audit-oracle-qualification",
  description: "Qualify actual server log windows without model execution",
  prompt:
    "Read the bounded host log and reject a report for another cursor or boot.",
  async orchestrate(context) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const world of managedLogAuditWorlds) {
      try {
        const run = await context.runner.runManagedLogAudit(
          world.id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Host log qualification invoked a teacher");
        checks.push(run.result);
      } catch (cause) {
        throw new Error(`Host log qualification failed for ${world.id}`, {
          cause,
        });
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { logAuditQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["logAuditQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedLogAuditWorlds.length &&
      checks.every(
        ({ verification, rejectedDifferentWindow }) =>
          verification.passed && rejectedDifferentWindow,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "The host log readback or cited evidence differed from the task.",
          details: { checks },
        };
  },
});
