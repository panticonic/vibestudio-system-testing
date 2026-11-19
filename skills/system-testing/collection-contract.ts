import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type CollectionInput = { contextId: string; caseId: string };
type Verification = { passed: boolean; checks: Record<string, boolean> };
export interface ManagedCollectionReceiver {
  runManagedCollectionTeacher(
    input: CollectionInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Verification;
  }>;
  qualifyManagedCollection(input: CollectionInput): Promise<{
    verification: Verification;
    rejectsOutside: boolean;
    rejectsWrongReceipt: boolean;
  }>;
}
export const managedCollectionMethods =
  createReceiverRpcMethods<ManagedCollectionReceiver>([
    "runManagedCollectionTeacher",
    "qualifyManagedCollection",
  ]);
