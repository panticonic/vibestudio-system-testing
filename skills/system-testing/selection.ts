import type { TestCase } from "./types.js";

/** An exact name is consent for a live or costly case; suite/category selection is not. */
export function selectExplicitSystemTests(
  tests: TestCase[],
  names: readonly string[],
): TestCase[] {
  const explicit = new Set(names);
  return tests.filter((test) => !test.explicitOnly || explicit.has(test.name));
}
