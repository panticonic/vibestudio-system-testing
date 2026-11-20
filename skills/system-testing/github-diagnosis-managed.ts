import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

type Input = { contextId: string; caseId: string };
type Verification = { caseId: string; checks: Record<string, boolean>; passed: boolean };

export interface ManagedGitHubDiagnosisReceiver {
  runManagedGitHubDiagnosisTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedGitHubDiagnosis(input: Input): Promise<Verification>;
}
export const managedGitHubDiagnosisMethods = createReceiverRpcMethods<ManagedGitHubDiagnosisReceiver>([
  "runManagedGitHubDiagnosisTeacher",
  "qualifyManagedGitHubDiagnosis",
]);
