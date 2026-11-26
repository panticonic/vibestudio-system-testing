import {PubSubChannel} from "@workspace-workers/pubsub-channel";
import {iterateChannelReplayAfterPages} from "@workspace/pubsub";
import {AgentWorkerBase} from "@workspace/agentic-do/agent-worker-base";
import {DurableObjectBase,rpc} from "@workspace/runtime/worker/kernel";
import {anyOf,methodCapability,relationship} from "@vibestudio/shared/authorization";
import {canonicalEntityId} from "@vibestudio/shared/runtime/entitySpec";
import {assertChannelDeliverySource,type ResidentChannelDeliveryInput} from "@vibestudio/shared/residentSession";
import {channelRpcMethods} from "@workspace-workers/pubsub-channel/contract";
import type {ParticipantDescriptor} from "@workspace/harness";
import type {OwnedMessagingLease} from "@workspace-skills/messaging/local-workflow";
import type {Receipt,DeliveryEvidence} from "@workspace-skills/messaging/local-workflow";

const requires=anyOf(methodCapability("host"),relationship("workspace-role","root"));

type Configuration={contextId:string;fixtureId:string;channelId:string;channelTargetId:string;channelRef:{source:string;className:string;objectKey:string};handle:string;name:string;lease?:OwnedMessagingLease;sendAdmissionClosed?:boolean};
function actorId(value:{source:string;className:string;key:string}) {return canonicalEntityId({kind:"do",...value});}

