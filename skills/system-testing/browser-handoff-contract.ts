import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type BrowserHandoffInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedBrowserHandoffReceiver {
  runManagedBrowserHandoffTeacher(
    input: BrowserHandoffInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedBrowserHandoff(input: BrowserHandoffInput): Promise<{
    verification: Verification;
    rejectsEarly: boolean;
    rejectsWrongOrder: boolean;
  }>;
}
export const managedBrowserHandoffMethods =
  createReceiverRpcMethods<ManagedBrowserHandoffReceiver>([
    "runManagedBrowserHandoffTeacher",
    "qualifyManagedBrowserHandoff",
  ]);
