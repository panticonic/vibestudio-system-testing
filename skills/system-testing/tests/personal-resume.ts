import type { PersonalResumeReceiver } from "../personal-resume-managed.js";
import { personalResumeWorlds } from "../personal-resume-worlds.js";
import type { TestCase } from "../types.js";

type Qualification = Awaited<ReturnType<PersonalResumeReceiver["qualifyPersonalResume"]>>;
type Teacher = Awaited<ReturnType<PersonalResumeReceiver["runPersonalResumeTeacher"]>>;

export const managedPersonalResumeTests: TestCase[] = personalResumeWorlds.flatMap(
  (world) => [false, true].map((qualification): TestCase => ({
    category: "skills",
    explicitOnly: true,
    validation: "harness",
    timeoutMs: 6 * 60_000,
    requiresUnits: ["skills/github", "skills/onboarding"],
    name: `personal-resume-${qualification ? "oracle" : "live"}-${world.id}`,
    description: "Plan repository resumption from the live worktree and installed setup owner",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const start = Date.now();
      const run = await runner.runPersonalResume(world.id, qualification, signal);
      const duration = Date.now() - start;
      if (run.kind === "reference") {
        if (!qualification) throw new Error("Expected a captured Personal workflow");
        return { messages: [], duration, diagnostics: { personalResume: run.value } };
      }
      if (qualification) throw new Error("Qualification invoked a teacher");
      const { teacher, verification, contextId } = run.value;
      return {
        messages: [], duration,
        provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
        diagnostics: { natlangTeacher: teacher, personalResume: verification },
      };
    },
    validate(result) {
      const observed = result.diagnostics?.["personalResume"] as Qualification | undefined;
      const teacher = result.diagnostics?.["natlangTeacher"] as Teacher["teacher"] | undefined;
      return {
        passed: observed?.passed === true && (qualification || teacher?.trainingEligible === true),
        details: observed?.checks,
      };
    },
  })),
);
