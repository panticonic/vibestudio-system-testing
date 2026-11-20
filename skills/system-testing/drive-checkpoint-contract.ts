import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type DriveCheckpointInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedDriveCheckpointReceiver {
  runManagedDriveCheckpointTeacher(
    input: DriveCheckpointInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedDriveCheckpoint(input: DriveCheckpointInput): Promise<{
    verification: Verification;
    earlyRejected: boolean;
  }>;
}
export const managedDriveCheckpointMethods =
  createReceiverRpcMethods<ManagedDriveCheckpointReceiver>([
    "runManagedDriveCheckpointTeacher",
    "qualifyManagedDriveCheckpoint",
  ]);
