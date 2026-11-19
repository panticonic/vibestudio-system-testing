import type { TestCase } from "../types.js";
import type { ManagedTerminalCheckReceiver } from "../terminal-check-managed.js";
import { managedTerminalCheckWorlds } from "../terminal-check-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedTerminalCheckReceiver["runManagedTerminalCheckTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedTerminalCheckReceiver["qualifyManagedTerminalCheck"]>
>;
const settings = {
  category: "agent-orchestration",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/terminal", "extensions/shell"],
  authorityPolicy: {
    authority: [
      {
        ruleId: "assigned-terminal-plan",
        capability: {
          kind: "prefix" as const,
          prefix: "userland:extensions/shell/native.shell.execute#",
        },
        resource: {
          kind: "exact" as const,
          key: "native.shell:extension:@workspace-extensions/shell",
        },
        tier: "gated" as const,
        decision: "once" as const,
      },
    ],
  },
};

export const managedTerminalCheckTests: TestCase[] =
  managedTerminalCheckWorlds.map((world) => ({
    ...settings,
    name: `terminal-check-live-${world.id}`,
    description:
      "Run caller-assigned process checks and verify held dependencies",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedTerminalCheck(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected authored terminal checks");
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
          managedTerminalChecks: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedTerminalChecks"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedTerminalCheckTests.push({
  ...settings,
  name: "terminal-check-oracle-qualification",
  description:
    "Verify exact native terminal effects and held dependencies without a model",
  prompt:
    "Check the literal argv, assigned pipeline, and bounded process effects.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedTerminalCheckWorlds) {
      const run = await runner.runManagedTerminalCheck(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Terminal qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { terminalCheckQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["terminalCheckQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedTerminalCheckWorlds.length &&
        checks.every(
          ({ verification, rejectedHeld }) =>
            verification.passed && rejectedHeld,
        ),
      details: { checks },
    };
  },
});
