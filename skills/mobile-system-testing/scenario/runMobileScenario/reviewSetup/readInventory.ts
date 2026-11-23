import {mobileInventory} from "natlang:services";
import type {MobileInventory} from "../../types.js";
/** Read the installed tooling and assigned Android discovery surface. */
export default async function readInventory():Promise<MobileInventory>{
 return mobileInventory.read();
}
