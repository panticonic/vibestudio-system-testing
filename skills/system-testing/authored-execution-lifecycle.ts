import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { serializeSystemTestError } from "./structured-error.js";

export type AuthoredExecutionLifecycle = {
  schema: "vibestudio.authored-lifecycle/1";
  boundary: "assigned-program-load";
  runId: string;
  runtimeId: string;
  teacherStarted: boolean;
} | {
  schema: "vibestudio.authored-lifecycle/2";
  boundary: "teacher-worker-dispatch";
  caseId: string;
  sourceContextId: string;
  teacherStarted: false;
};

/** Only the harness owning a boundary writes the outer witness. Guest failure
 * fields remain in the original cause and cannot impersonate that witness. */
export function withAuthoredExecutionLifecycle(error: unknown, evidence: AuthoredExecutionLifecycle | null): Error {
  return Object.assign(new Error(serializeSystemTestError(error).message, { cause: error }), {
    errorData: { authoredLifecycle: evidence },
  });
}

export interface AuthoredLifecycleReceiver {
  markAssignedProgramStarted(runId: string): Promise<void>;
}
export const authoredLifecycleRpcMethods = createReceiverRpcMethods<AuthoredLifecycleReceiver>([
  "markAssignedProgramStarted",
]);
