import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type GoogleSetupInput = {
  caseId: string;
  contextId: string;
  panelId: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedGoogleSetupReceiver {
  runManagedGoogleSetupTeacher(
    input: GoogleSetupInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedGoogleSetup(input: GoogleSetupInput): Promise<{
    verification: Verification;
    rejectedDifferentReceipt: boolean;
  }>;
}
export const managedGoogleSetupMethods =
  createReceiverRpcMethods<ManagedGoogleSetupReceiver>([
    "runManagedGoogleSetupTeacher",
    "qualifyManagedGoogleSetup",
  ]);
