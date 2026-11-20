import type { TestCase } from "../types.js";
import type { ManagedNewsReceiver } from "../news-contract.js";
import { managedNewsWorlds, newsPanel, newsWorker } from "../news-worlds.js";
import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";

type Teacher = Awaited<
  ReturnType<ManagedNewsReceiver["runManagedNewsTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedNewsReceiver["qualifyManagedNews"]>
>;
export const newsAuthority = panelControlAuthorityPolicy("inspect-owned-news-reader", [
    {
      ruleId: "news-missions",
      capability: { kind: "exact", key: "workspace-service:missions" },
      resource: { kind: "prefix", prefix: "do:workers/missions:MissionsDO:" },
      tier: "gated",
      decision: "task",
    },
    {
      ruleId: "edit-news-fixture-schedule",
      capability: {
        kind: "prefix",
        prefix: "userland:workers/missions/missions.edit#",
      },
      resource: {
        kind: "exact",
        key: "mission:do:workers/missions:MissionsDO:workspace-missions",
      },
      tier: "gated",
      decision: "once",
    },
    {
      ruleId: "retire-news-fixture-schedule",
      capability: {
        kind: "prefix",
        prefix: "userland:workers/missions/missions.retire#",
      },
      resource: {
        kind: "exact",
        key: "mission:do:workers/missions:MissionsDO:workspace-missions",
      },
      tier: "critical",
      decision: "once",
    },
  ]);
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: [
    newsPanel,
    newsWorker,
    "skills/news-workflows",
    "packages/news-live-evidence",
  ],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: newsAuthority,
};

const scratchUnits = [
  "skills/scratch-handoff",
  "skills/scratch-handoff-bindings",
];
export const managedNewsTests: TestCase[] = managedNewsWorlds.map((world) => ({
  ...settings,
  ...(world.handoff
    ? { requiresUnits: [...settings.requiresUnits, ...scratchUnits] }
    : {}),
  name: `news-live-${world.id}`,
  description: world.handoff
    ? "Review the installed News worker and stage a handoff from the verified schedule settings"
    : "Review the installed News worker and its actual schedule owners",
  prompt: world.goal,
  async orchestrate(context) {
    const started = Date.now();
    const run = await context.runner.runManagedNews(
      world.id,
      false,
      context.signal,
    );
    if (run.kind !== "teacher")
      throw new Error("Expected an authored News review");
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
        managedNews: { contextId, verification },
      },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as
      | (Teacher["teacher"] & { trainingEligible?: boolean })
      | undefined;
    const verification = (
      result.diagnostics?.["managedNews"] as
        | Omit<Teacher, "teacher">
        | undefined
    )?.verification;
    return teacher?.trainingEligible && verification?.passed
      ? { passed: true, details: verification.checks }
      : {
          passed: false,
          reason:
            "The findings must match persisted News state and the requested check order.",
          details: verification,
        };
  },
}));

function newsQualification(
  worlds: typeof managedNewsWorlds,
  handoff: boolean,
): TestCase {
  return {
    ...settings,
    ...(handoff
      ? { requiresUnits: [...settings.requiresUnits, ...scratchUnits] }
      : {}),
    name: handoff
      ? "news-managed-handoff-qualification"
      : "news-managed-oracle-qualification",
    description:
      "Qualify the installed News and Missions owners without a model",
    prompt:
      "Verify the actual reader and schedule fixtures, rejecting unrelated evidence.",
    async orchestrate(context) {
      const started = Date.now();
      const checks: Qualification[] = [];
      for (const world of worlds) {
        try {
          const run = await context.runner.runManagedNews(
            world.id,
            true,
            context.signal,
          );
          if (run.kind !== "reference")
            throw new Error("News qualification invoked a teacher");
          checks.push(run.result);
        } catch (cause) {
          throw new Error(`News qualification failed for ${world.id}`, {
            cause,
          });
        }
      }
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { newsQualification: checks },
      };
    },
    validate(result) {
      const checks = result.diagnostics?.["newsQualification"] as
        | Qualification[]
        | undefined;
      return checks?.length === worlds.length &&
        checks.every(
          ({ verification, rejectedDifferentEvidence }) =>
            verification.passed && rejectedDifferentEvidence,
        )
        ? {
            passed: true,
            details: { checkedCases: checks.length, modelCalls: 0 },
          }
        : {
            passed: false,
            reason:
              "The installed News or Missions evidence differed from the assignment.",
            details: { checks },
          };
    },
  };
}

managedNewsTests.push(
  newsQualification(
    managedNewsWorlds.filter(({ handoff }) => !handoff),
    false,
  ),
  newsQualification(
    managedNewsWorlds.filter(({ handoff }) => handoff),
    true,
  ),
);
