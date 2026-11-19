import type { TestCase } from "../types.js";
import type { ManagedPdfLayoutReceiver } from "../pdf-layout-managed.js";
import { managedPdfLayoutWorlds } from "../pdf-layout-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedPdfLayoutReceiver["runManagedPdfLayoutTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedPdfLayoutReceiver["qualifyManagedPdfLayout"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["extensions/pdf-ingest"],
};

export const managedPdfLayoutTests: TestCase[] = managedPdfLayoutWorlds.map(
  (world) => ({
    ...settings,
    name: `pdf-layout-live-${world.id}`,
    description: "Recover reading order from the assigned PDF layout",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedPdfLayout(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang PDF layout review");
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
          managedPdfLayout: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedPdfLayout"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedPdfLayoutTests.push({
  ...settings,
  name: "pdf-layout-oracle-qualification",
  description:
    "Qualify reading order over actual PDF fragments without model calls",
  prompt: "Check the geometry and reading order of the assigned PDF.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedPdfLayoutWorlds) {
      const run = await runner.runManagedPdfLayout(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("PDF layout qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { pdfLayoutQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["pdfLayoutQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedPdfLayoutWorlds.length &&
        checks.every(
          ({ verification, rejectsWrongPage }) =>
            verification.passed && rejectsWrongPage,
        ),
      details: { checks },
    };
  },
});
