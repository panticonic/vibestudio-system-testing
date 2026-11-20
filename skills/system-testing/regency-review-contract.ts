import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type RegencyReviewInput = {
  contextId: string;
  caseId: string;
  realm: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedRegencyReceiver {
  runManagedRegencyTeacher(
    input: RegencyReviewInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedRegency(input: RegencyReviewInput): Promise<{
    verification: Verification;
    wrongHorizonDenied: boolean;
    rejectedAlteredEvidence: boolean;
  }>;
}
export const managedRegencyMethods =
  createReceiverRpcMethods<ManagedRegencyReceiver>([
    "runManagedRegencyTeacher",
    "qualifyManagedRegency",
  ]);
