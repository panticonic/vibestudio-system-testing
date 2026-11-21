import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { SystemTestRunnerDO } from "./index.js";

type Receiver = Pick<SystemTestRunnerDO,
  | "storeSystemTestRunCheckpoint"
  | "launchAssignedOpenAutomation"
  | "runPanelTeacher"
  | "runWorkspaceIntegrationTeacher"
  | "runUnitRepairTeacher"
>;
export const systemTestRunnerRpcMethods = createReceiverRpcMethods<Receiver>([
  "storeSystemTestRunCheckpoint",
  "launchAssignedOpenAutomation",
  "runPanelTeacher",
  "runUnitRepairTeacher",
  "runWorkspaceIntegrationTeacher",
]);
