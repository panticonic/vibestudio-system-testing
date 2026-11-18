import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type RuntimeProgramInput = {
  caseId: string;
  contextId: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedRuntimeProgramReceiver {
  runManagedRuntimeProgramTeacher(
    input: RuntimeProgramInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedRuntimeProgram(input: RuntimeProgramInput): Promise<{
    verification: Verification;
    rejectedWrongReceipt: boolean;
  }>;
}
export const managedRuntimeProgramMethods =
  createReceiverRpcMethods<ManagedRuntimeProgramReceiver>([
    "runManagedRuntimeProgramTeacher",
    "qualifyManagedRuntimeProgram",
  ]);
