import type { PendingApproval } from "@vibestudio/shared/approvals";

/**
 * Watching a terminal session's share of the person's approval queue.
 *
 * The session runs under the harness's test authority policy, like every other
 * system-test context: the launch service gives the app's context the policy of
 * the call that launched it, so the model credential the agent uses and the
 * gated requests its eval makes are decided by that policy and never queue. A
 * request that does reach the person's queue is therefore one the policy did
 * not decide (critical or irreversible work), and nobody in a headless run can
 * answer it: the guard names it and ends the scenario, rather than letting the
 * session wait for a decision that will never come.
 *
 * A terminal app runs as its own principal, so what is "the session's" is
 * attributed by who raised it: the launching harness, the app's own principal,
 * or an agent working in the app's context. Requests outside the session's
 * scope are not this test's to judge.
 */

export type ApprovalActor = "launcher" | "app" | "agent";

/** What identifies the session's requesters; filled in as the session starts. */
export interface TerminalApprovalScope {
  /** The harness runtime that launches and resumes the session. */
  launcherId: string;
  /** The running app incarnation's principal (`TerminalSessionEntry.principalId`). */
  appPrincipalId: string | null;
  /** The app's workspace context, where the agents it starts also run. */
  appContextId: string | null;
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

export class TerminalApprovalGuard {
  /** Every in-scope request that reached the queue, described. */
  readonly escalated: string[] = [];
  #scope: TerminalApprovalScope;
  #latest: readonly PendingApproval[] = [];
  readonly #seen = new Set<string>();

  constructor(
    scope: TerminalApprovalScope,
    /** Called once per in-scope request that reached the person's queue. */
    private readonly onEscalated: (error: Error) => void,
  ) {
    this.#scope = scope;
  }

  /** Learn more of the session's identity; pending requests are reconsidered. */
  setScope(scope: Partial<TerminalApprovalScope>): void {
    this.#scope = { ...this.#scope, ...scope };
    this.observe(this.#latest);
  }

  /** The approval queue's current pending set (each queue change delivers it whole). */
  observe(pending: readonly PendingApproval[]): void {
    this.#latest = pending;
    for (const approval of pending) {
      if (this.#seen.has(approval.approvalId)) continue;
      const actor = approvalActor(approval, this.#scope);
      if (!actor) continue;
      this.#seen.add(approval.approvalId);
      const description = describeApproval(approval, actor);
      this.escalated.push(description);
      this.onEscalated(
        new Error(
          `The terminal session raised an approval the test authority policy did not decide, which nobody can answer in a headless run: ${description}`,
        ),
      );
    }
  }
}
