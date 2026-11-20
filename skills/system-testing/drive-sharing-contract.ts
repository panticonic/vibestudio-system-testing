import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type DriveSharingInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedDriveSharingReceiver {
  runManagedDriveSharingTeacher(
    input: DriveSharingInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedDriveSharing(input: DriveSharingInput): Promise<{
    verification: Verification;
    earlyRejected: boolean;
  }>;
}
export const managedDriveSharingMethods =
  createReceiverRpcMethods<ManagedDriveSharingReceiver>([
    "runManagedDriveSharingTeacher",
    "qualifyManagedDriveSharing",
  ]);
