import { expect, it, vi } from "vitest";
vi.mock("@workspace/runtime", () => ({ contextId: "owned", rpc: {}, runtime: {} }));
vi.mock("@workspace/pubsub", () => ({ connectViaRpc(options: any) {
  return { contextId: options.contextId, onError: () => () => {}, close: async () => {},
    async ready() {
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await options.rpc.streamReadable(options.channelTargetId, { name: "subscribe" }, {}); return; }
        catch (error) { if (attempt === 3) throw error; }
      }
    } };
} }));
import { recoverOwnedSubscription } from "./open-goal-delivery-wake-managed.js";
it("retains owned subscription authority across more than two openings", async () => {
  let actual = 0;
  const port: any = { selfId: "client:owned", call: async () => null,
    async streamReadable() {
      if (++actual === 1) throw Object.assign(new Error("native transport reset"), { code: "ECONNRESET" });
      return { status: 200 };
    } };
  const result = await recoverOwnedSubscription(port, "channel", "target", "context", "recover");
  expect(result).toEqual({ channel: "channel", context: "context", attempts: 3,
    firstRejected: true, ready: true, admittedSurfaces: 1 });
});
