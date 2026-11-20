import type { TestCase } from "../types.js";
import type { ManagedGoogleSetupReceiver } from "../google-setup-contract.js";
import {
  managedGoogleSetupWorlds,
  googleSetupPanel,
} from "../google-setup-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Teacher = Awaited<
  ReturnType<ManagedGoogleSetupReceiver["runManagedGoogleSetupTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedGoogleSetupReceiver["qualifyManagedGoogleSetup"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [googleSetupPanel, "skills/google-drive"],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy("observe-google-setup", [
    {
      ruleId: "reload-owned-welcome-panel",
      capability: { kind: "exact", key: "runtime.supervision.manage" },
      resource: { kind: "prefix", prefix: "restart:panel:panel:" },
      tier: "gated",
      decision: "once",
    },
  ]),
};
const composeUnits = [
  "skills/gmail-workflow-review",
  "skills/gmail-compose-history-bindings",
];

export const managedGoogleSetupTests: TestCase[] = managedGoogleSetupWorlds.map(
  (world) => ({
    ...settings,
    ...(world.compose
      ? { requiresUnits: [...settings.requiresUnits, ...composeUnits] }
      : {}),
    name: `google-setup-live-${world.id}`,
    description: world.compose
      ? "Use the real Gmail launch control and stored compose history to plan continuation"
      : "Review the actual Google setup state and welcome panel",
    prompt: world.goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedGoogleSetup(
        world.id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored Google setup review");
      const { contextId, teacher, verification } = run.result;
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId,
          channelId: verification.compose?.seed.channelId ?? null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
        },
        diagnostics: {
          natlangTeacher: teacher,
          managedGoogleSetup: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | (Teacher["teacher"] & { trainingEligible?: boolean })
        | undefined;
      const verification = (
        result.diagnostics?.["managedGoogleSetup"] as
          | Omit<Teacher, "teacher">
          | undefined
      )?.verification;
      return teacher?.trainingEligible && verification?.passed
        ? { passed: true, details: verification.checks }
        : {
            passed: false,
            reason:
              "The report must match the actual account state, panel receipts, and requested check order.",
            details: verification,
          };
    },
  }),
);

function googleQualification(
  worlds: typeof managedGoogleSetupWorlds,
  compose: boolean,
): TestCase {
  return {
    ...settings,
    ...(compose
      ? { requiresUnits: [...settings.requiresUnits, ...composeUnits] }
      : {}),
    name: compose
      ? "google-setup-managed-compose-qualification"
      : "google-setup-managed-oracle-qualification",
    description:
      "Qualify the actual Google setup panel and account readiness without a model",
    prompt:
      "Verify ordered setup and browser checks and reject a different panel receipt.",
    async orchestrate(context) {
      const started = Date.now();
      const checks: Qualification[] = [];
      for (const world of worlds) {
        try {
          const run = await context.runner.runManagedGoogleSetup(
            world.id,
            true,
            context.signal,
          );
          if (run.kind !== "reference")
            throw new Error("Google setup qualification invoked a teacher");
          checks.push(run.result);
        } catch (cause) {
          throw new Error(`Google setup qualification failed for ${world.id}`, {
            cause,
          });
        }
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { googleSetupQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["googleSetupQualification"] as
        | Qualification[]
        | undefined;
      return checks?.length === worlds.length &&
        checks.every(
          ({ verification, rejectedDifferentReceipt }) =>
            verification.passed && rejectedDifferentReceipt,
        )
        ? {
            passed: true,
            details: { checkedCases: checks.length, modelCalls: 0 },
          }
        : {
            passed: false,
            reason:
              "The installed panel readback or evidence binding differed from the task.",
            details: { checks },
          };
    },
  };
}
managedGoogleSetupTests.push(
  googleQualification(
    managedGoogleSetupWorlds.filter(({ compose }) => !compose),
    false,
  ),
  googleQualification(
    managedGoogleSetupWorlds.filter(({ compose }) => compose),
    true,
  ),
);
