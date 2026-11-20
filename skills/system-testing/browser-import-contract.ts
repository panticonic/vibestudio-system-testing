import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type BrowserImportInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedBrowserImportReceiver {
  runManagedBrowserImportTeacher(
    input: BrowserImportInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedBrowserImport(input: BrowserImportInput): Promise<{
    verification: Verification;
    rejectedExtraRead: boolean;
  }>;
}
export const managedBrowserImportMethods =
  createReceiverRpcMethods<ManagedBrowserImportReceiver>([
    "runManagedBrowserImportTeacher",
    "qualifyManagedBrowserImport",
  ]);
