import type { TestCase } from "../types.js";
import type { ManagedPublicationReceiver } from "../publication-preflight-contract.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";
import { managedPublicationWorlds } from "../publication-preflight-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedPublicationReceiver["runManagedPublicationTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedPublicationReceiver["qualifyManagedPublication"]>
>;

function makeCase(
  world: (typeof managedPublicationWorlds)[number],
  qualification: boolean,
): TestCase {
  return {
    name: `publication-preflight-${qualification ? "qualification" : "live"}-${world.id}`,
    category: "project-lifecycle",
    description:
      "Review a real portable package and the exact live panel for a publication decision",
    prompt: world.goal,
    explicitOnly: true,
    validation: "harness",
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy(
      "inspect-publication-review-panel",
      world.journalPhase ? [{
        ruleId: "seed-disposable-publication-journal",
        capability: { kind: "exact", key: "website.publish" },
        resource: { kind: "prefix", prefix: "managed-publication-" },
        tier: "critical",
        decision: "once",
      }] : [],
    ),
    workspaceRepoFixture: {
      kind: "publication-preflight-panel",
      section: "panels",
      caseId: world.id,
    },
    async orchestrate(context) {
      context.signal.throwIfAborted();
      const started = Date.now();
      const observed = await context.runner.runManagedPublication(
        world.goal,
        qualification,
      );
      context.signal.throwIfAborted();
      if (observed.kind === "reference")
        return {
          messages: [],
          duration: Date.now() - started,
          diagnostics: { publicationQualification: observed.result },
        };
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
          contextId: observed.result.contextId,
        },
        diagnostics: {
          natlangTeacher: observed.result.teacher,
          managedPublication: {
            contextId: observed.result.contextId,
            verification: observed.result.verification,
          },
        },
      };
    },
    validate(result) {
      if (qualification) {
        const value = result.diagnostics?.["publicationQualification"] as
          | Qualification
          | undefined;
        return value?.accepted.passed && value.rejectedUnpublishedClaim
          ? {
              passed: true,
              details: {
                ...value.accepted.checks,
                rejectedUnpublishedClaim: true,
                modelCalls: 0,
              },
            }
          : {
              passed: false,
              reason:
                "Local artifact and live panel verification did not match",
              details: value?.accepted.checks,
            };
      }
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const value = result.diagnostics?.["managedPublication"] as
        | Omit<Teacher, "teacher">
        | undefined;
      return teacher?.trainingEligible === true && value?.verification.passed
        ? { passed: true, details: value.verification.checks }
        : {
            passed: false,
            reason:
              "Authored workflow and independent package and panel observation must both pass",
            details: value?.verification.checks,
          };
    },
  };
}
export const managedPublicationTests: TestCase[] = [
  ...managedPublicationWorlds.map((world) => makeCase(world, false)),
  ...managedPublicationWorlds.map((world) => makeCase(world, true)),
];
