import { describe, expect, it } from "vitest";
import type { ServerLogEvent } from "@workspace/pubsub";
import { closedChildModelReports } from "./_subagent-evidence.js";

const evidence = { calls: [{ messageId: "message:one", ref: "local:lfm2.5-2.6b", outcome: "completed" }] };
function transcript(): ServerLogEvent[] {
  return [
    { id: 1, senderId: "child", payload: { kind: "message.completed", turnId: "turn:one",
      causality: { messageId: "message:one" }, payload: { outcome: "completed",
        blocks: [{ type: "text", content: "Observed heading" }] } } },
    { id: 2, senderId: "child", payload: { kind: "turn.closed", turnId: "turn:one", payload: {} } },
  ] as unknown as ServerLogEvent[];
}
describe("native child assignment evidence", () => {
  it("joins the report to its executed model and exact closed turn", () => {
    expect(closedChildModelReports(transcript(), "child", evidence)).toEqual([
      { text: "Observed heading", model: "local:lfm2.5-2.6b", messageId: "message:one", turnId: "turn:one" },
    ]);
  });
  it.each(["another-sender", "another-turn", "before-report", "failed-turn", "interrupted-turn"])(
    "rejects %s closure", (mismatch) => {
      const events = transcript();
      const close = events[1]!;
      if (mismatch === "another-sender") close.senderId = "other";
      if (mismatch === "another-turn") (close.payload as { turnId: string }).turnId = "turn:other";
      if (mismatch === "before-report") close.id = 0;
      if (mismatch === "failed-turn") (close.payload as { payload: object }).payload = { reason: "work_failed" };
      if (mismatch === "interrupted-turn") (close.payload as { payload: object }).payload = { reason: "user_interrupted" };
      expect(closedChildModelReports(events, "child", evidence)).toEqual([]);
    },
  );
  it("rejects launch settings, unrelated attempts and failed attempts", () => {
    for (const value of [{ model: "local:lfm2.5-2.6b" },
      { calls: [{ ...evidence.calls[0], messageId: "message:other" }] },
      { calls: [{ ...evidence.calls[0], outcome: "failed" }] }]) {
      expect(closedChildModelReports(transcript(), "child", value)).toEqual([]);
    }
  });
});
