import type { SessionReview } from "../session-test-review/types.ts";

export function verifySessionTestReview(
  expected: SessionReview,
  received: SessionReview,
): boolean {
  return Boolean(
    received &&
    expected.decision === received.decision &&
    expected.finding === received.finding &&
    Array.isArray(received.evidenceIds) &&
    expected.evidenceIds.length === received.evidenceIds.length &&
    expected.evidenceIds.every(
      (id, index) => id === received.evidenceIds[index],
    ),
  );
}
