import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type LocalComparisonInput = {
  caseId: string;
  contextId: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedLocalComparisonReceiver {
  runManagedLocalComparisonTeacher(
    input: LocalComparisonInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedLocalComparison(input: LocalComparisonInput): Promise<{
    verification: Verification;
    rejectedDifferentModel: boolean;
  }>;
}
export const managedLocalComparisonMethods =
  createReceiverRpcMethods<ManagedLocalComparisonReceiver>([
    "runManagedLocalComparisonTeacher",
    "qualifyManagedLocalComparison",
  ]);
