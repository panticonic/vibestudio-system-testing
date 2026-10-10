import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { SystemTestRunnerDO } from "./index.js";

type Receiver = Pick<SystemTestRunnerDO, "storeSystemTestRunCheckpoint">;
export const systemTestRunnerRpcMethods = createReceiverRpcMethods<Receiver>([
  "storeSystemTestRunCheckpoint",
]);
