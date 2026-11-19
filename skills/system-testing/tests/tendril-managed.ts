import type { TestCase } from "../types.js";
import type { ManagedTendrilReceiver } from "../tendril-contract.js";
import { managedTendrilWorlds, tendrilPanel } from "../tendril-worlds.js";
import {
  panelControlAuthorityPolicy,
  PANEL_AUTOMATION_RESOURCE,
} from "../panel-authority.js";

type Exercise = Awaited<
  ReturnType<ManagedTendrilReceiver["runManagedTendrilTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedTendrilReceiver["qualifyManagedTendril"]>
>;
const settings = {
  category: "tendrils",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [tendrilPanel, "workers/tendril"],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("inspect-owned-tendril"),
};

export const managedTendrilTests: TestCase[] = managedTendrilWorlds.map(
  ({ id, request }) => ({
    ...settings,
    name: `tendril-live-${id}`,
    description: "Verify a live Tendril board and its durable state",
    prompt: request.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedTendril(
        id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Tendril run");
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
          managedTendril: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Exercise["teacher"]
        | undefined;
      const exercise = result.diagnostics?.["managedTendril"] as
        | Omit<Exercise, "teacher">
        | undefined;
      return teacher?.trainingEligible === true &&
        exercise?.verification.passed === true
        ? { passed: true, details: exercise.verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the live board and its stored state.",
            details: exercise?.verification,
          };
    },
  }),
);

managedTendrilTests.push({
  ...settings,
  name: "tendril-managed-oracle-qualification",
  description: "Qualify the owned Tendril on a live presentation target",
  prompt:
    "Verify the live board, its exposed controls and exact durable state effects.",
  async orchestrate(context) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedTendrilWorlds) {
      try {
        const run = await context.runner.runManagedTendril(
          id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Qualification invoked a teacher");
        checks.push(run.result);
      } catch (cause) {
        throw new Error(`Tendril qualification failed for ${id}`, { cause });
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { tendrilQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["tendrilQualification"] as
      | Qualification[]
      | undefined;
    return checks?.length === managedTendrilWorlds.length &&
      checks.every(
        ({ verification, rejectsOtherSlot }) =>
          verification.passed && rejectsOtherSlot,
      )
      ? {
          passed: true,
          details: { checkedCases: checks.length, modelCalls: 0 },
        }
      : {
          passed: false,
          reason:
            "Tendril did not verify the live effects and reject an unrelated slot.",
          details: { checks },
        };
  },
});
