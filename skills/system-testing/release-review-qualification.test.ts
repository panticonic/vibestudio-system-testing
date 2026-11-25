import {expect,it} from "vitest";
import {managedReleaseReviewHandoffTests} from "./tests/release-review-handoff-managed.js";
import {managedReleaseReviewHandoffWorlds} from "./release-review-handoff-worlds.js";
import {managedAuthorityReviewWorlds} from "./authority-review-worlds.js";
const validate=managedReleaseReviewHandoffTests.at(-1)!.validate!;
function checks(){return managedReleaseReviewHandoffWorlds.map(world=>({
 verification:{passed:true},earlyReadDenied:true,earlyWriteDenied:true,earlyAuthorityDenied:true,
 sourceOnlyReadDenied:true,partialScratchWriteDenied:true,
 partialAuthorityReads:managedAuthorityReviewWorlds.find(authority=>authority.id===world.authority)!.operations.slice(0,-1).map(operation=>({operationId:operation.id,denied:true})),
}));}
const result=(rows:unknown)=>({diagnostics:{releaseReviewHandoffQualification:rows}} as never);
it("represents the single-operation case with no invented partial-prefix probe",()=>{
 const rows=checks();expect(rows[2]!.partialAuthorityReads).toEqual([]);
 expect(validate(result(rows)).passed).toBe(true);
});
it("requires each real partial prefix denial and exact operation identity",()=>{
 const rows=checks();rows[0]!.partialAuthorityReads[0]!.denied=false;
 expect(validate(result(rows)).passed).toBe(false);
 rows[0]!.partialAuthorityReads[0]!.denied=true;rows[0]!.partialAuthorityReads[0]!.operationId="foreign";
 expect(validate(result(rows)).passed).toBe(false);
});
it("rejects missing probes and fabricated probes for a nonexistent prefix",()=>{
 const rows=checks();rows[0]!.partialAuthorityReads=[];expect(validate(result(rows)).passed).toBe(false);
 const extra=checks();extra[2]!.partialAuthorityReads.push({operationId:"invented",denied:true});
 expect(validate(result(extra)).passed).toBe(false);
});
