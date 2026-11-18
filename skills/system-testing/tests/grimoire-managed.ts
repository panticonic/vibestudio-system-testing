import type { TestCase } from "../types.js";
import type { ManagedGrimoireReceiver } from "../grimoire-contract.js";
import { grimoirePanel, managedGrimoireWorlds } from "../grimoire-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Teacher = Awaited<
  ReturnType<ManagedGrimoireReceiver["runManagedGrimoireTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedGrimoireReceiver["qualifyManagedGrimoire"]>
>;
const setup = {
  category: "adventure",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    grimoirePanel,
    "workers/grimoire-world",
    "skills/examples-review",
  ],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("review-live-garden", [
    {
      ruleId: "garden-world",
      capability: { kind: "exact", key: "workspace-service:grimoire" },
      resource: {
        kind: "prefix",
        prefix: "do:workers/grimoire-world:GrimoireWorldDO:natlang-garden-",
      },
      tier: "gated",
      decision: "task",
    },
  ]),
};

export const managedGrimoireTests: TestCase[] = managedGrimoireWorlds.map(
  (world) => ({
    ...setup,
    name: `grimoire-live-${world.id}`,
    description:
      "Review multiple claims using the installed garden, live resident visits and persisted readback",
    prompt: world.request.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedGrimoire(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Examples review");
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
          managedGrimoire: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedGrimoire"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the persisted garden evidence and every assigned claim.",
            details: verification,
          };
    },
  }),
);

managedGrimoireTests.push({
  ...setup,
  name: "grimoire-managed-oracle-qualification",
  description: "Qualify the installed Grimoire garden workflow without a model",
  prompt: "Verify the real garden readback and reject substituted evidence.",
  async orchestrate(context) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const world of managedGrimoireWorlds) {
      const run = await context.runner.runManagedGrimoire(
        world.id,
        true,
        context.signal,
      );
      if (run.kind !== "reference")
        throw new Error("Garden qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { grimoireQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["grimoireQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedGrimoireWorlds.length &&
      checks.every(
        ({ verification, rejectedAlteredEvidence }) =>
          verification.passed && rejectedAlteredEvidence,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "The persisted garden or independent verification differed from the assigned observation.",
          details: { checks },
        };
  },
});
