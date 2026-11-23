declare module "natlang:services" {
  export const retainedTestFailure: {
    inspect(operationId: string): Promise<import("./types.js").RetainedFailurePacket | null>;
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
