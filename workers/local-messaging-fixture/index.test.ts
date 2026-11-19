import {afterEach,expect,it,vi} from "vitest";
import {createTestDO} from "@vibestudio/durable/test-utils";
import {rpcMethodAuthority} from "@vibestudio/rpc";
import {wireCallerFor} from "@vibestudio/rpc/internal";
import {PubSubChannel} from "@workspace-workers/pubsub-channel";
import {LocalMessagingProbeDO,LocalMessagingSenderDO,LocalMessagingChannelDO} from "./index.js";
class Probe extends LocalMessagingProbeDO {wire(){return wireCallerFor(this.rpc);}}
const dbs:Array<{close():void}>=[];
afterEach(()=>{for(const db of dbs.splice(0))db.close();vi.restoreAllMocks();});
it("persists the original exact delivery on a passive synthetic probe and sends nothing",async()=>{
 const entity=await createTestDO(Probe,{WORKER_SOURCE:"workers/local-messaging-fixture",WORKER_CLASS_NAME:"LocalMessagingProbeDO",__objectKey:"probe"});dbs.push(entity.db);
 const participantId="do:workers/local-messaging-fixture:LocalMessagingProbeDO:probe",channelId="owned-channel",target="do:workers/local-messaging-fixture:LocalMessagingChannelDO:owned-channel";
 const call=vi.spyOn(entity.instance.wire(),"call").mockImplementation(async(_target,_method,_args)=>({ok:true,participantId,revision:1}));
 await entity.call("configure",{contextId:"owned-context",fixtureId:"owned-fixture",channelId,channelTargetId:target,channelRef:{source:"workers/local-messaging-fixture",className:"LocalMessagingChannelDO",objectKey:channelId},handle:"mira",name:"Mira"});
 const delivery={deliveryId:"real-delivery",channelId,channelRef:{source:"workers/local-messaging-fixture",className:"LocalMessagingChannelDO",objectKey:channelId},participantId,subscriptionRevision:1,eventSequence:1,envelope:{kind:"log",event:{id:1,type:"agentic.trajectory.v1/event",payload:{kind:"message.completed"}}},agenticContext:null};
 await expect(entity.callAs({callerId:target,callerKind:"do"},"acceptChannelDelivery",delivery)).resolves.toEqual({deliveryId:"real-delivery",disposition:"processed"});
 const snapshot=await entity.call("snapshot");expect(snapshot.deliveries).toEqual([delivery]);expect(call).toHaveBeenCalledTimes(1);
 await expect(entity.callAs({callerId:target,callerKind:"do"},"acceptChannelDelivery",{...delivery,subscriptionRevision:2})).rejects.toThrow(/generation/);
 await expect(entity.callAs({callerId:"do:other:Channel:other",callerKind:"do"},"acceptChannelDelivery",delivery)).rejects.toThrow(/exact admitted channel/);
});
it("the fixture channel joins the same inherited canonical capture and wait without host RPC impersonation",async()=>{
 const receipt={queues:["channel-delivery" as const],barrier:{channelId:"owned-channel",headSequence:2,headHash:"actual-hash",admissionRevision:2}};
 const prepare=vi.spyOn(PubSubChannel.prototype,"prepareDurableWorkRelease").mockResolvedValue(receipt);
 const wait=vi.spyOn(PubSubChannel.prototype,"waitDurableWorkRelease").mockResolvedValue();
 const entity=await createTestDO(LocalMessagingChannelDO,{WORKER_SOURCE:"workers/local-messaging-fixture",WORKER_CLASS_NAME:"LocalMessagingChannelDO",__objectKey:"owned-channel"});dbs.push(entity.db);
 expect(rpcMethodAuthority(entity.instance,"joinFixtureDelivery")).toMatchObject({website:{kind:"closed"}});
 await expect(entity.instance.joinFixtureDelivery()).resolves.toEqual(receipt);
 expect(prepare).toHaveBeenCalledWith("delivery");expect(wait).toHaveBeenCalledWith("delivery",receipt.barrier);
});

it("registers sender and probe tables before fixture RPCs can change the durable schema", async () => {
  const probe = await createTestDO(LocalMessagingProbeDO);
  dbs.push(probe.db);
  const image = {
    WORKER_SOURCE: "workers/local-messaging-fixture",
    WORKER_CLASS_NAME: "LocalMessagingSenderDO",
    WORKER_EXECUTION_DIGEST: "e".repeat(64),
  };
  const schemaProbe = await createTestDO(
    LocalMessagingSenderDO,
    { ...image, VIBESTUDIO_SCHEMA_PROBE: true },
    { initialize: false },
  );
  dbs.push(schemaProbe.db);
  const response = await schemaProbe.instance.fetch(
    new Request("http://test/test-key/__vibestudio_schema_descriptor"),
  );
  expect(response.ok).toBe(true);
  const sender = await createTestDO(LocalMessagingSenderDO, {
    ...image,
    VIBESTUDIO_SCHEMA_DESCRIPTOR: await response.json(),
  });
  dbs.push(sender.db);
  const tables = (sql: typeof probe.sql) => sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'messaging_%' ORDER BY name")
    .toArray()
    .map(({ name }) => name);
  expect(tables(probe.sql)).toEqual([
    "messaging_configuration", "messaging_probe_deliveries", "messaging_probe_revision",
  ]);
  expect(tables(sender.sql)).toEqual(["messaging_configuration", "messaging_send"]);
});