/** A passive real delivery endpoint: persists original channel input and acknowledges it; never invokes a model. */
export class LocalMessagingProbeDO extends DurableObjectBase {
 protected createTables(): void {
  this.sql.exec("CREATE TABLE IF NOT EXISTS messaging_configuration (id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
  this.sql.exec("CREATE TABLE IF NOT EXISTS messaging_probe_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)");
  this.sql.exec("CREATE TABLE IF NOT EXISTS messaging_probe_deliveries (id TEXT PRIMARY KEY, json TEXT NOT NULL)");
 }
 private config():Configuration {
  const row=this.sql.exec("SELECT json FROM messaging_configuration WHERE id=1").toArray()[0];
  if(!row)throw new Error("Synthetic messaging probe is not configured");
  return JSON.parse(String(row["json"])) as Configuration;
 }
 @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging fixture operations only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"}) async configure(input:Configuration) {
  const previous=this.sql.exec("SELECT json FROM messaging_configuration WHERE id=1").toArray()[0];
  if(previous && String(previous["json"])!==JSON.stringify(input))throw new Error("Owned messaging configuration is immutable");
  this.sql.exec("INSERT OR IGNORE INTO messaging_configuration(id,json) VALUES(1,?)",JSON.stringify(input));
  const id=actorId({source:String(this.env["WORKER_SOURCE"]),className:String(this.env["WORKER_CLASS_NAME"]),key:this.objectKey});
  const joined=await this.rpc.call(input.channelTargetId,channelRpcMethods.join,[{participantId:id,operationId:`join:${input.fixtureId}:${id}`,contextId:input.contextId,metadata:{type:"agent",handle:input.handle,name:input.name},delivery:"addressed",endpoint:{kind:"entity",entityId:id,invocation:"direct"},applicationConfig:null,replay:false}]);
  this.sql.exec("INSERT OR REPLACE INTO messaging_probe_revision VALUES(1,?)",joined.revision);
  return {participantId:id,revision:joined.revision};
 }
 @rpc({website:{kind:"closed",reason:"Only the fixture owner may retire a passive review participant."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"})
 async leaveOwnedRoster(revision:number) {
  const config=this.config();
  const retained=Number(this.sql.exec("SELECT revision FROM messaging_probe_revision WHERE id=1").one()["revision"]);
  if (revision!==retained) throw new Error("This is not the owned participant revision");
  const participantId=actorId({source:String(this.env["WORKER_SOURCE"]),className:String(this.env["WORKER_CLASS_NAME"]),key:this.objectKey});
  await this.rpc.call(config.channelTargetId,channelRpcMethods.leave,[{participantId,revision}]);
 }
 @rpc({website:{kind:"closed",reason:"Only canonical channel delivery reaches this passive probe."},principals:["code","host"],effect:{kind:"open"},tier:"open",sensitivity:"write"})
 override async acceptChannelDelivery(input:ResidentChannelDeliveryInput) {
  const config=this.config();
  assertChannelDeliverySource({id:this.rpcCallerId,kind:this.rpcCallerKind},input,config.channelTargetId);
  if(input.channelId!==config.channelId)throw new Error("Delivery belongs to another synthetic fixture channel");
  const revision=this.sql.exec("SELECT revision FROM messaging_probe_revision WHERE id=1").toArray()[0]?.["revision"];
  const expected=actorId({source:String(this.env["WORKER_SOURCE"]),className:String(this.env["WORKER_CLASS_NAME"]),key:this.objectKey});
  if(input.participantId!==expected || input.subscriptionRevision!==Number(revision))throw new Error("Delivery belongs to another owned recipient generation");
  this.sql.exec("INSERT OR IGNORE INTO messaging_probe_deliveries VALUES(?,?)",input.deliveryId,JSON.stringify(input));
  return {deliveryId:input.deliveryId,disposition:"processed"};
 }
 @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging fixture operations only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"}) async snapshot() {
  const config=this.config();
  const revision=this.sql.exec("SELECT revision FROM messaging_probe_revision WHERE id=1").toArray()[0]?.["revision"];
  return {channelId:config.channelId,participantId:actorId({source:String(this.env["WORKER_SOURCE"]),className:String(this.env["WORKER_CLASS_NAME"]),key:this.objectKey}),delivery:"addressed" as const,subscriptionRevision:Number(revision),deliveries:this.sql.exec("SELECT json FROM messaging_probe_deliveries ORDER BY id").toArray().map(row=>JSON.parse(String(row["json"])) as ResidentChannelDeliveryInput)};
 }
}

/** Owns an actual agent subscription and reuses canonical discovery and notify. It performs no inference. */
export class LocalMessagingSenderDO extends AgentWorkerBase {
 protected override createAgentTables(): void {
  super.createAgentTables();
  this.sql.exec("CREATE TABLE IF NOT EXISTS messaging_configuration (id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
  this.sql.exec("CREATE TABLE IF NOT EXISTS messaging_send (id TEXT PRIMARY KEY, args TEXT NOT NULL, receipt TEXT)");
 }

 private readonly pendingSends=new Set<Promise<unknown>>();
 private configuration():Configuration {
  const row=this.sql.exec("SELECT json FROM messaging_configuration WHERE id=1").toArray()[0];
  if(!row)throw new Error("Owned messaging sender is not configured");
  return JSON.parse(String(row["json"])) as Configuration;
 }
 protected override getParticipantInfo():ParticipantDescriptor {return {name:"Owned synthetic sender",handle:"fixture-sender",type:"agent",metadata:{}};}
 @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging fixture operations only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"}) async configure(input:Configuration) {
  const previous=this.sql.exec("SELECT json FROM messaging_configuration WHERE id=1").toArray()[0];
  if(previous && String(previous["json"])!==JSON.stringify(input))throw new Error("Owned sender configuration is immutable");
  if(!input.lease)throw new Error("Owned sender requires its exact fixture lease");
  this.sql.exec("INSERT OR IGNORE INTO messaging_configuration VALUES(1,?)",JSON.stringify(input));
  return this.subscribeChannel({channelId:input.channelId,channelRef:input.channelRef,contextId:input.contextId,delivery:"addressed",replay:false});
 }
 private bindings() {
  const lease=this.configuration().lease!;
  return this.localMessagingBindings({lease,assertOwnedFixture:async()=>this.configuration().lease!,inspectCommitted:async(receipt)=>this.observeCommitted(receipt)});
 }
 private async observeCommitted(receipt:Receipt|null):Promise<DeliveryEvidence> {
  const config=this.configuration();
  if(!receipt)return {channelId:config.channelId,messageId:null,committed:false,recipientRefs:[],content:null,evidence:["No delivery receipt was issued; independent fixture boundary verifies final absence."]};
  for await (const page of iterateChannelReplayAfterPages(request=>this.rpc.call(config.channelTargetId,channelRpcMethods.getReplayAfter,[request]),{after:0})) {
    for (const event of page.logEvents) {
      if (!event.payload || typeof event.payload !== "object") continue;
      const value=event.payload as {kind?:string;causality?:{messageId?:string};payload?:{to?:{kind?:string;participantId?:string}[];blocks?:{type?:string;content?:string}[]}};
      if(value.kind!=="message.completed" || value.causality?.messageId!==receipt.messageId)continue;
      const selectors=value.payload?.to;
      if(!selectors || selectors.some(item=>item.kind!=="participant"))throw new Error("Committed owned note broadened its audience");
      const refs=selectors.map(item=>config.lease!.recipients.find(recipient=>recipient.participantId===item.participantId)?.ref);
      if(refs.some(ref=>ref===undefined))throw new Error("Committed note names an unowned recipient");
      return {channelId:config.channelId,messageId:receipt.messageId,committed:true,recipientRefs:refs as string[],content:(value.payload?.blocks??[]).filter(item=>item.type==="text").map(item=>item.content??"").join("\n"),evidence:[JSON.stringify(event)]};
    }
  }
  throw new Error("Original notify message is not committed");
 }
 @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging fixture operations only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"}) async inspect(phrase:string){return this.bindings().read.inspect(phrase);}
 @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging fixture operations only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"}) async inspectDelivery(receipt:Receipt|null){return this.bindings().read.inspectDelivery(receipt);}
 @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging fixture operations only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"}) async send(revision:string,phrase:string,ref:string,content:string){
  const config=this.configuration();if(!config.lease?.active||config.sendAdmissionClosed)throw new Error("Owned send admission is closed");
  const key=config.lease.operationId,args=JSON.stringify([revision,phrase,ref,content]);
  const existing=this.sql.exec("SELECT args,receipt FROM messaging_send WHERE id=?",key).toArray()[0];
  if(existing){if(existing["args"]!==args)throw new Error("Owned operation already has another exact message intent");if(typeof existing["receipt"]==="string")return JSON.parse(existing["receipt"]) as Receipt;throw new Error("Owned send outcome is unknown; inspect the original log without sending again");}
  this.sql.exec("INSERT INTO messaging_send(id,args) VALUES(?,?)",key,args);
  const work=this.bindings().send.send(revision,phrase,ref,content);this.pendingSends.add(work);
  try{const receipt=await work;this.sql.exec("UPDATE messaging_send SET receipt=? WHERE id=?",JSON.stringify(receipt),key);return receipt;}finally{this.pendingSends.delete(work);}
 }
 @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging fixture operations only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"}) async closeAdmission(){const config=this.configuration();config.sendAdmissionClosed=true;this.sql.exec("UPDATE messaging_configuration SET json=? WHERE id=1",JSON.stringify(config));const settled=await Promise.allSettled([...this.pendingSends]),errors=settled.flatMap(value=>value.status==="rejected"?[value.reason]:[]);if(errors.length)throw new AggregateError(errors,"Owned send failed before admission closed");return {closed:true as const};}
}

/** Original channel implementation with an operator-only finite join for this synthetic fixture. */
export class LocalMessagingChannelDO extends PubSubChannel {
 @rpc({website:{kind:"closed",reason:"Join delivery on this owned synthetic channel only."},requires,effect:{kind:"open"},tier:"open",sensitivity:"write"})
 async joinFixtureDelivery(){const receipt=await super.prepareDurableWorkRelease("delivery");await super.waitDurableWorkRelease("delivery",receipt.barrier);return receipt;}
}

export { OwnedMethodPeerDO } from "./owned-method-peer.js";
