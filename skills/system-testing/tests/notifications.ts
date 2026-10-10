import type { TestCase, TestExecutionResult } from "../types.js";
import { NativeNotificationLifecycleObservationSchema } from "@vibestudio/service-schemas/notification";
import { findLastAgentMessage, getToolCalls, noIncompleteInvocations, successfulEvalCode } from "./_helpers.js";

function notificationChecked(result: TestExecutionResult, actionLabels: string[] = []) {
  const pending = noIncompleteInvocations(result);
  if (!pending.passed) return pending;
  const final = findLastAgentMessage(result);
  if (!/notification/iu.test(final) || !/(accepted|shown|displayed|created)/iu.test(final) || !/(dismissed|dismissal|removed|cleaned|closed)/iu.test(final))
    return { passed: false, reason: "Final response did not report notification acceptance and explicit cleanup" };
  const code = successfulEvalCode(result);
  if (/notification\.reportAction|notifications\.reportAction/u.test(code))
    return { passed: false, reason: "Notification probe fabricated a user action" };
  const observations = getToolCalls(result).flatMap((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError === true) return [];
    const envelope = call.execution.result as { details?: { operationJournal?: { protocol?: unknown; truncated?: unknown; entries?: unknown[] } } } | undefined;
    const journal = envelope?.details?.operationJournal;
    if (journal?.protocol !== "workspace-operations.v1" || journal.truncated !== false || !Array.isArray(journal.entries)) return [];
    return journal.entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const native = entry as Record<string, unknown>;
      if (native["type"] !== "notification.lifecycle") return [];
      const parsed = NativeNotificationLifecycleObservationSchema.safeParse(native["receipt"]);
      return parsed.success ? [parsed.data] : [];
    });
  });
  if (observations.length !== 2) return { passed: false, reason: "Expected one native notification acceptance and one explicit dismissal" };
  const [show, dismiss] = observations;
  if (show?.method !== "notification.show" || dismiss?.method !== "notification.dismiss" || show.notificationId !== dismiss.notificationId)
    return { passed: false, reason: "Native notification acceptance and cleanup did not join the same identity in order" };
  if (JSON.stringify([...show.actionLabels].sort()) !== JSON.stringify([...actionLabels].sort()))
    return { passed: false, reason: "The accepted notification has different action labels" };
  return { passed: true };
}

export const notificationTests: TestCase[] = [
  {
    name: "show-notification",
    description: "Request and explicitly dismiss one host test notification",
    category: "notifications",
    prompt: "Show a harmless temporary informational TEST notification in the shell chrome, then remove it once the host accepts it. Report whether both operations completed.",
    validate: (result) => notificationChecked(result),
  },
  {
    name: "show-with-actions",
    description: "Request and dismiss a host test notification with exactly two action buttons",
    category: "notifications",
    prompt: "Show a temporary TEST notification in the shell chrome with exactly two clickable action buttons, Accept and Decline, then remove it once the host accepts it. Report whether both operations completed. Do not claim that the user clicked either choice.",
    validate: (result) => notificationChecked(result, ["Accept", "Decline"]),
  },
];
