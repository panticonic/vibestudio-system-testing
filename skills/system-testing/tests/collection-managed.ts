import type { TestCase } from "../types.js";
import type { ManagedCollectionReceiver } from "../collection-contract.js";
import { managedCollectionWorlds } from "../collection-worlds.js";
import {
  panelControlAuthorityPolicy,
  PANEL_AUTOMATION_RESOURCE,
} from "../panel-authority.js";

type Exercise = Awaited<
  ReturnType<ManagedCollectionReceiver["runManagedCollectionTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedCollectionReceiver["qualifyManagedCollection"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["about/collection", "skills/collection-conductor-runtime"],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("inspect-owned-collection"),
};

export const managedCollectionTests: TestCase[] = managedCollectionWorlds.map(
  ({ id, request }) => ({
    ...settings,
    name: `collection-live-${id}`,
    description:
      "Organize a test-owned collection and verify the live panel tree",
    prompt: request.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedCollection(
        id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored collection workflow");
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
          managedCollection: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Exercise["teacher"]
        | undefined;
      const exercise = result.diagnostics?.["managedCollection"] as
        | Omit<Exercise, "teacher">
        | undefined;
      return teacher?.trainingEligible === true &&
        exercise?.verification.passed === true
        ? { passed: true, details: exercise.verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the owned panel tree and persisted notes.",
            details: exercise?.verification,
          };
    },
  }),
);

managedCollectionTests.push({
  ...settings,
  name: "collection-managed-oracle-qualification",
  description: "Qualify live scoped collection changes without a model",
  prompt:
    "Check valid panel tree changes and refusal of changes outside the collection.",
  async orchestrate(context) {
    const started = Date.now();
    const rows: Qualification[] = [];
    for (const { id } of managedCollectionWorlds) {
      try {
        const run = await context.runner.runManagedCollection(
          id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Qualification invoked a teacher");
        rows.push(run.result);
      } catch (cause) {
        throw new Error(`Collection qualification failed for ${id}`, { cause });
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { collectionQualification: rows },
    };
  },
  validate(result) {
    const rows = result.diagnostics?.["collectionQualification"] as
      | Qualification[]
      | undefined;
    return rows?.length === managedCollectionWorlds.length &&
      rows.every(
        ({ verification, rejectsOutside, rejectsWrongReceipt }) =>
          verification.passed && rejectsOutside && rejectsWrongReceipt,
      )
      ? { passed: true, details: { checkedCases: rows.length, modelCalls: 0 } }
      : {
          passed: false,
          reason: "Collection effects or scope verification did not match.",
          details: { rows },
        };
  },
});
