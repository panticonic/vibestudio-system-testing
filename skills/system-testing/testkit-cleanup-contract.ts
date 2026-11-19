import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { prepareTestkitCleanup } from "./testkit-cleanup-managed.js";

type Verification = ReturnType<
  Awaited<ReturnType<typeof prepareTestkitCleanup>>["verify"]
>;
export type TestkitCleanupInput = { contextId: string; caseId: string };
export interface ManagedTestkitCleanupReceiver {
  runManagedTestkitCleanupTeacher(
    input: TestkitCleanupInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedTestkitCleanup(input: TestkitCleanupInput): Promise<{
    verified: Verification;
    rejectedForeignReceipt: boolean;
  }>;
}

export const testkitCleanupMethods =
  createReceiverRpcMethods<ManagedTestkitCleanupReceiver>([
    "runManagedTestkitCleanupTeacher",
    "qualifyManagedTestkitCleanup",
  ]);
