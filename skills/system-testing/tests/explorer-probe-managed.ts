import type { ExplorerProbeReceiver } from "../explorer-probe-managed.js";
import { explorerTextWorlds } from "../explorer-probe-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<ExplorerProbeReceiver["qualifyExplorerProbe"]>>;
type Teacher = Awaited<ReturnType<ExplorerProbeReceiver["runExplorerProbeTeacher"]>>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/explorer-probe-bindings"],
};

export const managedExplorerProbeTests: TestCase[] = explorerTextWorlds.map((world) => ({
  ...settings,
  name: `explorer-text-live-${world.id}`,
  description: "Plan and classify a live two-store text experiment",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runExplorerTextProbe(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured workspace probe");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, explorerTextProbe: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["explorerTextProbe"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedExplorerProbeTests.push({
  ...settings,
  name: "explorer-text-oracle-qualification",
  description: "Qualify the native workspace text experiment without a model",
  prompt: explorerTextWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of explorerTextWorlds) {
      const result = await runner.runExplorerTextProbe(id, true, signal);
      if (result.kind !== "reference") throw new Error("Explorer qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { explorerTextProbe: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["explorerTextProbe"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === explorerTextWorlds.length && outcomes.every(({ passed }) => passed),
      details: { cases: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })) },
    };
  },
});
