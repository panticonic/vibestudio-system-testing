/**
 * Natlang skill-port scenarios, wave 2 (plan section 6): vibestudio-vcs changes, web-research brief, memory recall
 * summary and system-test triage.
 *
 * Each case gives a user-level goal and grades two halves. The surface half reads the eval result's `natlang.calls`:
 * the ported function's small-model calls ran to completion. The agent half checks one discriminating token that only
 * an agent which used the result could produce. The prompts never name the function or the skill; finding it is the
 * point.
 */
import { type TestCase, type TestExecutionResult } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import { findLastAgentMessage, getToolCalls } from "./_helpers.js";

const CATEGORY = "natlang-skills";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The natlang calls the successful eval cells reported, by function name and outcome. */
function natlangCalls(
  result: TestExecutionResult,
): Array<{ name: string; outcome: string }> {
  return getToolCalls(result).flatMap((call) => {
    if (
      call.name !== "eval" ||
      call.execution?.status !== "complete" ||
      call.execution.isError
    )
      return [];
    const section = record(
      record(record(call.execution.result)?.["details"])?.["natlang"],
    );
    const calls = section?.["calls"];
    return Array.isArray(calls)
      ? calls.flatMap((entry) => {
          const summary = record(entry);
          return typeof summary?.["name"] === "string" &&
            typeof summary["outcome"] === "string"
            ? [{ name: summary["name"], outcome: summary["outcome"] }]
            : [];
        })
      : [];
  });
}

/** Every named function completed at least once ("done" is natlang's success outcome). */
function requireNatlang(result: TestExecutionResult, names: readonly string[]) {
  const calls = natlangCalls(result);
  const missing = names.filter(
    (name) =>
      !calls.some((call) => call.name === name && call.outcome === "done"),
  );
  return missing.length === 0
    ? { passed: true as const }
    : {
        passed: false as const,
        reason: `The natlang function(s) ${missing.join(", ")} never completed in an eval. Reported calls: ${
          calls.map((call) => `${call.name}:${call.outcome}`).join(", ") ||
          "(none)"
        }`,
      };
}

/** A pasted failure record, as a user would copy it from `inspect` output: the agent did the work and the check was narrow. */
const PASTED_FAILURE = JSON.stringify(
  {
    name: "diagnose-default-timeout",
    category: "diagnostics",
    validationReason: 'Expected the default 30s but found "thirty seconds"',
    finalAgentMessage:
      "The default request timeout is thirty seconds, as documented.",
    sessionError: null,
    failure: null,
    validationFailure: null,
    invocations: [
      { name: "read", status: "complete" },
      { name: "eval", status: "complete" },
    ],
    toolFailures: [],
    cleanupErrors: [],
    cleanupFailures: [],
    channelDeliveryLatency: null,
    workspaceRepoFixture: null,
    orchestration: null,
    likelyIssue: "validation-mismatch",
  },
  null,
  2,
);

export const natlangSkillsWave2Tests: TestCase[] = [
  {
    name: "natlang-triage-pasted-failure",
    description:
      "A pasted failed-test record in which the agent did the work is traced to the validator that was too narrow, with the record's own words as evidence",
    category: CATEGORY,
    prompt:
      "A system test failed and this is what the run record says for it:\n\n" +
      PASTED_FAILURE +
      "\n\nWhich layer should I go and fix, and what in the record shows it?",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["deliveredOutcome"]);
      if (!natlang.passed) return natlang;
      const final = findLastAgentMessage(result);
      return /\bvalidator\b/iu.test(final) && /thirty seconds|30s/iu.test(final)
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response does not name the validator layer with the record's evidence",
          };
    },
  },
];
