import {createHash} from "node:crypto";
import {mkdtemp,readFile,readdir,rename,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,join} from "node:path";
import {expect,it,vi} from "vitest";
import {prepareOpenDictationHandoff} from "./open-goal-dictation-managed.js";
import {dictationHandoffWorlds} from "./open-goal-dictation-worlds.js";
import {prepareOpenProviderHandoff} from "./open-goal-provider-handoff-managed.js";
import {providerHandoffWorlds} from "./open-goal-provider-handoff-worlds.js";
import {referenceObserver} from "./observer-slot-control.js";
vi.mock("@workspace/runtime",()=>({contextId:"owned",fs:{},rpc:{},vcs:{}}));

/** Real retained bytes and ordered append-only journal receipts, without an actor or provider. */
async function journalPorts(thread:boolean){
 const directory=await mkdtemp(join(tmpdir(),"application-journal-"));
 const local=(path:string)=>join(directory,path.replace(/^\/\.tmp\/?/u,""));
 const lanes=new Map<string,{rows:Record<string,unknown>[]}>,blobs=new Map<string,string>();
 let channel=0,sequence=0;
 const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
 const state={mainEventId:"main",workingHead:{kind:"event",eventId:"main"}};
 const ports={contextId:"owned",status:async()=>structuredClone(state),
  fs:{mkdtemp:async(prefix:string)=>"/.tmp/"+basename(await mkdtemp(join(directory,prefix+"-"))),
   writeFile:async(path:string,text:string)=>writeFile(local(path),text),
   readFile:async(path:string)=>readFile(local(path),"utf8"),
   readdir:async(path:string)=>readdir(local(path)),rename:async(from:string,to:string)=>rename(local(from),local(to)),
   rm:async(path:string)=>rm(local(path),{recursive:true,force:true})},
  open:async()=>{const lane={key:"channel-"+(++channel)};lanes.set(lane.key,{rows:[]});return lane;},
  append:async(lane:{key:string},_context:string,records:unknown[])=>records.map(record=>{
   const seq=++sequence,id="message-"+seq;lanes.get(lane.key)!.rows.push({messageId:id,envelopeId:"envelope-"+seq,seq,record:structuredClone(record)});return id;
  }),
  read:async(lane:{key:string})=>{const rows=structuredClone(lanes.get(lane.key)!.rows);return {[thread?"threadId":"channelId"]:lane.key,through:rows.at(-1)?.seq??0,rows};},
  put:async(text:string)=>{const hash=digest(text);blobs.set(hash,text);return hash;},get:async(hash:string)=>blobs.get(hash)??null,
  readBytes:async(path:string,limit:number)=>{const bytes=await readFile(local(path));if(bytes.length>limit)throw new Error("Bounded fixture read exceeded its limit");return bytes;},
 };
 return {ports,close:()=>rm(directory,{recursive:true,force:true})};
}
it.each(dictationHandoffWorlds)("$id independently qualifies exact dictation text, current frontiers and local receipt",async world=>{
 const fixture=await journalPorts(true);
 try{
  const prepared=await prepareOpenDictationHandoff({contextId:"owned",caseId:world.id},fixture.ports as never);
  const proof=await prepared.qualify();expect(proof.passed).toBe(true);
  const value={plan:{...proof.independent,explanation:world.expected.statement},review:proof.exactDraft,handoff:proof.handoff};
  expect((await prepared.verify(value,referenceObserver(value))).passed).toBe(true);
  const wrong={...value,plan:{...value.plan,through:-1}};
  const rejected=await prepared.verify(wrong,referenceObserver(wrong));
  expect(rejected.outcomeDimensions.effects.passed).toBe(true);expect(rejected.passed).toBe(true);expect(rejected.semanticReviewRequired).toBe(true);
  // The private copied cursor is not a requested answer or an actor operation.
  // Keep the actual submitted value visible to review when an answer is requested.
  expect(rejected.semanticReviewInput.actual.requestedReturn).toEqual(world.requestedAnswer?wrong:null);
  if(world.requestedAnswer){const missing={...value,plan:{...value.plan,explanation:""}};expect((await prepared.verify(missing,referenceObserver(missing))).passed).toBe(false);}
  if(proof.handoff){
   const wrongReceipt={...value,handoff:{...proof.handoff,path:"/.tmp/invented/handoff.json"}};
   const optional=await prepared.verify(wrongReceipt,referenceObserver(wrongReceipt));
   expect(optional.passed).toBe(true);expect(optional.semanticReviewRequired).toBe(true);
  }
 }finally{await fixture.close();}
});
it.each(providerHandoffWorlds)("$id qualifies retained provider decisions and original output without copied evidence",async world=>{
 const fixture=await journalPorts(false);
 try{
  const prepared=await prepareOpenProviderHandoff({contextId:"owned",caseId:world.id},fixture.ports as never);
  const proof=await prepared.qualify();expect(proof.passed).toBe(true);
  const rejected=await prepared.verify(null,referenceObserver(null));
  expect(rejected.outcomeDimensions.effects.passed).toBe(true);expect(rejected.outcomeDimensions.returnedValue.passed).toBe(false);expect(rejected.passed).toBe(world.requestedReturnRequired === false);
 }finally{await fixture.close();}
});

