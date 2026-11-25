import {isDeepStrictEqual} from "node:util";
import type {RegencyFinding} from "@workspace-skills/open-regency-briefing/types";
/** The installed numeric decision and real account citations are authoritative;
 * explanatory wording and the user's decomposition are assessed by goal review. */
export function matchesNativeRegencyFinding(actual:RegencyFinding, expected:RegencyFinding):boolean {
  return actual?.review?.decision === expected.review.decision &&
    Array.isArray(actual.review.evidenceIds) &&
    isDeepStrictEqual([...actual.review.evidenceIds].sort(), [...expected.review.evidenceIds].sort()) &&
    typeof actual.review.finding === "string" && actual.review.finding.trim().length > 0;
}
