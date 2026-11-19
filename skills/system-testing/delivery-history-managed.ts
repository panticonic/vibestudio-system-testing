import { isDeepStrictEqual } from "node:util";
import { contextId, openPanel, panelTree, rpc } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { bindDeliveryHistory } from "@workspace-skills/delivery-history-bindings";
import type {
  ChatDeliveryPanel,
  ChatDeliveryReport,
  DeliveryHistoryObservation,
  DeliveryHistoryReport,
} from "../conversation-evidence-review/types.js";
import {
  createOwnedHeadlessChannel,
  withOwnedChannelClient,
} from "./session-replay-managed.js";
import {
  chatDeliveryWorlds,
  deliveryHistoryWorlds,
  deliveryOriginByMode,
  isChatDeliveryCase,
} from "./delivery-history-worlds.js";
import {
  CHAT_PANEL_SOURCE,
  awaitChatPanelConnected,
  observeVisibleChatMessage,
} from "./real-chat-panel.js";

type Input = { contextId: string; caseId: string };

async function prepareHistory(input: Input) {
  const world = [...deliveryHistoryWorlds, ...chatDeliveryWorlds].find(
    ({ id }) => id === input.caseId,
  );
  if (!world || input.contextId !== contextId) throw new Error("Unknown delivery history assignment");
  const source = await createOwnedHeadlessChannel(contextId, "Original delivery");
  const foreign = world.mode === "foreign";
  const missing = world.mode === "missing";
  const senderMismatch = world.mode === "sender-mismatch";
  const origin = deliveryOriginByMode[world.mode];
  const matched = origin === "matched";
  const consumer = matched ? "matched" : "unreviewed";
  const selected = foreign ? await createOwnedHeadlessChannel(contextId, "Other delivery") : source;
  const key = "assigned-delivery";
  const send = (lane: typeof source) => withOwnedChannelClient(lane, contextId, (client) =>
    client.send(world.text, { idempotencyKey: key }),
  );
  const originalId = await send(source);
  const retryId = world.mode === "retry" ? await send(source) : null;
  const decoyId = foreign ? await send(selected) : null;
  const senderId = rpc.selfId;
  const receipt = {
    channelId: source.key,
    messageId: missing ? crypto.randomUUID() : originalId,
    senderId: senderMismatch ? crypto.randomUUID() : senderId,
  };
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
        canonical.messageId === (decoyId ?? originalId) && canonical.senderId === senderId &&
        canonical.text === world.text && (foreign ? decoyId !== originalId : decoyId === null) &&
        (world.mode === "retry" ? retryId === originalId : retryId === null),
      retained: !!canonical && (foreign || missing
        ? observed?.retained.length === 0 && observed.rendered.length === 0
        : isDeepStrictEqual(observed?.retained, [canonical]) &&
          isDeepStrictEqual(observed?.rendered, [{ messageId: originalId, senderId, text: world.text }])),
      verdict: report?.origin === origin && report.consumer === consumer && report.verified === matched,
    };
    return { ...input, request: bound.request, observed, canonical, retryId, decoyId, checks, passed: Object.values(checks).every(Boolean) };
  }

  async function reference(): Promise<DeliveryHistoryReport> {
    const observation = await services.deliveryHistory.inspect(
      bound.request.operationId,
    );
    return { observation, origin, consumer, verified: matched };
  }
  return {
    request: bound.request,
    services,
    reference,
    verify,
    channelId: selected.key,
    visibleMessageId: decoyId ?? originalId,
    text: world.text,
    matched,
  };
}

