import type { LiveCleanupEvidence, ReplayCheckpoint, TranscriptPage, TranscriptStart } from "./types.js";

declare module "natlang:services" {
  export const transcriptCursor: {
    /** Start the assigned transcript read and bind its native snapshot. */
    open(operationId: string): Promise<TranscriptStart>;
    /** Read the next page at that exact native cursor and watermark. */
    next(operationId: string, after: number, through: number): Promise<TranscriptPage>;
  };
  export const testkitCleanup: {
    inspect(receipt: string): Promise<LiveCleanupEvidence>;
  };
  export const sessionReplay: {
    inspect(receipt: string): Promise<ReplayCheckpoint>;
  };
}
