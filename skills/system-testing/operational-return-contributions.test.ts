import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {observeInvocation} from "./observed-invocation.js";
import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import {assetFindingContributions,packageResultContributions,intentOutcomeContributions} from "./operational-return-contributions.js";
function observe(root:unknown,children:{id:string;source:string;value:unknown}[]){
 const texts=new Map<string,string>();
 const rows=[{id:"root",source:"actual-composition.ts",value:root},...children];
 const calls=rows.map(row=>{const text=JSON.stringify(row.value),hash=createHash("sha256").update(text).digest("hex");texts.set(hash,text);return {callId:row.id,summary:{run_id:"run",owner_key:"owner",owner_kind:"eval"},record:{call_id:row.id,parent_call_id:row.id==="root"?null:"root",definition:{name:row.id,source:row.source},executor:{kind:row.id==="root"?"crisp":"agent",model_id:row.id==="root"?null:"teacher"},cost:{model_requests:row.id==="root"?0:1},outcome:"done",output:{complete:true,hash}}};});
 return observeInvocation({evalRunId:"run",rootCallIds:["root"],captureErrors:[],calls},async hash=>texts.get(hash)??null);
}
function contract(names:string[]){return {effects:{checks:["nativeEffect"],rationale:"Actual native effect remains established."},returnedValue:{checks:names,required:false,rationale:"Independent optional application fields."},incidentalValues:{checks:[],rationale:"Only actual bad producers are held."}};}
it("holds a bad package verification without masking its correct package finding",async()=>{
 const value={finding:{decision:"preserve-current",reason:"actual source"},repair:null,verification:{status:"invented"}};
 const observations=observe(value,[{id:"correct-finding",source:"reviewInstalledPackage/decidePackage.nl",value:value.finding},{id:"wrong-verification",source:"reviewInstalledPackage/reviewVerification.nl",value:value.verification}]);
 const result=await assessObservedApplicationOutcome({passed:false,checks:{nativeEffect:true,returnedPackageFinding:true,returnedPackageRepair:true,returnedPackageVerification:false}},contract(["returnedPackageFinding","returnedPackageRepair","returnedPackageVerification"]),value,observations,packageResultContributions);
 expect(result.passed).toBe(true);
 expect(result.incorrectReturnValues.map(row=>row.definition.name)).toEqual(["root","wrong-verification"]);
});
it("holds only the failed asset comparison and preserves another comparison and the correct recovery plan",async()=>{
 const good={key:"first",differences:[]},bad={key:"second",differences:["invented"]},plan={status:"held",reason:"no copy authority"},value={findings:[good,bad],reason:plan.reason};
 const observations=observe(value,[{id:"good-comparison",source:"reviewAssetIntegrity/compareAsset.nl",value:good},{id:"bad-comparison",source:"reviewAssetIntegrity/compareAsset.nl",value:bad},{id:"correct-plan",source:"reviewAssetIntegrity/planRecovery.nl",value:plan}]);
 const result=await assessObservedApplicationOutcome({passed:false,checks:{nativeEffect:true,joinedAssetIntegrityFinding:true,matchedAssetDisposition:true,"assetFinding:0":true,"assetFinding:1":false}},contract(["joinedAssetIntegrityFinding","matchedAssetDisposition","assetFinding:0","assetFinding:1"]),value,observations,assetFindingContributions(2,true));
 expect(result.passed).toBe(true);
 expect(result.incorrectReturnValues.map(row=>row.definition.name)).toEqual(["root","bad-comparison"]);
});
it("does not blame the correct intent answer for an invalid native note echo",async()=>{
 const value={outcome:{status:"observed",summary:"supported"},handoff:{path:"invented"}};
 const observations=observe(value,[{id:"correct-answer",source:"discoverScopedIntent/concludeIntentReview.nl",value:value.outcome}]);
 const result=await assessObservedApplicationOutcome({passed:false,checks:{nativeEffect:true,exactIntentOutcome:true,returnedIntentNote:false}},contract(["exactIntentOutcome","returnedIntentNote"]),value,observations,intentOutcomeContributions);
 expect(result.incorrectReturnValues.map(row=>row.definition.name)).toEqual(["root"]);
});
