import { browserLibrarySettings } from "./browser-library-managed.js";
import {
  panelControlAuthorityPolicy,
  PANEL_AUTOMATION_RESOURCE,
} from "../panel-authority.js";
import type { TestCase } from "../types.js";
import type { ManagedBrowserHandoffReceiver } from "../browser-handoff-contract.js";
import { managedBrowserHandoffWorlds } from "../browser-handoff-worlds.js";

type Exercise = Awaited<
  ReturnType<ManagedBrowserHandoffReceiver["runManagedBrowserHandoffTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedBrowserHandoffReceiver["qualifyManagedBrowserHandoff"]>
>;
const settings = {
  ...browserLibrarySettings,
  requiresUnits: [
    ...browserLibrarySettings.requiresUnits,
    "about/collection",
    "skills/browser-handoff-runtime",
  ],
  resources: [PANEL_AUTOMATION_RESOURCE],
  authorityPolicy: panelControlAuthorityPolicy(
    "inspect-browser-handoff-collection",
    browserLibrarySettings.authorityPolicy.authority,
  ),
};

export const managedBrowserHandoffTests: TestCase[] =
  managedBrowserHandoffWorlds.map(({ id, goal }) => ({
    ...settings,
    name: `browser-handoff-live-${id}`,
    description:
      "Curate a browser reference and leave its verified URL in the assigned panel",
    prompt: goal,
    async orchestrate(context) {
      const started = Date.now();
      const run = await context.runner.runManagedBrowserHandoff(
        id,
        false,
        context.signal,
      );
      if (run.kind !== "teacher")
        throw new Error("Expected an authored browser-library workflow");
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
          managedBrowserHandoff: { contextId, verification },
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Exercise["teacher"]
        | undefined;
      const exercise = result.diagnostics?.["managedBrowserHandoff"] as
        | Omit<Exercise, "teacher">
        | undefined;
      return teacher?.trainingEligible === true &&
        exercise?.verification.passed === true
        ? { passed: true, details: exercise.verification.checks }
        : {
            passed: false,
            reason:
              "The report must prove the browser-to-collection dependency and exact live effects.",
            details: exercise?.verification,
          };
    },
  }));

managedBrowserHandoffTests.push({
  ...settings,
  name: "browser-handoff-managed-oracle-qualification",
  timeoutMs: 15 * 60_000,
  description:
    "Qualify the live browser-to-collection dependency without a model",
  prompt:
    "Require verified persisted browser state before writing a panel handoff.",
  async orchestrate(context) {
    const started = Date.now();
    const rows: Qualification[] = [];
    for (const { id } of managedBrowserHandoffWorlds) {
      try {
        const run = await context.runner.runManagedBrowserHandoff(
          id,
          true,
          context.signal,
        );
        if (run.kind !== "reference")
          throw new Error("Qualification invoked a teacher");
        rows.push(run.result);
      } catch (cause) {
        throw new Error(`Browser handoff qualification failed for ${id}`, {
          cause,
        });
      }
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { browserHandoffQualification: rows },
    };
  },
  validate(result) {
    const rows = result.diagnostics?.["browserHandoffQualification"] as
      | Qualification[]
      | undefined;
    return rows?.length === managedBrowserHandoffWorlds.length &&
      rows.every(
        ({ verification, rejectsEarly, rejectsWrongOrder }) =>
          verification.passed && rejectsEarly && rejectsWrongOrder,
      )
      ? { passed: true, details: { checkedCases: rows.length, modelCalls: 0 } }
      : {
          passed: false,
          reason:
            "The handoff did not prove the required order and live state.",
          details: { rows },
        };
  },
});
