import type { TestCase, TestExecutionResult } from "../types.js";
import { BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import { getToolCalls, noIncompleteInvocations } from "./_helpers.js";

import {
  completedScenarioEvidence,
  invocationReturnValue,
  walkRecords,
} from "./_scenario-evidence.js";

function validateTerminalRoundtrip(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const completed = getToolCalls(result).some((call) => {
    if (
      call.name !== "eval" ||
      call.execution?.status !== "complete" ||
      call.execution.isError === true
    )
      return false;
    const code = String(call.arguments?.["code"] ?? "");
    if (
      !/extensions\.invoke\s*\(\s*['"]shell['"]\s*,\s*['"]exec['"]/u.test(code)
    )
      return false;
    const returned = invocationReturnValue(call);
    return (
      returned.present &&
      walkRecords([returned.value]).some(
        (value) =>
          value["exitCode"] === 0 &&
          typeof value["stdout"] === "string" &&
          value["stdout"].includes("agentic-terminal-roundtrip"),
      )
    );
  });
  return completed
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "No successful shell execution returned the requested output with exit code zero",
      };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function callDetails(call: ReturnType<typeof getToolCalls>[number]) {
  return record(record(call.execution?.result)?.["details"]);
}

/** Arguments use an issued exact selector; receipts keep the native identity. */
function sameRunReference(
  reference: unknown,
  nativeRunId: string,
  runRef?: unknown,
): boolean {
  return (
    typeof reference === "string" &&
    (reference === nativeRunId ||
      (typeof runRef === "string" && reference === runRef))
  );
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
      call.execution.isError !== true,
  );
  if (!spawn) {
    return {
      passed: false,
      reason: "No completed child launch established a canonical run",
    };
  }
  const runHandle = callDetails(spawn)?.["runId"];
  const runRef = callDetails(spawn)?.["runRef"];
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
      !sameRunReference(call.arguments?.["runId"], runHandle, runRef) ||
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
  const sourceEventId = inspection
    ? record(callDetails(inspection)?.["semanticIntegration"])?.[
        "sourceEventId"
      ]
    : undefined;
  if (!integrate) {
    if (!inspection || typeof sourceEventId !== "string")
      return {
        passed: false,
        reason:
          "No bounded diff identified the child's committed event against the unintegrated parent state",
      };
    const diff = protocolText(inspection);
    const escapedEvent = sourceEventId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (
      !new RegExp(`Source\\s+${escapedEvent}:\\s*[1-9]\\d*\\s+adopt`, "u").test(
        diff,
      ) ||
      !/Coordinate:.*\badopt\b/iu.test(diff) ||
      !/Child source is committed and clean/iu.test(diff)
    )
      return {
        passed: false,
        reason:
          "The child-relative diff did not prove a non-empty committed clean change",
      };
  }
  const merges = calls.filter(
    (call) =>
      call.name === "merge_subagent" &&
      sameRunReference(call.arguments?.["runId"], runHandle, runRef) &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
  if (integrate) {
    // Ordinary integration reviews the canonical merge resolution itself. A
    // separate diff is useful for an explicit comparison goal, not a preflight.
    const merged = merges.find((call) => {
      const details = callDetails(call);
      const resolution = record(record(details?.["review"])?.["resolution"]);
      const nativeMerges = details?.["merges"];
      const nonempty =
        Array.isArray(nativeMerges) &&
        nativeMerges.some((value) => {
          const mutation = record(value);
          return (
            typeof mutation?.["incorporatedChangeCount"] === "number" &&
            mutation["incorporatedChangeCount"] > 0
          );
        });
      const priorInspection =
        inspection && calls.indexOf(inspection) < calls.indexOf(call);
      return (
        details?.["protocol"] === "vibestudio.subagent-merge.v1" &&
        sameRunReference(details["runId"], runHandle) &&
        typeof details["sourceEventId"] === "string" &&
        details["sourceEventId"].length > 0 &&
        (!priorInspection || details["sourceEventId"] === sourceEventId) &&
        nonempty &&
        resolution?.["complete"] === true &&
        resolution["concluded"] === true &&
        resolution["remainingCoordinateCount"] === 0
      );
    });
    if (!merged)
      return {
        passed: false,
        reason:
          "No non-empty canonical child event was completely integrated into the parent",
      };
  } else if (merges.length > 0)
    return {
      passed: false,
      reason:
        "The parent integrated the child's work in a case whose whole point is not to",
    };
  return noIncompleteInvocations(result);
}

function validateSubagentFollowup(result: TestExecutionResult) {
  const base = validateAgentCompletionReport(result);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const successful = (call: (typeof calls)[number]) =>
    call.execution?.status === "complete" && call.execution.isError !== true;
  const launches = calls.filter(
    (call) => call.name === "spawn_subagent" && successful(call),
  );
  const handle = launches[0] ? callDetails(launches[0])?.["runId"] : undefined;
  const runRef = launches[0] ? callDetails(launches[0])?.["runRef"] : undefined;
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
      sameRunReference(call.arguments?.["runId"], handle, runRef) &&
      successful(call) &&
      callDetails(call)?.["runId"] === handle &&
      record(callDetails(call)?.["semanticIntegration"])?.["state"] ===
        "unattempted",
  );
  const first = inspections[0];
  const last = inspections.at(-1);
  const source = (call: (typeof calls)[number] | undefined) =>
    call
      ? record(callDetails(call)?.["semanticIntegration"])?.["sourceEventId"]
      : undefined;
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
          sameRunReference(ref.slice(4), handle, runRef),
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
      sameRunReference(call.arguments?.["runId"], handle, runRef) &&
      details?.["runId"] === handle &&
      details?.["sourceEventId"] === source(last) &&
      resolution?.["complete"] === true &&
      resolution["concluded"] === true &&
      resolution["remainingCoordinateCount"] === 0
    );
  });
  const integratedBeforeFollowupReview = calls.some(
    (call) =>
      call.name === "merge_subagent" &&
      successful(call) &&
      sameRunReference(call.arguments?.["runId"], handle, runRef) &&
      calls.indexOf(call) < calls.indexOf(last),
  );
  if (integratedBeforeFollowupReview)
    return {
      passed: false,
      reason: "The child was integrated before the follow-up had been reviewed",
    };
  if (!merged)
    return { passed: false, reason: "The follow-up commit was not integrated" };
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
      "Ask the same collaborator to make two related changes in the disposable package. Review the first result without bringing it into your workspace; then ask that collaborator to make the follow-up, review it, and bring that second change into your workspace. Summarize both changes.",

    validate: validateSubagentFollowup,
  },
  {
    name: "subagent-diff-inspection",
    description:
      "A parent delegates a small change, reviews the child's semantic diff, and deliberately leaves it unintegrated",
    category: "agent-orchestration",
    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Ask a collaborator to make one small change in the disposable package. Review the result and summarize it without bringing it into your workspace.",

    validate: (result) => validateSubagentDiff(result, false),
  },
  {
    name: "subagent-reviewed-merge",
    description:
      "A parent reviews a child's committed source diff and integrates that exact event",
    category: "agent-orchestration",
    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Ask a collaborator to make one small change in the disposable package. Review the result, bring it into your workspace, and summarize what changed.",

    validate: (result) => validateSubagentDiff(result, true),
  },
  {
    name: "subagent-design-synthesis",
    description:
      "Two children explore competing design priorities that the parent synthesizes",
    category: "agent-orchestration",
    prompt:
      "Review this hypothetical brief for a standalone TypeScript library that represents edge-case test corpora; there is no existing codebase, so reason only from the brief. Brief: A few TypeScript packages will share a checked-in corpus of edge-case fixtures. Each case has input and an expected outcome. Maintainers add cases by hand and from generated reproducers. Tests need deterministic iteration and filters by suite. When a case fails, maintainers need to trace it to the originating issue, reproducer, or generator revision. The library must work without a runtime service dependency. Delegate two independent reviews concurrently: one should favor a simple data model, the other provenance and debuggability. Once both perspectives are back, summarize their main tradeoffs and disagreements concisely.",
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
      "Run a harmless command that prints `agentic-terminal-roundtrip`, then tell me what it printed and whether it completed normally.",
    validate: validateTerminalRoundtrip,
  },
];
