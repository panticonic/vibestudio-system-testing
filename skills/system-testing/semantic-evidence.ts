import { isDeepStrictEqual } from "node:util";
/** Exact evidence coverage without prescribing observation order or retry count. */
export function sameEvidenceMembers(actual: readonly unknown[], required: readonly unknown[]): boolean {
  return actual.every(value => required.some(expected => isDeepStrictEqual(value, expected))) &&
    required.every(expected => actual.some(value => isDeepStrictEqual(value, expected)));
}

/** A requested value must be one of the actual native observations. Other owned
 * observations and repeated reads do not invalidate its provenance. */
export function includesEvidence(actual: readonly unknown[], required: unknown): boolean {
  return actual.some(value => isDeepStrictEqual(value, required));
}
