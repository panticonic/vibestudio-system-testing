import { isDeepStrictEqual } from "node:util";
import { contextId } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import {
  approvalObservationCaseId,
  systemTestApprovalObservationSchema,
  type PanelTeacherResult,
  type SystemTestApprovalObservation,
} from "@vibestudio/service-schemas/systemTestRunner";

export const approvalTransitionGoal =
  "Follow the assigned workspace review across both approval queue observations.";

type Input = { contextId: string; observation: SystemTestApprovalObservation };

export function prepareManagedApprovalTransition(input: Input) {
  if (input.contextId !== contextId)
    throw new Error("Approval observation was delivered to another context");

  const { workspaceId, caller, approvalId, earlier, later } =
    systemTestApprovalObservationSchema.parse(input.observation);
  const request = {
    goal: approvalTransitionGoal,
    caller,
    approvalId,
    earlier,
    later,
  };

  function visibility(receipts: typeof earlier) {
    const source = receipts.find((receipt) =>
      receipt.ids.includes(approvalId),
    )?.source;
    return {
      coverage: "complete",
      surfaces: receipts.map(({ source, ids }) => ({
        source,
        state: "visible",
        ids,
      })),
      location: source
        ? { status: "located", source }
        : { status: "absent", source: null },
    };
  }

  const earlierReport = visibility(earlier);
  const laterReport = visibility(later);
  const reference = {
    transition: "no-longer-listed",
    earlier: earlierReport,
    later: laterReport,
  };

  function verify(report: unknown) {
    const checks = {
      workspaceReviewWasPending: earlier[0].ids.includes(approvalId),
      hubDidNotListAssignedReview:
        !earlier[1].ids.includes(approvalId) &&
        !later[1].ids.includes(approvalId),
      workspaceReviewWasRemoved: !later[0].ids.includes(approvalId),
      report: isDeepStrictEqual(report, reference),
    };
    return {
      caseId: approvalObservationCaseId,
      contextId,
      workspaceId,
      request,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  return {
    request,
    verify,
    qualify() {
      const verification = verify(reference);
      const checks = {
        ...verification.checks,
        rejectsStaleQueue: !verify({ ...reference, later: earlierReport })
          .passed,
        rejectsWrongDisposition: !verify({
          ...reference,
          transition: "still-pending",
        }).passed,
        rejectsReversedObservations: !verify({
          ...reference,
          earlier: laterReport,
          later: earlierReport,
        }).passed,
      };
      return {
        ...verification,
        checks,
        passed: Object.values(checks).every(Boolean),
      };
    },
  };
}

type Prepared = ReturnType<typeof prepareManagedApprovalTransition>;
export interface ManagedApprovalTransitionReceiver {
  runManagedApprovalTransitionTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedApprovalTransition(
    input: Input,
  ): Promise<ReturnType<Prepared["qualify"]>>;
}

export const approvalTransitionMethods =
  createReceiverRpcMethods<ManagedApprovalTransitionReceiver>([
    "runManagedApprovalTransitionTeacher",
    "qualifyManagedApprovalTransition",
  ]);
