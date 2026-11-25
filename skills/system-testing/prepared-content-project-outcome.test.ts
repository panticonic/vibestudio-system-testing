import {expect,it} from "vitest";
import {assessSemanticOutcome} from "@workspace/application-outcomes/semantic-outcome-contract";
import {observedContentReview} from "@workspace/application-outcomes/observed-content-review";
import {preparedContentProjectOutcomeContract as contract} from "./prepared-content-project-outcome.js";
it("retains native artifact/hold completion without a generic result echo",()=>{
 const checks=Object.fromEntries(contract.effects.checks.map(name=>[name,true]));
 const result=assessSemanticOutcome({passed:false,checks:{...checks,actualProjectResult:false}},contract);
 expect(result.passed).toBe(true);expect(result.outcomeDimensions.returnedValue).toEqual({required:false,passed:false,checks:{actualProjectResult:false}});
 for(const name of contract.effects.checks)expect(assessSemanticOutcome({passed:false,checks:{...checks,[name]:false,actualProjectResult:true}},contract).passed).toBe(false);
});
it("keeps native goal meaning review required while excluding an incorrect incidental pointer",()=>{
 const nativeProjectEvidence={sourceNow:[{localApproval:"pending"}],artifact:null};
 const review=observedContentReview({goal:"Create only after approval",nativeProjectEvidence},contract,{outcome:"invented"},["nativeProjectEvidence"]);
 expect(review.semanticReviewRequired).toBe(true);expect(review.semanticReviewInput.actual.requestedReturn).toBeNull();expect(review.semanticReviewInput.actual.observations).toEqual({nativeProjectEvidence});
});
