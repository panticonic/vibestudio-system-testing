import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {observeInvocation} from "./observed-invocation.js";
import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
vi.mock("@vibestudio/content-addressing",()=>({sha256HexSyncText:(text:string)=>createHash("sha256").update(text).digest("hex")}));
const definition={name:"actualApplication",source:"fixture/application.ts"};
function recorded(value:unknown){
 const text=JSON.stringify(value),hash=createHash("sha256").update(text).digest("hex");
 return observeInvocation({evalRunId:"run",rootCallIds:["root"],captureErrors:[],calls:[{callId:"root",summary:{run_id:"run",owner_key:"owner",owner_kind:"eval"},record:{call_id:"root",parent_call_id:null,definition,outcome:"done",output:{complete:true,hash}}}]},async reference=>reference===hash?text:null);
}
const contract={effects:{checks:["nativeWrite"],rationale:"The private document was actually stored."},returnedValue:{checks:["answer"],required:true,rationale:"The caller requested an answer as well as the document."},incidentalValues:{checks:["receipt"],rationale:"The receipt echo is optional presentation."}};
it("retains successful native work and masks the exact wrong optional root return",async()=>{
 const value={answer:"supported",receipt:"invented"};
 const outcome=await assessObservedApplicationOutcome({passed:false,checks:{nativeWrite:true,answer:true,receipt:false}},contract,value,recorded(value));
 expect(outcome.passed).toBe(true);
 expect(outcome.outcomeDimensions.incidentalValues?.incorrectReturns).toMatchObject([{definition,required:false,valueJson:JSON.stringify(value)}]);
});
it("does not manufacture a source mask when the supplied value differs from the recorded root",async()=>{
 const outcome=await assessObservedApplicationOutcome({passed:false,checks:{nativeWrite:true,answer:true,receipt:false}},contract,{receipt:"different"},recorded({receipt:"recorded"}));
 expect(outcome.outcomeDimensions.incidentalValues?.incorrectReturns).toEqual([]);
});
it("requires actual requested answers and native effects independently",async()=>{
 const value={answer:"unsupported",receipt:null};
 const answer=await assessObservedApplicationOutcome({passed:false,checks:{nativeWrite:true,answer:false,receipt:true}},contract,value,recorded(value));
 expect(answer.passed).toBe(false);
 expect(answer.outcomeDimensions.incidentalValues?.incorrectReturns).toMatchObject([{definition,required:true}]);
 const effects=await assessObservedApplicationOutcome({passed:false,checks:{nativeWrite:false,answer:true,receipt:true}},contract,value,recorded(value));
 expect(effects.passed).toBe(false);
 expect(effects.outcomeDimensions.incidentalValues?.incorrectReturns).toEqual([]);
});
