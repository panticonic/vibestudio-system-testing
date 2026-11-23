import {mobilePairing} from "natlang:services";
import type {PairReceipt} from "../../types.js";
/** Dispatch one assigned phone provisioning request. */
export default async function pairDevice(deviceId: string):Promise<PairReceipt | null>{
 return mobilePairing.pair(deviceId);
}
