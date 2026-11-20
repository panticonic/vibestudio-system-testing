import type { RetainedTriageReceiver } from "../retained-triage-managed.js";
import { retainedTriageWorlds } from "../retained-triage-worlds.js";
import type { TestCase } from "../types.js";

type Capture = Awaited<
  ReturnType<RetainedTriageReceiver["runRetainedTriageTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<RetainedTriageReceiver["qualifyRetainedTriage"]>
>;
const settings = {
  category: "skills",
  explicitOnly: true,
  validation: "harness" as const,
};

export const retainedTriageTests = retainedTriageWorlds.flatMap(
  (world): TestCase[] => [
    {
      ...settings,
      name: world.testName,
      description:
        "Induce the precise failure to produce one native retained triage fixture",
      prompt: "Produce the assigned failed test record.",
      async orchestrate() {
        if (world.phase === "orchestration") throw new Error(world.detail);
        return { messages: [], duration: 0 };
      },
      validate() {
        throw new Error(world.detail);
      },
    },
    {
      ...settings,
      name: `retained-triage-live-${world.id}`,
      description:
        "Triage an owned native diagnostic after the source execution is released",
      prompt: world.goal,
      async orchestrate({ runner, signal }) {
        const start = Date.now();
        const result = await runner.runRetainedTriage(world.id, false, signal);
        if (result.kind !== "teacher")
          throw new Error("Expected a retained triage capture");
        const { teacher, ...fixture } = result.value;
        return {
          messages: [],
          duration: Date.now() - start,
          provenance: {
            contextId: fixture.contextId,
            channelId: null,
            branchId: null,
            agentEntityId: null,
            agentTargetId: null,
          },
          diagnostics: { natlangTeacher: teacher, retainedTriage: fixture },
        };
      },
      validate(result) {
        const teacher = result.diagnostics?.["natlangTeacher"] as
          | Capture["teacher"]
          | undefined;
        const fixture = result.diagnostics?.["retainedTriage"] as
          | Omit<Capture, "teacher">
          | undefined;
        return {
          passed:
            teacher?.trainingEligible === true &&
            fixture?.verification.passed === true,
          details: fixture?.verification.checks,
        };
      },
    },
    {
      ...settings,
      name: `retained-triage-oracle-qualification-${world.id}`,
      description: "Verify a real retained failure record without model calls",
      prompt: world.goal,
      async orchestrate({ runner, signal }) {
        const start = Date.now();
        const result = await runner.runRetainedTriage(world.id, true, signal);
        if (result.kind !== "reference")
          throw new Error("Retained triage qualification invoked a model");
        return {
          messages: [],
          duration: Date.now() - start,
          diagnostics: { retainedTriage: result.value },
        };
      },
      validate(result) {
        const qualification = result.diagnostics?.["retainedTriage"] as
          | Qualification
          | undefined;
        return {
          passed:
            qualification?.caseId === world.id && qualification.passed === true,
          details: qualification?.checks,
        };
      },
    },
  ],
);
