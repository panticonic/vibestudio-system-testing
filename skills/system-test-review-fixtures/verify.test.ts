import { expect, it } from "vitest";
import { verifySystemTestReview } from "./verify.js";
import { systemTestReviewWorlds } from "./worlds.js";

it("preserves terminal cleanup as a separate requirement and works across aliases", () => {
  const world = systemTestReviewWorlds.find(
    ({ id }) => id === "test-review-green-but-workers-left",
  )!;
  const report = {
    kind: "run" as const,
    next: "join-cleanup" as const,
    basis: "run-green-but-workers-left",
  };
  expect(verifySystemTestReview(world, report).passed).toBe(true);
  expect(
    verifySystemTestReview(world, { ...report, next: "verified" }).passed,
  ).toBe(false);
  expect(verifySystemTestReview({ ...world, id: "alias" }, report).passed).toBe(
    true,
  );
});
