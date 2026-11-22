import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type IncidentContinuationInput = {
  caseId: string;
  contextId: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedIncidentContinuationReceiver {
  runManagedIncidentContinuationTeacher(
    input: IncidentContinuationInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    log: { contextId: string; verification: Verification };
    models: { contextId: string; verification: Verification } | null;
    verification: Verification;
  }>;
  qualifyManagedIncidentContinuation(
    input: IncidentContinuationInput,
  ): Promise<{
    verification: Verification;
    rejectedForeignRef: boolean;
  }>;
}
export const managedIncidentContinuationMethods =
  createReceiverRpcMethods<ManagedIncidentContinuationReceiver>([
    "runManagedIncidentContinuationTeacher",
    "qualifyManagedIncidentContinuation",
  ]);
