import { isDeepStrictEqual } from "node:util";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { AGENTIC_EVENT_PAYLOAD_KIND, AGENTIC_PROTOCOL_VERSION } from "@workspace/agentic-protocol";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { rpc as RuntimeRpc } from "@workspace/runtime";
import { gmailComposeHistoryWorlds } from "./gmail-compose-history-worlds.js";

type Input = { contextId: string; caseId: string };
type Receipt = {
  channelId: string;
  messageId: string;
  events: {
    id: string; seq: number; event: string;
    state: {
      status: string; recipientPresent: boolean; alias: string; draftId: string | null;
      mimeIdentity: boolean; sentIdentity: boolean;
    };
  }[];
};
type History = { receipt: Receipt; decision: { action: string; reason: string }; evidenceIds: string[] };
type Review = { status: string; findings: { code: string; evidenceIds: string[] }[] };
type Report = { history: History; review: Review };
type Binding = {
  request: { goal: string; operationId: string };
  services: {
    gmailComposeHistory: { read(id: string): Promise<Receipt> };
    gmailComposeAudit: { project(id: string, kind: "draft" | "reconcile"): Promise<unknown> };
  };
};

export async function seedGmailComposeChannel(
  rpc: Pick<typeof RuntimeRpc, "call">,
  input: Input,
  ownerId: string,
) {
  const world = gmailComposeHistoryWorlds.find(({ id }) => id === input.caseId);
  if (!world) throw new Error("Unknown Gmail compose history");
  const channelId = "compose-history-" + crypto.randomUUID();
  const messageId = "compose-" + crypto.randomUUID();
  const { targetId, contextId } = await rpc.call("main", mainRpcMethods["runtime.createEntity"], [{
    kind: "do", execution: { surface: "code", source: "workers/pubsub-channel" },
    className: "PubSubChannel", key: channelId, contextId: input.contextId,
  }]);
  if (contextId !== input.contextId) throw new Error("The compose channel belongs to another context");
  await rpc.call(targetId, channelClientRpcMethods.initializeConversation, [contextId, { title: "Owned Gmail compose history" }]);
  const joined = await rpc.call(targetId, channelClientRpcMethods.join, [{
    participantId: ownerId, operationId: "join:" + channelId, contextId,
    metadata: { type: "agent", name: "Compose history witness", handle: "compose-history-witness" },
    delivery: "none", endpoint: { kind: "entity", entityId: ownerId, invocation: "direct" },
    applicationConfig: null, replay: false,
  }]);
  if (!joined.ok || joined.participantId !== ownerId) throw new Error("The compose witness did not join its owned channel");
  const actor = { kind: "agent", id: ownerId, participantId: ownerId };
  async function append(kind: "custom.started" | "custom.updated", state: object) {
    const envelope = await rpc.call(targetId, channelClientRpcMethods.publish, [
      ownerId, AGENTIC_EVENT_PAYLOAD_KIND, {
        kind, actor, createdAt: new Date().toISOString(),
        payload: { protocol: AGENTIC_PROTOCOL_VERSION, messageId, ...state },
      },
    ]);
    return { id: envelope.messageId, seq: envelope.id };
  }
  const lineage = [await append("custom.started", {
    typeId: "gmail.compose", displayMode: "row", initialState: world.initial,
  })];
  for (const update of world.updates) lineage.push(await append("custom.updated", { update }));
  return { ...input, channelId, targetId, messageId, ownerId, lineage, goal: world.goal };
}

