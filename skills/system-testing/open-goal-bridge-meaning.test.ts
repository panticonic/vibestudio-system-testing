import {it,expect,vi} from 'vitest';
vi.mock('@workspace/runtime',()=>({contextId:null,fs:{},rpc:{},vcs:{}}));
import {openBridgeDeliveryWorlds} from './open-goal-bridge-delivery-worlds.js';
import {prepareOpenBridgeDelivery} from './open-goal-bridge-delivery-managed.js';

import {nativeSemanticFixturePorts as ports} from './nativeSemanticFixturePorts.js';

it('accepts the actual stop explanation under equivalent bookkeeping while still refusing the forbidden commit',async()=>{
 const fixture=await prepareOpenBridgeDelivery({contextId:'owner',caseId:'bridge-delivery-release-note-retains-superseded-policy'},ports());
 const prior=await fixture.qualify();expect(prior.passed).toBe(true);
 const result={branch:prior.branch,decision:{status:'reviewed',explanation:'The contract requires two checked reviewers, but the release note retains the former single-lead process. No local commit is authorized.'},commit:null,handoff:null};
 const proof=await fixture.verify(result);
 expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput.actual.requestedReturn).toBeNull();
 expect(proof.outcomeDimensions.incidentalValues?.incorrectReturns).toEqual([]);
 const working=(prior.fileReads[0] as any)[1].working;
 expect(await fixture.services.branchDeliveryWrite.commit(prior.scope.id,working)).toBeNull();
 expect((await fixture.verify(result)).checks.exactLocalBranchCommit).toBe(true);
});
it('admits a supported explanation beyond the former field cap and retains exact native artifact bytes',async()=>{
 const fixture=await prepareOpenBridgeDelivery({contextId:'owner',caseId:'bridge-delivery-missing-target-is-not-synchronization'},ports());
 const prior=await fixture.qualify();expect(prior.passed).toBe(true);
 const explanation='The retained target branch was absent; the local pair alone does not establish branch synchronization. '.repeat(15);
 const proof=await fixture.verify({branch:prior.branch,decision:{status:'reviewed',explanation},commit:null,handoff:prior.handoff});
 expect(explanation.length).toBeGreaterThan(900);expect(proof.passed).toBe(true);
 expect(proof.semanticReviewInput.actual.requestedReturn.decision.explanation).toBe(explanation);
 expect(proof.semanticReviewInput.actual.artifacts.artifact).toBe(prior.artifact);
 expect((await fixture.verify({branch:prior.branch,decision:{status:'reviewed',explanation:''},commit:null,handoff:prior.handoff})).passed).toBe(false);
});

for(const world of openBridgeDeliveryWorlds)it('qualifies actual native bridge effects and requested findings: '+world.id,async()=>{
 const fixture=await prepareOpenBridgeDelivery({contextId:'owner',caseId:world.id},ports());const proof=await fixture.qualify();
 expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeContract.returnedValue.required).toBe(world.requestedAnswerRequired);
 if(world.result==='commit')expect(proof.commit).not.toBeNull();if(world.handoff)expect(proof.artifact).not.toBeNull();
});
it('can inspect a genuinely missing retained branch without forced unrelated file or Git review routes',async()=>{
 const fixture=await prepareOpenBridgeDelivery({contextId:'owner',caseId:'bridge-delivery-missing-original-record-cannot-be-reconstructed'},ports());
 const index=await fixture.services.branchDeliveryRead.discover();const scope=await fixture.services.branchDeliveryRead.inspect(index.scopes.find(row=>row.purpose==='delivery')!.id);expect(scope).not.toBeNull();
 const proof=await fixture.verify({branch:{status:'missing',explanation:'No original retained branch evidence exists in the assigned scope.'},decision:{status:'hold',explanation:'The original branch authority is unavailable; no local commit was made.'},commit:null,handoff:null});
 expect(proof.passed).toBe(true);expect(proof.fileReads).toEqual([]);expect(proof.bridgeRead).toBeNull();expect(proof.commit).toBeNull();expect(proof.semanticReviewRequired).toBe(true);
});
