import {mobileApp} from "natlang:services";
import type {AppReadback} from "../../types.js";
/** Verify the exact developer app on the same device. */
export default async function readInstalledApp(deviceId: string, packageName: string):Promise<AppReadback | null>{
 return mobileApp.verify(deviceId, packageName);
}
