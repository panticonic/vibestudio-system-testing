import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type SpectroliteInput = {
  caseId: string;
  contextId: string;
  panelId: string;
  navigation: { from: string; target: string; to: string }[];
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedSpectroliteReceiver {
  runManagedSpectroliteTeacher(
    input: SpectroliteInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedSpectrolite(input: SpectroliteInput): Promise<{
    verification: Verification;
    rejectedDifferentRevision: boolean;
  }>;
}
export const managedSpectroliteMethods =
  createReceiverRpcMethods<ManagedSpectroliteReceiver>([
    "runManagedSpectroliteTeacher",
    "qualifyManagedSpectrolite",
  ]);
