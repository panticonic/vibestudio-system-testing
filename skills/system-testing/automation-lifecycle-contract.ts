import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedAutomation,
  verifyManagedAutomation,
} from "./automation-lifecycle-managed.js";

export interface ManagedAutomationReceiver {
  runManagedAutomationTeacher(input: {
    caseId: string;
    contextId: string;
    executorModel: string;
  }): Promise<{
    teacher: PanelTeacherResult;
    contextId: string;
    verification: Awaited<ReturnType<typeof verifyManagedAutomation>>;
  }>;
  qualifyManagedAutomation(input: {
    caseId: string;
    contextId: string;
  }): ReturnType<typeof qualifyManagedAutomation>;
}
export const managedAutomationMethods =
  createReceiverRpcMethods<ManagedAutomationReceiver>([
    "runManagedAutomationTeacher",
    "qualifyManagedAutomation",
  ]);
