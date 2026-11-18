import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { PresentationRequest } from "@workspace-skills/visualize/types";

export type PresentationTeacherInput = {
  contextId: string;
  executorModel: string;
  request: PresentationRequest;
};

export interface ManagedPresentationReceiver {
  runManagedPresentationTeacher(
    input: PresentationTeacherInput,
  ): Promise<PanelTeacherResult>;
}

export const managedPresentationMethods =
  createReceiverRpcMethods<ManagedPresentationReceiver>([
    "runManagedPresentationTeacher",
  ]);
