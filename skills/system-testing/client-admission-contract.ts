import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

type Input = { contextId: string; caseId: string };
type Verification = {
  passed: boolean;
  contextId: string;
  caseId: string;
  checks: {
    source: boolean;
    host: boolean;
    catalog: boolean;
    unchanged: boolean;
    report: boolean;
  };
};
export interface ManagedClientAdmissionReceiver {
  runManagedClientAdmissionTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedClientAdmission(input: Input): Promise<{
    verification: Verification;
    rejectedForeignScope: boolean;
    rejectedWrongDecision: boolean;
  }>;
}
export const managedClientAdmissionMethods =
  createReceiverRpcMethods<ManagedClientAdmissionReceiver>([
    "runManagedClientAdmissionTeacher",
    "qualifyManagedClientAdmission",
  ]);
