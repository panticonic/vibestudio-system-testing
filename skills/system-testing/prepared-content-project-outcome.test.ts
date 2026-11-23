import { expect, it } from "vitest";
import { assessSemanticOutcome } from "./semantic-outcome-contract.js";
import { preparedContentProjectOutcomeContract as contract } from "./prepared-content-project-outcome.js";

it("requires the real project return as well as independent retained state", () => {
  const checks = Object.fromEntries(contract.effects.checks.map(name => [name, true]));
  const result = assessSemanticOutcome({passed:false, checks:{...checks, actualProjectResult:false}}, contract);
  expect(result.passed).toBe(false);
  expect(result.outcomeDimensions.returnedValue).toEqual({required:true, passed:false, checks:{actualProjectResult:false}});
  expect(result.outcomeDimensions.incidentalValues).toBeUndefined();
  for (const name of contract.effects.checks)
    expect(assessSemanticOutcome({passed:false,checks:{...checks,[name]:false,actualProjectResult:true}},contract).passed).toBe(false);
});
