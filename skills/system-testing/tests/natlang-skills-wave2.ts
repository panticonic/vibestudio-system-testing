/**
 * Natlang skill-port scenarios, wave 2 (plan section 6): vibestudio-vcs changes, web-research brief, memory recall
 * summary, messaging addressee resolution and system-test triage.
 *
 * Each case gives a user-level goal and grades two halves. The surface half reads the eval result's `natlang.calls`:
 * the ported function's small-model calls ran to completion. The agent half checks one discriminating token that only
 * an agent which used the result could produce. The prompts never name the function or the skill; finding it is the
 * point.
 */
import {
  CONTENT_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
} from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import {
  findLastAgentMessage,
  getToolCalls,
  successfulEvalCode,
} from "./_helpers.js";

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
    name: "natlang-commit-message-proposal",
    description:
      "New project files are described with a commit message whose reason comes only from a recorded intent, and nothing is committed",
    category: CATEGORY,
    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    prompt:
      "In the project repository, add a README.md with a title and a short usage section, and a LICENSE file with a placeholder line. Don't commit anything. Then tell me the commit message you would use, and whether there is a recorded reason worth attaching to it.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["commitSubject"]);
      if (!natlang.passed) return natlang;
      const committed =
        getToolCalls(result).some(
          (call) =>
            call.name === "vcs" &&
            call.execution?.status === "complete" &&
            !call.execution.isError &&
            call.arguments?.["operation"] === "commit",
        ) || /vcs\s*\.\s*commit\s*\(/u.test(successfulEvalCode(result));
      if (committed)
        return {
          passed: false,
          reason: "The agent committed although the user asked it not to",
        };
      return /README/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response proposes a commit message that does not mention the README",
          };
    },
  },
  {
    name: "natlang-cited-web-brief",
    description:
      "A factual question is answered from fetched pages with each source's URL and the day it was read",
    category: CATEGORY,
    prompt:
      "What does the HTTP 429 status code mean, and how should a well-behaved client react to it? I want an answer I can cite: give me the sources and when you read them.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["findEvidence", "writeBrief"]);
      if (!natlang.passed) return natlang;
      const final = findLastAgentMessage(result);
      if (!/https?:\/\/\S+/u.test(final))
        return { passed: false, reason: "The final response cites no URL" };
      return /\b\d{4}-\d{2}-\d{2}\b/u.test(final) ||
        /\b(?:today|retrieved|read on|accessed)\b/iu.test(final)
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response does not say when the sources were read",
          };
    },
  },
  {
    name: "natlang-memory-recall-summary",
    description:
      "A question about what the workspace already says is answered from recalled snippets, each fact tied to its source and weak ones flagged",
    category: CATEGORY,
    prompt:
      "Check what this workspace already says about citing sources when doing web research. Only tell me what you can point to, and say how solid each point is.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["relevant", "factFrom"]);
      if (!natlang.passed) return natlang;
      return /\b(?:cite|citation|source|url)\b/iu.test(
        findLastAgentMessage(result),
      )
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response does not report what the workspace says about citing sources",
          };
    },
  },
  {
    name: "natlang-resolve-named-recipient",
    description:
      "A message for someone who is not in the conversation is held back and the user is told who can be reached, not redirected to a roster member",
    category: CATEGORY,
    prompt:
      "Let Dana from accounting know the quarterly report is ready for review.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["rowFit"]);
      if (!natlang.passed) return natlang;
      const sent = getToolCalls(result).some(
        (call) =>
          call.name === "notify" &&
          call.execution?.status === "complete" &&
          !call.execution.isError,
      );
      if (sent)
        return {
          passed: false,
          reason:
            "A message was sent although no addressee matches the named recipient",
        };
      return /\bDana\b/iu.test(findLastAgentMessage(result)) &&
        /\b(?:not|no|cannot|can't|couldn't|unable|isn't|unknown)\b/iu.test(
          findLastAgentMessage(result),
        )
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response does not tell the user that Dana could not be found among the addressees",
          };
    },
  },
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
