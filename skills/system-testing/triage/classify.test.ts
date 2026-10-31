import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import classify from "./triageFailure/classify.js";
import type { Failure, FailureClass } from "./types.js";

const cases = readFileSync(new URL("./cases.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map(
    (line) =>
      JSON.parse(line) as {
        id: string;
        input: { failure: Failure };
        expected: { class: FailureClass };
      },
  );

/** Records whose typed fields name no layer: only the agent's message and the validator's complaint can. */
const MEANING_ONLY = [
  "count-in-words",
  "default-in-words",
  "describe-evidence-format",
  "dismissal-wording",
  "left-uncommitted",
];

describe("classify", () => {
  it("reads every record the typed fields decide, and none other, as its expected layer", () => {
    for (const { id, input, expected } of cases) {
      const layer = classify(input.failure);
      if (MEANING_ONLY.includes(id)) expect(layer, id).toBeNull();
      else expect(layer, id).toBe(expected.class);
    }
  });
});
