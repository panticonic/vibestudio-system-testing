import type { TestCase, TestExecutionResult } from "../types.js";
import type { ManagedNotificationReceiver } from "../notification-lifecycle-managed.js";
import { notificationWorlds } from "../notification-worlds.js";
import { NativeNotificationLifecycleObservationSchema } from "@vibestudio/service-schemas/notification";
import { findLastAgentMessage, getToolCalls, noIncompleteInvocations, successfulEvalCode } from "./_helpers.js";

function notificationChecked(result: TestExecutionResult, actionLabels: string[] = []) {
  const pending = noIncompleteInvocations(result);
  if (!pending.passed) return pending;
  const final = findLastAgentMessage(result);
  if (!/notification/iu.test(final) || !/(accept|shown|show|display|creat|issu|sent|post|request)/iu.test(final) || !/(dismiss|remov|clean|clos)/iu.test(final))
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

const managedSettings = {
  category: "notifications",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/conversation-evidence-review"],
};
notificationTests.push(...notificationWorlds.map((world): TestCase => ({
  ...managedSettings,
  name: `notification-lifecycle-live-${world.id}`,
  description: "Show and dismiss one assigned temporary notification with native receipts",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const run = await runner.runManagedNotification(world.id, false, signal);
    if (run.kind !== "teacher") throw new Error("Expected notification teacher execution");
    const { teacher, verification, contextId } = run.value;
    return {
      messages: [],
      duration: Date.now() - started,
      provenance: { contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, managedNotification: { verification, contextId } },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as { trainingEligible?: boolean } | undefined;
    const fixture = result.diagnostics?.["managedNotification"] as
      Omit<Awaited<ReturnType<ManagedNotificationReceiver["runManagedNotificationTeacher"]>>, "teacher"> | undefined;
    return {
      passed: teacher?.trainingEligible === true && fixture?.verification.passed === true,
      details: fixture?.verification.checks,
    };
  },
})));
notificationTests.push({
  ...managedSettings,
  name: "notification-lifecycle-oracle-qualification",
  description: "Qualify plain and action-bearing host notifications without model calls",
  prompt: "Check host acceptance, same-identity dismissal, and foreign-ID rejection.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const cases = [];
    for (const { id } of notificationWorlds) {
      const run = await runner.runManagedNotification(id, true, signal);
      if (run.kind !== "reference") throw new Error("Notification qualification invoked a model");
      cases.push(run.value);
    }
    return { messages: [], duration: Date.now() - started, diagnostics: { notificationQualification: cases } };
  },
  validate(result) {
    const cases = result.diagnostics?.["notificationQualification"] as
      Awaited<ReturnType<ManagedNotificationReceiver["qualifyManagedNotification"]>>[] | undefined;
    return {
      passed: cases?.length === notificationWorlds.length &&
        cases.every(({ verification, rejectedForeignId }, index) =>
          verification.caseId === notificationWorlds[index]?.id && verification.passed && rejectedForeignId
        ),
      details: { cases: cases?.map(({ verification }) => verification.checks) },
    };
  },
});
