import type { TranscriptCursorReceiver } from "../transcript-cursor-managed.js";
import { transcriptCursorWorlds } from "../transcript-cursor-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<TranscriptCursorReceiver["qualifyTranscriptCursor"]>>;
type Teacher = Awaited<ReturnType<TranscriptCursorReceiver["runTranscriptCursorTeacher"]>>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/session-cursor-bindings"],
};

export const managedTranscriptCursorTests: TestCase[] = transcriptCursorWorlds.map((world) => ({
  ...settings,
  name: `transcript-cursor-live-${world.id}`,
  description: "Recover durable transcript pages and the next saved cursor",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runTranscriptCursor(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a captured transcript continuation");
    const { contextId, teacher, verification } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId, channelId: verification.channelId, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, transcriptCursor: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
    const verification = result.diagnostics?.["transcriptCursor"] as Teacher["verification"] | undefined;
    return { passed: !!teacher?.trainingEligible && !!verification?.passed, details: verification?.checks };
  },
}));

managedTranscriptCursorTests.push({
  ...settings,
  name: "transcript-cursor-oracle-qualification",
  description: "Qualify headless channel replay and the frozen watermark without model calls",
  prompt: transcriptCursorWorlds[0].goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const outcomes: Qualification[] = [];
    for (const { id } of transcriptCursorWorlds) {
      const result = await runner.runTranscriptCursor(id, true, signal);
      if (result.kind !== "reference") throw new Error("Transcript qualification invoked a teacher");
      outcomes.push(result.value);
    }
    return { messages: [], duration: Date.now() - start, diagnostics: { transcriptCursor: outcomes } };
  },
  validate(result) {
    const outcomes = result.diagnostics?.["transcriptCursor"] as Qualification[] | undefined;
    return {
      passed: outcomes?.length === transcriptCursorWorlds.length && outcomes.every(({ passed }) => passed),
      details: { cases: outcomes?.map(({ caseId,checks }) => ({ caseId,checks })) },
    };
  },
});
