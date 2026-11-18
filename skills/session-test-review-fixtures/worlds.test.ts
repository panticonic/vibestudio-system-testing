import { unitVerificationReceiptV1Schema } from "@vibestudio/service-schemas/build";
import { runSuites, suite } from "@workspace/testkit";
import { expect, it } from "vitest";
import type { TestkitRelease } from "../session-test-review/types.ts";
import { verifySessionTestReview } from "./oracle.js";
import { sessionTestReviewWorlds } from "./worlds.js";

it("uses unique world IDs with headless, verification and owned release lineages", () => {
  const ids = sessionTestReviewWorlds.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    new Set(sessionTestReviewWorlds.map(({ sourceGroup }) => sourceGroup)).size,
  ).toBe(6);
});

it.each(sessionTestReviewWorlds)(
  "$id rejects the wrong terminal or scope",
  ({ request, expected }) => {
    const evidence = request.evidence;
    if (evidence.kind === "result" && evidence.receipt) {
      const { id, ...receipt } = evidence.receipt;
      expect(
        unitVerificationReceiptV1Schema.safeParse({
          protocol: "unit-verification-receipt.v1",
          reportDigest: "c".repeat(64),
          ...receipt,
        }).success,
      ).toBe(true);
      expect(expected.evidenceIds).toEqual([id]);
    } else if ("receipt" in evidence && typeof evidence.receipt === "string") {
      expect(expected.evidenceIds).toEqual([evidence.receipt]);
    }

    expect(verifySessionTestReview(expected, structuredClone(expected))).toBe(
      true,
    );
    expect(
      verifySessionTestReview(expected, {
        ...expected,
        decision: expected.decision === "confirmed" ? "waiting" : "confirmed",
      }),
    ).toBe(false);
    expect(
      verifySessionTestReview(expected, {
        ...expected,
        finding: `${expected.finding}-other`,
      }),
    ).toBe(false);
    expect(
      verifySessionTestReview(expected, {
        ...expected,
        evidenceIds: ["other-receipt"],
      }),
    ).toBe(false);
  },
);

it("replays the authored failure release through the deterministic testkit runner", async () => {
  const world = sessionTestReviewWorlds.find(
    ({ id }) => id === "case-defers-release-after-failure",
  );
  const evidence = world?.request.evidence;
  if (!world || evidence?.kind !== "testkit")
    throw new Error("Missing testkit release world");
  const released: TestkitRelease["released"] = [];
  const failure = suite("owned release", { failOnSupervision: false }).test(
    "case fails after registering release",
    (test) => {
      for (const resource of evidence.resources) {
        test.defer(() => {
          released.push({ ...resource, acknowledgement: "released" });
        });
      }
      throw new Error("assertion path did not complete");
    },
  );
  const result = await runSuites(failure);
  expect(result.results[0]?.status).toBe("errored");
  expect(released).toEqual(evidence.released);
  expect(world.expected).toEqual({
    decision: "confirmed",
    finding: "testkit-released",
    evidenceIds: [evidence.receipt],
  });
});
