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
