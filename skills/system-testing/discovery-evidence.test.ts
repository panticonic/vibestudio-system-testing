import {it,expect} from "vitest";
import {authenticDiscoveryEvidence as valid} from "./discovery-evidence.js";
it("accepts genuine discovery subsets, repeated reads and different observation order",()=>{
 const a={id:"read",scope:"owned"}, b={id:"status",scope:"workspace"};
 const rows=[{query:"status",hits:[b]},{query:"read",hits:[a]},{query:"read",hits:[a]}];
 const descriptions=new Map([[a.id,a],[b.id,b]]);
 expect(valid({queries:["read","status"],hits:[[a],[b]],described:[b,a]},rows,descriptions)).toBe(true);
 expect(valid({queries:[],hits:[],described:[a]},rows,descriptions)).toBe(true);
 expect(valid({queries:["invented"],hits:[[a]],described:[a]},rows,descriptions)).toBe(false);
 expect(valid({queries:["read"],hits:[[b]],described:[a]},rows,descriptions)).toBe(false);
 expect(valid({queries:[],hits:[],described:[{...a,scope:"foreign"}]},rows,descriptions)).toBe(false);
});
