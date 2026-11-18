import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type ProvenanceHistoryInput = {
  caseId: string;
  contextId: string;
  repoPath: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedProvenanceHistoryReceiver {
  runManagedProvenanceHistoryTeacher(
    input: ProvenanceHistoryInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedProvenanceHistory(input: ProvenanceHistoryInput): Promise<{
    verification: Verification;
    rejectedWrongCoordinate: boolean;
  }>;
}
export const managedProvenanceHistoryMethods =
  createReceiverRpcMethods<ManagedProvenanceHistoryReceiver>([
    "runManagedProvenanceHistoryTeacher",
    "qualifyManagedProvenanceHistory",
  ]);
