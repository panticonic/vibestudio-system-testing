import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type AndroidAuditInput = { contextId: string; caseId: string };
type Verification = { caseId: string; checks: Record<string, boolean>; passed: boolean };

export interface AndroidAuditReceiver {
  runAndroidAuditTeacher(input: AndroidAuditInput & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyAndroidAudit(input: AndroidAuditInput): Promise<Verification>;
}
export const androidAuditMethods = createReceiverRpcMethods<AndroidAuditReceiver>([
  "runAndroidAuditTeacher",
  "qualifyAndroidAudit",
]);
