import {
  approvalObservationRunNames,
  approvalObservationCaseId,
} from "@vibestudio/service-schemas/systemTestRunner";
import {
  approvalTransitionGoal,
  type ManagedApprovalTransitionReceiver,
} from "../approval-transition-managed.js";
import type { TestCase } from "../types.js";

type Teacher = Awaited<
  ReturnType<
    ManagedApprovalTransitionReceiver["runManagedApprovalTransitionTeacher"]
  >
>;
type Qualification = Awaited<
  ReturnType<
    ManagedApprovalTransitionReceiver["qualifyManagedApprovalTransition"]
  >
>;

const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/capabilities"],
  prompt: approvalTransitionGoal,
};

export const managedApprovalTransitionTests: TestCase[] = [
  {
    ...settings,
    name: approvalObservationRunNames[0],
    description:
      "Track the assigned live workspace approval through cancellation",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedApprovalTransition(false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang approval transition capture");
      const { teacher, verification, contextId } = run.result;
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
          managedApprovalTransition: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedApprovalTransition"] as
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
    name: approvalObservationRunNames[1],
    description:
      "Verify live approval observations and reject incorrect transitions without model calls",
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedApprovalTransition(true, signal);
      if (run.kind !== "reference")
        throw new Error("Approval transition qualification invoked a teacher");
      return {
        messages: [],
        duration: Date.now() - started,
        diagnostics: { approvalTransitionQualification: run.result },
      };
    },
    validate(result) {
      const qualification = result.diagnostics?.[
        "approvalTransitionQualification"
      ] as Qualification | undefined;
      return {
        passed:
          qualification?.caseId === approvalObservationCaseId &&
          qualification.passed,
        details: qualification?.checks,
      };
    },
  },
];
