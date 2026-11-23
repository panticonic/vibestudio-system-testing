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

it("requires the requested answer while retaining independently identified wrong incidental returns",()=>{
 const definition={name:"chooseNext",source:"reviewDesktopReadiness/clientDevelopment/reviewClientAdmission/chooseNext.nl"};
 const contract={effects:{checks:["nativeState"],rationale:"Actual owned native facts."},returnedValue:{checks:["requestedAnswer"],required:true,rationale:"The requested answer remains required."},incidentalValues:{checks:["auxiliaryClassification"],rationale:"Unused internal admission classification is not requested."}};
 const proof={passed:false,checks:{nativeState:true,requestedAnswer:true,auxiliaryClassification:false},incorrectReturnValues:[{definition,value:"check-declaration"}]};
 const result=assessSemanticOutcome(proof,contract);expect(result.passed).toBe(true);expect(result.checks).toEqual({nativeState:true,requestedAnswer:true});
 expect(result.outcomeDimensions.incidentalValues).toMatchObject({passed:false,incorrectReturns:[{definition,valueJson:'"check-declaration"',sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}]});
 expect(assessSemanticOutcome({...proof,checks:{...proof.checks,requestedAnswer:false}},contract).passed).toBe(false);
 expect(assessSemanticOutcome({...proof,checks:{...proof.checks,nativeState:false}},contract).passed).toBe(false);
});

it("composes already assessed outcomes without losing optional observations", () => {
 const contract={effects:{checks:["stored"],rationale:"Actual private state."},returnedValue:{checks:["summary"],required:false,rationale:"No summary was requested."}};
 const first=assessSemanticOutcome({passed:false,checks:{stored:true,summary:false}},contract);
 const second=assessSemanticOutcome(first,contract);
 expect(second).toEqual(first);
 expect(()=>assessSemanticOutcome({...first,checks:{stored:false}},contract)).toThrow("preserve its original observations");
 expect(assessSemanticOutcome(second,{...contract,returnedValue:{...contract.returnedValue,required:true}}).passed).toBe(false);
});

it("does not hide wrong optional returned values behind an empty incidental check list",()=>{
 const contract={effects:{checks:["stored"],rationale:"Actual stored bytes."},returnedValue:{checks:["answer"],required:false,rationale:"The answer is optional after the requested mutation."}};
 const masked=assessSemanticOutcome({passed:false,checks:{stored:true,answer:false},incorrectReturnValues:[{definition:{name:"judge",source:"judge.nl"},required:false,value:{answer:"wrong"}}]},contract);
 expect(masked.passed).toBe(true);expect(masked.outcomeDimensions.returnedValue.passed).toBe(false);
 expect(masked.outcomeDimensions.incidentalValues).toBeUndefined();expect(masked.outcomeDimensions.returnedValue.incorrectReturns).toHaveLength(1);
 const unbound=assessSemanticOutcome({passed:false,checks:{stored:true,answer:false}},contract);
 expect(unbound.outcomeDimensions.returnedValue.passed).toBe(false);expect(unbound.outcomeDimensions.incidentalValues).toBeUndefined();
});
