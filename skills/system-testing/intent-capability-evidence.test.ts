import {it,expect} from "vitest";
import {selectedCapabilityEvidence as valid} from "./intent-capability-evidence.js";
it("joins chosen method IDs to authentic native capabilities without requiring a search transcript",()=>{
 const a={id:"read",scope:"owned"}, b={id:"status",scope:"workspace"};
 const native=new Map([[a.id,a],[b.id,b]]);
 expect(valid({selection:{methodIds:["read"]},capabilities:[a]},native)).toBe(true);
 expect(valid({selection:{methodIds:["read","status"]},capabilities:[b,a]},native)).toBe(true);
 expect(valid({selection:{methodIds:["read"]},capabilities:[{...a,scope:"foreign"}]},native)).toBe(false);
 expect(valid({selection:{methodIds:["unknown"]},capabilities:[]},native)).toBe(false);
 expect(valid({selection:{methodIds:["read"]},capabilities:[b]},native)).toBe(false);
});
