import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { AGENTIC_EVENT_PAYLOAD_KIND, AGENTIC_PROTOCOL_VERSION } from "@workspace/agentic-protocol";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { rpc as RuntimeRpc } from "@workspace/runtime";

type ComposeSeed = {
  key: string;
  title: string;
  room: string;
  initial: object;
  updates: readonly object[];
};

export async function seedOpenGmailComposes(
  rpc: Pick<typeof RuntimeRpc, "call">,
  input: { contextId: string; caseId: string },
  ownerId: string,
  composes: readonly ComposeSeed[],
) {
  const sources = [];
  for (const compose of composes) {
    const channelId = "gmail-open-goal-" + crypto.randomUUID();
    const messageId = "compose-" + crypto.randomUUID();
    const options = { signal: AbortSignal.timeout(20_000) };
    let phase = "create channel";
    try {
      const { targetId, contextId } = await rpc.call("main", mainRpcMethods["runtime.createEntity"], [{
        kind: "do", execution: { surface: "code", source: "workers/pubsub-channel" },
        className: "PubSubChannel", key: channelId, contextId: input.contextId,
      }], options);
      if (contextId !== input.contextId) throw new Error("Gmail compose belongs to another context");
      phase = "initialize conversation";
      await rpc.call(targetId, channelClientRpcMethods.initializeConversation, [contextId, { title: compose.room }], options);
      phase = "join conversation witness";
      const joined = await rpc.call(targetId, channelClientRpcMethods.join, [{
        participantId: ownerId, operationId: "join:" + channelId, contextId,
        metadata: { type: "agent", name: "Draft history witness", handle: "draft-history-witness" },
        delivery: "none", endpoint: { kind: "entity", entityId: ownerId, invocation: "direct" },
        applicationConfig: null, replay: false,
      }], options);
      if (!joined.ok || joined.participantId !== ownerId) throw new Error("The compose witness did not join its owned room");
      const actor = { kind: "agent", id: ownerId, participantId: ownerId };
      async function append(kind: "custom.started" | "custom.updated", state: object) {
        phase = kind;
        const envelope = await rpc.call(targetId, channelClientRpcMethods.publish, [
          ownerId, AGENTIC_EVENT_PAYLOAD_KIND, {
            kind, actor, createdAt: new Date().toISOString(),
            payload: { protocol: AGENTIC_PROTOCOL_VERSION, messageId, ...state },
          },
        ], options);
        return envelope.messageId;
      }
      const envelopeIds = [await append("custom.started", {
        typeId: "gmail.compose", displayMode: "row", initialState: compose.initial,
      })];
      for (const update of compose.updates) envelopeIds.push(await append("custom.updated", { update }));
      sources.push({ key: compose.key, title: compose.title, room: compose.room, channelId, targetId, messageId, ownerId, envelopeIds });
    } catch (error) {
      throw new Error(`Could not ${phase} for the owned Gmail compose in ${compose.room}`, { cause: error });
    }
  }
  return { ...input, sources };
}
