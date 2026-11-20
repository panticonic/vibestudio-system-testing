import type { PublicationRevisionReceiver } from "../publication-revision-managed.js";
import { publicationRevisionWorlds } from "../publication-revision-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<PublicationRevisionReceiver["qualifyPublicationRevision"]>>;
type Teacher = Awaited<ReturnType<PublicationRevisionReceiver["runPublicationRevisionTeacher"]>>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/publication-revision-bindings"],
  workspaceRepoFixture: { kind: "publication-preflight-panel", section: "panels", caseId: "review-ready" } as const,
};

export const managedPublicationRevisionTests: TestCase[] = publicationRevisionWorlds.map((world) => ({
  ...settings,
  name: `publication-revision-live-${world.id}`,
  description: "Compare real sealed website packages and their assigned destination",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runPublicationRevision(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured package revision");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, publicationRevision: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["publicationRevision"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedPublicationRevisionTests.push({
  ...settings,
  name: "publication-revision-oracle-qualification",
  description: "Qualify sealed package comparison and source edits without model calls",
  prompt: publicationRevisionWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of publicationRevisionWorlds) {
      const result = await runner.runPublicationRevision(id, true, signal);
      if (result.kind !== "reference") throw new Error("Publication revision qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { publicationRevision: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["publicationRevision"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === publicationRevisionWorlds.length && outcomes.every(({ passed }) => passed),
      details: { cases: outcomes?.map(({ caseId, checks }) => ({ caseId, checks })) },
    };
  },
});
