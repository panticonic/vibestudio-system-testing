/**
 * Natlang skill-port scenarios, wave 0 (plan section 6): server-logs, local-models, problem-reporting and github.
 *
 * Each case gives a user-level goal and grades two halves. The surface half reads the eval result: where a ported program
 * asks the small model (the GitHub failure cause) the `natlang.calls` must show the call completed; where the measured
 * executor did not meet its gates the program is exact or the skill stays agent-executed, and the case requires that the
 * agent loaded the exact program, or only that the evidence it cites is real (the server-log boot). The agent half checks
 * one discriminating token that only an agent that used the result could produce. The prompts never name the function or
 * the skill; finding it is the point. Skill helpers that make no model call are plain code, and their scenarios live with
 * their skills (`messaging.ts`, `problem-reporting.ts`, `skills.ts`).
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
