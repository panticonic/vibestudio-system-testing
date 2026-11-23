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
function tree(rows:{id:string;parent:string|null;source:string;kind:"agent"|"crisp";value:unknown}[]){
 const texts=new Map<string,string>();
 const calls=rows.map(row=>{const text=JSON.stringify(row.value),hash=createHash("sha256").update(text).digest("hex");texts.set(hash,text);return {callId:row.id,summary:{run_id:"run",owner_key:"owner",owner_kind:"eval"},record:{call_id:row.id,parent_call_id:row.parent,definition:{name:row.id,source:row.source},executor:{kind:row.kind,model_id:row.kind==="agent"?"actual-teacher":null},cost:{model_requests:row.kind==="agent"?1:0},outcome:"done",output:{complete:true,hash}}};});
 return observeInvocation({evalRunId:"run",rootCallIds:["root"],captureErrors:[],calls},async hash=>texts.get(hash)??null);
}
const optional={effects:{checks:["nativeWrite"],rationale:"Actual private document persisted."},returnedValue:{checks:["answer"],required:false,rationale:"The mutation does not require a returned answer."},incidentalValues:{checks:[],rationale:"Optional semantic result presentation."}};
const invalid={passed:false,checks:{nativeWrite:true,answer:false}};
it("follows only sole-child whole-return crisp chains to actual sampled NL outputs",async()=>{
 const value={answer:"wrong"},rows=[{id:"root",parent:null,source:"compose.ts",kind:"crisp",value},{id:"join",parent:"root",source:"join.ts",kind:"crisp",value},{id:"producer",parent:"join",source:"domain/judge.nl",kind:"agent",value}] as const;
 const outcome=await assessObservedApplicationOutcome(invalid,optional,value,tree([...rows]));
 expect(outcome.passed).toBe(true);expect(outcome.outcomeDimensions.incidentalValues?.passed).toBe(false);
 expect(outcome.outcomeDimensions.incidentalValues?.incorrectReturns).toMatchObject([{definition:{source:"compose.ts"}},{definition:{source:"domain/judge.nl"},contribution:{kind:"forwarded",lineage:["root","join","producer"]}}]);
 const siblings=await assessObservedApplicationOutcome(invalid,optional,value,tree([...rows,{id:"unrelated",parent:"root",source:"other/judge.nl",kind:"agent",value}]));
 expect(siblings.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);
});
it("binds explicit projected bad findings to a unique actual NL producer, without requiring copied intermediate state",async()=>{
 const value={answer:"wrong"},full={assessment:{answer:"wrong"},internal:["actual retained input"]};
 const rows=[{id:"root",parent:null,source:"compose.ts",kind:"crisp",value},{id:"producer",parent:"root",source:"domain/judge.nl",kind:"agent",value:full},{id:"unrelated",parent:"root",source:"other/judge.nl",kind:"agent",value:full}] as const;
 const binding={checks:["answer"],rootPath:["answer"],producerSourceSuffix:"domain/judge.nl",producerPath:["assessment","answer"]};
 const outcome=await assessObservedApplicationOutcome(invalid,optional,value,tree([...rows]),[binding]);
 const masks=outcome.outcomeDimensions.incidentalValues?.incorrectReturns??[];
 expect(masks).toHaveLength(2);expect(masks[1]).toMatchObject({definition:{source:"domain/judge.nl"},valueJson:JSON.stringify(full),contribution:{kind:"projection",root_path:["answer"],producer_path:["assessment","answer"],lineage:["root","producer"]}});
 for(const bad of [ {...binding,producerPath:["missing"]},{...binding,rootPath:["missing"]} ]){
  const result=await assessObservedApplicationOutcome(invalid,optional,value,tree([...rows]),[bad]);expect(result.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);expect(result.unboundReturnContributions).toHaveLength(1);
 }
 const ambiguous=await assessObservedApplicationOutcome(invalid,optional,value,tree([...rows,{id:"sameSource",parent:"root",source:"domain/judge.nl",kind:"agent",value:full}]),[binding]);
 expect(ambiguous.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);expect(ambiguous.unboundReturnContributions[0]?.reason).toBe("ambiguous-actual-producer");
 const nonCrisp=tree([{id:"root",parent:null,source:"outer.nl",kind:"agent",value},...rows.slice(1)]);
 expect((await assessObservedApplicationOutcome(invalid,optional,value,nonCrisp,[binding])).outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);
});
it("never treats computed array properties as authored JSON field projections",async()=>{
 const rows=[{id:"root",parent:null,source:"compose.ts",kind:"crisp",value:{answer:1}},{id:"producer",parent:"root",source:"judge.nl",kind:"agent",value:["wrong"]}] as const;
 const result=await assessObservedApplicationOutcome(invalid,optional,{answer:1},tree([...rows]),[{checks:["answer"],rootPath:["answer"],producerSourceSuffix:"judge.nl",producerPath:["length"]}]);
 expect(result.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);
});
