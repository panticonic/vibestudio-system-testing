import type { TestExecutionResult, TestResult } from "./types.js";

interface TestkitSummary {
  total: number;
  failed: number;
  errored: number;
}

function validateSummary(summary: TestkitSummary): TestResult {
  const clean = summary.failed === 0 && summary.errored === 0 && summary.total > 0;
  return {
    passed: clean,
    reason: clean
      ? undefined
      : `${summary.failed} failed / ${summary.errored} errored of ${summary.total}`,
    details: { summary },
  };
}

function isTestkitSummary(value: unknown): value is TestkitSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TestkitSummary>;
  return [candidate.total, candidate.failed, candidate.errored].every(
    (count) => typeof count === "number"
  );
}

/** Validate summary evidence produced directly by the deterministic harness. */
export function validateDeterministicRun(result: TestExecutionResult): TestResult {
  const summary = result.diagnostics?.["deterministicSummary"];
  return isTestkitSummary(summary)
    ? validateSummary(summary)
    : { passed: false, reason: "no deterministic testkit summary found in harness evidence" };
}

/** Validate the final fenced testkit summary without parsing invocation JSON. */
export function validateDeterministicSummary(
  messages: Array<{ content?: unknown }>
): TestResult {
  const finalText = [...messages]
    .reverse()
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .find((content) => /```(?:json)?\s*[\s\S]*?```/i.test(content));
  const match = finalText?.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match?.[1]) {
    return { passed: false, reason: "no testkit summary JSON found in agent reply" };
  }
  try {
    const summary = JSON.parse(match[1].trim()) as unknown;
    return isTestkitSummary(summary)
      ? validateSummary(summary)
      : { passed: false, reason: "testkit summary JSON has an invalid shape" };
  } catch {
    return { passed: false, reason: "testkit summary JSON did not parse" };
  }
}
