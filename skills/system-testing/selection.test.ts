import { describe, expect, it } from "vitest";
import type { TestCase } from "./types.js";
import { selectExplicitSystemTests } from "./selection.js";

const ordinary: TestCase = {
  name: "ordinary",
  category: "migration",
  description: "Ordinary",
  prompt: "Check this",
  validate: () => ({ passed: true }),
};
const live: TestCase = { ...ordinary, name: "live", explicitOnly: true };
describe("explicit system-test selection", () => {
  it("excludes live cases from automatic suite and category selections", () => {
    expect(selectExplicitSystemTests([ordinary, live], [])).toEqual([ordinary]);
  });
  it("allows only the exact opted-in case", () => {
    expect(selectExplicitSystemTests([ordinary, live], ["liv"])).toEqual([
      ordinary,
    ]);
    expect(selectExplicitSystemTests([live], ["live"])).toEqual([live]);
  });
});
