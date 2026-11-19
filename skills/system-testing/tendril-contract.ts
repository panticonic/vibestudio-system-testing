import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type TendrilInput = {
  contextId: string;
  caseId: string;
  channelId: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedTendrilReceiver {
  runManagedTendrilTeacher(
    input: TendrilInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedTendril(input: TendrilInput): Promise<{
    verification: Verification;
    rejectsOtherSlot: boolean;
  }>;
}
export const managedTendrilMethods =
  createReceiverRpcMethods<ManagedTendrilReceiver>([
    "runManagedTendrilTeacher",
    "qualifyManagedTendril",
  ]);
