import type { TestCase } from "../types.js";
import type { ManagedLogHandoffReceiver } from "../log-handoff-managed.js";
import { managedLogHandoffWorlds } from "../log-handoff-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedLogHandoffReceiver["runManagedLogHandoffTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedLogHandoffReceiver["qualifyManagedLogHandoff"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/server-logs"],
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

export const managedLogHandoffTests: TestCase[] = managedLogHandoffWorlds.map(
  (world) => ({
    ...settings,
    name: `log-handoff-live-${world.id}`,
    description: "Review a host-log handoff against live host logs",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedLogHandoff(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang host-log handoff");
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
          managedLogHandoff: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedLogHandoff"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedLogHandoffTests.push(
  ...managedLogHandoffWorlds.map((world): TestCase => ({
    ...settings,
    name: `log-handoff-oracle-${world.id}`,
    description: "Qualify two bounded host-log windows without model calls",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedLogHandoff(world.id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Log cursor qualification invoked a teacher");
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { logHandoffQualification: run.result },
      };
    },
    validate(result) {
      const check = result.diagnostics?.["logHandoffQualification"] as
        | Qualification
        | undefined;
      return {
        passed: Boolean(check?.verification.passed && check.rejectsForeignWindow),
        details: { check },
      };
    },
  })),
);
