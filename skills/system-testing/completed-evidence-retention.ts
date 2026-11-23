import type { RetainedTestEvidence, TestSuiteResultEntry } from "./types.js";

/** Keep verdicts and stable identity in memory after the original entry is durable.
 * The referenced blob and native entry pages retain the complete, unchanged packet.
 */
export function retainedSystemTestEntry(entry: TestSuiteResultEntry, evidence: RetainedTestEvidence): TestSuiteResultEntry {
  if (!/^[a-f0-9]{64}$/u.test(evidence.digest) || !Number.isSafeInteger(evidence.size) || evidence.size <= 0)
    throw new Error("A completed test needs an acknowledged full-evidence reference");
  return {
    test: { ...entry.test },
    result: { passed: entry.result.passed, ...(entry.result.reason ? { reason: entry.result.reason } : {}) },
    execution: {
      messages: [], duration: entry.execution.duration,
      ...(entry.execution.error ? { error: entry.execution.error } : {}),
      ...(entry.execution.provenance ? { provenance: { ...entry.execution.provenance } } : {}),
      ...(entry.execution.toolFailures ? { toolFailures: entry.execution.toolFailures.map(failure => ({ ...failure })) } : {}),
    },
    retainedEvidence: { digest: evidence.digest, size: evidence.size },
  };
}
