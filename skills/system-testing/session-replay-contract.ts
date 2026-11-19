import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { ReplayCheckpoint } from "../session-test-review/types.js";
import type { bindSessionReplay } from "./session-replay-managed.js";

export type SessionReplayInput = {
  contextId: string;
  caseId: string;
  evidence: ReplayCheckpoint[];
};
export interface ManagedSessionReplayReceiver {
  runManagedSessionReplayTeacher(
    input: SessionReplayInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<ReturnType<typeof bindSessionReplay>["verify"]>;
  }>;
  qualifyManagedSessionReplay(input: SessionReplayInput): Promise<{
    verified: ReturnType<ReturnType<typeof bindSessionReplay>["verify"]>;
    rejectedForeignReceipt: boolean;
  }>;
}

export const sessionReplayMethods =
  createReceiverRpcMethods<ManagedSessionReplayReceiver>([
    "runManagedSessionReplayTeacher",
    "qualifyManagedSessionReplay",
  ]);
