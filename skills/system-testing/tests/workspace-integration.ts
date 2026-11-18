import type { TestCase } from "../types.js";
import { workspaceIntegrationWorlds } from "../vcs-integration-worlds.js";

/** Actual authored roots and independent VCS-state verification; no ordinary-agent transcript adapter. */
export const workspaceIntegrationTests: TestCase[] =
  workspaceIntegrationWorlds.map((world) => ({
    name: `workspace-integration-${world.id}`,
    category: "vcs-integration",
    explicitOnly: true,
    validation: "harness",
    description:
      "Reconcile assigned local and incoming changes in real workspace settings without publication",
    prompt: world.goal,
    async orchestrate(context) {
      context.signal.throwIfAborted();
      const started = Date.now();
      const observed = await context.runner.runWorkspaceIntegrationTeacher(
        `native-${world.id}`,
        world.goal,
        world.id,
      );
      context.signal.throwIfAborted();
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
          contextId: observed.world.contextId,
        },
        diagnostics: {
          natlangTeacher: observed.result,
          workspaceIntegrationWorld: observed.world,
          workspaceIntegrationVerification: observed.verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | {
            report?: { status?: string };
            executionError?: unknown;
            captureErrors?: string[];
            trainingEligible?: boolean;
            calls?: Array<{ record?: { definition?: { name?: string } } }>;
          }
        | undefined;
      const verification = result.diagnostics?.[
        "workspaceIntegrationVerification"
      ] as { passed?: boolean; reasons?: string[] } | undefined;
      const names = new Set(
        teacher?.calls
          ?.map((call) => call.record?.definition?.name)
          .filter((name): name is string => typeof name === "string"),
      );
      const nested = [
        "integrateWorkspace",
        "compareIntents",
        "explainCompatibility",
        "planResolution",
        "verifyIntegration",
      ].every((name) => names.has(name));
      return teacher?.report?.status === "integrated" &&
        teacher.trainingEligible === true &&
        !teacher.executionError &&
        !teacher.captureErrors?.length &&
        nested &&
        verification?.passed
        ? {
            passed: true,
            details: {
              authoredNestedStages: [...names],
              independentVcsState: true,
            },
          }
        : {
            passed: false,
            reason:
              "Authored nested workflow and independent VCS-state/history checks must both pass",
            details: {
              authoredNestedStages: [...names],
              reasons: verification?.reasons,
            },
          };
    },
  }));

workspaceIntegrationTests.push(
  ...[undefined, "three-stage-review"].map(
    (worldId): TestCase => ({
      name: worldId
        ? "workspace-integration-multi-file-oracle-qualification"
        : "workspace-integration-oracle-qualification",
      category: "vcs-integration",
      explicitOnly: true,
      validation: "harness",
      description:
        "Qualify actual VCS-state oracle with reference, negative and alias candidates without model calls",
      prompt:
        "Establish that the independent settings integration checks accept a complete result, reject a result that drops the incoming change, and remain correct under different identities and values. Keep all work isolated and leave protected main unchanged.",
      async orchestrate(context) {
        context.signal.throwIfAborted();
        const started = Date.now();
        const checks =
          await context.runner.runWorkspaceIntegrationQualification(
            "oracle-qualification",
            worldId,
          );
        context.signal.throwIfAborted();
        return {
          messages: [],
          duration: Date.now() - started,
          diagnostics: { workspaceIntegrationOracleQualification: checks },
        };
      },
      validate(result) {
        const checks = result.diagnostics?.[
          "workspaceIntegrationOracleQualification"
        ] as
          | Array<{ variant: string; verdict: { passed: boolean } }>
          | undefined;
        const byName = new Map(
          checks?.map((item) => [item.variant, item.verdict.passed]),
        );
        return checks?.length === 3 &&
          byName.get("reference") === true &&
          byName.get("negative") === false &&
          byName.get("alias") === true
          ? {
              passed: true,
              details: {
                reference: true,
                negativeRejected: true,
                alias: true,
                modelCalls: 0,
              },
            }
          : {
              passed: false,
              reason:
                "Actual VCS oracle reference/negative/alias qualification did not pass",
            };
      },
    }),
  ),
);
