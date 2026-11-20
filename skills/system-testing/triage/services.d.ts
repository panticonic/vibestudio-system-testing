declare module "natlang:services" {
  import type { RetainedFailurePacket } from "./types.js";

  export const retainedTestFailure: {
    inspect(operationId: string): Promise<RetainedFailurePacket | null>;
  };

  /** Read-only access to system-test run records. */
  export const systemTests: {
    inspect(
      runnerTargetId: string,
      runId: string,
      testName?: string,
    ): Promise<unknown>;
  };
}
