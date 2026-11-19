import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { prepareReleaseReviewHandoff } from "./release-review-handoff-managed.js";

type Prepared = Awaited<ReturnType<typeof prepareReleaseReviewHandoff>>;
type Input = { contextId: string; caseId: string };
export interface ManagedReleaseReviewHandoffReceiver {
  runManagedReleaseReviewHandoffTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedReleaseReviewHandoff(
    input: Input,
  ): ReturnType<Prepared["qualify"]>;
}
export const managedReleaseReviewHandoffMethods =
  createReceiverRpcMethods<ManagedReleaseReviewHandoffReceiver>([
    "runManagedReleaseReviewHandoffTeacher",
    "qualifyManagedReleaseReviewHandoff",
  ]);
