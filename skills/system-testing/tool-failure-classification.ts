const ARGUMENT_REJECTION = /(?:^|unknown_tool_failure:\s*)Invalid arguments for tool\s+/i;
const SAFE_VCS_REJECTIONS = new Set([
  "ConflictPresent",
  "CoupledGroupIncomplete",
  "DestinationOccupied",
  "IntegrationIncomplete",
  "InvalidReference",
  "NoEffect",
  "RevisionChanged",
  "WorkingChangesPresent",
  "BuildGateFailed",
]);

/**
 * The harness rejects malformed tool arguments before invoking the tool. That
 * is a model/protocol correction, not a failed platform effect: no filesystem,
 * service, eval, or external operation began. Keep the rejected invocation in
 * diagnostics, but do not classify it with execution/infrastructure failures.
 */
export function isPreExecutionArgumentRejection(...values: unknown[]): boolean {
  return values.some((value) => typeof value === "string" && ARGUMENT_REJECTION.test(value));
}

/**
 * Discovery and verification may reject a request after dispatch when the
 * runtime has the authoritative workspace view. The typed failure proves
 * that no requested execution began and directs the agent to correct its input.
 */
export function isCorrectableToolInputRejection(toolName: string, ...values: unknown[]): boolean {
  if (!new Set(["read", "ls", "grep", "find", "glob", "stat", "verify"]).has(toolName)) return false;
  return values.some((value) => {
    let rendered: unknown;
    try {
      rendered = typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      return false;
    }
    if (typeof rendered !== "string") return false;
    return (
      rendered.includes('"protocol":"agent-tool-failure.v1"') &&
      rendered.includes('"kind":"invalid-input"') &&
      rendered.includes('"policy":"correct-input"')
    );
  });
}

/**
 * These typed VCS refusals are optimistic-concurrency, reference, or state
 * preconditions. The service/tool adapter guarantees that they perform no
 * effect and the agent is expected to re-observe and correct its request. Keep
 * them in the trajectory, but do not conflate a successful fail-closed guard
 * with an infrastructure failure.
 */
export function isSafeVcsDomainRejection(
  toolName: string,
  terminalReasonCode: string | undefined
): boolean {
  return (
    toolName === "vcs" &&
    terminalReasonCode !== undefined &&
    SAFE_VCS_REJECTIONS.has(terminalReasonCode)
  );
}

/**
 * Provenance is a read-only typed-root lookup. An exact root that is stale,
 * malformed, or unreachable is refused before any effect; the agent should
 * copy a freshly observed root unchanged and retry.
 */
export function isSafeProvenanceDomainRejection(
  toolName: string,
  terminalReasonCode: string | undefined
): boolean {
  return toolName === "provenance" && terminalReasonCode === "InvalidReference";
}

/**
 * Static module resolution happens before any eval guest code executes. A
 * typed unavailable-module result is therefore a correctable, no-effect input
 * rejection, not an infrastructure failure.
 */
export function isSafeEvalDomainRejection(
  toolName: string,
  terminalReasonCode: string | undefined
): boolean {
  return toolName === "eval" && terminalReasonCode === "module_not_available";
}

/**
 * Eval and source verification distinguish guest program failures from their
 * own infrastructure failing. Agentic development is expected to execute,
 * diagnose, edit, and rerun imperfect user code, so every such failure
 * explicitly typed as `user-code` has a distinct diagnostic owner. This
 * classification does not exempt it from the unexpected-failure verdict.
 * Deliberate broken-code scenarios must declare their intended fault.
 */
export function isGuestCodeFailure(
  toolName: string,
  terminalReasonCode: string | undefined,
  failureKind: string | undefined
): boolean {
  return (
    (toolName === "eval" || toolName === "verify") &&
    failureKind === "user-code" &&
    terminalReasonCode !== "module_not_available"
  );
}

/**
 * Subagent tools expose typed no-effect domain refusals. inspect_subagent
 * reports ambiguous references before reading anything; `notify` to a
 * `run:` addressee refuses terminal runs with a structured SubagentTerminal
 * outcome naming the
 * retained result and the real options. Keep these visible without treating
 * the guard itself as a platform execution failure.
 */
export function isSafeSubagentDomainRejection(
  toolName: string,
  terminalReasonCode: string | undefined
): boolean {
  if (toolName === "inspect_subagent" && terminalReasonCode === "InvalidReference") {
    return true;
  }
  return toolName === "notify" && terminalReasonCode === "SubagentTerminal";
}

export type BuiltInToolFailureClassification =
  | "argument-rejection"
  | "domain-rejection"
  | "guest-code-failure";

/**
 * Classification identifies the failing boundary; it never excuses a failed
 * invocation. Only a fault explicitly declared by the scenario is expected.
 */
export interface ToolFailureDisposition {
  expected?: boolean;
  classification?: BuiltInToolFailureClassification;
}

/**
 * Keep this predicate shared by the verdict, suite accounting, rerun selection,
 * reports, and diagnostics. Recovery and classification cannot turn an
 * incidental failure into a clean execution.
 */
export function isUnexpectedToolFailure(failure: ToolFailureDisposition): boolean {
  return failure.expected !== true;
}

/**
 * One canonical classifier preserves diagnostic ownership across reports
 * and validators. All classifications still fail unless the scenario declared
 * that specific invocation as an intentional fault.
 */
export function classifyBuiltInToolFailure(input: {
  name: string;
  terminalReasonCode?: string;
  failureCode?: string;
  failureKind?: string;
  error?: unknown;
  result?: unknown;
  description?: unknown;
}): BuiltInToolFailureClassification | null {
  if (isPreExecutionArgumentRejection(input.error, input.result, input.description)) {
    return "argument-rejection";
  }
  if (isCorrectableToolInputRejection(input.name, input.error, input.result, input.description)) {
    return "argument-rejection";
  }
  if (
    isSafeVcsDomainRejection(input.name, input.terminalReasonCode ?? input.failureCode) ||
    isSafeProvenanceDomainRejection(input.name, input.terminalReasonCode ?? input.failureCode) ||
    isSafeEvalDomainRejection(input.name, input.terminalReasonCode ?? input.failureCode) ||
    isSafeSubagentDomainRejection(input.name, input.terminalReasonCode ?? input.failureCode)
  ) {
    return "domain-rejection";
  }
  if (
    isGuestCodeFailure(
      input.name,
      input.terminalReasonCode ?? input.failureCode,
      input.failureKind
    )
  ) {
    return "guest-code-failure";
  }
  return null;
}
