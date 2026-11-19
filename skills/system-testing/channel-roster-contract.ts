import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type ChannelRosterInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedChannelRosterReceiver {
  runManagedChannelRosterTeacher(
    input: ChannelRosterInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedChannelRoster(input: ChannelRosterInput): Promise<{
    verification: Verification;
    rejectsOtherChannel: boolean;
    rejectsWrongReceipt: boolean;
  }>;
}
export const managedChannelRosterMethods =
  createReceiverRpcMethods<ManagedChannelRosterReceiver>([
    "runManagedChannelRosterTeacher",
    "qualifyManagedChannelRoster",
  ]);
