import { rpc } from "@workspace/runtime";
import { createProblemReportsClient } from "@workspace/runtime/problem-reports";
import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types";
import {
  findLastAgentMessage,
  hasLoadedSkill,
  noIncompleteInvocations,
} from "./_helpers";
const prompt =
  "I asked Vibestudio to sort alpha, gamma, beta alphabetically. It answered gamma, beta, alpha. Save a problem report for me, preserving what I asked and the wrong result. Explain what we know and what still needs checking. Do not collect logs or send anything.";
async function prepareQualityReport(
  context: TestOrchestrationContext,
  request = prompt,
): Promise<TestExecutionResult> {
  const start = Date.now();
  const reports = createProblemReportsClient(rpc);
  const before = new Set((await reports.history()).map((row) => row.id));
  const session = await context.runner.spawn();
  let error: string | undefined;
  let draft: unknown;
  const cleanupErrors: string[] = [];
  try {
    await context.sendAndWait(
      session,
      request,
      "complete the request with reviewable problem evidence",
    );
    const created = (await reports.history()).filter(
      (row) => !before.has(row.id),
    );
    for (const row of created) {
      const candidate = await reports.get(row.id);
      if (candidate.value.problem.symptom?.includes("gamma")) {
        draft = { ...candidate, state: row.state };
        break;
      }
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    try {
      await session.close();
    } catch (cause) {
      cleanupErrors.push(String(cause));
    }
  }
  return {
    messages: [...session.messages],
    duration: Date.now() - start,
    snapshot: session.snapshot(),
    ...(error ? { error } : {}),
    cleanupErrors,
    diagnostics: { draft },
  };
}
function validateQualityReport(result: TestExecutionResult) {
  const draft = result.diagnostics?.["draft"] as
    | {
        value?: {
          intent?: string;
          problem?: { symptom?: string; expected?: string };
          narrative?: { author: string; markdown: string }[];
          evidence?: unknown[];
          attachments?: unknown[];
        };
        state?: string | null;
      }
    | undefined;
  if (
    !draft?.value ||
    draft.value.intent !== "manual-problem" ||
    draft.state === "queued" ||
    draft.state === "sending" ||
    draft.state === "received"
  )
    return {
      passed: false,
      reason: "No saved, unsent manual report was found in the reporting store",
    };
  const content = JSON.stringify(draft.value);
  if (
    !content.includes("alpha") ||
    !content.includes("gamma") ||
    !draft.value.narrative?.some(
      (n) => n.author === "agent" && n.markdown.length > 0,
    )
  )
    return {
      passed: false,
      reason:
        "The stored report lost the user facts or agent-written narrative",
    };
  if (draft.value.evidence?.length || draft.value.attachments?.length)
    return {
      passed: false,
      reason: "The agent included unrequested diagnostic evidence",
    };
  if (
    !hasLoadedSkill(result, "problem-reporting") ||
    !/report/i.test(findLastAgentMessage(result))
  )
    return {
      passed: false,
      reason:
        "The reporting guidance was not discoverable or the agent did not explain the saved report",
    };
  return noIncompleteInvocations(result);
}

export const problemReportingTests: TestCase[] = [
  {
    name: "prepare-quality-problem-report",
    category: "problem-reporting",
    description:
      "An agent preserves a poor result in a saved, unsent report with narrative for user review.",
    prompt,
    orchestrate: prepareQualityReport,
    validate: validateQualityReport,
  },
  {
    name: "proactively-prepare-problem-report",
    category: "problem-reporting",
    description:
      "An ordinary agent completes the user's task and proactively saves an unsent report of an incorrect Vibestudio result without being asked to report it.",
    prompt:
      "Vibestudio marked the alphabetized list alpha, gamma, beta as correct even though beta belongs before gamma. Please give me the correct ordering and explain the mistake.",
    orchestrate: (context) =>
      prepareQualityReport(
        context,
        "Vibestudio marked the alphabetized list alpha, gamma, beta as correct even though beta belongs before gamma. Please give me the correct ordering and explain the mistake.",
      ),
    validate: validateQualityReport,
  },
];
