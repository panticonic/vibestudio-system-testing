import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedAuthoring,
  verifyManagedAuthoring,
} from "./authoring-managed.js";

export type AuthoringInput = { contextId: string; caseId: string };

export interface ManagedAuthoringReceiver {
  runManagedAuthoringTeacher(
    input: AuthoringInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<typeof verifyManagedAuthoring>>;
  }>;
  qualifyManagedAuthoring(
    input: AuthoringInput,
  ): ReturnType<typeof qualifyManagedAuthoring>;
}

export const managedAuthoringMethods =
  createReceiverRpcMethods<ManagedAuthoringReceiver>([
    "runManagedAuthoringTeacher",
    "qualifyManagedAuthoring",
  ]);
