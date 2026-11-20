import type { TestCase } from "../types.js";
import type { ManagedWebBriefReceiver } from "../web-brief-managed.js";
import type { ManagedResearchHandoffReceiver } from "../research-handoff-managed.js";
import {
  managedResearchIntakeWorlds,
  managedResearchHandoffWorlds,
  managedWebBriefWorlds,
} from "../web-brief-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedWebBriefReceiver["runManagedWebBriefTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedWebBriefReceiver["qualifyManagedWebBrief"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/web-research"],
};
const intakeSettings = {
  ...settings,
  requiresUnits: ["skills/web-research", "skills/research-intake"],
};

export const managedWebBriefTests: TestCase[] = managedWebBriefWorlds.map(
  (world) => ({
    ...settings,
    name: `web-brief-live-${world.id}`,
    description: "Write an exact brief from assigned public webpages",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedWebBrief(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang web brief");
      const { contextId, teacher, verification } = run.result;
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId,
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
        },
        diagnostics: {
          natlangTeacher: teacher,
          managedWebBrief: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedWebBrief"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

managedWebBriefTests.push({
  ...settings,
  name: "web-brief-oracle-qualification",
  description:
    "Qualify live public fetch and cached evidence without model calls",
  prompt: "Check the assigned public URLs and exact cached evidence.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedWebBriefWorlds) {
      const run = await runner.runManagedWebBrief(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Web brief qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { webBriefQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["webBriefQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedWebBriefWorlds.length &&
        checks.every(
          ({ verification, rejectedUnassignedUrl, rejectedForeignDigest }) =>
            verification.passed &&
            rejectedUnassignedUrl &&
            rejectedForeignDigest,
        ),
      details: { checks },
    };
  },
});

type HandoffTeacher = Awaited<ReturnType<ManagedResearchHandoffReceiver["runManagedResearchHandoffTeacher"]>>;
type HandoffQualification = Awaited<ReturnType<ManagedResearchHandoffReceiver["qualifyManagedResearchHandoff"]>>;
managedWebBriefTests.push(...managedResearchHandoffWorlds.flatMap((world) =>
  [false, true].map((qualification): TestCase => ({
    ...intakeSettings,
    requiresUnits: [...intakeSettings.requiresUnits, "skills/scratch-handoff"],
    name: `research-handoff-${qualification ? "oracle" : "live"}-${world.id}`,
    description: "Transfer verified public research into an independently checked scratch handoff",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedResearchHandoff(world.id, qualification, signal);
      const diagnostics = run.kind === "reference"
        ? { researchHandoffQualification: run.result }
        : { natlangTeacher: run.result.teacher, managedResearchHandoff: run.result.verification };
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId: run.result.verification.contextId,
          channelId: null, branchId: null, agentEntityId: null, agentTargetId: null,
        },
        diagnostics,
      };
    },
    validate(result) {
      if (qualification) {
        const proof = result.diagnostics?.["researchHandoffQualification"] as HandoffQualification | undefined;
        return {
          passed: proof?.verification.passed === true && proof.earlyReadDenied && proof.earlyWriteDenied,
          details: proof?.verification.checks,
        };
      }
      const proof = result.diagnostics?.["managedResearchHandoff"] as HandoffTeacher["verification"] | undefined;
      const teacher = result.diagnostics?.["natlangTeacher"] as HandoffTeacher["teacher"] | undefined;
      return { passed: teacher?.trainingEligible === true && proof?.passed === true, details: proof?.checks };
    },
  }))
));

type IntakeTeacher = Awaited<
  ReturnType<ManagedWebBriefReceiver["runManagedResearchIntakeTeacher"]>
>;
type IntakeCheck = Awaited<
  ReturnType<ManagedWebBriefReceiver["qualifyManagedResearchIntake"]>
>;
managedWebBriefTests.push(
  ...managedResearchIntakeWorlds.map(
    (world): TestCase => ({
      ...intakeSettings,
      name: `research-intake-live-${world.id}`,
      description:
        "Review acquired public research evidence from verified cache receipts",
      prompt: world.goal,
      async orchestrate({ runner, signal }) {
        const started = Date.now();
        const run = await runner.runManagedResearchIntake(
          world.id,
          false,
          signal,
        );
        if (run.kind !== "teacher")
          throw new Error("Expected a live research intake capture");
        const { contextId, teacher, verification } = run.result;
        return {
          messages: [],
          duration: Date.now() - started,
          provenance: {
            contextId,
            channelId: null,
            branchId: null,
            agentEntityId: null,
            agentTargetId: null,
          },
          diagnostics: {
            natlangTeacher: teacher,
            managedResearchIntake: verification,
          },
        };
      },
      validate(result) {
        const capture = result.diagnostics?.["natlangTeacher"] as
          | IntakeTeacher["teacher"]
          | undefined;
        const verification = result.diagnostics?.["managedResearchIntake"] as
          | IntakeTeacher["verification"]
          | undefined;
        return {
          passed:
            capture?.trainingEligible === true && verification?.passed === true,
          details: verification?.checks,
        };
      },
    }),
  ),
);
managedWebBriefTests.push({
  ...intakeSettings,
  name: "research-intake-oracle-qualification",
  description:
    "Qualify assigned live research receipts and scoped cache reads with no model",
  prompt: "Check the live source receipts before research interpretation.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: IntakeCheck[] = [];
    for (const { id } of managedResearchIntakeWorlds) {
      const run = await runner.runManagedResearchIntake(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Research intake qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { researchIntakeQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["researchIntakeQualification"] as
      | IntakeCheck[]
      | undefined;
    return {
      passed:
        checks?.length === managedResearchIntakeWorlds.length &&
        checks.every(
          ({ verification, rejectedWrongOperation }) =>
            verification.passed && rejectedWrongOperation,
        ),
      details: { cases: checks?.map(({ verification }) => verification.checks) },
    };
  },
});
