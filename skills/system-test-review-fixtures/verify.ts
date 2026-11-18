import { isDeepStrictEqual } from "node:util";
import type { TestReviewReport } from "../system-testing/triage/types.js";
import type { TestReviewWorld } from "./worlds.js";

export function verifySystemTestReview(
  world: TestReviewWorld,
  report: TestReviewReport,
) {
  const exact = isDeepStrictEqual(report, world.expected);
  return { passed: exact, checks: { exact } };
}
