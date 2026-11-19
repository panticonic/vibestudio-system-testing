import type { GmailComposeHistoryReceiver } from "../gmail-compose-history-managed.js";
import { gmailComposeHistoryWorlds } from "../gmail-compose-history-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<GmailComposeHistoryReceiver["qualifyGmailComposeHistory"]>>;
type Teacher = Awaited<ReturnType<GmailComposeHistoryReceiver["runGmailComposeHistoryTeacher"]>>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/gmail-compose-history-bindings"],
};

export const managedGmailComposeHistoryTests: TestCase[] = gmailComposeHistoryWorlds.map((world) => ({
  ...settings,
  name: `gmail-compose-history-live-${world.id}`,
  description: "Verify a Gmail compose disposition from native channel events",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runGmailComposeHistory(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured Gmail compose review");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: verification.seed.channelId, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, gmailComposeHistory: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["gmailComposeHistory"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedGmailComposeHistoryTests.push({
  ...settings,
  name: "gmail-compose-history-oracle-qualification",
  description: "Qualify actual compose-history channel receipts without calling a model",
  prompt: gmailComposeHistoryWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of gmailComposeHistoryWorlds) {
      const result = await runner.runGmailComposeHistory(id, true, signal);
      if (result.kind !== "reference") throw new Error("Compose history qualification invoked a teacher");
      checks.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { gmailComposeHistory: checks } };
  },
  validate(result) {
    const checks = result.diagnostics?.["gmailComposeHistory"] as Qualification[] | undefined;
    return {
      passed: checks?.length === gmailComposeHistoryWorlds.length && checks.every(({ passed }) => passed),
      details: checks?.map(({ seed, checks }) => ({ caseId: seed.caseId, checks })),
    };
  },
});
