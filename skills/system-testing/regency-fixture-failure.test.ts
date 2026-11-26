import { it, expect } from "vitest";
import { serializeRpcFailure } from "@vibestudio/rpc";
import { regencyFixtureFailure } from "./regency-fixture-player.js";
it("retains native source-bound phase diagnostics through serialized renderer JSON", () => {
  const error = Object.assign(
    new Error("eval execution timed out after 3000ms"),
    {
      code: "eval_execution_deadline_exceeded",
      errorData: {
        nativeEvalDiagnostic: {
          schema: "vibestudio.eval-failure-diagnostic/1",
          runId: "owned-run",
          sourceSha256: "a".repeat(64),
          events: [{ sequence: 7, at: 30, phase: "execute" }],
        },
      },
    },
  );
  const response = JSON.parse(
    JSON.stringify({
      error: error.message,
      failure: serializeRpcFailure(error),
    }),
  );
  const failure = regencyFixtureFailure(response);
  expect(failure).toMatchObject({
    message: `Native Regency fixture action failed: ${error.message}`,
    cause: { code: error.code },
    errorData: error.errorData,
  });
});
it("accepts successful and historical string-only receipts while rejecting invalid structured failure", () => {
  expect(regencyFixtureFailure({ error: null })).toBeNull();
  expect(regencyFixtureFailure({ error: "old native failure" })).toMatchObject({
    cause: { message: "old native failure" },
  });
  expect(() =>
    regencyFixtureFailure({ error: "bad", failure: { code: 4 } }),
  ).toThrow();
});
