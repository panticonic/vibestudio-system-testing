/**
 * Natlang scenarios for the agent-facing helpers of the Base sandbox skill: claim checking, locating documentation and
 * recovering from a failed call.
 *
 * Each case gives a user-level goal and grades two halves, as the wave scenarios do. The surface half reads the eval
 * result's `natlang.calls`: the helper's small-model decision completed. The agent half checks what only an agent that
 * used the result could report. The prompts never name the helper or the skill; finding it is the point.
 */
import type { TestCase, TestExecutionResult } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import { findLastAgentMessage, getToolCalls } from "./_helpers.js";

const CATEGORY = "natlang-skills";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The natlang calls the successful eval cells reported, by function name and outcome. */
function natlangCalls(result: TestExecutionResult): Array<{ name: string; outcome: string }> {
  return getToolCalls(result).flatMap((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError) return [];
    const calls = record(record(record(call.execution.result)?.["details"])?.["natlang"])?.["calls"];
    return Array.isArray(calls)
      ? calls.flatMap((entry) => {
          const summary = record(entry);
          return typeof summary?.["name"] === "string" && typeof summary["outcome"] === "string"
            ? [{ name: summary["name"], outcome: summary["outcome"] }]
            : [];
        })
      : [];
  });
}

/** The named small-model decision completed at least once ("done" is natlang's success outcome). */
function requireNatlang(result: TestExecutionResult, name: string) {
  const calls = natlangCalls(result);
  return calls.some((call) => call.name === name && call.outcome === "done")
    ? { passed: true as const }
    : {
        passed: false as const,
        reason: `The natlang function ${name} never completed in an eval. Reported calls: ${
          calls.map((call) => `${call.name}:${call.outcome}`).join(", ") || "(none)"
        }`,
      };
}

function graded(result: TestExecutionResult, decision: string, answer: (final: string) => string | null) {
  const base = validateAgentCompletionReport(result);
  if (!base.passed) return base;
  const natlang = requireNatlang(result, decision);
  if (!natlang.passed) return natlang;
  const missing = answer(findLastAgentMessage(result));
  return missing === null ? { passed: true } : { passed: false, reason: missing };
}

/** A customer reply that states the refund amount, contradicts the delivery date it was asked to confirm, and omits the case number. */
const DRAFT_REPLY =
  "Hi Sam, thanks for your patience. We've issued a refund of 42.50 EUR to the card you paid with; it usually shows up within five working days. " +
  "Your replacement kettle is not in stock yet, so it will not ship this week. Let us know if anything else comes up.";

export const natlangAgentHelpTests: TestCase[] = [
  {
    name: "natlang-claim-check-draft-reply",
    description:
      "Before sending a drafted customer reply, the agent checks it states each fact the user listed and reports the one it contradicts and the one it leaves out, quoting the reply",
    category: CATEGORY,
    prompt:
      "Before I send this reply to a customer, check whether it tells them three things: that the refund is 42.50 EUR, that the replacement ships this week, and their case number. Quote the reply for each, and don't rewrite it.\n\n" +
      DRAFT_REPLY,
    validate: (result) =>
      graded(result, "verdict", (final) =>
        /not in stock|will not ship/iu.test(final)
          ? null
          : "The final response does not quote the reply's words that contradict the shipping claim",
      ),
    reportClaims: [
      {
        id: "case-number",
        claim: "The reply does not give the customer's case number.",
        match: /case number[^.\n]*(?:missing|absent|not (?:mention|includ|stat|giv)|omit)|(?:missing|absent|no|omits?)[^.\n]*case number/iu,
      },
    ],
  },
  {
    name: "natlang-locate-doc-eval-deadline",
    description: "The agent finds where the workspace documentation says how to give an eval call a deadline and quotes it",
    category: CATEGORY,
    prompt:
      "Where do the workspace docs say how to give an eval call a deadline, so a hung operation does not block forever? Give me the file and quote the passage exactly.",
    validate: (result) =>
      graded(result, "fits", (final) =>
        /skills\/sandbox\/EVAL\.md/u.test(final) && /timeoutMs/u.test(final)
          ? null
          : "The final response does not cite skills/sandbox/EVAL.md with its timeoutMs passage",
      ),
  },
  {
    name: "natlang-recover-pasted-failure",
    description:
      "A pasted tool error that only says the call was outside the caller's reachable context is read as a wrong-context failure with a next step",
    category: CATEGORY,
    prompt:
      "Starting an automation just failed with this error:\n\n[vcs.authorize] requested context is outside the caller's reachable context graph\n\nWhat kind of problem is this, and what should I do next? Don't retry it yet.",
    validate: (result) => graded(result, "cause", () => null),
    reportClaims: [
      {
        id: "wrong-context",
        claim: "The call was made in the wrong context: the context it asked for is outside what the caller can reach.",
        match: /wrong context/iu,
      },
      {
        id: "next",
        claim: "The next step is to find the context the automation should run in, rather than retrying the same call.",
      },
    ],
  },
];
