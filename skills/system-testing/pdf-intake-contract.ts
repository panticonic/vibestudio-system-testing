import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedPdf,
  verifyManagedPdf,
} from "./pdf-intake-managed.js";
import type {
  qualifyManagedPdfHandoff,
  verifyManagedPdfHandoff,
} from "./pdf-handoff-managed.js";

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
  runManagedPdfHandoffTeacher(
    input: PdfIntakeInput & { executorModel: string },
  ): Promise<{
    teacher: PanelTeacherResult;
    contextId: string;
    verification: Awaited<ReturnType<typeof verifyManagedPdfHandoff>>;
  }>;
  qualifyManagedPdfHandoff(
    input: PdfIntakeInput,
  ): ReturnType<typeof qualifyManagedPdfHandoff>;
}
export const managedPdfMethods = createReceiverRpcMethods<ManagedPdfReceiver>([
  "runManagedPdfTeacher",
  "qualifyManagedPdf",
  "runManagedPdfHandoffTeacher",
  "qualifyManagedPdfHandoff",
]);
