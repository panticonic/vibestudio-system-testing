import {isDeepStrictEqual} from "node:util";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
import type {TerminalRepairReport} from "@workspace-skills/open-user-goal/types";

const outcomes:readonly TerminalRepairReport["outcome"][]=["verified","already-ready","diagnosed","hold-edit","hold-test","hold-moved","blocked"];
/** Native receipt binding is independent of a private preferred hold label. */
export function terminalRepairReturnIsBound(value:unknown,artifact:unknown){
 const report=value as TerminalRepairReport|null;
 return !!report && outcomes.includes(report.outcome) && typeof report.explanation==="string" &&
   !!report.explanation.trim() && isDeepStrictEqual(report.artifact,artifact);
}
export const assessTerminalRepairGoal=bindObservedContentReview(["journal","proof"]);
