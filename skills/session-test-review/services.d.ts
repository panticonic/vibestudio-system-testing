declare module "natlang:services" {
  export const transcriptCursor: {
    /** Start the assigned transcript read and bind its native snapshot. */
    open(operationId: string): Promise<import("./types.js").TranscriptStart>;
    /** Read the next page at that exact native cursor and watermark. */
    next(operationId: string, after: number, through: number): Promise<import("./types.js").TranscriptPage>;
  };
  export const testkitCleanup: {
    inspect(receipt: string): Promise<import("./types.js").LiveCleanupEvidence>;
  };
  export const sessionReplay: {
    inspect(receipt: string): Promise<import("./types.js").ReplayCheckpoint>;
  };
}
