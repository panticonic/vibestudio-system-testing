import type { PdfMediaReceiver } from "../pdf-media-managed.js";
import { pdfMediaWorlds } from "../pdf-media-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<PdfMediaReceiver["qualifyPdfMedia"]>>;
type Teacher = Awaited<ReturnType<PdfMediaReceiver["runPdfMediaTeacher"]>>;
const settings = {
  category: "mobile",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["extensions/pdf-ingest"],
};

export const managedPdfMediaTests: TestCase[] = pdfMediaWorlds.map((world) => ({
  ...settings,
  name: `pdf-media-live-${world.id}`,
  description: "Review real PDF extraction geometry and artifact evidence",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runPdfMedia(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured PDF extraction review");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, pdfMedia: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["pdfMedia"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedPdfMediaTests.push({
  ...settings,
  name: "pdf-media-oracle-qualification",
  description: "Qualify live PDF extraction and artifacts without model calls",
  prompt: pdfMediaWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of pdfMediaWorlds) {
      const result = await runner.runPdfMedia(id, true, signal);
      if (result.kind !== "reference") throw new Error("PDF media qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { pdfMedia: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["pdfMedia"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === pdfMediaWorlds.length && outcomes.every(({ passed }) => passed),
      details: { cases: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })) },
    };
  },
});