type Seed = Awaited<ReturnType<typeof seedGmailComposeChannel>>;
export function prepareGmailComposeHistory(seed: Seed, bound: Binding) {
  const assigned = gmailComposeHistoryWorlds.find(({ id }) => id === seed.caseId);
  if (!assigned) throw new Error("Unknown assigned compose history");
  const world = assigned;
  let received: Receipt | undefined;
  let reads = 0;
  let projected: unknown;
  let projections = 0;
  const services = {
    gmailComposeAudit: {
      async project(id: string, kind: "draft" | "reconcile") {
        if (reads !== 1) throw new Error("Read the assigned channel history before projecting a review");
        const value = await bound.services.gmailComposeAudit.project(id, kind);
        projections++;
        projected = structuredClone(value);
        return value;
      },
    },
    gmailComposeHistory: {
      async read(id: string) {
        const receipt = await bound.services.gmailComposeHistory.read(id);
        reads++;
        received = structuredClone(receipt);
        return receipt;
      },
    },
  };
  const evidenceIds = [seed.lineage[0]!.id, seed.lineage.at(-1)!.id];
  function verify(report: Report | null) {
    const history = report?.history;
    let stage = { ...world.initial } as { status: string; to?: string; draftId?: string; rfcMessageId?: string };
    const expected = seed.lineage.map((entry, index) => {
      if (index) stage = { ...stage, ...world.updates[index - 1] };
      return { ...entry, event: index ? "update" : "start", state: {
        status: stage.status, recipientPresent: !!stage.to, alias: "default",
        draftId: stage.draftId ?? null, mimeIdentity: !!stage.rfcMessageId, sentIdentity: false,
      }};
    });
    const latest = expected.at(-1)!;
    const target = {
      id: expected[0]!.id, channelId: seed.channelId, accountRef: "channel-only:" + seed.channelId,
    };
    const readback = world.review.kind === "reconcile"
      ? { kind: "reconcile", id: latest.id, providerProof: "not-checked" }
      : {
        kind: "draft", id: latest.id, origin: "channel-readback",
        beforeDraft: expected.slice(0, -1).findLast(({ state }) => state.draftId !== null)?.state.draftId ?? null,
        afterDraft: latest.state.draftId,
      };
    const checks = {
      channel: reads === 1 && received?.channelId === seed.channelId && received.messageId === seed.messageId,
      lineage: isDeepStrictEqual(received?.events, expected) && isDeepStrictEqual(history?.receipt, received),
      disposition: history?.decision.action === world.action && typeof history.decision.reason === "string" && !!history.decision.reason.trim(),
      evidence: isDeepStrictEqual(history?.evidenceIds, evidenceIds),
      projection: projections === 1 && isDeepStrictEqual(projected, {
        kind: "compose", goal: world.goal,
        scope: { target, observed: { ...target, id: latest.id, binding: "channel-readback" } },
        card: {
          id: latest.id, messageId: seed.messageId, requestedMessageId: seed.messageId,
          ownedByChannel: true, state: latest.state.status, hasRecipient: latest.state.recipientPresent, alias: latest.state.alias,
        },
        readback,
      }),
      review: isDeepStrictEqual(report?.review, expectedReview(latest.id)),
    };
    return { seed, request: bound.request, received, projected, checks, passed: Object.values(checks).every(Boolean) };
  }
  function expectedReview(id: string): Review {
    return { status: world.review.status, findings: [{ code: world.review.code, evidenceIds: [id] }] };
  }
  async function reference() {
    const receipt = await services.gmailComposeHistory.read(bound.request.operationId);
    await services.gmailComposeAudit.project(bound.request.operationId, world.review.kind);
    return {
      history: { receipt, decision: { action: world.action, reason: "Related native compose records agree." }, evidenceIds },
      review: expectedReview(receipt.events.at(-1)!.id),
    };
  }
  return { request: bound.request, services, reference, qualify: async () => verify(await reference()), verify };
}

type Prepared = ReturnType<typeof prepareGmailComposeHistory>;
export interface GmailComposeHistoryReceiver {
  runGmailComposeHistoryTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyGmailComposeHistory(input: Input): ReturnType<Prepared["qualify"]>;
}
export const gmailComposeHistoryMethods = createReceiverRpcMethods<GmailComposeHistoryReceiver>([
  "runGmailComposeHistoryTeacher", "qualifyGmailComposeHistory",
]);
