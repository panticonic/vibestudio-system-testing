import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { bindDeliveryHistory } from "@workspace-skills/delivery-history-bindings";
import type { DeliveryHistoryObservation, DeliveryHistoryReport } from "../conversation-evidence-review/types.js";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { deliveryHistoryWorlds } from "./delivery-history-worlds.js";

type Input = { contextId: string; caseId: string };

export async function prepareDeliveryHistory(input: Input) {
  const world = deliveryHistoryWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId) throw new Error("Unknown delivery history assignment");
  const source = await createOwnedHeadlessChannel(contextId, "Original delivery");
  const foreign = world.mode === "foreign";
  const selected = foreign ? await createOwnedHeadlessChannel(contextId, "Other delivery") : source;
  const key = "assigned-delivery";
  const send = (lane: typeof source) => withOwnedChannelClient(lane, contextId, (client) =>
    client.send(world.text, { idempotencyKey: key }),
  );
  const originalId = await send(source);
  const retryId = world.mode === "retry" ? await send(source) : null;
  const decoyId = foreign ? await send(selected) : null;
  const receipt = { channelId: source.key, messageId: originalId, senderId: rpc.selfId };
  const bound = bindDeliveryHistory({
    goal: world.goal, channelId: selected.key, channelTarget: selected.target, receipt,
    observeConsumer: () => withOwnedChannelClient(selected, contextId, async (client) => {
      return client.waitUntil(() => {
        const rows = client.messages.filter(({ id }) => id === originalId);
        if (rows.length)
          return rows.map(({ id, senderId, content }) => ({ messageId: id, senderId: senderId ?? "", text: content }));
      }, { signal: AbortSignal.timeout(8_000) });
    }),
  });
  let observed: DeliveryHistoryObservation | undefined;
  let reads = 0;
  const services: typeof bound.services = {
    deliveryHistory: {
      async inspect(id) {
        const result = await bound.services.deliveryHistory.inspect(id);
        observed = structuredClone(result);
        reads++;
        return result;
      },
    },
  };

  async function verify(report: DeliveryHistoryReport | null) {
    const page = await rpc.call(selected.target, channelClientRpcMethods.getReplayAfter, [{ after: 0, limit: 100 }]);
    const rows = page.logEvents.flatMap((row) => {
      const event = row.payload as AgenticEvent<"message.completed"> | undefined;
      if (event?.kind !== "message.completed" || !event.causality?.messageId) return [];
      return [{
        messageId: event.causality.messageId, senderId: row.senderId,
        envelopeId: row.messageId, sequence: row.id,
        text: (event.payload.blocks ?? []).map((block) => block.type === "text" ? block.content : "").join(""),
      }];
    });
    const canonical = rows[0];
    const checks = {
      scope: reads === 1 && observed?.channelId === selected.key && isDeepStrictEqual(observed.receipt, receipt) &&
        isDeepStrictEqual(report?.observation, observed),
      nativeDelivery: !page.ready.hasMoreAfter && rows.length === 1 && !!canonical &&
        canonical.messageId === (decoyId ?? originalId) && canonical.senderId === receipt.senderId &&
        canonical.text === world.text && (foreign ? decoyId !== originalId : decoyId === null) &&
        (world.mode === "retry" ? retryId === originalId : retryId === null),
      retained: !!canonical && (foreign
        ? observed?.retained.length === 0 && observed.rendered.length === 0
        : isDeepStrictEqual(observed?.retained, [canonical]) &&
          isDeepStrictEqual(observed?.rendered, [{ messageId: originalId, senderId: receipt.senderId, text: world.text }])),
      verdict: report?.origin === (foreign ? "foreign-channel" : "matched") &&
        report.consumer === (foreign ? "unreviewed" : "matched") && report.verified === !foreign,
    };
    return { ...input, request: bound.request, observed, canonical, retryId, decoyId, checks, passed: Object.values(checks).every(Boolean) };
  }

  async function qualify() {
    const observation = await services.deliveryHistory.inspect(bound.request.operationId);
    return verify({ observation, origin: foreign ? "foreign-channel" : "matched", consumer: foreign ? "unreviewed" : "matched", verified: !foreign });
  }
  return { request: bound.request, services, qualify, verify };
}

type Prepared = Awaited<ReturnType<typeof prepareDeliveryHistory>>;
export interface DeliveryHistoryReceiver {
  runDeliveryHistoryTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyDeliveryHistory(input: Input): ReturnType<Prepared["qualify"]>;
}
export const deliveryHistoryMethods = createReceiverRpcMethods<DeliveryHistoryReceiver>([
  "runDeliveryHistoryTeacher", "qualifyDeliveryHistory",
]);
