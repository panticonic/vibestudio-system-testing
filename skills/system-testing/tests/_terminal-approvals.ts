import type { ApprovalDecisionId } from "@vibestudio/shared/approvalContract";
import type { PendingApproval } from "@vibestudio/shared/approvals";

/**
 * The person's side of a terminal session's approvals.
 *
 * A terminal app runs as its own principal outside any test-policy context, so
 * what it and the agents it starts ask for reaches the person's approval queue
 * like any other request. The scenario answers that queue through the same
 * presenter API a terminal client uses (`shellApproval.resolve`), from a
 * declared table of expected requests: each rule names who may ask
 * (the launching harness, the app's own principal, or an agent working in the
 * app's context), the exact capability, and the decision. Any other request in
 * the session's scope is denied, so the requester settles, and fails the test.
 * Requests outside the session's scope are not this test's to answer.
 */

export type ApprovalActor = "launcher" | "app" | "agent";

export interface TerminalApprovalRule {
  ruleId: string;
  actor: ApprovalActor;
  capability: string;
  /** Exact host-resolved resource (`resource.value` or `grantResourceKey`). */
  resourceValue?: string;
  /** Requester categories admitted for this rule (for example only `eval`). */
  requesterCategories?: readonly string[];
  decision: ApprovalDecisionId;
}

/** What identifies the session's requesters; filled in as the session starts. */
export interface TerminalApprovalScope {
  /** The harness runtime that launches and resumes the session. */
  launcherId: string;
  /** The running app incarnation's principal (`TerminalSessionEntry.principalId`). */
  appPrincipalId: string | null;
  /** The app's workspace context, where the agents it starts also run. */
  appContextId: string | null;
}

export interface AnsweredApproval {
  approvalId: string;
  actor: ApprovalActor;
  ruleId: string | null;
  kind: PendingApproval["kind"];
  capability: string | null;
  resource: string | null;
  callerId: string;
  requesterCategory: string | null;
  requesterId: string | null;
  decision: ApprovalDecisionId;
  outcome: "resolved" | "failed";
  error?: string;
}

/** Who in the session raised `approval`, or null when it is not the session's. */
export function approvalActor(
  approval: PendingApproval,
  scope: TerminalApprovalScope,
): ApprovalActor | null {
  if (approval.callerId === scope.launcherId) return "launcher";
  if (scope.appPrincipalId && approval.callerId === scope.appPrincipalId) return "app";
  const requester = approval.requester;
  if (scope.appContextId && requester?.contextId === scope.appContextId) return "agent";
  if (
    scope.appPrincipalId &&
    requester?.breadcrumbs.some((crumb) => crumb.id === scope.appPrincipalId)
  )
    return "agent";
  return null;
}

function capabilityOf(approval: PendingApproval): string | null {
  return approval.kind === "capability" ? approval.capability : null;
}

function resourceOf(approval: PendingApproval): string | null {
  if (approval.kind !== "capability") return null;
  return approval.resource?.value ?? approval.grantResourceKey ?? null;
}

export function matchApprovalRule(
  approval: PendingApproval,
  actor: ApprovalActor,
  rules: readonly TerminalApprovalRule[],
): TerminalApprovalRule | null {
  if (approval.kind !== "capability") return null;
  return (
    rules.find(
      (rule) =>
        rule.actor === actor &&
        rule.capability === approval.capability &&
        (rule.resourceValue === undefined ||
          rule.resourceValue === approval.resource?.value ||
          rule.resourceValue === approval.grantResourceKey) &&
        (rule.requesterCategories === undefined ||
          (approval.requester !== undefined &&
            rule.requesterCategories.includes(approval.requester.category))),
    ) ?? null
  );
}

