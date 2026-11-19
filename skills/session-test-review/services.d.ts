import type { LiveCleanupEvidence, ReplayCheckpoint } from "./types.js";

declare module "natlang:services" {
  export const testkitCleanup: {
    inspect(receipt: string): Promise<LiveCleanupEvidence>;
  };
  export const sessionReplay: {
    inspect(receipt: string): Promise<ReplayCheckpoint>;
  };
}
