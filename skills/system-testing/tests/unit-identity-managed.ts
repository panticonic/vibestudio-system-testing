import type { UnitIdentityReceiver } from "../unit-identity-managed.js";
import { unitIdentityWorlds } from "../unit-identity-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<UnitIdentityReceiver["qualifyUnitIdentity"]>>;
type Teacher = Awaited<ReturnType<UnitIdentityReceiver["runUnitIdentityTeacher"]>>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/unit-identity-bindings"],
};

export const managedUnitIdentityTests: TestCase[] = unitIdentityWorlds.map((world) => ({
  ...settings,
  name: `unit-identity-live-${world.id}`,
  description: "Resolve and verify an installed unit icon in its actual working state",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runUnitIdentity(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured unit identity workflow");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, unitIdentity: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["unitIdentity"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedUnitIdentityTests.push({
  ...settings,
  name: "unit-identity-oracle-qualification",
  description: "Qualify live artwork, manifest edits and protected main without model calls",
  prompt: unitIdentityWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const results: Qualification[] = [];
    for (const { id } of unitIdentityWorlds) {
      const result = await runner.runUnitIdentity(id, true, signal);
      if (result.kind !== "reference") throw new Error("Unit identity qualification invoked a teacher");
      results.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { unitIdentity: results } };
  },
  validate(result) {
    const results = result.diagnostics?.["unitIdentity"] as Qualification[] | undefined;
    return {
      passed: results?.length === unitIdentityWorlds.length && results.every(({ passed }) => passed),
      details: { cases: results?.map(({ caseId, checks }) => ({ caseId, checks })) },
    };
  },
});
