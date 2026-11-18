import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedSetup,
  verifyManagedSetup,
} from "./onboarding-managed.js";

export type SetupInput = { contextId: string; caseId: string };
export interface ManagedSetupReceiver {
  runManagedSetupTeacher(
    input: SetupInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<typeof verifyManagedSetup>>;
  }>;
  qualifyManagedSetup(
    input: SetupInput,
  ): ReturnType<typeof qualifyManagedSetup>;
}
export const managedSetupMethods =
  createReceiverRpcMethods<ManagedSetupReceiver>([
    "runManagedSetupTeacher",
    "qualifyManagedSetup",
  ]);
