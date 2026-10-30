declare module "natlang:services" {
  /** Read-only access to system-test run records. */
  export const systemTests: {
    inspect(
      runnerTargetId: string,
      runId: string,
      testName?: string,
    ): Promise<unknown>;
  };
}
