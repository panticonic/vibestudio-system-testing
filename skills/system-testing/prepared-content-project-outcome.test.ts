import { expect, it } from "vitest";
import { assessSemanticOutcome } from "./semantic-outcome-contract.js";
import { preparedContentProjectOutcomeContract as contract } from "./prepared-content-project-outcome.js";

it("retains a privately written draft even when the final value honestly requests further review", () => {
  const checks = Object.fromEntries(contract.effects.checks.map(name => [name, true]));
  const result = assessSemanticOutcome({passed:false, checks:{...checks, correctOutcomeReport:false}}, contract);
  expect(result.passed).toBe(true);
  expect(result.outcomeDimensions.returnedValue).toEqual({required:false, passed:true, checks:{}});
  expect(result.outcomeDimensions.incidentalValues).toEqual({passed:false,checks:{correctOutcomeReport:false},incorrectReturns:[]});
  for (const name of contract.effects.checks)
    expect(assessSemanticOutcome({passed:false,checks:{...checks,[name]:false,correctOutcomeReport:true}},contract).passed).toBe(false);
});
