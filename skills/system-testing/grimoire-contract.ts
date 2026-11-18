import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

type GardenInput = { contextId: string; garden: string };
export type GardenReviewInput = GardenInput & {
  caseId: string;
  before: unknown;
};
type Verification = {
  garden: string;
  passed: boolean;
  checks: Record<string, boolean>;
};
export interface ManagedGrimoireReceiver {
  inspectOwnedGarden(input: GardenInput): Promise<unknown>;
  runManagedGrimoireTeacher(
    input: GardenReviewInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedGrimoire(input: GardenReviewInput): Promise<{
    verification: Verification;
    rejectedAlteredEvidence: boolean;
  }>;
}
export const managedGrimoireMethods =
  createReceiverRpcMethods<ManagedGrimoireReceiver>([
    "inspectOwnedGarden",
    "runManagedGrimoireTeacher",
    "qualifyManagedGrimoire",
  ]);
