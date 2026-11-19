import type { ReplayCheckpoint } from "./types.js";

declare module "natlang:services" {
  export const sessionReplay: {
    inspect(receipt: string): Promise<ReplayCheckpoint>;
  };
}
