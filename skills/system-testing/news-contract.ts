import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
export type NewsInput = {
  contextId: string;
  caseId: string;
  channelId: string;
  channelTargetId: string;
  participantId: string;
  agentKey: string;
};
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedNewsReceiver {
  runManagedNewsTeacher(input: NewsInput & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedNews(input: NewsInput): Promise<{
    verification: Verification;
    rejectedDifferentEvidence: boolean;
  }>;
  retireManagedNews(input: NewsInput): Promise<boolean>;
}
export const managedNewsMethods = createReceiverRpcMethods<ManagedNewsReceiver>(
  ["runManagedNewsTeacher", "qualifyManagedNews", "retireManagedNews"],
);
