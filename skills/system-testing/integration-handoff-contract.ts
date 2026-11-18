import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyIntegrationHandoff,
  verifyIntegrationHandoff,
} from "./integration-handoff-managed.js";

export interface IntegrationHandoffReceiver {
  runIntegrationHandoffTeacher(input: {
    caseId: string;
    executorModel: string;
  }): Promise<{
    teacher: PanelTeacherResult;
    contextId: string;
    caseId: string;
    verification: Awaited<ReturnType<typeof verifyIntegrationHandoff>>;
  }>;
  qualifyIntegrationHandoff(
    caseId: string,
  ): ReturnType<typeof qualifyIntegrationHandoff>;
}
export const integrationHandoffMethods =
  createReceiverRpcMethods<IntegrationHandoffReceiver>([
    "runIntegrationHandoffTeacher",
    "qualifyIntegrationHandoff",
  ]);
