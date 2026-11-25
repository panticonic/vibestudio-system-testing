import {expect,it} from "vitest";
import {groundedSourceConclusion,groundedSourceEvidence} from "./source-attribution-grounding.js";
import type {SourceAttributionEvidence,SourceAttributionFile} from "@workspace-skills/open-user-goal/reviewSourceAttribution/types";

const file:SourceAttributionFile={candidate:{id:"owned",name:"owned.txt",path:"owned.txt"},state:"actual-state",file:"actual-file",coordinateKind:"utf16",digest:"actual-bytes",fragments:[{id:"value",text:"cap=3",start:0,end:5}]};
const evidence:SourceAttributionEvidence={selected:{candidate:file.candidate.id,fragment:"value"},trace:{file:file.file,state:file.state,fragment:"value",truncated:false,spans:[{id:"native-span",start:0,end:5,boundary:"authored",intentTier:"stated",paths:["copies-content"],work:"actual-work",command:"actual-command",externalSource:null}]},roots:[{ref:"actual-work",kind:"work-unit",label:"Decision",intent:"Keep one collection window free",tier:"stated",externalSource:null}]};
const conclusion={disposition:"supported",claims:[{fragment:"value",span:"native-span",origin:"native",intent:"Preserve a free pickup window",refs:["actual-work"]}]};

it("validates independently observed frames without a reference path, trace count, or copied prose",()=>{
 expect(groundedSourceEvidence([file],[evidence])).toBe(true);
 expect(groundedSourceEvidence([file],[evidence,evidence])).toBe(true);
 expect(groundedSourceConclusion(conclusion,[evidence])).toBe(true);
 expect(groundedSourceConclusion({...conclusion,disposition:"partial"},[evidence])).toBe(true);
});
it("keeps an explicit partial native trace as evidence instead of forbidding a limited answer",()=>{
 const partial=structuredClone(evidence);partial.trace.truncated=true;partial.trace.spans[0]!.end=3;
 expect(groundedSourceEvidence([file],[partial])).toBe(true);
 expect(groundedSourceEvidence([file],[{...partial,trace:{...partial.trace,truncated:false}}])).toBe(false);
});
it.each(["file","state","fragment"] as const)("rejects a trace bound to another native %s",key=>{
 const changed=structuredClone(evidence);changed.trace[key]="foreign";
 expect(groundedSourceEvidence([file],[changed])).toBe(false);
});
it("rejects missing actor file bindings, foreign roots and out-of-frame ranges",()=>{
 expect(groundedSourceEvidence([],[evidence])).toBe(false);
 const foreign=structuredClone(evidence);foreign.roots[0]!.ref="other-work";
 expect(groundedSourceEvidence([file],[foreign])).toBe(false);
 const range=structuredClone(evidence);range.trace.spans[0]!.end=6;
 expect(groundedSourceEvidence([file],[range])).toBe(false);
});
it.each([
 {span:"unseen-span"},{fragment:"unread-fragment"},{refs:["uninspected-root"]},{origin:"external"},{intent:37},
])("rejects invented native claim custody %j",change=>{
 expect(groundedSourceConclusion({...conclusion,claims:[{...conclusion.claims[0],...change}]},[evidence])).toBe(false);
});
it("does not invent semantic correctness for shape-valid unsupported answers",()=>{
 // This is deliberately only native frame/citation grounding. Mandatory goal
 // review must reject absent requested meaning or false paraphrases.
 expect(groundedSourceConclusion({disposition:"unverifiable",claims:[]},[])).toBe(true);
 expect(groundedSourceConclusion({...conclusion,claims:[{...conclusion.claims[0],intent:"An unsupported reason"}]},[evidence])).toBe(true);
 expect(groundedSourceConclusion(null,[evidence])).toBe(false);
});
