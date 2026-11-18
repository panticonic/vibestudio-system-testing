import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedChecklist,
  verifyManagedChecklist,
} from "./checklist-managed.js";

export type ChecklistInput = { contextId: string; caseId: string };
export interface ManagedChecklistReceiver {
  runManagedChecklistTeacher(
    input: ChecklistInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<typeof verifyManagedChecklist>>;
  }>;
  qualifyManagedChecklist(
    input: ChecklistInput,
  ): ReturnType<typeof qualifyManagedChecklist>;
}
export const managedChecklistMethods =
  createReceiverRpcMethods<ManagedChecklistReceiver>([
    "runManagedChecklistTeacher",
    "qualifyManagedChecklist",
  ]);
