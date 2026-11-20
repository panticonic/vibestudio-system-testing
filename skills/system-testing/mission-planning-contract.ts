import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type MissionPlanningInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedMissionPlanningReceiver {
  runManagedMissionPlanningTeacher(
    input: MissionPlanningInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedMissionPlanning(input: MissionPlanningInput): Promise<{
    verification: Verification;
    rejectsStale: boolean;
    rejectsWrongReceipt: boolean;
  }>;
  runManagedMissionFacilityTeacher(
    input: MissionPlanningInput & { executorModel: string },
  ): Promise<{ contextId: string; teacher: PanelTeacherResult; verification: Verification }>;
  qualifyManagedMissionFacility(input: MissionPlanningInput): Promise<Verification>;
}
export const managedMissionPlanningMethods =
  createReceiverRpcMethods<ManagedMissionPlanningReceiver>([
    "runManagedMissionPlanningTeacher",
    "qualifyManagedMissionPlanning",
    "runManagedMissionFacilityTeacher",
    "qualifyManagedMissionFacility",
  ]);
