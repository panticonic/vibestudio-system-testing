import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { notificationTests } from "./notifications.js";

const actionsTest = notificationTests.find((test) => test.name === "show-with-actions")!;
const showTest = notificationTests.find((test) => test.name === "show-notification")!;
const show = { protocol: "notification-lifecycle-observation.v1", method: "notification.show", notificationId: "host-notification", actionLabels: ["Accept", "Decline"] };
const dismiss = { protocol: "notification-lifecycle-observation.v1", method: "notification.dismiss", notificationId: "host-notification" };
function execution(receipts: unknown[], code = "await notifications.show(input); await notifications.dismiss(id);", summary: unknown = { arbitrarySummary: "done" }, finalContent = "The host accepted the test notification and it was explicitly dismissed."): TestExecutionResult {
  return { duration: 0, messages: [
    { kind: "message", id: "eval", senderId: "agent", senderMetadata: { type: "agent" }, complete: true, contentType: "invocation", content: "", invocation: {
      id: "eval-call", name: "eval", arguments: { code }, execution: { status: "complete", isError: false, result: { details: { success: true, returnValue: summary, operationJournal: { protocol: "workspace-operations.v1", truncated: false, entries: receipts.map((receipt) => ({ type: "notification.lifecycle", receipt })) } } },
    } } },
    { kind: "message", id: "final", senderId: "agent", senderMetadata: { type: "agent" }, complete: true, content: finalContent },
  ] } as unknown as TestExecutionResult;
}

describe("notification lifecycle system test validators", () => {
  it("joins native acceptance and explicit cleanup independently of the guest summary", () => {
    expect(actionsTest.validate(execution([show, dismiss]))).toEqual({ passed: true });
    expect(actionsTest.validate(execution([{ ...show, actionLabels: ["Decline", "Accept"] }, dismiss])).passed).toBe(true);
  });
  it("accepts a final report that the host accepted the notification dismissal", () => {
    expect(actionsTest.validate(execution([show, dismiss], undefined, undefined, "Both operations completed: the shell host accepted the informational TEST notification, then accepted its dismissal."))).toEqual({ passed: true });
  });
  it("accepts the exact successful final response for show-notification", () => {
    expect(
      showTest.validate(
        execution(
          [
            { ...show, actionLabels: [] },
            dismiss,
          ],
          undefined,
          undefined,
          "Both operations completed: the shell host accepted the informational TEST notification, then accepted its dismissal."
        )
      )
    ).toEqual({ passed: true });
  });
  it("still requires final reporting of acceptance and cleanup", () => {
    for (const finalContent of [
      "The host accepted the informational TEST notification.",
      "The notification was explicitly dismissed.",
    ]) {
      expect(actionsTest.validate(execution([show, dismiss], undefined, undefined, finalContent)).passed).toBe(false);
    }
  });
  it("rejects guest-only claims, missing cleanup, another identity and reversed lifecycle", () => {
    for (const receipts of [[], [show], [show, { ...dismiss, notificationId: "another" }], [dismiss, show]])
      expect(actionsTest.validate(execution(receipts, "return {shown:true,dismissed:true}", { shown: true, dismissed: true })).passed).toBe(false);
  });
  it("checks accepted action labels rather than source-code spelling", () => {
    for (const labels of [["Accept"], ["Accept", "Later"], ["Accept", "Accept", "Decline"]])
      expect(actionsTest.validate(execution([{ ...show, actionLabels: labels }, dismiss])).passed).toBe(false);
  });
  it("rejects fabricated user action reporting", () => {
    expect(actionsTest.validate(execution([show, dismiss], "await notifications.reportAction(id, 'accept');")).passed).toBe(false);
  });
});
