import { describe, expect, it, vi } from "vitest";
import { HeadlessSession } from "@workspace/agentic-session";
import {
  awaitChatPanelConnected,
  observeChatPanelRendering,
  observeFeedbackRepair,
  sessionBoundSignal,
} from "./real-chat-panel.js";

/** A page whose evaluation never settles until the page is closed. */
function hangingPanel() {
  let rejectEvaluation!: (error: Error) => void;
  const page = {
    evaluate: vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectEvaluation = reject;
        }),
    ),
    close: vi.fn(async () => rejectEvaluation(new Error("page closed"))),
  };
  return { page, panel: { id: "p1", cdp: { page: async () => page } } as never };
}

/** A real session (no connection) so `waitUntil` and `lifetime` are the product's. */
function realSession(): HeadlessSession {
  return HeadlessSession.create({
    config: { clientId: "c", rpc: {} },
  } as never);
}

const answer = { id: "m1", senderId: "agent", turnId: "native-run:4:58" } as never;
const feedback = [
  {
    payload: {
      target: { kind: "agent", id: "agent", participantId: "agent" },
      category: "compile_failed",
      refs: { messageId: "m1", turnId: "native-run:4:58" },
      error: { message: "x" },
      occurrenceKey: "mdx:m1",
    },
  },
];

describe("real chat panel waits settle on abort and session close", () => {
  it("panel connection wait rejects on caller abort and closes the page", async () => {
    const { page, panel } = hangingPanel();
    const controller = new AbortController();
    const wait = awaitChatPanelConnected(panel, controller.signal);
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalled());
    controller.abort(new Error("cancelled"));
    await expect(wait).rejects.toThrow("cancelled");
    expect(page.close).toHaveBeenCalled();
  });

  it("panel connection wait rejects when the session closes", async () => {
    const { page, panel } = hangingPanel();
    const session = realSession();
    const wait = awaitChatPanelConnected(panel, sessionBoundSignal(session));
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalled());
    await session.close().catch(() => undefined);
    await expect(wait).rejects.toThrow("Headless session closed");
    expect(page.close).toHaveBeenCalled();
  });

  it("a page whose close never rejects its evaluation still settles on abort", async () => {
    const page = {
      evaluate: vi.fn(() => new Promise(() => undefined)),
      close: vi.fn(async () => {
        throw new Error("close failed");
      }),
    };
    const controller = new AbortController();
    const wait = awaitChatPanelConnected(
      { cdp: { page: async () => page } } as never,
      controller.signal,
    );
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalled());
    controller.abort(new Error("cancelled"));
    await expect(wait).rejects.toThrow("cancelled");
  });

  it("render settling rejects on caller abort and on session close", async () => {
    for (const how of ["abort", "close"] as const) {
      const { page, panel } = hangingPanel();
      const session = realSession();
      const controller = new AbortController();
      const wait = observeChatPanelRendering(session, panel, answer, {
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalled());
      if (how === "abort") controller.abort(new Error("cancelled"));
      else await session.close().catch(() => undefined);
      await expect(wait).rejects.toThrow(how === "abort" ? "cancelled" : "closed");
    }
  });

  it("repair-turn observation rejects on caller abort and on session close", async () => {
    for (const how of ["abort", "close"] as const) {
      const session = realSession();
      Object.defineProperty(session, "uiFeedback", { get: () => feedback });
      const controller = new AbortController();
      const wait = observeFeedbackRepair(session, answer, controller.signal);
      if (how === "abort") controller.abort(new Error("cancelled"));
      else await session.close().catch(() => undefined);
      await expect(wait).rejects.toThrow(how === "abort" ? "cancelled" : "closed");
    }
  });

  it("ui.feedback arrival wait rejects on caller abort and on session close", async () => {
    for (const how of ["abort", "close"] as const) {
      const session = realSession();
      const controller = new AbortController();
      const wait = session.waitUntil(
        () => (session.uiFeedback.length > 0 ? true : undefined),
        { signal: controller.signal },
      );
      if (how === "abort") controller.abort(new Error("cancelled"));
      else await session.close().catch(() => undefined);
      await expect(wait).rejects.toThrow(how === "abort" ? "cancelled" : "closed");
    }
  });
});

describe("committedPanelId", () => {
  it("names the panel an openPanel failure left committed", async () => {
    const { committedPanelId } = await import("./runner.js");
    const error = {
      errorData: { details: { slotCommitted: true }, provenance: { panelId: "panel:x" } },
    };
    expect(committedPanelId(error)).toBe("panel:x");
    expect(committedPanelId({ errorData: { provenance: { panelId: "panel:x" } } })).toBeUndefined();
    expect(committedPanelId(new Error("boom"))).toBeUndefined();
  });
});
