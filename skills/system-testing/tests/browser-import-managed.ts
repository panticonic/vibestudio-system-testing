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
  authorityPolicy: {
    authority: [
      {
        ruleId: "owned-browser-import-store-write",
        capability: {
          kind: "prefix" as const,
          prefix: "userland:workers/browser-data/browser-data.write#",
        },
        resource: {
          kind: "prefix" as const,
          prefix:
            "browser-data:do:workers/browser-data:BrowserDataDO:browser-import-fixture-",
        },
        tier: "gated" as const,
        decision: "once" as const,
      },
    ],
  },
  category: "oauth",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 5 * 60_000,
  requiresUnits: ["skills/browser-import-runtime", "workers/browser-data"],
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

managedBrowserImportTests.push({
  ...settings,
  name: "browser-import-oracle-qualification",
  description: "Qualify the assigned browser migration reads without a model",
  prompt:
    "Check migration preview boundaries and persisted public import receipts.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks = [];
    for (const { id } of managedBrowserImportWorlds) {
      const run = await runner.runManagedBrowserImport(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("browser import qualification invoked a teacher");
      checks.push({ caseId: id, ...run.result });
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { driveSharingQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["driveSharingQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedBrowserImportWorlds.length &&
        checks.every(
          ({ verification, rejectedExtraRead }) =>
            verification.passed && rejectedExtraRead,
        ),
      details: { checks },
    };
  },
});
