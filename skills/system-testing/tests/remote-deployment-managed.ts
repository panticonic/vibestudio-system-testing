import type { TestCase } from "../types.js";
import type { ManagedDeploymentReceiver } from "../remote-deployment-managed.js";
import { managedDeploymentWorlds } from "../remote-deployment-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedDeploymentReceiver["runManagedDeploymentTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedDeploymentReceiver["qualifyManagedDeployment"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/remote-access"],
  timeoutMs: 6 * 60_000,
};

export const managedDeploymentTests: TestCase[] =
  managedDeploymentWorlds.flatMap((world): TestCase[] => [
    {
      ...settings,
      prompt: world.goal,
      name: `remote-deployment-live-${world.id}`,
      description:
        "Verify the assigned VibeStudio deployment on an owned profile",
      async orchestrate({ runner, signal }) {
        const started = Date.now();
        const run = await runner.runManagedDeployment(world.id, false, signal);
        if (run.kind !== "teacher")
          throw new Error("Expected a managed deployment capture");
        const { contextId, teacher, verification } = run.value;
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
            remoteDeploymentManaged: verification,
          },
        };
      },
      validate(result) {
        const teacher = result.diagnostics?.["natlangTeacher"] as
          | Teacher["teacher"]
          | undefined;
        const verification = result.diagnostics?.["remoteDeploymentManaged"] as
          | Teacher["verification"]
          | undefined;
        return {
          passed: Boolean(teacher?.trainingEligible && verification?.passed),
          details: verification?.checks,
        };
      },
    },
    {
      ...settings,
      prompt: world.goal,
      name: `remote-deployment-oracle-qualification-${world.id}`,
      description:
        "Qualify the assigned native deployment and its receipts without model calls",
      async orchestrate({ runner, signal }) {
        const started = Date.now();
        const run = await runner.runManagedDeployment(world.id, true, signal);
        if (run.kind !== "reference")
          throw new Error("Qualification invoked a deployment teacher");
        return {
          messages: [],
          duration: Date.now() - started,
          diagnostics: { remoteDeploymentQualification: run.value },
        };
      },
      validate(result) {
        const observation = result.diagnostics?.[
          "remoteDeploymentQualification"
        ] as Qualification | undefined;
        return {
          passed: observation?.caseId === world.id && observation.passed,
          details: observation?.checks,
        };
      },
    },
  ]);
