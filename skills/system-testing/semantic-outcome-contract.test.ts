import { describe, expect, it } from "vitest";
import { assessSemanticOutcome } from "./semantic-outcome-contract.js";

describe("application outcome contracts", () => {
  const effectsOnly = {
    effects: { checks: ["storedActualDocument", "preservedNeighbor"], rationale: "The task requests a document change with its neighbor preserved." },
    returnedValue: { checks: ["reportedRevision"], required: false, rationale: "The task requests no summary of the revision." },
  };
  it("admits independently observed effects while retaining an incorrect incidental receipt", () => {
    const result = assessSemanticOutcome({ passed: false, checks: {
      storedActualDocument: true, preservedNeighbor: true, reportedRevision: false,
    } }, effectsOnly);
    expect(result.passed).toBe(true);
    expect(result.outcomeDimensions.returnedValue).toEqual({ required: false, passed: false, checks: { reportedRevision: false } });
  });
  it("keeps a requested answer required", () => {
    const result = assessSemanticOutcome({ passed: false, checks: {
      storedActualDocument: true, preservedNeighbor: true, reportedRevision: false,
    } }, { ...effectsOnly, returnedValue: { ...effectsOnly.returnedValue, required: true } });
    expect(result.passed).toBe(false);
  });
  it("rejects missing effects and incomplete declarations", () => {
    expect(assessSemanticOutcome({ passed: false, checks: {
      storedActualDocument: true, preservedNeighbor: false, reportedRevision: true,
    } }, effectsOnly).passed).toBe(false);
    expect(() => assessSemanticOutcome({ passed: false, checks: { reportedRevision: false } }, effectsOnly)).toThrow("every independent application check");
  });
});

import { applicationVerifierValue } from "./semantic-outcome-contract.js";
it("adapts native application values only at the legacy oracle boundary", () => {
  const research = { status: "answered", question: "Why?", statements: [] };
  expect(applicationVerifierValue({ resultType: "ResearchGoalReport", skill: "owned-research" }, research))
    .toEqual({ status: "answered", research });
  const edit = { status: "edited", path: "guide.md", version: "v2" };
  for (const resultType of ["UnitHandoffReport", "WorkspaceEditReport", "BrowserGoalReport", "WorkspaceSuiteReport"])
    expect(applicationVerifierValue({ resultType, skill: "ignored" }, edit)).toBe(edit);
  expect(applicationVerifierValue({ resultType:"ResearchRevision" }, {research,revision:edit})).toEqual({...edit,research});
  expect(applicationVerifierValue({ resultType: "WorkspaceAnswer" }, { answer: "Doors open at 6." }))
    .toEqual({ answer: "Doors open at 6." });
  expect(applicationVerifierValue({ resultType: "DomainOutcome", skill: "domain" }, edit))
    .toEqual({ status: "workspace-skill-reviewed", skill: "domain", outcome: edit });
});
