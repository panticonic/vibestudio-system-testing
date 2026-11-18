import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  qualifyManagedMemory,
  verifyManagedMemory,
} from "./verified-memory-managed.js";

export type VerifiedMemoryInput = { contextId: string; caseId: string };
export interface VerifiedMemoryReceiver {
  runManagedMemoryTeacher(
    input: VerifiedMemoryInput & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<typeof verifyManagedMemory>>;
  }>;
  qualifyManagedMemory(
    input: VerifiedMemoryInput,
  ): ReturnType<typeof qualifyManagedMemory>;
}

export const managedMemoryMethods =
  createReceiverRpcMethods<VerifiedMemoryReceiver>([
    "runManagedMemoryTeacher",
    "qualifyManagedMemory",
  ]);
