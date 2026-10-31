/** The layer a record's typed fields decide by themselves, or null when only its meaning can. Exact reading, in rule order. */
import type { Failure, FailureClass } from "../types.js";

const HARNESS_PHASES =
  /^(?:workspace-fixture|fixture|device-driver|test-authority|orchestration)/;
const ARGUMENT_FAULTS = new Set([
  "argument-rejection",
  "domain-rejection",
  "guest-code-failure",
]);

export default function classify(failure: Failure): FailureClass | null {
  const phase = failure.failure?.phase ?? "";
  if (failure.validationFailure || phase === "validation") return "validator";
  if (
    HARNESS_PHASES.test(phase) ||
    failure.workspaceRepoFixture?.creationScopeError ||
    failure.orchestration
  )
    return "harness";
  if (
    failure.toolFailures.some(
      (tool) =>
        (tool.classification && ARGUMENT_FAULTS.has(tool.classification)) ||
        tool.failureKind === "user-code",
    )
  )
    return "documentation";
  if (
    failure.toolFailures.some(
      (tool) => tool.failureKind === "infrastructure",
    ) ||
    failure.cleanupFailures.length > 0 ||
    failure.cleanupErrors.length > 0 ||
    (failure.channelDeliveryLatency?.violations.length ?? 0) > 0 ||
    failure.invocations.some(
      (invocation) => invocation.status !== "complete",
    ) ||
    failure.sessionError ||
    phase !== ""
  ) {
    return "infrastructure";
  }
  return null;
}