export async function prepareDeliveryHistory(input: Input) {
  const history = await prepareHistory(input);
  if (!isChatDeliveryCase(input.caseId)) {
    return {
      request: history.request,
      services: history.services,
      qualify: async () => history.verify(await history.reference()),
      verify: (report: DeliveryHistoryReport | ChatDeliveryReport | null) =>
        history.verify(report && "delivery" in report ? null : report),
      release: async () => {},
    };
  }

  const panel = await openPanel(CHAT_PANEL_SOURCE, {
    contextId: input.contextId,
    ref: `ctx:${input.contextId}`,
    stateArgs: { channelName: history.channelId },
    parentId: null,
    focus: false,
  });
  const request = {
    ...history.request,
    contextId: input.contextId,
    panelId: panel.id,
  };
  let panelReads = 0;
  let observedPanel: ChatDeliveryPanel | null = null;
  async function observe(): Promise<ChatDeliveryPanel> {
    const signal = AbortSignal.timeout(20_000);
    const before = await panel.observe();
    const argsBefore = await panel.stateArgs.get<{ channelName?: string }>();
    await awaitChatPanelConnected(panel, signal);
    const messages = await observeVisibleChatMessage(
      panel,
      history.visibleMessageId,
      signal,
    );
    const after = await panel.observe();
    const argsAfter = await panel.stateArgs.get<{ channelName?: string }>();
    if (
      before.attemptId !== after.attemptId ||
      argsBefore.channelName !== argsAfter.channelName
    )
      throw new Error(
        "The assigned chat panel changed while reading the visible message",
      );
    return {
      contextId: after.contextId,
      panelId: after.panelId,
      channelId: argsAfter.channelName ?? null,
      source: after.source,
      phase: after.phase,
      messages,
    };
  }
  const services = {
    ...history.services,
    chatDeliveryPanel: {
      async inspect(panelId: string): Promise<ChatDeliveryPanel> {
        if (panelId !== request.panelId || !history.matched)
          throw new Error("The browser read is outside the assigned delivery");
        panelReads++;
        if (panelReads !== 1)
          throw new Error("The assigned browser read was already used");
        const result = await observe();
        observedPanel = structuredClone(result);
        return result;
      },
    },
  };
  const release = async () => {
    if (await panelTree.path(panel.id)) await panel.archive();
  };

  async function verify(
    report: DeliveryHistoryReport | ChatDeliveryReport | null,
  ) {
    const chat = report && "delivery" in report ? report : null;
    const verification = await history.verify(chat?.delivery ?? null);
    // The oracle reads the assigned pane independently, including the decoy
    // for a foreign receipt. The agent's browser service remains unused there.
    const actualPanel = await observe().finally(release);
    const checks = {
      ...verification.checks,
      livePanel:
        actualPanel.panelId === request.panelId &&
        actualPanel.contextId === request.contextId &&
        actualPanel.channelId === history.channelId &&
        actualPanel.source === CHAT_PANEL_SOURCE &&
        actualPanel.phase === "ready" &&
        isDeepStrictEqual(actualPanel.messages, [
          { messageId: history.visibleMessageId, text: history.text },
        ]),
      browserScope: history.matched
        ? panelReads === 1 &&
          isDeepStrictEqual(observedPanel, actualPanel) &&
          isDeepStrictEqual(chat?.panel, actualPanel)
        : panelReads === 0 && observedPanel === null && chat?.panel === null,
      chatVerdict:
        chat?.verdict === (history.matched ? "verified" : "history-unverified"),
      panelReleased: (await panelTree.path(panel.id)) === null,
    };
    return {
      ...verification,
      request,
      chat: { actualPanel, observedPanel, panelReads },
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    try {
      const delivery = await history.reference();
      return await verify({
        delivery,
        panel: history.matched
          ? await services.chatDeliveryPanel.inspect(request.panelId)
          : null,
        verdict: history.matched ? "verified" : "history-unverified",
      });
    } finally {
      await release();
    }
  }
  return { request, services, qualify, verify, release };
}

type Prepared = Awaited<ReturnType<typeof prepareDeliveryHistory>>;
export interface DeliveryHistoryReceiver {
  runDeliveryHistoryTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyDeliveryHistory(input: Input): ReturnType<Prepared["qualify"]>;
}
export const deliveryHistoryMethods =
  createReceiverRpcMethods<DeliveryHistoryReceiver>([
    "runDeliveryHistoryTeacher",
    "qualifyDeliveryHistory",
  ]);
