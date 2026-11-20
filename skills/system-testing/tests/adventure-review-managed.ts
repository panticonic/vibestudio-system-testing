import type { ManagedAdventureReceiver } from "../adventure-review-contract.js";
import { managedAdventureWorlds } from "../adventure-review-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  PANEL_RUNTIME_SUPERVISION_AUTHORITY,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";
import type { TestCase } from "../types.js";

const settings = {
  category: "adventure",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["workers/adventure-world", "skills/examples-review"],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("review-adventure-opening", [
    PANEL_RUNTIME_SUPERVISION_AUTHORITY,
    {
      ruleId: "owned-adventure-journey",
      capability: { kind: "exact", key: "workspace-service:adventure" },
      resource: {
        kind: "prefix",
        prefix:
          "do:workers/adventure-world:AdventureWorldDO:natlang-adventure-",
      },
      tier: "gated",
      decision: "task",
    },
    {
      ruleId: "adventure-import-illustration",
      capability: { kind: "exact", key: "workspace-service:images" },
      resource: { kind: "exact", key: "do:workers/images:ImagesDO:workspace" },
      tier: "gated",
      decision: "task",
    },
  ]),
};
type Teacher = Awaited<
  ReturnType<ManagedAdventureReceiver["runManagedAdventureTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedAdventureReceiver["qualifyManagedAdventure"]>
>;
export const managedAdventureReviewTests: TestCase[] =
  managedAdventureWorlds.map((world) => ({
    ...settings,
    requiresUnits: [...settings.requiresUnits, `panels/${world.campaign}`],
    name: `adventure-review-live-${world.id}`,
    description:
      "Review access, continuity and artwork in one saved Adventure journey",
    prompt: world.request.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedAdventure(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Adventure review");
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
          managedAdventureReview: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const review = result.diagnostics?.["managedAdventureReview"] as
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

managedAdventureReviewTests.push({
  ...settings,
  requiresUnits: [
    ...settings.requiresUnits,
    ...managedAdventureWorlds.map(({ campaign }) => `panels/${campaign}`),
  ],
  name: "adventure-review-oracle-qualification",
  description:
    "Verify the installed Adventure worker and loaded opening artwork without a model",
  prompt: "Check the opening views, their artwork and the assigned claims.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedAdventureWorlds) {
      const run = await runner.runManagedAdventure(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Adventure qualification invoked a teacher");
      checks.push({ caseId: id, ...run.result });
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { adventureReviewQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["adventureReviewQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedAdventureWorlds.length &&
        checks.every(
          ({ verification, rejectedAlteredEvidence }) =>
            verification.passed && rejectedAlteredEvidence,
        ),
      details: { checks },
    };
  },
});
