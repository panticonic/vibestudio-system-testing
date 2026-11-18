import { z } from "zod";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { verifyManagedScratchHandoff } from "./scratch-handoff-managed.js";

export const scratchHandoffInputSchema = z
  .object({
    contextId: z.string().min(1),
    caseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .strict();
export const scratchHandoffTeacherInputSchema =
  scratchHandoffInputSchema.extend({
    executorModel: z.string().regex(/^[^:]+:.+$/u),
  });
export type ScratchHandoffInput = z.infer<typeof scratchHandoffInputSchema>;
export type ScratchHandoffTeacherInput = z.infer<
  typeof scratchHandoffTeacherInputSchema
>;
type Verification = Awaited<ReturnType<typeof verifyManagedScratchHandoff>>;
export interface ScratchHandoffReceiver {
  runScratchHandoffTeacher(input: ScratchHandoffTeacherInput): Promise<{
    teacher: PanelTeacherResult;
    world: { contextId: string; caseId: string };
    verification: Verification;
  }>;
  qualifyScratchHandoff(
    input: ScratchHandoffInput,
    negative: boolean,
  ): Promise<Verification>;
}
export const scratchHandoffRpcMethods =
  createReceiverRpcMethods<ScratchHandoffReceiver>([
    "runScratchHandoffTeacher",
    "qualifyScratchHandoff",
  ]);
