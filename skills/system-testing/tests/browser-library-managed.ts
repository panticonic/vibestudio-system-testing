import type { TestCase } from "../types.js";
import type { ManagedBrowserLibraryReceiver } from "../browser-library-contract.js";
import { managedBrowserLibraryWorlds } from "../browser-library-worlds.js";

type Exercise = Awaited<
  ReturnType<ManagedBrowserLibraryReceiver["runManagedBrowserLibraryTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedBrowserLibraryReceiver["qualifyManagedBrowserLibrary"]>
>;
export const browserLibrarySettings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["extensions/browser-data", "skills/browser-library-runtime"],
  authorityPolicy: {
    authority: ["write", "delete"].map((effect) => ({
      ruleId: `browser-library-fixture-${effect}`,
      capability: {
        kind: "prefix" as const,
        prefix: `userland:workers/browser-data/browser-data.${effect}#`,
      },
      resource: {
        kind: "prefix" as const,
        prefix: "browser-data:do:workers/browser-data:BrowserDataDO:",
      },
      tier: "gated" as const,
      decision: "once" as const,
    })),
  },
};

export const managedBrowserLibraryTests: TestCase[] =
  managedBrowserLibraryWorlds.map(({ id, request }) => ({
    ...browserLibrarySettings,
    name: `browser-library-live-${id}`,
    description:
      "Curate test-owned browser records and verify the persisted library",
    prompt: request.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedBrowserLibrary(
        id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored browser-library workflow");
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
          managedBrowserLibrary: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Exercise["teacher"]
        | undefined;
      const exercise = result.diagnostics?.["managedBrowserLibrary"] as
        | Omit<Exercise, "teacher">
        | undefined;
      return teacher?.trainingEligible === true &&
        exercise?.verification.passed === true
        ? { passed: true, details: exercise.verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the owned browser library and retained records.",
            details: exercise?.verification,
          };
    },
  }));

managedBrowserLibraryTests.push({
  ...browserLibrarySettings,
  name: "browser-library-managed-oracle-qualification",
  description: "Qualify live browser-library changes without a model",
  prompt:
    "Check bookmark effects and refusal of changes outside the assigned folders.",
  async orchestrate(context) {
    const started = Date.now();
    const rows: Qualification[] = [];
    for (const { id } of managedBrowserLibraryWorlds) {
      try {
        const run = await context.runner.runManagedBrowserLibrary(
          id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Qualification invoked a teacher");
        rows.push(run.result);
      } catch (cause) {
        throw new Error(`Browser library qualification failed for ${id}`, {
          cause,
        });
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { browserLibraryQualification: rows },
    };
  },
  validate(result) {
    const rows = result.diagnostics?.["browserLibraryQualification"] as
      | Qualification[]
      | undefined;
    return rows?.length === managedBrowserLibraryWorlds.length &&
      rows.every(
        ({ verification, rejectsOutside, rejectsWrongReceipt }) =>
          verification.passed && rejectsOutside && rejectsWrongReceipt,
      )
      ? { passed: true, details: { checkedCases: rows.length, modelCalls: 0 } }
      : {
          passed: false,
          reason: "BrowserLibrary effects or scope verification did not match.",
          details: { rows },
        };
  },
});
