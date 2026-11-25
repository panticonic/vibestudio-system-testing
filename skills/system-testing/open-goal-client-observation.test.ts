import { expect, it } from "vitest";
import { checkClientObservationTrace } from "./client-diagnostics-meaning.js";
it("accepts repeated/reordered owned state observations while preserving successful-effect order without an exact reference count", () => {
  const first = { kind: "observe", surface: "first", stage: "open" } as const;
  const second = {
    kind: "observe",
    surface: "second",
    stage: "signed",
    width: 400,
    overflow: false,
  } as const;
  const effect = {
    kind: "apply",
    surface: "first",
    action: { kind: "click", control: "continue" },
    status: "applied",
  } as const;
  const follow = {
    ...effect,
    action: { kind: "click", control: "finish" },
  } as const;
  const expected = [first, second, effect, follow];
  expect(
    checkClientObservationTrace(
      [second, first, first, effect, second, follow],
      expected,
    ),
  ).toBe(true);
  expect(
    checkClientObservationTrace(
      [first, { ...second, stage: "stale" }, effect, follow],
      expected,
    ),
  ).toBe(false);
  expect(
    checkClientObservationTrace(
      [first, { ...second, surface: "foreign" }, effect, follow],
      expected,
    ),
  ).toBe(false);
  expect(
    checkClientObservationTrace(
      [first, second, effect, effect, follow],
      expected,
    ),
  ).toBe(true);
  expect(
    checkClientObservationTrace([first, second, follow, effect], expected),
  ).toBe(false);
});
