/** Read the facts triage judges from one failure record. Exact work: fields in, redacted bounded signals out. */
import type { Failure, Signal } from "../types.js";

const LIMIT = 300;

/** Home directories and credential-looking strings never leave the record that held them. */
function redact(text: string): string {
  return text
    .replace(/\/(?:home|Users)\/[^/\s"']+/g, "~")
    .replace(
      /\b(?:sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}/g,
      "[redacted]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[hex]");
}

const clip = (text: string) => redact(text).slice(0, LIMIT);

export default function signals(failure: Failure): Signal[] {
  const out: Signal[] = [];
  if (failure.validationFailure)
    out.push({
      source: "validator-error",
      text: `the ${failure.validationFailure.validator} validator threw`,
    });
  if (failure.failure)
    out.push({
      source: "phase",
      text: clip(
        `${failure.failure.phase}: ${failure.failure.error.name}${failure.failure.error.code ? ` (${failure.failure.error.code})` : ""}: ${failure.failure.error.message}`,
      ),
    });
  if (failure.sessionError)
    out.push({ source: "session-error", text: clip(failure.sessionError) });
  for (const tool of failure.toolFailures) {
    const kind = [
      tool.failureKind,
      tool.classification,
      tool.failureCode ?? tool.terminalReasonCode,
    ]
      .filter(Boolean)
      .join(", ");
    out.push({
      source: "tool-failure",
      text: clip(
        `${tool.name}${kind ? ` [${kind}]` : ""}${tool.error ? `: ${tool.error}` : ""}`,
      ),
    });
  }
  for (const invocation of failure.invocations) {
    if (invocation.status !== "complete")
      out.push({
        source: "incomplete-invocation",
        text: clip(
          `${invocation.name} is ${invocation.status}${invocation.terminalReasonCode ? ` (${invocation.terminalReasonCode})` : ""}`,
        ),
      });
  }
  for (const error of failure.cleanupErrors)
    out.push({ source: "cleanup", text: clip(error) });
  for (const cleanup of failure.cleanupFailures)
    out.push({
      source: "cleanup",
      text: clip(`${cleanup.phase}: ${cleanup.error.message}`),
    });
  if (failure.workspaceRepoFixture?.creationScopeError)
    out.push({
      source: "fixture",
      text: clip(failure.workspaceRepoFixture.creationScopeError),
    });
  for (const violation of failure.channelDeliveryLatency?.violations ?? [])
    out.push({ source: "latency", text: clip(violation) });
  for (const [key, value] of Object.entries(failure.orchestration ?? {}))
    out.push({ source: "orchestration", text: clip(`${key}: ${value}`) });
  if (failure.validationReason)
    out.push({ source: "validation", text: clip(failure.validationReason) });
  if (failure.finalAgentMessage)
    out.push({
      source: "final-message",
      text: clip(failure.finalAgentMessage),
    });
  out.push({ source: "heuristic", text: clip(failure.likelyIssue) });
  return out.slice(0, 10);
}
