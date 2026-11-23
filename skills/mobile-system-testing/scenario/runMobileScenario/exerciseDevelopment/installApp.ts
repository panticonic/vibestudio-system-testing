import {mobileDevelopment} from "natlang:services";
import type {InstallReceipt} from "../../types.js";
/** Run the assigned Android development install with its caller-bound reset policy. */
export default async function installApp(deviceId: string):Promise<InstallReceipt | null>{
 return mobileDevelopment.install(deviceId);
}
