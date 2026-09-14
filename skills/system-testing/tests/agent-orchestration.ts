import type { TestCase, TestExecutionResult } from "../types.js";
import { BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import { findLastAgentMessage, getToolCalls, noIncompleteInvocations } from "./_helpers.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function callDetails(call: ReturnType<typeof getToolCalls>[number]) {
  return record(record(call.execution?.result)?.["details"]);
}

/**
 * Compare a run reference the way the product resolves one.
 *
 * `spawn_subagent` reports an elided display handle and the supervision tools
 * accept "the exact runId or any sufficiently long unique prefix; the display
 * ellipsis is optional". An agent that drops the ellipsis is therefore doing
 * exactly what it was told, and a validator demanding one exact spelling grades
 * transcription rather than behaviour.
 */
function sameRunReference(reference: unknown, handle: string): boolean {
  if (typeof reference !== "string" || !reference) return false;
  const bare = (value: string) => value.replace(/…+$/u, "");
  const left = bare(reference);
  const right = bare(handle);
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function protocolText(call: ReturnType<typeof getToolCalls>[number]): string {
  const content = record(call.execution?.result)?.["protocolContent"];
  return Array.isArray(content)
    ? content
        .map((block) => record(block)?.["text"])
        .filter((text): text is string => typeof text === "string")
        .join("\n")
    : "";
}

function validateSubagentDiff(result: TestExecutionResult, integrate: boolean) {
  const base = validateAgentCompletionReport(result);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const spawn = calls.find(
    (call) =>
      call.name === "spawn_subagent" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true
  );
  if (!spawn) {
    return {
      passed: false,
      reason: "No completed child launch established a canonical run",
    };
  }
  const runHandle = callDetails(spawn)?.["runId"];
  if (typeof runHandle !== "string" || !runHandle) {
    return {
      passed: false,
      reason: "The child launch receipt did not identify its exact run",
    };
  }
  const inspection = calls.find((call) => {
    if (
      call.name !== "inspect_subagent" ||
      call.arguments?.["query"] !== "diff" ||
      !sameRunReference(call.arguments?.["runId"], runHandle) ||
      call.execution?.status !== "complete" ||
      call.execution.isError === true
    ) {
      return false;
    }
    const details = callDetails(call);
    const integration = record(details?.["semanticIntegration"]);
    return (
      sameRunReference(details?.["runId"], runHandle) &&
      integration?.["state"] === "unattempted" &&
      typeof integration["sourceEventId"] === "string" &&
      integration["sourceEventId"].length > 0
    );
  });
  if (!inspection) {
    return {
      passed: false,
      reason:
        "No bounded diff identified the child's committed event against the unintegrated parent state",
    };
  }
  const sourceEventId = String(
    record(callDetails(inspection)?.["semanticIntegration"])?.["sourceEventId"]
  );
  const diff = protocolText(inspection);
  const escapedEvent = sourceEventId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (
    !new RegExp(`Source\\s+${escapedEvent}:\\s*[1-9]\\d*\\s+adopt`, "u").test(diff) ||
    !/Coordinate:.*\badopt\b/iu.test(diff) ||
    !/Child source is committed and clean/iu.test(diff)
  ) {
    return {
      passed: false,
      reason: "The child-relative diff did not prove a non-empty committed clean change",
    };
  }
  // "Deliberately left unintegrated" is a fact about what the parent did, not a
  // phrase it has to say. Grading the prose failed an agent that wrote "without
  // integrating" because the alternation happened to list "not integrated" —
  // that measures wording, not behaviour.
  const merges = calls.filter(
    (call) =>
      call.name === "merge_subagent" &&
      sameRunReference(call.arguments?.["runId"], runHandle) &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true
  );
  if (integrate) {
    const merged = merges.find((call) => {
      const details = callDetails(call);
      const resolution = record(record(details?.["review"])?.["resolution"]);
      return (
        calls.indexOf(call) > calls.indexOf(inspection) &&
        sameRunReference(details?.["runId"], runHandle) &&
        details?.["sourceEventId"] === sourceEventId &&
        resolution?.["complete"] === true &&
        resolution["concluded"] === true &&
        resolution["remainingCoordinateCount"] === 0
      );
    });
    if (!merged) {
      return {
        passed: false,
        reason: "The reviewed child event was not completely integrated into the parent",
      };
    }
  } else if (merges.length > 0) {
    return {
      passed: false,
      reason: "The parent integrated the child's work in a case whose whole point is not to",
    };
  }
  const final = findLastAgentMessage(result);
  if (!/export/iu.test(final)) {
    return {
      passed: false,
      reason: "The parent never reported what the child changed, so the review went unreported",
    };
  }
  return noIncompleteInvocations(result);
}

function validateSubagentFollowup(result: TestExecutionResult) {
  const base = validateAgentCompletionReport(result);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const successful = (call: (typeof calls)[number]) =>
    call.execution?.status === "complete" && call.execution.isError !== true;
  const launches = calls.filter((call) => call.name === "spawn_subagent" && successful(call));
  const handle = launches[0] ? callDetails(launches[0])?.["runId"] : undefined;
  if (launches.length !== 1 || typeof handle !== "string") {
    return {
      passed: false,
      reason: "The follow-up did not retain exactly one collaborator",
    };
  }
  const inspections = calls.filter(
    (call) =>
      call.name === "inspect_subagent" &&
      call.arguments?.["query"] === "diff" &&
      sameRunReference(call.arguments?.["runId"], handle) &&
      successful(call)
  );
  const first = inspections[0];
  const last = inspections.at(-1);
  const source = (call: (typeof calls)[number] | undefined) =>
    call ? record(callDetails(call)?.["semanticIntegration"])?.["sourceEventId"] : undefined;
  if (
    !first ||
    !last ||
    first === last ||
    typeof source(first) !== "string" ||
    typeof source(last) !== "string" ||
    source(first) === source(last)
  ) {
    return {
      passed: false,
      reason: "The same child's two reviewed commits were not observed",
    };
  }
  const followup = calls.find((call) => {
    const to = call.arguments?.["to"];
    const refs = Array.isArray(to) ? to : [to];
    return (
      call.name === "notify" &&
      successful(call) &&
      calls.indexOf(call) > calls.indexOf(first) &&
      calls.indexOf(call) < calls.indexOf(last) &&
      refs.some(
        (ref) =>
          typeof ref === "string" &&
          ref.startsWith("run:") &&
          sameRunReference(ref.slice(4), handle)
      )
    );
  });
  if (!followup)
    return {
      passed: false,
      reason: "No successful follow-up reached the retained child",
    };
  const merged = calls.some((call) => {
    const details = callDetails(call);
    const resolution = record(record(details?.["review"])?.["resolution"]);
    return (
      call.name === "merge_subagent" &&
      successful(call) &&
      calls.indexOf(call) > calls.indexOf(last) &&
      sameRunReference(call.arguments?.["runId"], handle) &&
      details?.["sourceEventId"] === source(last) &&
      resolution?.["complete"] === true &&
      resolution["concluded"] === true &&
      resolution["remainingCoordinateCount"] === 0
    );
  });
  if (!merged) return { passed: false, reason: "The follow-up commit was not integrated" };
  return noIncompleteInvocations(result);
}

export const agentOrchestrationTests: TestCase[] = [
  {
    name: "subagent-followup-after-report",
    description:
      "A finished collaborator accepts follow-up work in its retained context and the parent integrates the resulting commit",
    category: "agent-orchestration",
    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Ask a fresh subagent to add a small deterministic typed export named firstValue in the disposable package and report back when finished. Review that committed change without merging it. Then ask that same subagent to add a second typed export named secondValue using firstValue. Review the new committed diff and integrate it. Keep the same collaborator and its work context throughout; summarize both changes.",
    validation: "agent-evidence",
    validate: validateSubagentFollowup,
  },
  {
    name: "subagent-diff-inspection",
    description:
      "A parent delegates a small change, reviews the child's semantic diff, and deliberately leaves it unintegrated",
    category: "agent-orchestration",
    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Ask a fresh subagent to add one small deterministic typed export in the disposable package. Review what the child changed without integrating it, then summarize the bounded diff.",
    validation: "agent-evidence",
    validate: (result) => validateSubagentDiff(result, false),
  },
  {
    name: "subagent-reviewed-merge",
    description: "A parent reviews a child's committed source diff and integrates that exact event",
    category: "agent-orchestration",
    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Ask a fresh subagent to add one small deterministic typed export in the disposable package. Review the child's diff before integrating the change into your workspace, then summarize the result.",
    validation: "agent-evidence",
    validate: (result) => validateSubagentDiff(result, true),
  },
  {
    name: "subagent-design-synthesis",
    description: "Two children explore competing design priorities that the parent synthesizes",
    category: "agent-orchestration",
    prompt:
      "Run a brief design review for a hypothetical standalone TypeScript library that represents edge-case test corpora. There is no existing codebase for it, so reason only from this brief. Delegate two independent reviews concurrently to subagents: one favoring a simple data model, the other favoring provenance and debuggability. Ask each reviewer to keep their reply to at most five bullets. Once both replies are in the conversation, write one synthesis under 500 words covering the main tradeoffs and disagreements.",
    validate: validateAgentCompletionReport,
  },
  {
    name: "claude-subagent-readonly-diagnostic",
    description:
      "Claude Code performs a bounded read-only audit while the parent supervises its progress and verifies that no source changed",
    category: "agent-orchestration",
    prompt:
      "Ask Claude Code to perform a read-only audit comparing the subagent reading-versus-inspection documentation with the current implementation. Have it identify one concrete developer-ergonomics risk with source evidence. Supervise the task through its normal progress and runtime information, confirm afterward that its workspace stayed clean, and report the finding plus any difficulty you encountered supervising it.",
    validate: validateAgentCompletionReport,
  },
  {
    name: "terminal-extension-capability-acquisition",
    description:
      "A harmless argv-mode terminal command exercises the installed scoped terminal capability",
    category: "agent-orchestration",
    authorityPolicy: {
      authority: [
        {
          ruleId: "terminal-native-execution",
          capability: {
            kind: "prefix",
            prefix: "userland:extensions/shell/native.shell.execute#",
          },
          resource: {
            kind: "exact",
            key: "native.shell:extension:@workspace-extensions/shell",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "Use the installed terminal capability to run a harmless bounded argv-mode printf command without shell interpretation. Print agentic-terminal-roundtrip, then report the observed output, exit status, and whether the command timed out or truncated anything.",
    validate: validateAgentCompletionReport,
  },
];
