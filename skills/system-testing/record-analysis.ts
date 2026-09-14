import { summarizeEntry, summarizeFailures, type DiagnosticLimits } from "./diagnostics.js";
import { isUnexpectedToolFailure } from "./tool-failure-classification.js";
import type { TestSuiteResultEntry } from "./types.js";
import type { SystemTestRunRecord } from "./cli.js";

export function inspectSystemTestRun(
  record: SystemTestRunRecord,
  options?: { testName?: string; limits?: Partial<DiagnosticLimits> },
): unknown {
  if (options?.testName) {
    return summarizeEntry(requireEntry(record, options.testName), options.limits);
  }
  return {
    ...record.summary,
    config: record.config,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt ?? record.completedAt,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    provenance: record.provenance,
    diagnostics: summarizeFailures(record.suite, options?.limits),
  };
}

export function systemTestTrajectory(
  record: SystemTestRunRecord,
  testName: string,
  options?: { full?: boolean; limits?: Partial<DiagnosticLimits> },
): unknown {
  const entry = requireEntry(record, testName);
  if (options?.full) return entry;
  return summarizeEntry(entry, options?.limits);
}

export function failedSystemTestNames(record: SystemTestRunRecord): string[] {
  return record.suite.results
    .filter(
      (entry) =>
        !entry.result.passed ||
        Boolean(entry.execution.error) ||
        (entry.execution.toolFailures ?? []).some(isUnexpectedToolFailure),
    )
    .map((entry) => entry.test.name);
}

function requireEntry(record: SystemTestRunRecord, testName: string): TestSuiteResultEntry {
  const entry = record.suite.results.find((candidate) => candidate.test.name === testName);
  if (!entry) throw new Error(`Run ${record.runId} has no test named ${testName}`);
  return entry;
}
