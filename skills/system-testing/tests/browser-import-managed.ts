import type { ManagedBrowserImportReceiver } from "../browser-import-contract.js";
import { managedBrowserImportWorlds } from "../browser-import-worlds.js";
import type { TestCase } from "../types.js";

type Teacher = Awaited<
  ReturnType<ManagedBrowserImportReceiver["runManagedBrowserImportTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedBrowserImportReceiver["qualifyManagedBrowserImport"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    "skills/browser-import-runtime",
    "workers/browser-import-fixture",
  ],
};

export const managedBrowserImportTests: TestCase[] =
  managedBrowserImportWorlds.map((world) => ({
    ...settings,
    name: `browser-import-live-${world.id}`,
    description:
      "Review an assigned browser migration source or a retained public import receipt",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedBrowserImport(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected an authored browser import review");
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
          managedBrowserImport: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const fixture = result.diagnostics?.["managedBrowserImport"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return {
        passed: Boolean(
          teacher?.trainingEligible && fixture?.verification.passed,
        ),
        details: fixture?.verification.checks,
      };
    },
  }));

managedBrowserImportTests.push(
  ...managedBrowserImportWorlds.map(
    ({ id, goal }): TestCase => ({
      ...settings,
      name: `browser-import-oracle-qualification-${id}`,
      description: "Qualify the assigned migration reads without a model",
      prompt: goal,
      async orchestrate({ runner, signal }) {
        const started = Date.now();
        const run = await runner.runManagedBrowserImport(id, true, signal);
        if (run.kind !== "reference")
          throw new Error("Browser import qualification invoked a teacher");
        return {
          messages: [],
          duration: Date.now() - started,
          diagnostics: { browserImportQualification: run.result },
        };
      },
      validate(result) {
        const qualification = result.diagnostics?.[
          "browserImportQualification"
        ] as Qualification | undefined;
        return {
          passed:
            qualification?.verification.passed === true &&
            qualification.rejectedExtraRead === true,
          details: qualification,
        };
      },
    }),
  ),
);
