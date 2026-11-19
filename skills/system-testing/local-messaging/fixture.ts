import type {WorkspaceRuntime} from "@workspace/runtime/hosted";
import type {RuntimeEntityHandle} from "@vibestudio/shared/runtime/entitySpec";
import {channelRpcMethods} from "@workspace-workers/pubsub-channel/contract";
import {localMessagingFixtureMethods as actor} from "@workspace-workers/local-messaging-fixture/contract";
import {iterateChannelReplayAfterPages,type ChannelEvent} from "@workspace/pubsub";
import {verifyOutcome} from "./verify-outcome.mjs";
import {localMessagingWorlds} from "./worlds.js";

type Runtime=WorkspaceRuntime["runtime"];
export async function createLocalMessagingFixture(options:{contextId:string;caseId:string;runtime:Pick<Runtime,"createEntity"|"retireEntity">;rpc:WorkspaceRuntime["rpc"]}) {
 const world=localMessagingWorlds.find(value=>value.id===options.caseId);
 if(!world)throw new Error("Select an authored local messaging world");
 const {runtime,rpc,contextId}=options,id=crypto.randomUUID(),issued:RuntimeEntityHandle[]=[];
 const channels=new Map<string,{id:string;targetId:string}>(),probes:Array<{slot:string;handle:RuntimeEntityHandle;participantId:string;revision:number}>=[];
 const baseline=new Map<string,number>();
 let sender:RuntimeEntityHandle|undefined,closed=false;
 const create=async(source:string,className:string,key:string)=>{
  const result=await runtime.createEntity({kind:"do",execution:{surface:"code",source},className,key,contextId});
  if(result.contextId!==contextId || result.kind!=="do")throw new Error("Created entity differs from its owned fixture context");
  issued.push(result);return result;
 };
 const close=async()=>{
  if(closed)return;closed=true;const errors:unknown[]=[];
  for(const handle of [...issued].reverse())try{await runtime.retireEntity({id:handle.id});}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,"Owned messaging cleanup failed");
 };
 const read=async(channel:{id:string;targetId:string},after:number,throughSeq?:number)=>{
  const events:ChannelEvent[]=[];
  for await(const page of iterateChannelReplayAfterPages(request=>rpc.call(channel.targetId,channelRpcMethods.getReplayAfter,[request]),{after,...(throughSeq!==undefined?{throughSeq}:{})}))events.push(...page.logEvents);
  return events;
 };
 try {
  for(const slot of world.channels){const key=`local-messaging-${id}-${slot}`,handle=await create("workers/local-messaging-fixture","LocalMessagingChannelDO",key);channels.set(slot,{id:key,targetId:handle.targetId});await rpc.call(handle.targetId,channelRpcMethods.initializeConversation,[contextId,{title:`Owned synthetic messaging ${slot}`}]);}
  for(const participant of world.participants){
   const channel=channels.get(participant.channel)!;
   const handle=await create("workers/local-messaging-fixture","LocalMessagingProbeDO",`probe-${id}-${participant.slot}`);
   const joined=await rpc.call(handle.targetId,actor.configure,[{contextId,fixtureId:id,channelId:channel.id,channelTargetId:channel.targetId,channelRef:{source:"workers/local-messaging-fixture",className:"LocalMessagingChannelDO",objectKey:channel.id},handle:participant.handle,name:participant.name}]);
   probes.push({slot:participant.slot,handle,participantId:joined.participantId,revision:joined.revision});
  }
  const source=channels.get("source")!;
  sender=await create("workers/local-messaging-fixture","LocalMessagingSenderDO",`sender-${id}`);
  const lease={fixtureId:id,channelId:source.id,senderParticipantId:sender.id,operationId:`messaging-${id}`,active:true,recipients:probes.filter(p=>world.participants.find(value=>value.slot===p.slot)?.channel==="source").map(p=>({ref:`@${world.participants.find(value=>value.slot===p.slot)!.handle}`,participantId:p.participantId,kind:"agent" as const}))};
  await rpc.call(sender.targetId,actor.configure,[{contextId,fixtureId:id,channelId:source.id,channelTargetId:source.targetId,channelRef:{source:"workers/local-messaging-fixture",className:"LocalMessagingChannelDO",objectKey:source.id},handle:"fixture-sender",name:"Owned synthetic sender",lease}]);
  for(const channel of channels.values()){await rpc.call(channel.targetId,actor.joinFixtureDelivery,[]);const events=await read(channel,0);baseline.set(channel.id,events.at(-1)?.id??0);}
  const target=sender.targetId;
  const service={inspect:(phrase:string)=>rpc.call(target,actor.inspect,[phrase]),send:(revision:string,phrase:string,ref:string,content:string)=>rpc.call(target,actor.send,[revision,phrase,ref,content])};
  // Explicit typed methods preserve the real receiver boundary; no closure is serialized to another realm.
  let resolution: Awaited<ReturnType<typeof service.inspect>>["resolution"] | undefined;
  const assignedService = {
    async inspect(phrase: string) {
      if (phrase !== world.request.recipientPhrase)
        throw new Error("Inspect only the caller's assigned recipient phrase");
      const snapshot = await service.inspect(phrase);
      resolution = structuredClone(snapshot.resolution);
      return snapshot;
    },
    send: service.send,
    inspectDelivery: (receipt: import("@workspace-skills/messaging/local-workflow").Receipt | null) =>
      rpc.call(target, actor.inspectDelivery, [receipt]),
  };
  async function verify(report:unknown){
    await rpc.call(target,actor.closeAdmission,[]);
    const boundaries:Array<{channelId:string;after:number;through:number;joined:boolean;barrier:unknown}>=[],events:Array<{channelId:string;event:ChannelEvent}>=[];
    for(const channel of channels.values()){
      const release=await rpc.call(channel.targetId,actor.joinFixtureDelivery,[]);
      const barrier=release.barrier;
      if(!barrier || typeof barrier!=="object" || Array.isArray(barrier) || typeof barrier["headSequence"]!=="number")throw new Error("Channel returned no owned delivery frontier");
      const through=barrier["headSequence"],retained=await read(channel,baseline.get(channel.id)!,through);
      boundaries.push({channelId:channel.id,after:baseline.get(channel.id)!,through,joined:true,barrier:release.barrier});
      events.push(...retained.map(event=>({channelId:channel.id,event})));
    }
    const snapshots=await Promise.all(probes.map(async p=>({...await rpc.call(p.handle.targetId,actor.snapshot,[]),joined:true})));
    const expectedRef = world.expected.status === "delivered"
      ? "@" + world.participants.find(({ slot }) => slot === world.expected.recipientSlots[0])!.handle
      : null;
    const correctResolution = world.expected.status === "held"
      ? resolution?.kind === "ambiguous" && resolution.reason === world.expected.reason
      : resolution?.kind === "ref" && resolution.ref === expectedRef;
    if (!correctResolution)
      throw new Error("The canonical roster resolution differs from the assigned case");
    const evidence={expectedStatus:world.expected.status,expectedRecipientIds:world.expected.recipientSlots.map(slot=>probes.find(p=>p.slot===slot)!.participantId),ownedChannelIds:[...channels.values()].map(c=>c.id),ownedProbeIds:probes.map(p=>p.participantId),requiredFacts:[...world.request.facts],senderId:sender!.id,sourceChannelId:source.id,report,closedAdmission:true,boundaries,events,probeSnapshots:snapshots};
    return {verification:verifyOutcome(evidence),evidence};
  }
  async function qualify() {
    const { recipientPhrase, facts } = world.request;
    const snapshot = await assignedService.inspect(recipientPhrase);
    const decision = snapshot.resolution;
    if (!snapshot.revision) throw new Error("The canonical roster has no revision");
    const content = decision.kind === "ref" ? facts.join("\n") : null;
    const receipt = decision.kind === "ref" && content !== null
      ? await assignedService.send(snapshot.revision, recipientPhrase, decision.ref, content)
      : null;
    const readback = await assignedService.inspectDelivery(receipt);
    if (receipt
      ? !readback.committed || readback.messageId !== receipt.messageId || readback.content !== content
      : readback.committed || readback.messageId !== null)
      throw new Error("The live messaging service disagrees with its delivery readback");
    return verify({
      status: receipt ? "delivered" : "held",
      recipientRef: receipt?.to ?? null,
      messageId: receipt?.messageId ?? null,
      content,
      clarification: receipt ? null : "Which participant in this channel should receive the message?",
      evidence: readback.evidence,
    });
  }
  return { request:world.request, assignedService, close, qualify, verify };
 }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],"Messaging setup and cleanup failed");}throw error;}
}
