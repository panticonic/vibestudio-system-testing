import { doTargetId } from "@vibestudio/shared/workspaceServiceRpc";
import { expect, it, vi } from "vitest";
import { bindTranscriptCursor } from "./index.js";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@workspace/runtime", () => ({ contextId: "owned-context", rpc: { call } }));
const channelId = "owned-channel";
const targetId = doTargetId({
  source: "workers/pubsub-channel", className: "PubSubChannel", objectKey: channelId,
});

function nativePage(ids: number[], hasMore: boolean) {
  return {
    mode: "after",
    logEvents: ids.map((id) => ({ id, type: "system", messageId: `event-${id}` })),
    ready: { contextId: "owned-context", snapshotLastSeq: 6, replayToId: ids.at(-1), hasMoreAfter: hasMore },
  };
}

it("requires the exact prior cursor and watermark for continuation", async () => {
  call.mockReset().mockResolvedValueOnce(nativePage([2, 4], true))
    .mockResolvedValueOnce(nativePage([6], false));
  const { request, services } = bindTranscriptCursor({
    goal: "Recover the transcript", channelId, targetId,
    saved: { channelId, seq: 0 }, pageSize: 2, maxPages: 2,
  });
  const { operationId } = request;
  const start = await services.transcriptCursor.open(operationId);
  expect(start.first).toMatchObject({ nextAfter: 4, through: 6, messages: [] });
  await expect(services.transcriptCursor.next(operationId, 4, 7)).rejects.toThrow("original snapshot");
  await expect(services.transcriptCursor.next(operationId, 2, 6)).rejects.toThrow("previous page cursor");
  const last = await services.transcriptCursor.next(operationId, 4, 6);
  expect(last).toMatchObject({ nextAfter: 6, through: 6, hasMore: false });
  expect(call.mock.calls.map(([, , args]) => args[0])).toEqual([
    { after: 0, limit: 2 }, { after: 4, throughSeq: 6, limit: 2 },
  ]);
});

it("exposes a foreign checkpoint without reading the assigned channel", async () => {
  call.mockReset();
  const { request, services } = bindTranscriptCursor({
    goal: "Confirm the checkpoint owner", channelId, targetId,
    saved: { channelId: "other", seq: 18 }, pageSize: 2, maxPages: 2,
  });
  await expect(services.transcriptCursor.open(request.operationId)).resolves.toMatchObject({
    first: null, saved: { channelId: "other", seq: 18 },
  });
  expect(call).not.toHaveBeenCalled();
});
