import { afterEach, describe, expect, it } from "vitest";
import { createNativeVesselTestDO } from "@workspace/agentic-do/testing/native-vessel";
import { AGENTIC_EVENT_PAYLOAD_KIND } from "@workspace/agentic-protocol";
import type { ChannelEvent } from "@workspace/harness";

import { TestAgentWorker } from "./test-agent-worker.js";

const databases = new Set<{ close(): void }>();
afterEach(() => {
  for (const database of databases) database.close();
  databases.clear();
});
async function nativeWorker<T>(
  ...args: Parameters<typeof createNativeVesselTestDO<T>>
) {
  const fixture = await createNativeVesselTestDO<T>(...args);
  databases.add(fixture.db);
  return fixture.instance;
}

const STANDARD_METHODS = [
  "pause",
  "resume",
  "connectModelCredential",
  "setModel",
  "setThinkingLevel",
  "setApprovalLevel",
  "setRespondPolicy",
  "getAgentSettings",
  "getModelExecutionEvidence",
  "getDebugState",
];

class CapturingTestAgentWorker extends TestAgentWorker {
  observeEvent(channelId: string, event: ChannelEvent) {
    return this.onChannelEvent(channelId, event);
  }

  published: Array<{
    event: { kind?: string; turnId?: string };
    opts?: unknown;
  }> = [];

  protected override createChannelClient() {
    return {
      publishAgenticEvent: async (
        _participantId: string,
        event: { kind?: string; turnId?: string },
        opts?: unknown,
      ) => {
        this.published.push({ event, opts });
        return { id: this.published.length };
      },
    } as never;
  }

  seedDeterministicSubscription(
    channelId = "ch-1",
    participantId = "agent-test",
  ) {
    this.sql.exec(
      `INSERT OR REPLACE INTO subscriptions
         (channel_id, context_id, revision, subscribed_at, config, relationship_json, participant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      channelId,
      "ctx-1",
      1,
      Date.now(),
      JSON.stringify({ deterministicResponse: true }),
      "{}",
      participantId,
    );
  }
}

class ContractTestAgentWorker extends TestAgentWorker {
  participant() {
    return this.getParticipantInfo("ch-1");
  }
}

describe("TestAgentWorker", () => {
  it("exposes the standard agent control methods", async () => {
    const instance = await nativeWorker(ContractTestAgentWorker);
    const methodNames = instance
      .participant()
      .methods?.map((method) => method.name);

    expect(methodNames).toEqual(expect.arrayContaining(STANDARD_METHODS));
  });

  it("publishes deterministic replies inside an explicit open and closed turn", async () => {
    const instance = await nativeWorker(CapturingTestAgentWorker);
    const worker = instance as CapturingTestAgentWorker;
    worker.seedDeterministicSubscription();

    const handled = await worker.observeEvent("ch-1", {
      id: 1,
      messageId: "msg-1",
      type: AGENTIC_EVENT_PAYLOAD_KIND,
      senderId: "panel:user",
      senderMetadata: { type: "panel", name: "User", handle: "user" },
      payload: {
        kind: "message.completed",
        actor: { kind: "panel", id: "panel:user" },
        causality: { messageId: "user-msg-1" },
        payload: {
          protocol: "agentic.trajectory.v1",
          role: "user",
          blocks: [
            { blockId: "user-msg-1:block:0", type: "text", content: "hello" },
          ],
          outcome: "completed",
        },
        createdAt: "2026-05-28T00:00:00.000Z",
      },
      ts: Date.now(),
    });

    expect(handled).toBe(true);

    expect(worker.published.map(({ event }) => event.kind)).toEqual([
      "turn.opened",
      "invocation.started",
      "invocation.output",
      "invocation.completed",
      "message.completed",
      "turn.closed",
    ]);
    expect(new Set(worker.published.map(({ event }) => event.turnId))).toEqual(
      new Set(["deterministic-turn-msg-1"]),
    );
  });

  it("leaves ordinary subscriptions and non-message events to native intake", async () => {
    const worker = await nativeWorker(CapturingTestAgentWorker);
    const event: ChannelEvent = {
      id: 1,
      messageId: "presence-1",
      type: "presence",
      senderId: "panel:user",
      senderMetadata: { type: "panel", name: "User", handle: "user" },
      payload: {},
      ts: Date.now(),
    };
    expect(await worker.observeEvent("ch-1", event)).toBe(false);
    worker.seedDeterministicSubscription();
    expect(await worker.observeEvent("ch-1", event)).toBe(false);
    expect(worker.published).toEqual([]);
  });
});
