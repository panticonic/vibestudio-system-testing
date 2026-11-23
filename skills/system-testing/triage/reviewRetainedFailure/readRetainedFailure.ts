import {retainedTestFailure} from "natlang:services";
import type {RetainedFailurePacket} from "../types.js";
/** Read one retained diagnostic from the assigned system-test runner. */
export default async function readRetainedFailure(operationId: string):Promise<RetainedFailurePacket | null>{
 return retainedTestFailure.inspect(operationId);
}
