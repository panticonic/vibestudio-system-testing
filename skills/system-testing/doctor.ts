/** CLI-side owner supplies its actual model policy and scoped native ports. */
import {rpc,workers} from "@workspace/runtime";
import {systemTestDoctor as inspectHealth} from "@workspace/system-test-health";
import {SYSTEM_TEST_AGENT_MODEL,systemTestModelRoute} from "./config.js";
export {unusableModelDetail} from "@workspace/system-test-health";
export function systemTestDoctor(expectedModel: string | null | undefined,catalogNames: readonly string[], options?: import("@vibestudio/service-schemas/systemTestRunner").SystemTestDoctorOptions) {
  if(options?.nativeReference&&typeof expectedModel==="string")throw new Error("nativeReference and model are mutually exclusive");
  return inspectHealth(systemTestModelRoute(expectedModel ?? SYSTEM_TEST_AGENT_MODEL,typeof expectedModel !== "string"),catalogNames,{rpc,workers},options);
}
