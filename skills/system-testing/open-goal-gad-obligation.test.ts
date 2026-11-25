import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
vi.mock('@workspace/runtime',()=>({gad:{},rpc:{},runtime:{}}));
import {bindOpenGadDurableQuestion} from './open-goal-gad-durable-question-managed.js';
import {gadDurableQuestionWorlds} from './open-goal-gad-durable-question-worlds.js';
import {observeInvocation} from '@workspace/application-outcomes/observed-invocation';
const archive=process.env.NATLANG_TEST_GAD_NATIVE_PACKET;
it.skipIf(!archive)('preserves actual false typed participant targets without inventing a conditional goal requirement',async()=>{
 const packet=JSON.parse(readFileSync(archive!,'utf8')),prior=packet.openGoalVerification;
 const {native,history,roster}=prior.diagnostics;
 const world=gadDurableQuestionWorlds.find(w=>w.id===prior.caseId)!;
 const uuid=vi.spyOn(globalThis.crypto,'randomUUID').mockReturnValue(history.receipt.split(':')[0]);
 const fixture=bindOpenGadDurableQuestion(prior.contextId,history.channelId,world,async()=>native,{
  async readChannelEnvelopes(){return{items:native.messages.map((message:any)=>({channelId:history.channelId,seq:message.sequence,envelopeId:message.envelopeId,payloadKind:'agentic.trajectory.v1/event',from:{id:message.senderId,kind:message.senderKind},payload:{kind:'message.completed',causality:{messageId:message.messageId},payload:{role:'user',blocks:message.textBlocks.map((content:string)=>({type:'text',content}))}}})),pageInfo:{hasMoreBefore:false,hasMoreAfter:false}};},
  async inspectChannelRoster(){return{rows:roster.members.map((m:any)=>({channel_id:roster.channelId,participant_id:m.participantId,roles:{handle:m.handle,name:m.displayName,type:m.kind},joined_at:m.joinedAt,left_at:m.leftAt}))};},
 } as never);
 uuid.mockRestore();
 const read=await fixture.services.gadDurableHistory.read();
 await fixture.services.gadDurableRoster.read(read.receipt);
 // These exact return bytes already occur in the original false packet with recorded hashes.
 const texts=new Map(prior.outcomeDimensions.incidentalValues.incorrectReturns.map((row:any)=>[row.sha256,row.valueJson]));
 const observed=observeInvocation(packet.natlangTeacher,async hash=>texts.get(hash) as string??null);
 const exact=packet.natlangTeacher.applicationResult;
 const proof=await fixture.verify(exact,observed);
 expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.observedChecks.exactParticipantDisposition).toBe(false);
 expect(proof.outcomeDimensions.incidentalValues?.passed).toBe(false);
 expect(proof.outcomeContract.returnedValue.checks).not.toContain('exactParticipantDisposition');
 const masked=proof.outcomeDimensions.incidentalValues!.incorrectReturns;
 expect(masked.some(row=>row.definition.source.endsWith('/evaluateRoster.nl')&&row.required===false)).toBe(true);
 expect(masked.some(row=>row.definition.source.endsWith('reviewDurableQuestion.ts')&&row.required===false)).toBe(true);
 expect(proof.unboundReturnContributions).toEqual([]);
 // The archive's root and leaf bytes remain independently source-bound, never relabelled correct.
 const roots=await observed.returns(call=>call.parentCallId===null);
 expect(roots[0].value).toEqual(exact);
 const leaf=await observed.returns(call=>call.definition.source.endsWith('/evaluateRoster.nl'));
 expect(leaf[0].value).toEqual({status:'absent',member:null});
 expect(native.roster[0].inactive).toBe(true);expect(native.active).toEqual([]);
});
