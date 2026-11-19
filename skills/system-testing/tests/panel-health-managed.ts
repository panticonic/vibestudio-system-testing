import type { TestCase } from "../types.js";
import type { HeadlessRunner } from "../runner.js";
import { managedPanelHealthWorlds } from "../panel-health-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Result = Awaited<ReturnType<HeadlessRunner["runManagedPanelHealth"]>>;
type Diagnostics = Omit<Result, "teacher">;

function makeCase(
  world: (typeof managedPanelHealthWorlds)[number],
  qualification: boolean,
): TestCase {
  return {
    name: `panel-health-${qualification ? "qualification" : "live"}-${world.id}`,
    category: "project-lifecycle",
    description: "Verify live panel DOM, console chronology and recovery",
    prompt: world.goal,
    explicitOnly: true,
    validation: "harness",
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy(
      "inspect-panel-health-preview",
    ),
    workspaceRepoFixture: {
      kind: "panel-health-preview",
      section: "panels",
      caseId: world.id,
    },
    async orchestrate(context) {
      const started = Date.now();
      const { teacher, ...verification } =
        await context.runner.runManagedPanelHealth(
          qualification,
          context.signal,
        );
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId: verification.contextId,
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
        },
        diagnostics: {
          ...(teacher ? { natlangTeacher: teacher } : {}),
          managedPanelHealth: verification,
        },
      };
    },
    validate(result) {
      const observation = result.diagnostics?.["managedPanelHealth"] as
        | Diagnostics
        | undefined;
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | { trainingEligible?: boolean }
        | undefined;
      return observation?.verification?.passed &&
        (qualification
          ? observation.rejectsForeignObservation &&
            observation.rejectsWrongReceipt
          : teacher?.trainingEligible === true)
        ? { passed: true, details: observation.verification.checks }
        : {
            passed: false,
            reason:
              "The exact DOM, retained diagnostics and recovery evidence must agree",
            details: observation,
          };
    },
  };
}

export const managedPanelHealthTests = managedPanelHealthWorlds.flatMap(
  (world) => [makeCase(world, false), makeCase(world, true)],
);
