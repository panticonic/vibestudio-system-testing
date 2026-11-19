import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type BrowserLibraryInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedBrowserLibraryReceiver {
  runManagedBrowserLibraryTeacher(
    input: BrowserLibraryInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedBrowserLibrary(input: BrowserLibraryInput): Promise<{
    verification: Verification;
    rejectsOutside: boolean;
    rejectsWrongReceipt: boolean;
  }>;
}
export const managedBrowserLibraryMethods =
  createReceiverRpcMethods<ManagedBrowserLibraryReceiver>([
    "runManagedBrowserLibraryTeacher",
    "qualifyManagedBrowserLibrary",
  ]);
