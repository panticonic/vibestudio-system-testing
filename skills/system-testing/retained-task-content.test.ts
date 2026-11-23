import {expect,it} from "vitest";
import {recoveryHandoffMatches,deliveredFactsMatch} from "./retained-task-content.js";
import {assessSemanticOutcome} from "./semantic-outcome-contract.js";
const contract={effects:{checks:["savedContent"],rationale:"Actual persisted handoff or delivered message content satisfies the user goal."},returnedValue:{checks:["laterSummary"],required:false,rationale:"A later response does not substitute for the retained content."}};
const expected={disposition:"hold",citations:[{messageId:"accepted-note",text:"Approval is pending"}],reason:["approval","pending"]};
const text=(review:unknown)=>JSON.stringify({schema:"vibestudio.session-recovery-handoff/1",review});
it("rejects an incorrect saved recovery decision even when a later public answer is correct",()=>{
 const saved=text({...expected,disposition:"continue",reason:"Ready to publish"});
 expect(assessSemanticOutcome({passed:true,checks:{savedContent:recoveryHandoffMatches(saved,expected),laterSummary:true}},contract).passed).toBe(false);
});
it("preserves a correct retained recovery decision when a later optional answer is wrong",()=>{
 const saved=text({...expected,reason:"The approval remains pending."});
 expect(assessSemanticOutcome({passed:false,checks:{savedContent:recoveryHandoffMatches(saved,expected),laterSummary:false}},contract).passed).toBe(true);
 expect(recoveryHandoffMatches(text({...expected,citations:[{messageId:"foreign-note"}],reason:"approval pending"}),expected)).toBe(false);
});
it("requires the actual delivered quoted facts independently of a later delivery claim",()=>{
 const wanted=["B62 may move to intake"];
 expect(assessSemanticOutcome({passed:true,checks:{savedContent:deliveredFactsMatch("B63 may move to intake",wanted),laterSummary:true}},contract).passed).toBe(false);
 expect(assessSemanticOutcome({passed:false,checks:{savedContent:deliveredFactsMatch("B62 may move to intake",wanted),laterSummary:false}},contract).passed).toBe(true);
});
