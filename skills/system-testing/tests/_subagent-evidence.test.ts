import { describe, expect, it } from "vitest";
import type { ServerLogEvent } from "@workspace/pubsub";
import { completedChildModelReports } from "./_subagent-evidence.js";

const event: ServerLogEvent = {
  id: 4,
  messageId: "published:answer",
  type: "agentic.trajectory.v1/event",
  senderId: "child",
  ts: 4,
  payload: {
    kind: "message.completed",
    causality: { messageId: "native:3:11:0" },
    payload: {
      outcome: "completed",
      metadata: { nativeTaskId: 7, nativeConversationId: 3, nativeEntryId: 11 },
      blocks: [{ type: "text", content: "real answer" }],
    },
  },
};
function evidence(status = "done", answer = 11) {
  return {
    calls: [
      {
        native: { taskId: 7, conversationId: 3 },
        entryId: 11,
        outcome: "completed",
        ref: "local:model",
        // The original model task can finish before a successor settles its inputs.
        task: { status: "terminal", outcome: "completed" },
        inputs: [{ id: 5, conversationId: 3, type: "input", status, answer }],
      },
    ],
  };
}
describe("completed native child model evidence", () => {
  it("joins actual published entry to settled original input without synthetic turn events", () => {
    expect(completedChildModelReports([event], "child", evidence())).toEqual([
      {
        text: "real answer",
        model: "local:model",
        messageId: "native:3:11:0",
        nativeTaskId: 7,
        nativeEntryId: 11,
      },
    ]);
  });
  it("does not mistake a terminal generation handover for a settled original input", () => {
    expect(
      completedChildModelReports([event], "child", evidence("placed")),
    ).toEqual([]);
  });
  it("rejects a previous response when the original input was answered by a later entry", () => {
    expect(
      completedChildModelReports([event], "child", evidence("done", 12)),
    ).toEqual([]);
  });
  it("requires exact native conversation and actual child sender", () => {
    const foreign = evidence();
    foreign.calls[0]!.native.conversationId = 9;
    expect(completedChildModelReports([event], "child", foreign)).toEqual([]);
    expect(
      completedChildModelReports([event], "other-child", evidence()),
    ).toEqual([]);
  });
});
