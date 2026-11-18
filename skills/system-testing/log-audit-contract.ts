import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type LogAuditInput = {
  caseId: string;
  contextId: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedLogAuditReceiver {
  runManagedLogAuditTeacher(
    input: LogAuditInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedLogAudit(input: LogAuditInput): Promise<{
    verification: Verification;
    rejectedDifferentWindow: boolean;
  }>;
}
export const managedLogAuditMethods =
  createReceiverRpcMethods<ManagedLogAuditReceiver>([
    "runManagedLogAuditTeacher",
    "qualifyManagedLogAudit",
  ]);
