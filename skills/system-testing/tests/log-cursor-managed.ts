import type { TestCase } from "../types.js";
import type { ManagedLogCursorReceiver } from "../log-cursor-managed.js";
import { managedLogCursorWorlds } from "../log-cursor-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedLogCursorReceiver["runManagedLogCursorTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedLogCursorReceiver["qualifyManagedLogCursor"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/server-logs", "skills/server-log-cursor-bindings"],
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

export const managedLogCursorTests: TestCase[] = managedLogCursorWorlds.map(
  (world) => ({
    ...settings,
    name: `log-cursor-live-${world.id}`,
    description: "Review a saved cursor against live host logs",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedLogCursor(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang saved log cursor review");
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
          managedLogCursor: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedLogCursor"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedLogCursorTests.push({
  ...settings,
  name: "log-cursor-oracle-qualification",
  description:
    "Qualify live boot, coverage and record group evidence without model calls",
  prompt: "Check the assigned cursor against the current host log.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedLogCursorWorlds) {
      const run = await runner.runManagedLogCursor(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Log cursor qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { logCursorQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["logCursorQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedLogCursorWorlds.length &&
        checks.every(
          ({ verification, rejectsForeignCursor }) =>
            verification.passed && rejectsForeignCursor,
        ),
      details: { checks },
    };
  },
});