it.each([1,4])("accepts stable provider evidence after %i real reads without requiring a golden disposition echo",async count=>{
 const fixture=await journalPorts(false);
 try{
  const world=providerHandoffWorlds.find(world=>world.id==="provider-brochure-prompt-still-queued")!;
  const prepared=await prepareOpenProviderHandoff({contextId:"owned",caseId:world.id},fixture.ports as never);
  const [card]=await prepared.services.retainedConversationIndex.list();
  const snapshots=await Promise.all(Array.from({length:count},()=>prepared.services.retainedConversationState.read(card!.channelId)));
  const snapshot=snapshots.at(-1)!;
  const value={plan:{channelId:card!.channelId,through:snapshot!.through,requestId:card!.request.id,disposition:"held" as const,reason:"decision-unconfirmed" as const,
    decisionMessage:null,resultMessage:null,output:null,explanation:"The native workspace queue still lists this request; no grant or delivered result is recorded."},handoff:null};
  const proof=await prepared.verify(value,referenceObserver(value));
  expect(proof.passed).toBe(true);expect(proof.snapshots).toHaveLength(count);expect(proof.semanticReviewRequired).toBe(true);
  expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(value);
  expect((await prepared.verify(null,referenceObserver(null))).passed).toBe(false);
 }finally{await fixture.close();}
});
it("rejects changed provider evidence without a current refresh and refuses staging after actual withdrawal",async()=>{
 const fixture=await journalPorts(false);
 try{
  const world=providerHandoffWorlds.find(world=>world.id==="provider-held-late-withdrawal-protects-draft")!;
  const prepared=await prepareOpenProviderHandoff({contextId:"owned",caseId:world.id},fixture.ports as never);
  const [card]=await prepared.services.retainedConversationIndex.list();const opening=await prepared.services.retainedConversationState.read(card!.channelId);
  const plan={channelId:card!.channelId,through:opening!.through,requestId:card!.request.id,disposition:"ready" as const,reason:"verified" as const,decisionMessage:null,resultMessage:null,output:null,explanation:"Old grant"};
  expect(await prepared.services.retainedProviderHandoff.stage(plan)).toBe(null);
  const stale=await prepared.verify({plan,handoff:null},referenceObserver({plan,handoff:null}));
  expect(stale.outcomeDimensions.effects.passed).toBe(false);expect(stale.observedChecks.exactRetainedProviderFrontier).toBe(false);
  const latest=await prepared.services.retainedConversationState.read(card!.channelId);expect(latest!.through).toBeGreaterThan(opening!.through);
  expect(await prepared.services.retainedProviderHandoff.stage({...plan,through:latest!.through})).toBe(null);
 }finally{await fixture.close();}
});

it("stages exact consented provider bytes independently of unrequested disposition/reason echoes",async()=>{
 const fixture=await journalPorts(false);
 try{
  const world=providerHandoffWorlds.find(world=>world.id==="provider-source-note-not-in-redacted-handoff")!;
  const prepared=await prepareOpenProviderHandoff({contextId:"owned",caseId:world.id},fixture.ports as never);
  const [card]=await prepared.services.retainedConversationIndex.list();
  const snapshot=await prepared.services.retainedConversationState.read(card!.channelId);
  const decision=snapshot!.rows.findLast(row=>row.record.kind==="decision")!;
  const result=snapshot!.rows.findLast(row=>row.record.kind==="result")!;
  const output=await prepared.services.retainedProviderOutput.read(card!.channelId,result.messageId);
  const plan={channelId:card!.channelId,through:snapshot!.through,requestId:card!.request.id,disposition:"held" as const,reason:"pending-consent" as const,decisionMessage:decision.messageId,resultMessage:result.messageId,output,explanation:"The exact approved summary and original receipt are retained without the internal note"};
  expect(await prepared.services.retainedProviderHandoff.stage({...plan,output:{...output!,text:"forged"}})).toBe(null);
  const handoff=await prepared.services.retainedProviderHandoff.stage(plan);expect(handoff).not.toBe(null);
  const value={plan,handoff};
  const proof=await prepared.verify(value,referenceObserver(value));
  expect(proof.outcomeDimensions.effects.passed).toBe(true);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 }finally{await fixture.close();}
});

it("rejects a qualification-only absent return without inventing invalid JSON bytes",async()=>{
 expect(()=>referenceObserver(undefined)).toThrow("JSON return witness");
 expect((await referenceObserver(null).returns())[0]?.value).toBe(null);
});
