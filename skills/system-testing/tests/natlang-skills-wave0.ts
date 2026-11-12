/**
 * Natlang skill-port scenarios, wave 0 (plan section 6): server-logs, gad-context, local-models, problem-reporting and
 * github.
 *
 * Each case gives a user-level goal and grades two halves. The surface half reads the eval result: where a ported program
 * asks the small model (the GitHub failure cause) the `natlang.calls` must show the call completed; where the measured
 * executor did not meet its gates the program is exact or the skill stays agent-executed, and the case requires that the
 * agent loaded the exact program, or only that the evidence it cites is real (the server-log boot). The agent half checks
 * one discriminating token that only an agent that used the result could produce. The prompts never name the function or
 * the skill; finding it is the point.
 */
import {
  NativeServerLogObservationSchema,
  type NativeServerLogObservation,
} from "@vibestudio/service-schemas/serverLog";
import type { TestAuthorityPolicy, TestCase, TestExecutionResult } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import { findLastAgentMessage, getToolCalls, successfulEvalCode } from "./_helpers.js";

const CATEGORY = "natlang-skills";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The result details of every successful eval cell. */
function evalDetails(result: TestExecutionResult): Record<string, unknown>[] {
  return getToolCalls(result).flatMap((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError)
      return [];
    const details = record(record(call.execution.result)?.["details"]);
    return details ? [details] : [];
  });
}

