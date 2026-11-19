import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  prepareManagedAutomationPlanning,
  qualifyManagedAutomation,
  verifyManagedAutomation,
} from "./automation-lifecycle-managed.js";

type PreparedPlanning = Awaited<
  ReturnType<typeof prepareManagedAutomationPlanning>
>;
type PlanningVerification = ReturnType<PreparedPlanning["verify"]>;
type Input = { caseId: string; contextId: string };

export interface ManagedAutomationReceiver {
  runAutomationPlanningTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    teacher: PanelTeacherResult;
    contextId: string;
    verification: Awaited<PlanningVerification>;
  }>;
  qualifyAutomationPlanning(input: Input): PlanningVerification;
  runManagedAutomationTeacher(input: {
    caseId: string;
    contextId: string;
    executorModel: string;
  }): Promise<{
    teacher: PanelTeacherResult;
    contextId: string;
    verification: Awaited<ReturnType<typeof verifyManagedAutomation>>;
  }>;
  qualifyManagedAutomation(input: {
    caseId: string;
    contextId: string;
  }): ReturnType<typeof qualifyManagedAutomation>;
}
export const managedAutomationMethods =
  createReceiverRpcMethods<ManagedAutomationReceiver>([
    "runAutomationPlanningTeacher",
    "qualifyAutomationPlanning",
    "runManagedAutomationTeacher",
    "qualifyManagedAutomation",
  ]);
