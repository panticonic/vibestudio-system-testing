import { expect, it } from "vitest";
import { AGENTIC_EVENT_PAYLOAD_KIND } from "@workspace/agentic-protocol";
import type { ChannelReplayEnvelope } from "@vibestudio/service-schemas/channel";
import { channelEnvelopePageInfo } from "@vibestudio/shared/channelEnvelopePaging";
import { readScheduledLaneReceipts } from "./scheduled-recovery-replay.js";

const contextId = "owned-context";
const lane = "owned-lane";
const senderId = "owned-sender";
type LogEvent = ChannelReplayEnvelope["logEvents"][number];
function page(logEvents: LogEvent[]): ChannelReplayEnvelope {
  const sequences = logEvents.map(row => row.id);
  const count = sequences.length;
  const info = channelEnvelopePageInfo({ channelId: lane, window: { kind: "after", seq: 0 }, limit: 100 }, {
    totalCount: count, firstSeq: sequences[0], lastSeq: sequences.at(-1),
  }, sequences);
  return {
    mode: "after", logEvents, snapshots: [],
    ready: {
      contextId, totalCount: count, envelopeCount: count,
      firstEnvelopeSeq: info.returnedFromSeq, replayFromId: info.returnedFromSeq, replayToId: info.returnedToSeq,
      snapshotLastSeq: info.snapshotLastSeq, hasMoreBefore: info.hasMoreBefore, hasMoreAfter: info.hasMoreAfter,
    },
  };
}

const read = (replay: ChannelReplayEnvelope) => readScheduledLaneReceipts(replay, contextId, lane, senderId);
const message: LogEvent = {
  id: 2, type: AGENTIC_EVENT_PAYLOAD_KIND, senderId, ts: 0, messageId: "envelope-2",
  payload: {
    kind: "message.completed", causality: { messageId: "original-note" },
    payload: { role: "user", blocks: [{ type: "text", content: "Current decision" }] },
  },
};
const observed = { ...message, id: 1, type: "observation", messageId: "envelope-1", payload: {} };

it("attests an empty archive from canonical owner paging metadata with no watermark", () => {
  const replay = page([]);
  expect(replay.ready.snapshotLastSeq).toBeUndefined();
  expect(read(replay)).toEqual([]);
});

it("recovers the exact owned durable receipt alongside unrelated projection events", () => {
  expect(read(page([observed, message]))).toEqual([
    { messageId: "original-note", text: "Current decision", lane, sender: senderId, sequence: 2 },
  ]);
});

it("rejects foreign, partial, or inconsistent replay windows", () => {
  const empty = page([]);
  const populated = page([observed, message]);
  expect(() => read({ ...empty, ready: { ...empty.ready, contextId: "foreign-context" } })).toThrow(/outside/);
  expect(() => read({ ...empty, mode: "initial" })).toThrow(/outside/);
  expect(() => read({ ...empty, ready: { ...empty.ready, hasMoreAfter: true } })).toThrow(/complete/);
  expect(() => read({ ...empty, ready: { ...empty.ready, totalCount: 1 } })).toThrow(/complete/);
  expect(() => read({ ...populated, ready: { ...populated.ready, snapshotLastSeq: undefined } })).toThrow(/complete/);
  expect(() => read({ ...populated, logEvents: [message] })).toThrow(/complete/);
  expect(() => read(page([{ ...message, senderId: "foreign-sender" }]))).toThrow(/author/);
});
