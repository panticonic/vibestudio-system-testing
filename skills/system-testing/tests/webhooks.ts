import {
  NativeWebhookObservationSchema,
  type NativeWebhookObservation,
} from "@vibestudio/service-schemas/webhookIngress";
import type { TestCase } from "../types.js";
import {
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
  successfulEvalReturnValues,
} from "./_helpers.js";
import { walkRecords } from "./_scenario-evidence.js";

function hasSecretField(value: unknown): boolean {
  return walkRecords([value]).some((item) => Object.hasOwn(item, "secret"));
}

function observations(
  result: Parameters<typeof noIncompleteInvocations>[0]
): NativeWebhookObservation[] {
  return getToolCalls(result).flatMap((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError)
      return [];
    const value = call.execution.result as
      | {
          details?: {
            operationJournal?: { protocol?: string; truncated?: boolean; entries?: unknown[] };
          };
        }
      | undefined;
    const journal = value?.details?.operationJournal;
    if (
      journal?.protocol !== "workspace-operations.v1" ||
      journal.truncated !== false ||
      !Array.isArray(journal.entries)
    )
      return [];
    return journal.entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      if (value["type"] !== "webhook.observation") return [];
      const parsed = NativeWebhookObservationSchema.safeParse(value["receipt"]);
      return parsed.success ? [parsed.data] : [];
    });
  });
}

function lifecycleChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const facts = observations(result);
  const verified = facts.some((created, createIndex) => {
    if (created.method !== "createSubscription" || !created.hasSecret) return false;
    const revoked = facts.findIndex(
      (fact, index) =>
        index > createIndex &&
        fact.method === "revokeSubscription" &&
        fact.subscriptionId === created.subscriptionId
    );
    if (revoked < 0) return false;
    return (
      facts.some(
        (fact, index) =>
          index > createIndex &&
          index < revoked &&
          fact.method === "rotateSecret" &&
          fact.subscriptionId === created.subscriptionId &&
          fact.secretPresent
      ) &&
      facts.some(
        (fact, index) =>
          index > createIndex &&
          index < revoked &&
          fact.method === "listSubscriptions" &&
          fact.subscriptions.some(
            (row) => row.subscriptionId === created.subscriptionId && !row.revoked
          )
      ) &&
      !facts.some(
        (fact, index) =>
          index > revoked &&
          fact.method === "listSubscriptions" &&
          fact.subscriptions.some(
            (row) => row.subscriptionId === created.subscriptionId && !row.revoked
          )
      )
    );
  });
  if (!verified)
    return {
      passed: false,
      reason:
        "Native webhook facts did not join creation, active listing, rotation and completed revocation without contradictory later listings to one subscription",
    };
  if (successfulEvalReturnValues(result).some(hasSecretField))
    return {
      passed: false,
      reason: "Webhook lifecycle returned secret material rather than a redacted report",
    };
  const final = findLastAgentMessage(result);
  if (
    !/webhook|subscription/iu.test(final) ||
    !/rotat/iu.test(final) ||
    !/revok|removed|clean/iu.test(final)
  )
    return { passed: false, reason: "Final response did not report webhook rotation and cleanup" };
  return noIncompleteInvocations(result);
}

function listChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const lists = observations(result).filter(
    (fact) => fact.method === "listSubscriptions" && !fact.includeRevoked
  );
  const final = findLastAgentMessage(result);
  if (
    !/webhook|subscription/iu.test(final) ||
    !lists.some((list) => {
      if (list.method !== "listSubscriptions") return false;
      const count = list.subscriptions.filter((subscription) => !subscription.revoked).length;
      return (
        new RegExp(`(?:^|\\D)${count}(?:\\D|$)`, "u").test(final) ||
        (count === 0 &&
          /\b(?:zero|none)\b|\bno (?:active |registered |current |webhook )*subscriptions?\b/iu.test(
            final
          ))
      );
    })
  )
    return {
      passed: false,
      reason: "Final response did not report an actual native active-subscription count",
    };
  return noIncompleteInvocations(result);
}

export const webhookTests: TestCase[] = [
  {
    name: "webhook-subscription-lifecycle",
    description: "Create, list, rotate, and revoke a webhook subscription",
    category: "webhooks",
    authorityPolicy: {
      authority: [
        {
          ruleId: "manage-temporary-webhook",
          capability: { kind: "exact", key: "webhooks.manage" },
          resource: { kind: "exact", key: "webhooks.manage" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "Try a harmless temporary webhook subscription, confirm that it appears, and check that its secret can be rotated. If this deployment cannot support that, explain the concrete blocker.",
    validate: lifecycleChecked,
  },
  {
    name: "webhook-list-bounded",
    description: "List current webhook subscriptions",
    category: "webhooks",
    authorityPolicy: {
      authority: [
        {
          ruleId: "list-webhooks",
          capability: { kind: "exact", key: "webhooks.manage" },
          resource: { kind: "exact", key: "webhooks.manage" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "How many webhook subscriptions are currently registered in this workspace? Zero is a valid answer; keep the report bounded.",
    validate: listChecked,
  },
];
