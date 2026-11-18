import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyOutcome} from './verify-outcome.mjs';

// Verifier unit fixtures only; these are not captured episodes or training data.
function evidence() {
  const event={id:1,messageId:'envelope-one',type:'agentic.trajectory.v1/event',senderId:'owned-sender',payload:{kind:'message.completed',actor:{id:'owned-sender'},causality:{messageId:'say:owned-op'},payload:{protocol:'agentic.trajectory.v1',to:[{kind:'participant',participantId:'mira'}],blocks:[{type:'text',content:'release-17: 148 tests passed; Alex reviews tomorrow'}]}}};
  return {expectedStatus:'delivered',expectedRecipientIds:['mira'],ownedChannelIds:['owned-source','owned-control'],ownedProbeIds:['mira','alex','control'],requiredFacts:['release-17','148 tests passed','Alex reviews tomorrow'],senderId:'owned-sender',sourceChannelId:'owned-source',report:{status:'delivered',messageId:'say:owned-op',content:event.payload.payload.blocks[0].content},closedAdmission:true,boundaries:[{channelId:'owned-source',after:0,through:1,joined:true,barrier:{channelId:'owned-source',headSequence:1,headHash:'original-source-head'}},{channelId:'owned-control',after:0,through:0,joined:true,barrier:{channelId:'owned-control',headSequence:0,headHash:'original-control-head'}}],events:[{channelId:'owned-source',event}],probeSnapshots:[{participantId:'mira',joined:true,delivery:'addressed',subscriptionRevision:1,deliveries:[{deliveryId:'actual-delivery-id',channelId:'owned-source',channelRef:{objectKey:'owned-source'},participantId:'mira',subscriptionRevision:1,eventSequence:1,envelope:{kind:'log',event}}]},{participantId:'alex',joined:true,delivery:'addressed',subscriptionRevision:1,deliveries:[]},{participantId:'control',joined:true,delivery:'addressed',subscriptionRevision:1,deliveries:[]}]};
}
test('accepts exact addressed routing while the message body names another participant',()=>{
 assert.equal(verifyOutcome(evidence()).passed,true);
});
test('rejects wrong audiences, wrong deliveries, incomplete snapshots and unjoined boundaries',()=>{
 for(const mutate of [e=>e.events[0].event.payload.payload.to=[{kind:'all'}],e=>e.probeSnapshots[1].deliveries=e.probeSnapshots[0].deliveries,e=>e.probeSnapshots.pop(),e=>e.events=[],e=>e.boundaries[0].joined=false,e=>e.report.messageId='invented']) {
  const value=evidence();mutate(value);assert.throws(()=>verifyOutcome(value));
 }
});
test('held outcome proves no task publication and does not substitute the channel for an ambiguous recipient',()=>{
 const e=evidence();e.expectedStatus='held';e.expectedRecipientIds=[];e.events=[];e.boundaries[0].through=0;e.boundaries[0].barrier.headSequence=0;e.probeSnapshots[0].deliveries=[];e.report={status:'held',messageId:null,clarification:'Which Nora do you mean: operations or audit?'};
 assert.equal(verifyOutcome(e).status,'held');
 const sent=evidence();sent.expectedStatus='held';sent.report=e.report;assert.throws(()=>verifyOutcome(sent));
});
