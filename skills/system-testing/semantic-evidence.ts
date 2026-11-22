import { isDeepStrictEqual } from "node:util";
/** Exact evidence coverage without prescribing observation order or retry count. */
export function sameEvidenceMembers(actual: readonly unknown[], required: readonly unknown[]): boolean {
  return actual.every(value => required.some(expected => isDeepStrictEqual(value, expected))) &&
    required.every(expected => actual.some(value => isDeepStrictEqual(value, expected)));
}
