import {describe,it,expect,vi} from "vitest";
vi.mock("@workspace/runtime",()=>({gad:{},rpc:{},runtime:{}}));
import {bindOpenGadDurableQuestion} from "./open-goal-gad-durable-question-managed.js";
import {gadDurableQuestionWorlds} from "./open-goal-gad-durable-question-worlds.js";
import {referenceObserver} from "./observer-slot-control.js";

describe("durable questions return required application answers from independent native records",()=>{
 for(const world of gadDurableQuestionWorlds)it(world.id,async()=>{
  const channel="owned-thread";
  const messages=world.messages.map((text,index)=>({messageId:"message-"+index,envelopeId:"envelope-"+index,sequence:index+1,senderId:"human",senderKind:"user",role:"user" as const,textBlocks:[text]}));
  const roster=world.participants.map((row,index)=>({participantId:"participant-"+index,handle:row.handle,displayName:row.name,inactive:!!row.retired}));
  const active=roster.filter(row=>!row.inactive).map(row=>row.participantId);
  const fixture=bindOpenGadDurableQuestion("owned",channel,world,async()=>({messages,roster,active}),{
   async readChannelEnvelopes(){const visible=world.expected.question==="history-incomplete"?messages.slice(-96):messages;return {items:visible.map(message=>({channelId:channel,seq:message.sequence,envelopeId:message.envelopeId,payloadKind:"agentic.trajectory.v1/event",from:{id:message.senderId,kind:message.senderKind},payload:{kind:"message.completed",causality:{messageId:message.messageId},payload:{role:"user",blocks:message.textBlocks.map(content=>({type:"text",content}))}}})),pageInfo:{hasMoreBefore:visible.length<messages.length,hasMoreAfter:false}};},
   async inspectChannelRoster(){return {rows:roster.map(row=>({channel_id:channel,participant_id:row.participantId,roles:{handle:row.handle,name:row.displayName,type:"agent"},joined_at:"2026-11-23T00:00:00Z",left_at:row.inactive?"2026-11-23T01:00:00Z":null}))};},
  } as never);
  const proof=await fixture.qualify();expect(proof.passed).toBe(true);
  expect(proof.outcomeDimensions.effects.passed).toBe(true);
  expect(proof.outcomeDimensions.returnedValue.required).toBe(true);
  const wrong={...proof.report,historyReceipt:"other-thread"};
  const rejected=await fixture.verify(wrong,referenceObserver(wrong));
  expect(rejected.passed).toBe(false);expect(rejected.outcomeDimensions.effects.passed).toBe(true);
  expect(rejected.outcomeDimensions.returnedValue.passed).toBe(false);
  expect(rejected.outcomeDimensions.incidentalValues?.incorrectReturns).toHaveLength(1);
  expect(rejected.outcomeDimensions.incidentalValues?.incorrectReturns[0]?.required).toBe(true);
 });
});

function conditionalFixture(id:string){
 const world=gadDurableQuestionWorlds.find(row=>row.id===id)!;
 const channel="owned-conditional";
 const messages=world.messages.map((text,index)=>({messageId:"native-message-"+index,envelopeId:"native-envelope-"+index,sequence:index+1,senderId:"native-user",senderKind:"user",role:"user" as const,textBlocks:[text]}));
 const roster=world.participants.map((row,index)=>({participantId:"native-participant-"+index,handle:row.handle,displayName:row.name,inactive:!!row.retired}));
 let rosterReads=0;
 const fixture=bindOpenGadDurableQuestion("owned",channel,world,async()=>({messages,roster,active:roster.filter(row=>!row.inactive).map(row=>row.participantId)}),{
  async readChannelEnvelopes(){const visible=world.expected.question==="history-incomplete"?messages.slice(-96):messages;return {items:visible.map(message=>({channelId:channel,seq:message.sequence,envelopeId:message.envelopeId,payloadKind:"agentic.trajectory.v1/event",from:{id:message.senderId,kind:message.senderKind},payload:{kind:"message.completed",causality:{messageId:message.messageId},payload:{role:"user",blocks:message.textBlocks.map(content=>({type:"text",content}))}}})),pageInfo:{hasMoreBefore:visible.length<messages.length,hasMoreAfter:false}};},
  async inspectChannelRoster(){rosterReads++;return {rows:roster.map(row=>({channel_id:channel,participant_id:row.participantId,roles:{handle:row.handle,name:row.displayName,type:"agent"},joined_at:"2026-11-23",left_at:row.inactive?"2026-11-24":null}))};},
 } as never);
 return {world,fixture,channel,messages,rosterReads:()=>rosterReads};
}
it.each(["gad-retired-no-question","gad-accented-quote-only","gad-held-unreadable-scope"])("accepts truthful unrequested membership without reading the roster: %s",async id=>{
 const {world,fixture,channel,messages,rosterReads}=conditionalFixture(id);
 const history=await fixture.services.gadDurableHistory.read();
 const report={historyReceipt:history.receipt,rosterReceipt:null,channelId:channel,question:{status:world.expected.question,message:world.expected.message===null?null:messages[world.expected.message]},participant:{status:"not-requested",member:null},disposition:"hold",explanation:"The actual question evidence does not activate a participant requirement."};
 const proof=await fixture.verify(report);
 expect(proof.passed).toBe(true);expect(rosterReads()).toBe(0);
 expect(proof.diagnostics.roster).toBeNull();
 expect(proof.outcomeDimensions.returnedValue.required).toBe(true);
 expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);
 const forged=await fixture.verify({...report,rosterReceipt:"unread-foreign-roster"});
 expect(forged.observedChecks.exactOptionalRosterReceipt).toBe(false);
 expect(forged.outcomeDimensions.incidentalValues?.passed).toBe(false);
 const falseMember=await fixture.verify({...report,participant:{status:"not-requested",member:{participantId:"invented"}}});
 expect(falseMember.observedChecks.exactParticipantDisposition).toBe(false);
 expect(falseMember.outcomeDimensions.incidentalValues?.passed).toBe(false);
 const falseHistory=await fixture.verify({...report,historyReceipt:"foreign-history"});
 expect(falseHistory.passed).toBe(false);
});
it("does not skip required membership or accept a fabricated required receipt",async()=>{
 const world=gadDurableQuestionWorlds.find(row=>row.participantRequirement==="required"&&row.expected.question==="current"&&row.expected.participant==="confirmed")!;
 const {fixture,channel,messages}=conditionalFixture(world.id);
 const history=await fixture.services.gadDurableHistory.read();
 const report={historyReceipt:history.receipt,rosterReceipt:null,channelId:channel,question:{status:world.expected.question,message:messages[world.expected.message!]},participant:{status:"not-requested",member:null},disposition:"ready",explanation:"Cannot invent required membership."};
 expect((await fixture.verify(report)).passed).toBe(false);
 const roster=await fixture.services.gadDurableRoster.read(history.receipt);
 const actual={...report,rosterReceipt:roster.receipt,participant:{status:"confirmed",member:roster.members[world.expected.member!]}};
 expect((await fixture.verify(actual)).passed).toBe(true);
 expect((await fixture.verify({...actual,rosterReceipt:"foreign-roster"})).passed).toBe(false);
});