/** The natlang calls the successful eval cells reported, by function name and outcome. */
function natlangCalls(result: TestExecutionResult): Array<{ name: string; outcome: string }> {
  return evalDetails(result).flatMap((details) => {
    const calls = record(details["natlang"])?.["calls"];
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

/** Every named function completed at least once ("done" is natlang's success outcome). */
function requireNatlang(result: TestExecutionResult, names: readonly string[]) {
  const calls = natlangCalls(result);
  const missing = names.filter(
    (name) => !calls.some((call) => call.name === name && call.outcome === "done")
  );
  return missing.length === 0
    ? { passed: true as const }
    : {
        passed: false as const,
        reason: `The natlang function(s) ${missing.join(", ")} never completed in an eval. Reported calls: ${
          calls.map((call) => `${call.name}:${call.outcome}`).join(", ") || "(none)"
        }`,
      };
}

/** The loaded `.nl` program paths the successful eval cells used (`natlang.load("skills/...")`). */
function loadedProgram(result: TestExecutionResult, program: string): boolean {
  return successfulEvalCode(result).includes(program);
}

/** Server-log reads recorded by native dispatch, before any guest projection. */
function serverLogObservations(result: TestExecutionResult): NativeServerLogObservation[] {
  return evalDetails(result).flatMap((details) => {
    const journal = record(details["operationJournal"]);
    if (journal?.["protocol"] !== "workspace-operations.v1" || !Array.isArray(journal["entries"]))
      return [];
    return journal["entries"].flatMap((entry) => {
      const value = record(entry);
      if (value?.["type"] !== "server-log.observation") return [];
      const parsed = NativeServerLogObservationSchema.safeParse(value["receipt"]);
      return parsed.success ? [parsed.data] : [];
    });
  });
}

const serverLogReadAuthority: TestAuthorityPolicy = {
  authority: [
    {
      ruleId: "inspect-server-host-logs",
      capability: { kind: "exact", key: "server-logs.read" },
      resource: { kind: "exact", key: "server-logs.read" },
      tier: "gated",
      decision: "once",
    },
  ],
};

export const natlangSkillsWave0Tests: TestCase[] = [
  {
    name: "natlang-server-log-brief",
    description:
      "A vague worry about the server is answered from its host log, citing the boot the lines came from",
    category: CATEGORY,
    authorityPolicy: serverLogReadAuthority,
    prompt:
      "Is anything going wrong with the workspace server right now? Look at its own logs and tell me, and tell me which boot you looked at so I can find the lines again.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const final = findLastAgentMessage(result);
      const boots = serverLogObservations(result).flatMap((receipt) =>
        receipt.kind === "records" ? [receipt.serverBootId] : []
      );
      return boots.some((boot) => final.includes(boot))
        ? { passed: true }
        : {
            passed: false,
            reason: "The final response does not name the server boot the brief was read from",
          };
    },
  },
  {
    name: "natlang-channel-health",
    description:
      "A worry that the chat is stuck is answered from one health snapshot whose findings carry the documented attention policy",
    category: CATEGORY,
    prompt:
      "Is this conversation in a healthy state? I want to know whether anything in it is stuck or broken, not a deep investigation.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // The health report is exact and makes no model call: require that the program was loaded.
      if (!loadedProgram(result, "skills/gad-context/inspectAgentHealth.nl")) {
        return { passed: false, reason: "The agent did not load the channel health program" };
      }
      return /\b(?:healthy|idle|intact|no problems|nothing (?:is )?(?:stuck|broken|wrong)|busy|in[- ]flight)\b/iu.test(
        findLastAgentMessage(result)
      )
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response does not say whether the conversation is healthy, busy or has findings",
          };
    },
  },
  {
    name: "natlang-channel-summary",
    description:
      "A request to recap the conversation and say whether the agent is waiting on the user is answered from the exact channel summary",
    category: CATEGORY,
    prompt:
      "Give me a two-line recap of what this conversation has been about so far, and tell me whether you are waiting on anything from me.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // The summary is exact (counts, the opening and the latest message): require that the program was loaded.
      if (!loadedProgram(result, "skills/gad-context/summarizeChannel.nl")) {
        return { passed: false, reason: "The agent did not load the channel summary program" };
      }
      return /\b(?:waiting|not waiting|nothing (?:is )?needed|need nothing|need anything|no(?:thing)? (?:from you|else))\b/iu.test(
        findLastAgentMessage(result)
      )
        ? { passed: true }
        : {
            passed: false,
            reason: "The final response does not say whether the agent is waiting on the user",
          };
    },
  },
  {
    name: "natlang-local-model-readiness",
    description:
      "A question about running a model on this machine is answered from the local-model readiness report, without installing anything",
    category: CATEGORY,
    prompt:
      "Can I run an AI model on this computer without sending anything to the cloud? Tell me what is ready right now. Don't install anything.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // With no failed model there is nothing for the small model to name: require that the program was loaded.
      if (!loadedProgram(result, "skills/local-models/localModelReadiness.nl")) {
        return {
          passed: false,
          reason: "The agent did not load the local model readiness program",
        };
      }
      const installed = successfulEvalCode(result).includes("installModel");
      if (installed)
        return {
          passed: false,
          reason: "The agent installed a model although the user said not to",
        };
      return /\b(?:lfm3|lfm2\.5|qwen|no local model|not installed|not downloaded|downloading)\b/iu.test(
        findLastAgentMessage(result)
      )
        ? { passed: true }
        : { passed: false, reason: "The final response names no local model or its state" };
    },
  },
  {
    name: "natlang-problem-report-triage",
    description:
      "Two failures, one an expected refusal and one the user's own bug, are recognized as not being platform defects, and no report is saved",
    category: CATEGORY,
    prompt:
      "Two things went wrong today. First, Vibestudio said the push was denied after I closed the approval prompt. Second, the todo panel I wrote throws \"TypeError: Cannot read properties of undefined (reading 'map')\" at panels/todo/index.tsx line 41. Should I report either one to the Vibestudio developers as a bug?",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      if (/problemReports\s*\.\s*(?:create|prepare|send)\b/u.test(successfulEvalCode(result))) {
        return {
          passed: false,
          reason: "A report was created although neither failure is a platform defect",
        };
      }
      return /\b(?:your (?:own )?(?:code|panel)|expected|refus|not a (?:vibestudio|platform) (?:bug|defect))\b/iu.test(
        findLastAgentMessage(result)
      )
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response does not explain that the denial is expected and the TypeError is the user's own code",
          };
    },
  },
  {
    name: "natlang-problem-report-draft",
    description:
      "A wrong result is saved as an unsent report laid out by the exact drafter, with the user's facts and nothing sent",
    category: CATEGORY,
    prompt:
      "I asked Vibestudio to sort alpha, gamma, beta alphabetically and it answered gamma, beta, alpha. Save a problem report for me to review. Do not send anything.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // The draft is exact and makes no model call: require that the program was loaded.
      if (!loadedProgram(result, "skills/problem-reporting/draftProblemReport.nl")) {
        return { passed: false, reason: "The agent did not load the problem report drafter" };
      }
      const code = successfulEvalCode(result);
      if (/problemReports\s*\.\s*send\b/u.test(code))
        return {
          passed: false,
          reason: "The report was sent although the user asked only to save it",
        };
      return /problemReports\s*\.\s*create\b/u.test(code) &&
        /gamma/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : {
            passed: false,
            reason: "No report was saved, or the final response lost the user's facts",
          };
    },
  },
  {
    name: "natlang-github-setup-route",
    description:
      "A request to work on pull requests, with GitHub not yet connected, is routed to the setup component by the exact setup route",
    category: CATEGORY,
    prompt:
      "I want you to be able to open pull requests on my GitHub repositories. Get that set up for me.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // The route is exact and makes no model call: require that the program was loaded.
      if (!loadedProgram(result, "skills/github/natlang/githubSetupRoute.nl")) {
        return { passed: false, reason: "The agent did not load the GitHub setup route program" };
      }
      const rendered = getToolCalls(result).some(
        (call) =>
          call.name === "inline_ui" &&
          call.execution?.status === "complete" &&
          String(call.arguments?.["path"] ?? "").includes("GitHubSetup")
      );
      return rendered || /\b(?:connect|set ?up|token|panel)\b/iu.test(findLastAgentMessage(result))
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The agent neither rendered the GitHub setup component nor explained how setup continues",
          };
    },
  },
  {
    name: "natlang-github-troubleshoot",
    description:
      "A GitHub permission failure is turned into the documented next steps by the small model's cause, without asking for a token in chat",
    category: CATEGORY,
    prompt:
      'Checking my GitHub connection says "403 Resource not accessible by personal access token" when I try to create an issue on my notes repo. What should I do?',
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      const natlang = requireNatlang(result, ["cause"]);
      if (!natlang.passed) return natlang;
      const final = findLastAgentMessage(result);
      if (/\bgh[pousr]_[A-Za-z0-9]{10,}/u.test(final))
        return { passed: false, reason: "A token appeared in the final message" };
      return /\bpermission\b/iu.test(final)
        ? { passed: true }
        : {
            passed: false,
            reason:
              "The final response does not tell the user to add the missing permission or repository access",
          };
    },
  },
];