export function describeApproval(approval: PendingApproval, actor: ApprovalActor): string {
  const capability = capabilityOf(approval);
  const resource = resourceOf(approval);
  const requester = approval.requester;
  return [
    `${approval.kind} approval ${approval.approvalId} from the ${actor}`,
    capability ? `capability ${capability}` : null,
    resource ? `resource ${resource}` : null,
    `caller ${approval.callerId}`,
    requester ? `requester ${requester.category} ${requester.title ?? requester.id}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

export class TerminalApprovalResponder {
  readonly answered: AnsweredApproval[] = [];
  #scope: TerminalApprovalScope;
  #latest: readonly PendingApproval[] = [];
  readonly #handled = new Set<string>();
  #processing: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<() => void>();

  constructor(
    private readonly rules: readonly TerminalApprovalRule[],
    scope: TerminalApprovalScope,
    private readonly resolve: (approvalId: string, decision: ApprovalDecisionId) => Promise<void>,
    /** An approval the session raised that the test did not expect, or could not answer. */
    private readonly onUnexpected: (error: Error) => void,
  ) {
    this.#scope = scope;
  }

  get scope(): Readonly<TerminalApprovalScope> {
    return this.#scope;
  }

  /** Learn more of the session's identity; pending requests are reconsidered. */
  setScope(scope: Partial<TerminalApprovalScope>): void {
    this.#scope = { ...this.#scope, ...scope };
    this.#schedule();
  }

  /** The approval queue's current pending set (each queue change delivers it whole). */
  observe(pending: readonly PendingApproval[]): void {
    this.#latest = pending;
    this.#schedule();
  }

  /** Settles once every answer started so far has been delivered or has failed. */
  settled(): Promise<void> {
    return this.#processing;
  }

  /** Resolve with the first approval answered under `ruleId`. */
  waitForRule(ruleId: string, signal?: AbortSignal): Promise<AnsweredApproval> {
    return new Promise((resolve, reject) => {
      const found = () =>
        this.answered.find((entry) => entry.ruleId === ruleId && entry.outcome === "resolved");
      const settle = () => {
        this.#listeners.delete(listener);
        signal?.removeEventListener("abort", onAbort);
      };
      const listener = () => {
        const entry = found();
        if (entry) {
          settle();
          resolve(entry);
        }
      };
      const onAbort = () => {
        settle();
        reject(signal!.reason);
      };
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#listeners.add(listener);
      listener();
    });
  }

  #schedule(): void {
    this.#processing = this.#processing.then(() => this.#process());
  }

  async #process(): Promise<void> {
    for (const approval of this.#latest) {
      if (this.#handled.has(approval.approvalId)) continue;
      const actor = approvalActor(approval, this.#scope);
      if (!actor) continue;
      this.#handled.add(approval.approvalId);
      const rule = matchApprovalRule(approval, actor, this.rules);
      const decision: ApprovalDecisionId = rule?.decision ?? "deny";
      const entry: AnsweredApproval = {
        approvalId: approval.approvalId,
        actor,
        ruleId: rule?.ruleId ?? null,
        kind: approval.kind,
        capability: capabilityOf(approval),
        resource: resourceOf(approval),
        callerId: approval.callerId,
        requesterCategory: approval.requester?.category ?? null,
        requesterId: approval.requester?.id ?? null,
        decision,
        outcome: "resolved",
      };
      const offered = approval.kind === "capability" ? approval.allowedDecisions : undefined;
      try {
        if (offered && !offered.includes(decision)) {
          throw new Error(`it offers ${offered.join(", ")}, not ${decision}`);
        }
        await this.resolve(approval.approvalId, decision);
      } catch (error) {
        entry.outcome = "failed";
        entry.error = error instanceof Error ? error.message : String(error);
      }
      this.answered.push(entry);
      for (const listener of [...this.#listeners]) listener();
      if (entry.outcome === "failed") {
        this.onUnexpected(
          new Error(
            `Answering ${describeApproval(approval, actor)} with ${decision} failed: ${entry.error}`,
          ),
        );
      } else if (!rule) {
        this.onUnexpected(
          new Error(
            `The terminal session raised an approval the test does not expect (denied): ${describeApproval(approval, actor)}`,
          ),
        );
      }
    }
  }
}
