import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedPublication,
  verifyManagedPublication,
} from "./publication-preflight-managed.js";

export type PublicationInput = {
  contextId: string;
  panelId: string;
  panelSource: string;
  caseId: string;
  goal: string;
};
export interface ManagedPublicationReceiver {
  runManagedPublicationTeacher(
    input: PublicationInput & { executorModel: string },
  ): Promise<{
    teacher: PanelTeacherResult;
    contextId: string;
    verification: Awaited<ReturnType<typeof verifyManagedPublication>>;
  }>;
  qualifyManagedPublication(
    input: PublicationInput,
  ): ReturnType<typeof qualifyManagedPublication>;
}
export const managedPublicationMethods =
  createReceiverRpcMethods<ManagedPublicationReceiver>([
    "runManagedPublicationTeacher",
    "qualifyManagedPublication",
  ]);
