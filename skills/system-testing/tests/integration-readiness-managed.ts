import type { TestCase } from "../types.js";
import type { ManagedIntegrationReadinessReceiver } from "../integration-readiness-managed.js";
import { managedIntegrationReadinessWorlds } from "../integration-readiness-worlds.js";

type Teacher = Awaited<
  ReturnType<
    ManagedIntegrationReadinessReceiver["runManagedIntegrationReadinessTeacher"]
  >
>;
type Qualification = Awaited<
  ReturnType<
    ManagedIntegrationReadinessReceiver["qualifyManagedIntegrationReadiness"]
  >
>;
const settings = {
  category: "oauth",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/api-integrations"],
  authorityPolicy: {
    authority: [
      {
        ruleId: "use-owned-integration-fixture",
        capability: { kind: "exact" as const, key: "credential.use" },
        resource: { kind: "exact" as const, key: "credential.use" },
        tier: "gated" as const,
        decision: "once" as const,
      },
    ],
  },
};

export const managedIntegrationReadinessTests: TestCase[] =
  managedIntegrationReadinessWorlds.map((world) => ({
    ...settings,
    name: `integration-readiness-live-${world.id}`,
    description:
      "Check exact API binding coverage without exposing credential details",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedIntegrationReadiness(
        world.id,
        false,
        signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected authored integration readiness");
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
          managedIntegrationReadiness: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.[
        "managedIntegrationReadiness"
      ] as Teacher["verification"] | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }));

managedIntegrationReadinessTests.push({
  ...settings,
  name: "integration-readiness-oracle-qualification",
  description:
    "Qualify actual host credential matching against a disposable synthetic binding",
  prompt:
    "Check both audience and transport mismatches against the seeded positive binding.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedIntegrationReadinessWorlds) {
      const run = await runner.runManagedIntegrationReadiness(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Integration readiness invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { integrationReadinessQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["integrationReadinessQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedIntegrationReadinessWorlds.length &&
        checks.every(
          ({ verification, rejectsWrongDestination }) =>
            verification.passed && rejectsWrongDestination,
        ),
      details: { checks },
    };
  },
});
