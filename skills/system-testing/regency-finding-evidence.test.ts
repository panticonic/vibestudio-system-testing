import {expect,it} from "vitest";
import {matchesNativeRegencyFinding} from "./regency-finding-evidence.js";
const claim={kind:"compare" as const,from:"current" as const,to:2 as const,check:{kind:"route-works-progressed" as const,route:"east-crossing"},assertCommitted:false};
const native={claim,review:{decision:"contradicted" as const,finding:"works-progress",evidenceIds:["saved","forecast"]}};
it("retains native numeric decisions and references while permitting an accurate explanatory finding",()=>{
 expect(matchesNativeRegencyFinding({...native,review:{...native.review,finding:"Repair progress is 0 → 0 in the actual forecast."}},native)).toBe(true);
 expect(matchesNativeRegencyFinding({...native,review:{...native.review,evidenceIds:["forecast","saved"]}},native)).toBe(true);
});
it("refuses an incorrect claimed result or a foreign, absent or duplicate account citation",()=>{
 expect(matchesNativeRegencyFinding({...native,review:{...native.review,decision:"supported"}},native)).toBe(false);
 for(const evidenceIds of [["saved","foreign"],[],["saved","saved"]])expect(matchesNativeRegencyFinding({...native,review:{...native.review,evidenceIds}},native)).toBe(false);
});
it("does not turn an empty explanation into a supported finding",()=>{
 expect(matchesNativeRegencyFinding({...native,review:{...native.review,finding:" "}},native)).toBe(false);
});
