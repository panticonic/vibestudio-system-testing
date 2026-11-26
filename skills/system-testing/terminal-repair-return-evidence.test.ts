import {it,expect} from "vitest";
import {assessTerminalRepairGoal,terminalRepairReturnIsBound} from "./terminal-repair-return-evidence.js";
it("binds genuine receipt bytes while allowing typed diagnostic/hold interpretations instead of a golden label",()=>{
 for(const outcome of ["diagnosed","hold-edit","blocked"]){expect(terminalRepairReturnIsBound({outcome,artifact:null,explanation:"The source adds one to the actual count; no mutation was permitted."},null)).toBe(true);}
 const actual={revision:"native-revision",artifactDigest:"native-digest"};
 expect(terminalRepairReturnIsBound({outcome:"verified",artifact:actual,explanation:"Actual native artifact"},actual)).toBe(true);
 for(const value of [null,{outcome:"invented",artifact:null,explanation:"Claim"},{outcome:"diagnosed",artifact:null,explanation:" "},{outcome:"verified",artifact:{revision:"forged"},explanation:"Claim"}])expect(terminalRepairReturnIsBound(value,actual)).toBe(false);
});
it("requires native-bound meaning review for requested diagnostics rather than accepting any nonempty explanation",async()=>{
 const actual={outcome:"blocked",artifact:null,explanation:"Only a permission statement; the reviewer must still judge the requested diagnosis"};
 const native={caseId:"case",goal:"Read actual source and explain the count discrepancy without editing",journal:[{service:"observe",result:{source:"return count+1",tests:{actual:4,expected:3},mayEdit:false}}],proof:{currentRevision:"native",protectedDigest:"unchanged"},checks:{nativeAuthority:true,returned:terminalRepairReturnIsBound(actual,null)},passed:true};
 const contract={effects:{checks:["nativeAuthority"],rationale:"Native authority"},returnedValue:{checks:["returned"],required:true,rationale:"Requested diagnosis"},incidentalValues:{checks:[],rationale:"No incidental requirement"}};
 const proof=await assessTerminalRepairGoal(native,contract,actual);
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.expected.observations.journal).toEqual(native.journal);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(actual);
 const optional=await assessTerminalRepairGoal({...native,checks:{nativeAuthority:true,returned:false}}, {...contract,returnedValue:{...contract.returnedValue,required:false}}, {outcome:"invented"});
 expect(optional.passed).toBe(true);expect(optional.outcomeDimensions.returnedValue.checks.returned).toBe(false);expect(optional.semanticReviewRequired).toBe(true);expect(optional.semanticReviewInput.actual.requestedReturn).toBeNull();
});
