import type { TestCase } from "../types.js";
import type { HeadlessRunner } from "../runner.js";
import { managedPresentationWorlds } from "../presentation-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Result = Awaited<ReturnType<HeadlessRunner["runManagedPresentation"]>>;
type Diagnostics = Omit<Result, "teacher">;

function makeCase(
  world: (typeof managedPresentationWorlds)[number],
  qualification: boolean,
): TestCase {
  return {
    name: `presentation-${qualification ? "qualification" : "live"}-${world.id}`,
    category: "project-lifecycle",
    description:
      "Verify grounded Natlang visualizations in Vibestudio's installed MDX renderer",
    prompt: world.request.goal,
    explicitOnly: true,
    validation: "harness",
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy(
      "inspect-presentation-preview",
    ),
    workspaceRepoFixture: {
      kind: "presentation-preview-panel",
      section: "panels",
      caseId: world.id,
    },
    async orchestrate(context) {
      const started = Date.now();
      const { teacher, ...verification } =
        await context.runner.runManagedPresentation(
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
          managedPresentation: verification,
        },
      };
    },
    validate(result) {
      const observation = result.diagnostics?.["managedPresentation"] as
        | Diagnostics
        | undefined;
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | { trainingEligible?: boolean }
        | undefined;
      return observation?.verification?.passed &&
        (qualification
          ? observation.rejectedAlteredMdx
          : teacher?.trainingEligible === true)
        ? { passed: true, details: observation.verification.checks }
        : {
            passed: false,
            reason:
              "Assigned facts, canonical MDX and actual browser rendering must agree",
            details: observation,
          };
    },
  };
}

export const managedPresentationTests = managedPresentationWorlds.flatMap(
  (world) => [makeCase(world, false), makeCase(world, true)],
);
