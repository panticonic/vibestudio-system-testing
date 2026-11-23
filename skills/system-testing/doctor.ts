/** CLI-side owner supplies its actual model policy and scoped native ports. */
import {rpc,workers} from "@workspace/runtime";
import {systemTestDoctor as inspectHealth} from "@workspace/system-test-health";
import {SYSTEM_TEST_AGENT_MODEL,systemTestModelRoute} from "./config.js";
export {unusableModelDetail} from "@workspace/system-test-health";
export function systemTestDoctor(expectedModel: string | null | undefined,catalogNames: readonly string[]) {
  return inspectHealth(systemTestModelRoute(expectedModel ?? SYSTEM_TEST_AGENT_MODEL,typeof expectedModel !== "string"),catalogNames,{rpc,workers});
}
