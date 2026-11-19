import type { TourRehearsalReceiver } from "../tour-rehearsal-managed.js";
import { tourRehearsalWorlds } from "../tour-rehearsal-worlds.js";
import { PANEL_AUTOMATION_RESOURCE, panelControlAuthorityPolicy } from "../panel-authority.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<TourRehearsalReceiver["qualifyTourRehearsal"]>>;
type Teacher = Awaited<ReturnType<TourRehearsalReceiver["runTourRehearsalTeacher"]>>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["panels/tour", "skills/tour-rehearsal-bindings"],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("rehearse-assigned-tour"),
};

export const managedTourRehearsalTests: TestCase[] = tourRehearsalWorlds.map((world) => ({
  ...settings,
  name: `tour-rehearsal-live-${world.id}`,
  description: "Rehearse the requested topics on the live Personal tour panel",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runTourRehearsal(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured tour rehearsal");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, tourRehearsal: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["tourRehearsal"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedTourRehearsalTests.push({
  ...settings,
  name: "tour-rehearsal-oracle-qualification",
  description: "Qualify owned tour state and actual CDP readbacks without a model",
  prompt: tourRehearsalWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of tourRehearsalWorlds) {
      const result = await runner.runTourRehearsal(id, true, signal);
      if (result.kind !== "reference") throw new Error("Tour qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { tourRehearsal: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["tourRehearsal"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === tourRehearsalWorlds.length && outcomes.every(({ passed }) => passed),
      details: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })),
    };
  },
});
