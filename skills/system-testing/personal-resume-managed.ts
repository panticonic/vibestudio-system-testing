import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

type Input = { contextId: string; caseId: string };
type Verification = { caseId: string; checks: Record<string, boolean>; passed: boolean };

export interface PersonalResumeReceiver {
  runPersonalResumeTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyPersonalResume(input: Input): Promise<Verification>;
}
export const personalResumeMethods = createReceiverRpcMethods<PersonalResumeReceiver>([
  "runPersonalResumeTeacher",
  "qualifyPersonalResume",
]);
