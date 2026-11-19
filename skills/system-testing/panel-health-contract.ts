import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type PanelHealthInput = {
  contextId: string;
  caseId: string;
  panelId: string;
  source: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedPanelHealthReceiver {
  runManagedPanelHealthTeacher(
    input: PanelHealthInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedPanelHealth(input: PanelHealthInput): Promise<{
    verification: Verification;
    rejectsForeignObservation: boolean;
    rejectsWrongReceipt: boolean;
  }>;
}
export const managedPanelHealthMethods =
  createReceiverRpcMethods<ManagedPanelHealthReceiver>([
    "runManagedPanelHealthTeacher",
    "qualifyManagedPanelHealth",
  ]);
