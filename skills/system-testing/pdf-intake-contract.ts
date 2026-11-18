import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedPdf,
  verifyManagedPdf,
} from "./pdf-intake-managed.js";

export type PdfIntakeInput = { contextId: string; caseId: string };
export interface ManagedPdfReceiver {
  runManagedPdfTeacher(
    input: PdfIntakeInput & { executorModel: string },
  ): Promise<{
    teacher: PanelTeacherResult;
    contextId: string;
    verification: Awaited<ReturnType<typeof verifyManagedPdf>>;
  }>;
  qualifyManagedPdf(
    input: PdfIntakeInput,
  ): ReturnType<typeof qualifyManagedPdf>;
}
export const managedPdfMethods = createReceiverRpcMethods<ManagedPdfReceiver>([
  "runManagedPdfTeacher",
  "qualifyManagedPdf",
]);
