import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { SystemTestRunnerDO } from "./index.js";

type Receiver = Pick<
  SystemTestRunnerDO,
  | "storeSystemTestRunCheckpoint"
  | "runPanelTeacher"
  | "runUnitRepairTeacher"
  | "runWorkspaceIntegrationTeacher"
  | "runAgentCellCompaction"
>;
export const systemTestRunnerRpcMethods = createReceiverRpcMethods<Receiver>([
  "storeSystemTestRunCheckpoint",
  "runPanelTeacher",
  "runUnitRepairTeacher",
  "runWorkspaceIntegrationTeacher",
  "runAgentCellCompaction",
]);
