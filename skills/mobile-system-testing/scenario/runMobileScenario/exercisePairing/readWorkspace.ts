import {mobileWorkspace} from "natlang:services";
import type {WorkspaceReadback} from "../../types.js";
/** Read the paired device's own workspace readiness. */
export default async function readWorkspace(pairedDevice: string):Promise<WorkspaceReadback | null>{
 return mobileWorkspace.read(pairedDevice);
}
