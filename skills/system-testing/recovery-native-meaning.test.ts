import {beforeEach,expect,it,vi} from "vitest";
import {doTargetId} from "@vibestudio/shared/workspaceServiceRpc";
import {AGENTIC_EVENT_PAYLOAD_KIND,storedAgenticEventSchema} from "@workspace/agentic-protocol";
import {prepareOpenRecoveryGoal} from "./open-goal-recovery-managed.js";
import {openGoalRecoveryWorlds} from "./open-goal-recovery-worlds.js";
import {referenceObserver} from "./observer-slot-control.js";
const native=vi.hoisted(()=>({lanes:new Map<string,{key:string;rows:any[]}>(),files:new Map<string,string>(),sequence:0,open:vi.fn()}));
vi.mock("@workspace/runtime",()=>({contextId:"recovery-owned",fs:{mkdtemp:async()=>"/.tmp/recovery",writeFile:async(path:string,text:string)=>{native.files.set(path,text);},readFile:async(path:string)=>native.files.get(path)},rpc:{call:async(target:string,_method:unknown,args:any[])=>{
 const lane=native.lanes.get(target)!;const {after,limit,throughSeq}=args[0];const through=throughSeq??lane.rows.at(-1)?.id??0;const eligible=lane.rows.filter(row=>row.id>after&&row.id<=through);const rows=eligible.slice(0,limit);
 return {mode:"after",logEvents:structuredClone(rows),ready:{contextId:"recovery-owned",snapshotLastSeq:through,replayToId:rows.at(-1)?.id,hasMoreAfter:eligible.length>rows.length}};
}}}));
vi.mock("./session-replay-managed.js",()=>({createOwnedHeadlessChannel:(...args:unknown[])=>native.open(...args),withOwnedChannelClient:async(lane:{target:string},_context:string,run:(client:unknown)=>unknown)=>run({send:async(text:string)=>{
 const id=++native.sequence,messageId="message-"+id;
 const payload=storedAgenticEventSchema.parse({kind:"message.completed",actor:{kind:"user",id:"owner"},createdAt:"2026-11-26T00:00:00.000Z",causality:{messageId},payload:{protocol:"agentic.trajectory.v1",role:"user",outcome:"completed",blocks:[{type:"text",content:text}]}});
 native.lanes.get(lane.target)!.rows.push({id,messageId:"envelope-"+id,type:AGENTIC_EVENT_PAYLOAD_KIND,payload});return messageId;
}})}));
beforeEach(()=>{native.sequence=0;native.lanes.clear();native.files.clear();native.open.mockImplementation(async()=>{const key="channel-"+native.lanes.size,target=doTargetId({source:"workers/pubsub-channel",className:"PubSubChannel",objectKey:key});const lane={key,target,rows:[]};native.lanes.set(target,lane);return lane;});});
it.each(openGoalRecoveryWorlds)("$id preserves native cursor/coverage/retention and its explicit answer obligation",async world=>{
 const fixture=await prepareOpenRecoveryGoal({contextId:"recovery-owned",caseId:world.id},world);
 const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.outcomeDimensions.returnedValue.required).toBe(world.requestedReturnRequired);
});
it("permits grouped independent recovery reads, extra owned evidence and reordered real citations",async()=>{
 const world=openGoalRecoveryWorlds[0]!;const fixture=await prepareOpenRecoveryGoal({contextId:"recovery-owned",caseId:world.id},world);
 const catalog=await fixture.services.recoverySessions.discover();const windows=await Promise.all(catalog.map(source=>fixture.services.recoveryReplay.resume(source.id)));
 const main=windows.find(window=>window.source.title==="Mailroom Dispatch")!;
 await fixture.services.recoveryReplay.resume(main.source.id);
 const review={disposition:"continue" as const,reason:"The duty lead signed the 17:30 UTC cutoff; earlier notes explain the pending signature",citations:[...main.notes].reverse()};
 const handoff=await fixture.services.recoveryHandoff.stage(review);const value={review,handoff};
 const proof=await fixture.verify(value,referenceObserver(value));expect(proof.passed).toBe(true);expect(proof.semanticReviewInput.actual.artifacts.handoffText).toContain("17:30");
 await expect(fixture.services.recoveryHandoff.stage({...review,citations:[{...main.notes[0]!,messageId:"unissued"}]})).rejects.toThrow();
});
it("preserves explicit first-then user order and rejects an unissued citation",async()=>{
 const world=openGoalRecoveryWorlds[1]!;const fixture=await prepareOpenRecoveryGoal({contextId:"recovery-owned",caseId:world.id},world);
 const sources=await fixture.services.recoverySessions.discover();const windows=await Promise.all(sources.map(source=>fixture.services.recoveryReplay.resume(source.id)));
 const value={review:{disposition:"hold" as const,reason:"The fire doors need inspection",citations:windows.flatMap(window=>window.notes)},handoff:null};
 const proof=await fixture.verify(value,referenceObserver(value));expect(proof.checks.exactReplayScope).toBe(false);
 await expect(fixture.services.recoveryHandoff.stage({...value.review,citations:[{...windows[0]!.notes[0]!,messageId:"unissued"}]})).rejects.toThrow("exact retained notes");
});
