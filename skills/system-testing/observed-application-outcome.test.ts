import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {observeInvocation} from "./observed-invocation.js";
import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import {assessSemanticOutcome} from "./semantic-outcome-contract.js";
vi.mock("@vibestudio/content-addressing",()=>({sha256HexSyncText:(text:string)=>createHash("sha256").update(text).digest("hex")}));
const definition={name:"actualApplication",source:"fixture/application.ts"};
function recorded(value:unknown){
 const text=JSON.stringify(value),hash=createHash("sha256").update(text).digest("hex");
 return observeInvocation({evalRunId:"run",rootCallIds:["root"],captureErrors:[],calls:[{callId:"root",summary:{run_id:"run",owner_key:"owner",owner_kind:"eval"},record:{call_id:"root",parent_call_id:null,definition,outcome:"done",output:{complete:true,hash}}}]},async reference=>reference===hash?text:null);
}
const contract={effects:{checks:["nativeWrite"],rationale:"The private document was actually stored."},returnedValue:{checks:["answer"],required:true,rationale:"The caller requested an answer as well as the document."},incidentalValues:{checks:["receipt"],rationale:"The receipt echo is optional presentation."}};
it("uses retained observations when rebinding an already projected successful optional return",async()=>{
 const value={answer:"supported",receipt:"actual"};
 const assessed=assessSemanticOutcome({passed:true,checks:{nativeWrite:true,answer:true,receipt:true}},contract);
 expect(assessed.checks).not.toHaveProperty("receipt");
 const rebound=await assessObservedApplicationOutcome(assessed,contract,value,recorded(value));
 expect(rebound.passed).toBe(true);
 expect(rebound.incorrectReturnValues).toEqual([]);
 expect(rebound.outcomeDimensions.incidentalValues?.checks.receipt).toBe(true);
});
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
 expect(outcome.passed).toBe(true);expect(outcome.outcomeDimensions.returnedValue.passed).toBe(false);expect(outcome.outcomeDimensions.incidentalValues?.passed).toBe(true);
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
  const result=await assessObservedApplicationOutcome(invalid,optional,value,tree([...rows]),[bad]);expect(result.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(2);expect(result.outcomeDimensions.incidentalValues?.incorrectReturns[1]?.contribution).toMatchObject({kind:"uncertain-projection",uncertainty:"no-verified-actual-producer"});expect(result.unboundReturnContributions).toHaveLength(1);
 }
 const ambiguous=await assessObservedApplicationOutcome(invalid,optional,value,tree([...rows,{id:"sameSource",parent:"root",source:"domain/judge.nl",kind:"agent",value:full}]),[binding]);
 expect(ambiguous.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(3);expect(ambiguous.unboundReturnContributions[0]?.reason).toBe("ambiguous-actual-producer");
 const nonCrisp=tree([{id:"root",parent:null,source:"outer.nl",kind:"agent",value},...rows.slice(1)]);
 expect((await assessObservedApplicationOutcome(invalid,optional,value,nonCrisp,[binding])).outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);
});
it("never treats computed array properties as authored JSON field projections",async()=>{
 const rows=[{id:"root",parent:null,source:"compose.ts",kind:"crisp",value:{answer:1}},{id:"producer",parent:"root",source:"judge.nl",kind:"agent",value:["wrong"]}] as const;
 const result=await assessObservedApplicationOutcome(invalid,optional,{answer:1},tree([...rows]),[{checks:["answer"],rootPath:["answer"],producerSourceSuffix:"judge.nl",producerPath:["length"]}]);
 expect(result.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(2);
});
it("preserves independently checked unused child errors without blaming a correct application return",async()=>{
 const value={answer:"correct"},child="wrong-classification";
 const invocation=tree([{id:"root",parent:null,source:"compose.ts",kind:"crisp",value},{id:"review",parent:"root",source:"review.nl",kind:"agent",value:"correct-review"},{id:"unused",parent:"review",source:"choose.nl",kind:"agent",value:child}]);
 const observed=(await invocation.returns(call=>call.callId==="unused"))[0]!;
 const evidence={passed:false,checks:{nativeWrite:true,answer:true,classification:false},incorrectReturnValues:[{callId:observed.callId,definition:observed.definition,value:observed.value,valueJson:observed.valueJson,checks:["classification"]}]};
 const declared={...contract,incidentalValues:{checks:["classification"],rationale:"An unused admission classification is independently checked against native state."}};
 const result=await assessObservedApplicationOutcome(evidence,declared,value,invocation);
 expect(result.passed).toBe(true);
 expect(result.outcomeDimensions.incidentalValues?.incorrectReturns).toMatchObject([{definition:{source:"choose.nl"},contribution:{kind:"incidental-child",lineage:["root","review","unused"],checks:["classification"]}}]);
 expect(result.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);
 await expect(assessObservedApplicationOutcome({...evidence,incorrectReturnValues:[{...evidence.incorrectReturnValues[0]!,callId:"invented"}]},declared,value,invocation)).rejects.toThrow(/actual sampled return/);
});
it("retains separate custody for multiple failed fields and complete uncertainty groups from one producer",async()=>{
 const value={optional:"wrong",required:"wrong"},producer={a:"wrong",b:"wrong"};
 const observation=tree([{id:"root",parent:null,source:"compose.ts",kind:"crisp",value},{id:"judge",parent:"root",source:"judge.nl",kind:"agent",value:producer}]);
 const rules={effects:{checks:["nativeWrite"],rationale:"Actual native state."},returnedValue:{checks:["required"],required:true,rationale:"Requested required finding."},incidentalValues:{checks:["optional"],rationale:"Optional finding."}};
 const result=await assessObservedApplicationOutcome({passed:false,checks:{nativeWrite:true,optional:false,required:false}},rules,value,observation,[{checks:["optional"],rootPath:["optional"],producerSourceSuffix:"judge.nl",producerPath:["a"]},{checks:["required"],rootPath:["required"],producerSourceSuffix:"judge.nl",producerPath:["b"]}]);
 expect(result.outcomeDimensions.incidentalValues?.incorrectReturns).toMatchObject([{contribution:{kind:"root"}},{required:false,contribution:{checks:["optional"],root_path:["optional"]}},{required:true,contribution:{checks:["required"],root_path:["required"]}}]);
 const uncertain=await assessObservedApplicationOutcome({passed:false,checks:{nativeWrite:true,optional:false,required:false}},rules,value,observation,[{checks:["optional"],rootPath:["optional"],producerSourceSuffix:"judge.nl",producerPath:["a"]},{checks:["required"],rootPath:["required"],producerSourceSuffix:"judge.nl",producerPath:["absent"]}]);
 expect(uncertain.outcomeDimensions.incidentalValues?.incorrectReturns?.[2]).toMatchObject({required:true,contribution:{kind:"uncertain-projection",checks:["required"],uncertainty:"no-verified-actual-producer"}});
});
it("holds the bad item while retaining correct sibling judgments in typed array composition",async()=>{
 const value={findings:[{answer:"correct"},{answer:"wrong"}]};
 const invocation=tree([{id:"root",parent:null,source:"compose.ts",kind:"crisp",value},{id:"good",parent:"root",source:"qualify.nl",kind:"agent",value:value.findings[0]},{id:"bad",parent:"root",source:"qualify.nl",kind:"agent",value:value.findings[1]}]);
 const rules={effects:{checks:["nativeWrite"],rationale:"Actual stored goal is complete."},returnedValue:{checks:["finding0","finding1"],required:false,rationale:"A returned array is optional after the actual mutation."}};
 const result=await assessObservedApplicationOutcome({passed:false,checks:{nativeWrite:true,finding0:true,finding1:false}},rules,value,invocation,[0,1].map(index=>({checks:[`finding${index}`],rootPath:["findings",index],producerSourceSuffix:"qualify.nl",producerPath:[]})));
 expect(result.passed).toBe(true);
 expect(result.outcomeDimensions.returnedValue.incorrectReturns?.map(row=>row.definition.source)).toEqual(["compose.ts","qualify.nl"]);
 expect(result.outcomeDimensions.returnedValue.incorrectReturns?.[1]?.contribution).toMatchObject({producer_call_id:"bad",checks:["finding1"],candidates:[{call_id:"good"},{call_id:"bad"}]});
});
