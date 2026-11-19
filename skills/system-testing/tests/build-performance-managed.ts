import { buildPerformanceWorlds } from "../build-performance-worlds.js";
import type { BuildPerformanceReceiver } from "../build-performance-managed.js";
import { BUILDABLE_PANEL_WORKSPACE_REPO_FIXTURE, type TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<BuildPerformanceReceiver["qualifyBuildPerformance"]>>;
type Teacher = Awaited<ReturnType<BuildPerformanceReceiver["runBuildPerformanceTeacher"]>>;

const settings = {
  category: "performance",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  workspaceRepoFixture: BUILDABLE_PANEL_WORKSPACE_REPO_FIXTURE,
  requiresUnits: ["skills/performance-build-bindings"],
};

export const managedBuildPerformanceTests: TestCase[] = buildPerformanceWorlds.map((world) => ({
  ...settings,
  name: `build-performance-live-${world.id}`,
  description: "Interpret actual build and payload receipts for an assigned panel",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const result = await runner.runBuildPerformance(world, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured build performance review");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [],
      duration: Date.now() - started,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, buildPerformance: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["buildPerformance"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedBuildPerformanceTests.push({
  ...settings,
  name: "build-performance-oracle-qualification",
  description: "Qualify measured build and cache evidence from the actual System workspace without a model",
  prompt: buildPerformanceWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const result = await runner.runBuildPerformance(buildPerformanceWorlds[0], true, signal);
    if (result.kind !== "reference") throw new Error("Build qualification invoked a teacher");
    return { messages: [], duration: Date.now() - started, diagnostics: { buildPerformance: result.value } };
  },
  validate(result) {
    const verification = result.diagnostics?.["buildPerformance"] as Qualification | undefined;
    return { passed: !!verification?.passed, details: verification?.checks };
  },
});
