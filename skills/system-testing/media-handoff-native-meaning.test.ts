import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {prepareOpenImageCandidate} from './open-goal-image-candidate-managed.js';
import {openImageCandidateWorlds} from './open-goal-image-candidate-worlds.js';
import {prepareOpenDictationHandoff} from './open-goal-dictation-managed.js';
import {dictationHandoffWorlds} from './open-goal-dictation-worlds.js';
// Actual factory components with independent in-memory Native-like storage.
// They are neither live Vibe qualification nor teacher/corpus data.
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function ports(){
 const rows=new Map<string,any[]>(),files=new Map<string,string>(),directories=new Set<string>(),assets=new Map<string,any>();let counter=0;
 const fs={mkdtemp:async(prefix:string)=>{const path=`/.tmp/${prefix}-${counter++}`;directories.add(path);return path},writeFile:async(path:string,text:string)=>{files.set(path,text)},rename:async(a:string,b:string)=>{files.set(b,files.get(a)!);files.delete(a)},rm:async(path:string)=>{directories.delete(path);for(const file of files.keys())if(file.startsWith(path+'/'))files.delete(file)},readdir:async()=>[...directories].map(path=>path.split('/').at(-1)!)};
 return {contextId:'owned',fs,status:async()=>({mainEventId:'current-head',workingHead:{kind:'event',id:'current-head'}}),
  open:async()=>{const lane={key:`lane-${counter++}`,target:'owned'};rows.set(lane.key,[]);return lane},
  append:async(lane:any,_context:string,values:any[])=>values.map(record=>{const list=rows.get(lane.key)!,seq=list.length+1,id=`${lane.key}:${seq}`;list.push({id,messageId:id,envelopeId:`envelope:${id}`,seq,senderId:'native-author',record});return id}),
  read:async(lane:any)=>({channelId:lane.key,threadId:lane.key,through:rows.get(lane.key)!.length,rows:structuredClone(rows.get(lane.key)!)}),
  readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??''),
  images:{importAsset:async({base64}:{base64:string})=>{const bytes=Buffer.from(base64,'base64'),id=`asset-${counter++}`;const asset={id,digest:hash(bytes),mimeType:bytes[0]===0x89?'image/png':bytes[0]===0xff?'image/jpeg':'image/webp',width:1,height:1,byteLength:bytes.length};assets.set(id,{asset,base64});return asset},readAsset:async(id:string)=>{const value=assets.get(id);if(!value)throw Error('unknown image asset');return structuredClone(value)},release:async({assetId}:{assetId:string})=>{assets.delete(assetId)}},
 };
}
it.each(openImageCandidateWorlds)('keeps native reference bytes/effects for $id without gold-answer teacher gates',async world=>{
 const fixture=await prepareOpenImageCandidate({contextId:'owned',caseId:world.id},ports() as never);const result=await fixture.qualify();expect(result.passed,JSON.stringify(result.observedChecks)).toBe(true);expect(result.semanticReviewRequired).toBe(true);expect(result.outcomeContract.returnedValue.required).toBe(world.requestedAnswer);
});
it.each(dictationHandoffWorlds)('keeps acknowledged source and actual reference effect for $id',async world=>{
 const fixture=await prepareOpenDictationHandoff({contextId:'owned',caseId:world.id},ports() as never);const result=await fixture.qualify();expect(result.passed,JSON.stringify(result.observedChecks)).toBe(true);expect(result.semanticReviewRequired).toBe(true);expect(result.outcomeContract.returnedValue.required).toBe(world.requestedAnswer);
});
it('allows concurrent actual original inspection of an unsuitable format without turning it into a valid PNG handoff',async()=>{
 const fixture=await prepareOpenImageCandidate({contextId:'owned',caseId:'image-candidate-transparent-png-brief'},ports() as never),s=fixture.services;
 const index=await s.imageCandidateBriefs.list(),journal=(await s.imageCandidateJournal.read(index.channelId))!;
 const candidates=journal.rows.filter(row=>row.record.kind==='candidate');
 const original=await Promise.all(candidates.map(row=>s.imageCandidateOriginal.read(index.briefs[0].id,(row.record as any).candidateId)));
 expect(original.map(row=>row.status)).toEqual(['verified','verified']);expect(original.map(row=>row.original?.mime)).toEqual(['image/webp','image/png']);
 const report={plan:{briefId:index.briefs[0].id,mode:'compare',historicalLabel:null,localHandoff:true,acceptedFormats:['webp','png']},assessment:{queue:original.map(row=>row.candidateId),candidates:[]},reads:original,decision:{action:'stage',candidateId:original[0].candidateId,explanation:'The real original is WebP.'},handoff:null};
 expect(await s.imageCandidateHandoff.stage(report as never)).toBeNull();
 const proof=await fixture.verify({originals:original,decision:{action:'hold',candidateId:null,explanation:'The first is WebP; the PNG is the relevant original.'}});
 expect(proof.semanticReviewRequired).toBe(true);expect(proof.observedChecks).not.toHaveProperty('groundedImageDecision');
});
it('refreshes a native original after a retry instead of returning a cached success from an earlier frontier',async()=>{
 const fixture=await prepareOpenImageCandidate({contextId:'owned',caseId:'image-candidate-retry-attempt-not-stale-success'},ports() as never),s=fixture.services;
 const index=await s.imageCandidateBriefs.list(),first=(await s.imageCandidateJournal.read(index.channelId))!;
 const candidate=first.rows.find(row=>row.record.kind==='candidate')!.record as any;
 // The first journal read admits the independently authored failed retry.
 expect((await s.imageCandidateOriginal.read(index.briefs[0].id,candidate.candidateId)).status).toBe('refused');
 await s.imageCandidateJournal.read(index.channelId);await s.imageCandidateJournal.read(index.channelId);
 expect((await s.imageCandidateOriginal.read(index.briefs[0].id,candidate.candidateId)).status).toBe('refused');
});
it('does not qualify an image reference if the requested native stage was refused',async()=>{
 const fixture=await prepareOpenImageCandidate({contextId:'owned',caseId:'image-candidate-transparent-png-brief'},ports() as never);fixture.services.imageCandidateHandoff.stage=async()=>null;
 const proof=await fixture.qualify();expect(proof.passed).toBe(false);expect(proof.observedChecks.referenceNativeLocalStage).toBe(false);
});
it('does not qualify a dictation reference if its requested native local artifact is absent',async()=>{
 const fixture=await prepareOpenDictationHandoff({contextId:'owned',caseId:'dictation-preview-is-not-final'},ports() as never);fixture.services.retainedDictationHandoff.stage=async()=>null;
 const proof=await fixture.qualify();expect(proof.passed).toBe(false);expect(proof.observedChecks.referenceNativeLocalStage).toBe(false);
});
it('does not cache a verified original after its actual native retention is lost',async()=>{
 const native=ports(),fixture=await prepareOpenImageCandidate({contextId:'owned',caseId:'image-candidate-jpeg-extensions-normalized'},native as never),s=fixture.services;
 const index=await s.imageCandidateBriefs.list(),journal=(await s.imageCandidateJournal.read(index.channelId))!;
 const candidate=journal.rows.find(row=>row.record.kind==='candidate')!.record as any;
 const first=await s.imageCandidateOriginal.read(index.briefs[0].id,candidate.candidateId);expect(first.status).toBe('verified');
 await native.images.release({assetId:first.original!.id});
 expect((await s.imageCandidateOriginal.read(index.briefs[0].id,candidate.candidateId)).status).toBe('missing');
});
it('recovers the same native stage receipt and preserves its evidence after a rejected changed-body retry',async()=>{
 const fixture=await prepareOpenImageCandidate({contextId:'owned',caseId:'image-candidate-transparent-png-brief'},ports() as never),s=fixture.services;
 const index=await s.imageCandidateBriefs.list(),journal=(await s.imageCandidateJournal.read(index.channelId))!;
 const candidate=journal.rows.find(row=>row.record.kind==='candidate'&&row.record.format==='png')!.record as any;
 const original=await s.imageCandidateOriginal.read(index.briefs[0].id,candidate.candidateId);
 const report={plan:{briefId:index.briefs[0].id,mode:'compare',historicalLabel:null,localHandoff:true,acceptedFormats:['png']},assessment:{queue:[candidate.candidateId],candidates:[]},reads:[original],decision:{action:'stage',candidateId:candidate.candidateId,explanation:'The current native PNG meets the requested local purpose.'},handoff:null};
 const handoff=await s.imageCandidateHandoff.stage(report as never);expect(handoff).not.toBeNull();
 expect(await s.imageCandidateHandoff.stage({...report,handoff} as never)).toEqual(handoff);
 expect(await s.imageCandidateHandoff.stage({...report,decision:{...report.decision,explanation:'A different body'}} as never)).toBeNull();
 const proof=await fixture.verify({originals:[original],decision:report.decision,handoff});expect(proof.passed).toBe(true);expect(proof.observedChecks.verifiedPrivateImageHandoff).toBe(true);
});
it('allows one actual dictation read to stage exact acknowledged wording while rejecting a forged transcript',async()=>{
 const fixture=await prepareOpenDictationHandoff({contextId:'owned',caseId:'dictation-preview-is-not-final'},ports() as never),s=fixture.services;
 const [thread]=await s.retainedDictationIndex.list(),snapshot=(await s.retainedDictationState.read(thread.threadId))!;
 const capture=snapshot.rows.find(row=>row.record.kind==='capture')!.record as any;
 const draft=snapshot.rows.find(row=>row.record.kind==='draft')!.record as any;
 const ack=snapshot.rows.find(row=>row.record.kind==='acknowledgment')!;
 const segment=snapshot.rows.find(row=>row.record.kind==='segment'&&row.record.state==='final')!;
 const transcript={text:(segment.record as any).text,language:thread.language,model:'whistle'};
 const plan={captureId:capture.captureId,segmentMessages:[segment.messageId],draftRevision:draft.revision,acknowledgementMessage:ack.messageId,transcript,reason:'verified',action:'stage-correction',threadId:thread.threadId,draftId:thread.draftId,through:snapshot.through,explanation:'Preserve the actual final acknowledged instruction.'};
 expect(await s.retainedDictationHandoff.stage({...plan,transcript:{...transcript,text:'Forged instruction'}} as never,{status:'draft',text:'Forged instruction'})).toBeNull();
 const handoff=await s.retainedDictationHandoff.stage(plan as never,{status:'draft',text:transcript.text});expect(handoff).not.toBeNull();
 const proof=await fixture.verify({plan,review:{status:'draft',text:transcript.text},handoff});expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
});
