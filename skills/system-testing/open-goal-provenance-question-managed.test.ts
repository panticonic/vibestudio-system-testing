import {describe,expect,it,vi} from 'vitest';
vi.mock('@workspace/runtime',()=>({contextId:null,blobstore:null,vcs:null}));
import {prepareProvenanceQuestion} from './open-goal-provenance-question-managed.js';
import {openProvenanceQuestionWorlds} from './open-goal-provenance-question-worlds.js';
import {recordedQuestionPorts} from './recorded-question-test-ports.js';
describe('recorded questions: actual native fixture reference and authority controls',()=>{
 for(const world of openProvenanceQuestionWorlds)it(world.id,async()=>{
  const {ports,controls}=recordedQuestionPorts(world);
  const fixture=await prepareProvenanceQuestion({contextId:ports.contextId,caseId:world.id},world,ports as never);
  const before=await fixture.verify({answer:'No evidence acquired yet.'});expect(before.outcomeDimensions.effects.passed).toBe(false);
  const reference=await fixture.qualify();expect(reference.passed).toBe(true);expect(reference.outcomeDimensions.effects.passed).toBe(true);expect(Object.values(reference.checks).every(Boolean)).toBe(true);
  expect(reference.qualification).toEqual({scope:'native-reference',requiredObservations:world.requestedEvidence,goalMeaningReview:'pending'});
  expect(reference.semanticReviewRequired).toBe(true);expect(reference.semanticReviewInput.actual.requestedReturn).toEqual(reference.report);expect(reference.semanticReviewInput.expected.requestedReturnRequired).toBe(true);
  expect(Object.hasOwn(reference,'answer')).toBe(false);expect(Object.hasOwn(reference.semanticReviewInput.actual.observations,'answer')).toBe(false);
  expect(reference.effects.some(e=>e.method==='cohort')).toBe(world.requestedEvidence.includes('cohort')||world.requestedEvidence.includes('counteractions'));
  expect(reference.effects.some(e=>e.method==='rejections')).toBe(world.requestedEvidence.includes('counteractions'));
  const absent=await fixture.verify(undefined);expect(absent.outcomeDimensions.effects.passed).toBe(true);expect(absent.outcomeDimensions.returnedValue.passed).toBe(false);expect(absent.semanticReviewRequired).toBe(true);
  const assignment=await fixture.services.recordedQuestionDiscovery.discover();
  await expect(fixture.services.recordedQuestionDiscovery.search('foreign-assignment',world.phrase)).rejects.toThrow('exact owned assignment');
  await expect(fixture.services.recordedQuestionGraph.cohort(assignment.id,'unissued')).rejects.toThrow('visible result');
  const rows=await fixture.services.recordedQuestionDiscovery.search(assignment.id,world.phrase);
  if(rows[0]){const cohort=await fixture.services.recordedQuestionGraph.cohort(assignment.id,rows[0].ref);await expect(fixture.services.recordedQuestionGraph.rejections(assignment.id,rows[0].ref,{...cohort,paths:[]})).rejects.toThrow('exact observed complete cohort');}
  const extras=await fixture.verify(reference.report);expect(extras.outcomeDimensions.effects.passed).toBe(true);
  controls.corruptProtectedBytes();const corrupt=await fixture.verify(reference.report);expect(corrupt.checks.preservedLocalQuestionScope).toBe(false);expect(corrupt.outcomeDimensions.effects.passed).toBe(false);
 });
});
it('keeps earlier issued candidates/cohorts usable after additional searches, parallel reads and extra valid evidence',async()=>{
 const world=openProvenanceQuestionWorlds[0];const {ports}=recordedQuestionPorts(world);const fixture=await prepareProvenanceQuestion({contextId:ports.contextId,caseId:world.id},world,ports as never);const reference=await fixture.qualify();const assignment=await fixture.services.recordedQuestionDiscovery.discover();const [target]=await fixture.services.recordedQuestionDiscovery.search(assignment.id,world.phrase);const basis=await fixture.services.recordedQuestionGraph.cohort(assignment.id,target.ref);
 const [other]=await fixture.services.recordedQuestionDiscovery.search(assignment.id,'unrelated receiving desk');expect(other).toBeDefined();
 await Promise.all([fixture.services.recordedQuestionGraph.cohort(assignment.id,target.ref),fixture.services.recordedQuestionGraph.cohort(assignment.id,other.ref)]);
 expect(await fixture.services.recordedQuestionGraph.rejections(assignment.id,target.ref,basis)).toHaveLength(world.undone);
 const proof=await fixture.verify(reference.report);expect(proof.outcomeDimensions.effects.passed).toBe(true);
});
it('delegates real search protocol bounds, preserves native errors and refuses stale native results',async()=>{
 const world=openProvenanceQuestionWorlds[0];const {ports,calls,controls}=recordedQuestionPorts(world);const fixture=await prepareProvenanceQuestion({contextId:ports.contextId,caseId:world.id},world,ports as never);const assignment=await fixture.services.recordedQuestionDiscovery.discover();
 expect(await fixture.services.recordedQuestionDiscovery.search(assignment.id,'long actual phrase '.repeat(10))).toEqual([]);expect(calls.filter(c=>c.method==='search')).toHaveLength(1);
 await expect(fixture.services.recordedQuestionDiscovery.search(assignment.id,'x'.repeat(401))).rejects.toThrow();
 const error=new Error('Native search unavailable');controls.failSearch(error);await expect(fixture.services.recordedQuestionDiscovery.search(assignment.id,world.phrase)).rejects.toBe(error);
});

it('refuses observations from a changed native head instead of treating stale references as current',async()=>{
 const world=openProvenanceQuestionWorlds[0];const {ports,controls}=recordedQuestionPorts(world);const fixture=await prepareProvenanceQuestion({contextId:ports.contextId,caseId:world.id},world,ports as never);const assignment=await fixture.services.recordedQuestionDiscovery.discover();const [target]=await fixture.services.recordedQuestionDiscovery.search(assignment.id,world.phrase);const basis=await fixture.services.recordedQuestionGraph.cohort(assignment.id,target.ref);
 controls.headChanged();await expect(fixture.services.recordedQuestionDiscovery.search(assignment.id,world.phrase)).rejects.toThrow('stale');await expect(fixture.services.recordedQuestionGraph.rejections(assignment.id,target.ref,basis)).rejects.toThrow('linkage is unavailable');expect((await fixture.services.recordedQuestionGraph.cohort(assignment.id,target.ref)).complete).toBe(false);
});
