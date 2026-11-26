import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { TestSuiteResultEntry } from "./types.js";

export interface ProviderOutageEvidence {
  caseName: string;
  callId: string;
  kind: string;
  model: string;
  errorSha256: string;
  circuitOpen: boolean;
}
export interface ProviderAdmissionStop {
  reason: "provider-transport-outage";
  evidence: ProviderOutageEvidence[];
  queuedTests: string[];
}
const object = (value: unknown): Record<string, any> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;

/** Match Python captured_provider_transport_errors' canonical error hash. */
export function providerErrorSha256(value: unknown): string {
  const encode = (x: any): string =>
    Array.isArray(x)
      ? `[${x.map(encode).join(",")}]`
      : x !== null && typeof x === "object"
        ? `{${Object.keys(x)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${encode(x[k])}`)
            .join(",")}}`
        : (() => {
            const encoded = JSON.stringify(x);
            if (encoded === undefined)
              throw new TypeError("Native error is not JSON");
            return encoded;
          })();
  return sha256HexSyncText(
    encode(value).replace(
      /[\u007f-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ),
  );
}
export function providerTransportCause(message: unknown): boolean {
  if (typeof message !== "string") return false;
  let cause = message
    .replace(/^Circuit breaker is open; last failure: /u, "")
    .replace(/^(?:GET|POST|PUT|PATCH|DELETE) https?:\/\/\S+: /u, "");
  return /^(?:fetch failed(?: \(record |$)|Client network socket disconnected before secure TLS connection was established|(?:connect |read )?(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b|getaddrinfo (?:EAI_AGAIN|ETIMEDOUT)\b|upstream HTTP (?:408|429|5[0-9]{2})\b|socket hang up(?: \(record |$)|Network destination name resolution timed out$)/u.test(
    cause,
  );
}

/** Native request failures, never successful model text or an authored/tool exception. */
export function capturedProviderOutage(entry: TestSuiteResultEntry): {
  attempted: boolean;
  evidence: ProviderOutageEvidence[];
} {
  const teacher = object(entry.execution.diagnostics?.natlangTeacher);
  const calls = Array.isArray(teacher?.calls) ? teacher.calls : [];
  const roots = teacher?.rootCallIds;
  if (
    !teacher ||
    !Array.isArray(teacher.captureErrors) ||
    teacher.captureErrors.length ||
    !Array.isArray(roots) ||
    roots.length !== 1
  )
    return { attempted: false, evidence: [] };
  const records = new Map<string, any>(
    calls
      .filter((c: any) => typeof c?.record?.call_id === "string")
      .map((c: any) => [c.record.call_id, c]),
  );
  const root = records.get(roots[0])?.record;
  if (
    records.size !== calls.length ||
    !root ||
    root.outcome !== teacher.rootOutcome
  )
    return { attempted: false, evidence: [] };
  const underRoot = (id: string): boolean => {
    const seen = new Set();
    while (records.has(id) && !seen.has(id)) {
      if (id === roots[0]) return true;
      seen.add(id);
      id = records.get(id).record.parent_call_id;
    }
    return false;
  };
  const recovered = (id: string): boolean => {
    const original = records.get(id).record;
    const key = original.definition?.key;
    const todo = [id],
      seen = new Set();
    while (todo.length) {
      const current = todo.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const a of records.get(current)?.annotations ?? []) {
        const retry = records.get(a?.value?.by)?.record;
        if (
          a?.kind !== "retried" ||
          a?.source !== "runtime" ||
          !key ||
          retry?.definition?.key !== key ||
          retry?.parent_call_id !== original.parent_call_id
        )
          continue;
        if (retry.outcome === "done") return true;
        todo.push(a.value.by);
      }
    }
    return false;
  };
  let attempted = false;
  const evidence: ProviderOutageEvidence[] = [];
  for (const [id, call] of records) {
    const record = call.record;
    if (
      !underRoot(id) ||
      record.executor?.kind !== "agent" ||
      typeof record.executor.model_id !== "string"
    )
      continue;
    const turns = (record.model_turns ?? []).filter((e: any) =>
      ["generation", "score"].includes(e.kind),
    );
    const last = turns.at(-1);
    const valid = (e: any) =>
      e?.schema === "natlang.model-exchange/1" &&
      e.request?.invocation_id === id &&
      Array.isArray(e.request.messages) &&
      e.request.messages.length > 0;
    if (turns.some(valid)) attempted = true;
    if (
      entry.result.passed ||
      !teacher.executionError ||
      [
        "AbortError",
        "NatlangAbortError",
        "NatlangTimeoutError",
        "NatlangBudgetError",
        "NatlangModelBudgetError",
        "NatlangCancelledError",
      ].includes(teacher.executionError.name) ||
      !["error", "failed", "quiesced"].includes(teacher.rootOutcome) ||
      !["error", "failed"].includes(record.outcome) ||
      recovered(id) ||
      !valid(last) ||
      last.reply != null ||
      !providerTransportCause(last.error?.message)
    )
      continue;
    if (
      !(call.events ?? []).some(
        (e: any) =>
          e.kind === "model_request" &&
          e.phase === "error" &&
          e.call_id === id &&
          e.actor?.id === record.executor.model_id,
      )
    )
      continue;
    let errorSha256: string;
    try {
      errorSha256 = providerErrorSha256(last.error);
    } catch {
      continue;
    }
    evidence.push({
      caseName: entry.test.name,
      callId: id,
      kind: last.kind,
      model: record.executor.model_id,
      errorSha256,
      circuitOpen: last.error.message.startsWith(
        "Circuit breaker is open; last failure: ",
      ),
    });
  }
  return { attempted, evidence };
}

export class ProviderOutageAdmission {
  private readonly attempted = new Set<string>();
  private readonly failures = new Map<string, ProviderOutageEvidence[]>();
  observe(entry: TestSuiteResultEntry): ProviderOutageEvidence[] | undefined {
    const observed = capturedProviderOutage(entry);
    if (observed.attempted) this.attempted.add(entry.test.name);
    if (observed.evidence.length)
      this.failures.set(entry.test.name, observed.evidence);
    const evidence = [...this.failures.values()].flat();
    return evidence.some((e) => e.circuitOpen) ||
      (this.failures.size >= 2 &&
        this.failures.size / this.attempted.size >= 0.5)
      ? evidence
      : undefined;
  }
}
