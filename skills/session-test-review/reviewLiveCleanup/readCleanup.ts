import {testkitCleanup} from "natlang:services";
import type {LiveCleanupEvidence} from "../types.js";
/** Read the caller-owned Testkit teardown receipt. */
export default async function readCleanup(receipt: string):Promise<LiveCleanupEvidence>{
 return testkitCleanup.inspect(receipt);
}
