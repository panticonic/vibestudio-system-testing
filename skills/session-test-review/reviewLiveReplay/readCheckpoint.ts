import {sessionReplay} from "natlang:services";
import type {ReplayCheckpoint} from "../types.js";
/** Read one assigned reconnect receipt. */
export default async function readCheckpoint(receipt: string):Promise<ReplayCheckpoint>{
 return sessionReplay.inspect(receipt);
}
