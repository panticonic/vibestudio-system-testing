import type { GitHubSetupReceiver } from "../github-setup-managed.js";
import { githubSetupWorlds } from "../github-setup-worlds.js";
import { appendSystemTestCleanupFailure } from "../structured-error.js";
import type { HeadlessSession } from "@workspace/agentic-session";
import type { TestCase, TestExecutionResult, TestOrchestrationContext } from "../types.js";
import { validateAgentCompletionReport } from "../test-runner.js";
import {
  findLastAgentMessage,
  getToolCalls,
  hasLoadedSkill,
  noIncompleteInvocations,
  successfulEvalCode,
  successfulEvalReturnValues,
} from "./_helpers.js";
import { walkRecords } from "./_scenario-evidence.js";

function skillChoiceChecked(
  result: Parameters<typeof noIncompleteInvocations>[0],
  skillName: string,
  finalClaim: RegExp,
  options?: { allowEmbeddedGuidance?: boolean }
) {
  const loaded = hasLoadedSkill(result, skillName);
  if (!finalClaim.test(findLastAgentMessage(result))) {
    return {
      passed: false,
      reason: `Final response did not explain the ${skillName} workflow choice`,
    };
  }
  if (!loaded && !options?.allowEmbeddedGuidance) {
    return {
      passed: false,
      reason: `No completed skill load opened ${skillName}`,
    };
  }
  return noIncompleteInvocations(result);
}

const MISSING_API_CREDENTIAL_ID = "credential:system-test-missing";
const MISSING_API_URL = "https://system-test-missing.invalid/resource";

function apiIntegrationChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const evalCalls = getToolCalls(result).filter((call) => call.name === "eval");
  const code = successfulEvalCode(result);
  if (
    evalCalls.length !== 1 ||
    !code.includes("credentials.fetch") ||
    !code.includes(MISSING_API_CREDENTIAL_ID) ||
    !code.includes(MISSING_API_URL)
  ) {
    return {
      passed: false,
      reason: "Expected one successful host-mediated fetch with the reserved missing credential",
    };
  }
  const allEvalCode = evalCalls
    .map((call) => (typeof call.arguments?.["code"] === "string" ? call.arguments["code"] : ""))
    .join("\n");
  if (
    /credentials\.(?:listStoredCredentials|inspectStoredCredentials|resolveCredential|forAudience|store|connect|configureClient|requestCredentialInput|revokeCredential|deleteClientConfig)|openExternal/u.test(
      allEvalCode
    )
  ) {
    return {
      passed: false,
      reason: "Missing-credential API probe inspected, mutated, or requested credential state",
    };
  }

  const values = successfulEvalReturnValues(result);
  const safeMissingOutcome =
    values.length === 1 &&
    JSON.stringify(values[0]).length <= 1_000 &&
    walkRecords(values).some(
      (record) =>
        record["missing"] === true ||
        (record["ok"] === false &&
          walkRecords([record]).some(
            (candidate) =>
              candidate["code"] === "credential-unavailable" ||
              candidate["message"] === "credential-unavailable"
          ))
    );
  const exposedCredentialData = walkRecords(values).some((record) =>
    Object.entries(record).some(
      ([key, value]) =>
        /(token|secret|password|credentialId|accessKey|material|stack)/iu.test(key) && value != null
    )
  );
  if (!safeMissingOutcome || exposedCredentialData) {
    return {
      passed: false,
      reason: "Missing-credential API eval must return one bounded, non-sensitive missing outcome",
    };
  }
  return noIncompleteInvocations(result);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function latestChildTask(session: HeadlessSession): { invocationId: string } {
  const task = [...session.snapshot().tasks]
    .reverse()
    .find((candidate) => candidate.type === "subagent");
  if (!task) throw new Error("Headless diagnostic setup did not create a child task");
  return { invocationId: task.id };
}

async function orchestrateHeadlessDiagnosis(
  context: TestOrchestrationContext
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let fixture: { invocationId: string } | undefined;

  try {
    await context.sendAndWait(
      session,
      "Delegate this self-contained review to one collaborator: A service began returning intermittent 503 responses after a deployment. The deployment changed connection pooling, while request volume and upstream health are unchanged. Identify the most plausible connection-pooling failure and one piece of evidence that would distinguish it from an upstream outage. Then give me your own concise assessment.",
      "create a child with an independent assignment"
    );
    fixture = latestChildTask(session);
    await context.sendAndWait(
      session,
      `Read the transcript for collaborator task ${fixture.invocationId} and summarize what it has communicated. If it has not communicated findings, say that. Do not infer whether it is still running or finished from the transcript alone.`,
      "inspect the child's bounded transcript"
    );
  } catch (err) {
    error = formatError(err);
  }

  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    ...(error ? { error } : {}),
    diagnostics: {
      orchestrated: true,
      fixture: {
        kind: "real-subagent-transcript",
        invocationId: fixture?.invocationId ?? null,
      },
    },
  };

  try {
    await session.close();
  } catch (err) {
    const message = `close: ${formatError(err)}`;
    appendSystemTestCleanupFailure(execution, "close", err);
    execution.error ??= `Headless cleanup failed: ${message}`;
  }
  const cleanupErrors = session
    .snapshot()
    .cleanupErrors.map((entry) => `${entry.phase}: ${entry.message}`);
  if (cleanupErrors.length > 0) {
    execution.cleanupErrors = [...(execution.cleanupErrors ?? []), ...cleanupErrors];
    execution.error ??= `Headless cleanup failed: ${cleanupErrors.join("; ")}`;
  }
  return execution;
}

export const skillTests: TestCase[] = [
  {
    name: "load-sandbox",
    description: "Apply the sandbox skill to choose an execution surface",
    category: "skills",
    prompt:
      "I need a one-off, read-only state inspection. Which execution surface should we use, and why?",
    validate: (result) =>
      skillChoiceChecked(result, "sandbox", /(sandbox|eval|execution surface|read-only)/iu, {
        // The base agent prompt already carries the sandbox/eval routing rule.
        // Re-reading the same skill for a one-sentence orientation answer is
        // unnecessary work; validate the decision rather than a redundant tool.
        allowEmbeddedGuidance: true,
      }),
  },
  {
    name: "load-workspace-dev",
    description: "Apply the workspace-dev skill to choose a project workflow",
    category: "skills",
    prompt:
      "I want to change a workspace panel. Which development workflow fits this request, and why?",
    validate: (result) =>
      skillChoiceChecked(result, "workspace-dev", /(workspace|panel|development|workflow)/iu, {
        // This is a workflow orientation question, already covered by the
        // supplied skill index and routing guidance; it performs no authoring.
        allowEmbeddedGuidance: true,
      }),
  },
  {
    name: "load-api-integrations",
    description: "Apply the API integrations skill to handle missing credentials",
    category: "skills",
    prompt: `Try the deliberately unconfigured test API at ${MISSING_API_URL} using the reserved test credential ${MISSING_API_CREDENTIAL_ID}. Explain the safe outcome without inspecting, changing, requesting, or exposing credential data.`,
    validate: apiIntegrationChecked,
    reportClaims: [
      { id: "credential", claim: "The request needs a credential or authentication.", match: /(credential|authentication)/iu },
      { id: "missing", claim: "That credential is missing or not configured.", match: /(missing|unavailable|not configured|not found)/iu },
      {
        id: "safe",
        claim: "No secret or credential material was exposed and the user was not prompted.",
        match: /(without|did not|didn't|no)\b[^.\n]*(secret|credential (?:data|material)|prompt|authoriz)/iu,
      },
    ],
  },
  {
    name: "load-headless-sessions",
    description: "Inspect a child transcript and report bounded evidence",
    category: "skills",
    prompt:
      "Inspect the collaborator's transcript and summarize what it has communicated. If the transcript has no findings yet, say so. Do not infer whether the child is still running or has finished from the transcript alone.",
    orchestrate: orchestrateHeadlessDiagnosis,
    // The setup owns a real independent child assignment. Its transcript is
    // useful whether the task is active or terminal; the fixture does not
    // infer liveness from transcript contents.
    validate: (result) => {
      const fixture = result.diagnostics?.["fixture"] as Record<string, unknown> | undefined;
      const final = findLastAgentMessage(result);
      const childId = fixture?.["invocationId"];
      const inspection =
        typeof childId === "string"
          ? getToolCalls(result)
              .map((call) => {
                const requestedRunId = call.arguments?.["runId"];
                if (
                  call.name !== "read_subagent" ||
                  typeof requestedRunId !== "string" ||
                  call.execution?.status !== "complete" ||
                  call.execution.isError === true
                )
                  return undefined;
                const details = (
                  call.execution.result as { details?: Record<string, unknown> } | undefined
                )?.details;
                const messages = details?.["messages"];
                return details?.["runId"] === childId &&
                  (requestedRunId === childId || details["runRef"] === requestedRunId) &&
                  Number.isSafeInteger(details["nextSeq"]) &&
                  Number(details["nextSeq"]) >= 0 &&
                  typeof details["hasMore"] === "boolean" &&
                  Array.isArray(messages) &&
                  messages.every(
                    (message) =>
                      message !== null &&
                      typeof message === "object" &&
                      Number.isSafeInteger((message as Record<string, unknown>)["seq"]) &&
                      typeof (message as Record<string, unknown>)["text"] === "string"
                  )
                  ? details
                  : undefined;
              })
              .find((details) => details !== undefined)
          : undefined;
      const transcript = Array.isArray(inspection?.["messages"])
        ? inspection["messages"]
            .map((message) =>
              message &&
              typeof message === "object" &&
              typeof (message as Record<string, unknown>)["text"] === "string"
                ? (message as Record<string, string>)["text"]
                : ""
            )
            .join("\n")
        : "";
      const reportsTranscriptEvidence =
        final.trim().length > 0 &&
        (transcript.trim().length > 0 || /\b(?:no|without|empty|nothing|none)\b/iu.test(final));
      return fixture?.["kind"] === "real-subagent-transcript" &&
        inspection !== undefined &&
        reportsTranscriptEvidence
        ? { passed: true }
        : {
            passed: false,
            reason:
              "Diagnosis did not inspect the exact child's bounded transcript or report when the page had no findings",
          };
    },
  },
  {
    name: "gad-channel-health",
    description:
      "A worry that the chat is stuck is answered from one health snapshot whose findings carry the documented attention policy",
    category: "skills",
    prompt:
      "Is this conversation in a healthy state? I want to know whether anything in it is stuck or broken, not a deep investigation.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // The health report is exact code (`@workspace-skills/gad-context`): require that the agent used it.
      const code = successfulEvalCode(result);
      if (!/@workspace-skills\/gad-context/u.test(code) || !/\binspectAgentHealth\b/u.test(code)) {
        return { passed: false, reason: "The agent did not use the channel health report" };
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
    name: "gad-channel-summary",
    description:
      "A request to recap the conversation and say whether the agent is waiting on the user is answered from the exact channel summary",
    category: "skills",
    prompt:
      "Give me a two-line recap of what this conversation has been about so far, and tell me whether you are waiting on anything from me.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // The summary is exact code (counts, the opening and the latest message): require that the agent used it.
      const code = successfulEvalCode(result);
      if (!/@workspace-skills\/gad-context/u.test(code) || !/\bsummarizeChannel\b/u.test(code)) {
        return { passed: false, reason: "The agent did not use the channel summary" };
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
    name: "github-setup-route",
    description:
      "A request to work on pull requests, with GitHub not yet connected, is routed to the setup component by the exact setup route",
    category: "skills",
    prompt:
      "I want you to be able to open pull requests on my GitHub repositories. Get that set up for me.",
    validate: (result) => {
      const base = validateAgentCompletionReport(result);
      if (!base.passed) return base;
      // The route is exact code (`@workspace-skills/github`): require that the agent used it.
      const code = successfulEvalCode(result);
      if (!/@workspace-skills\/github/u.test(code) || !/\brouteGitHubSetup\b/u.test(code)) {
        return { passed: false, reason: "The agent did not use the GitHub setup route" };
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
];


type GitHubSetupCapture = Awaited<ReturnType<GitHubSetupReceiver["runGitHubSetupTeacher"]>>;
type GitHubSetupQualification = Awaited<ReturnType<GitHubSetupReceiver["qualifyGitHubSetup"]>>;
const githubSetupSettings = {
  category: "skills",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["skills/github"],
};

skillTests.push(...githubSetupWorlds.flatMap((world): TestCase[] => [
  {
    ...githubSetupSettings,
    name: `github-setup-live-${world.id}`,
    description: "Choose the access level and handoff from the actual Personal connection status",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const start = Date.now();
      const result = await runner.runGitHubSetup(world.id, false, signal);
      if (result.kind !== "teacher") throw new Error("Expected a GitHub setup capture");
      const { teacher, ...fixture } = result.value;
      return {
        messages: [], duration: Date.now() - start,
        provenance: { contextId: fixture.contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
        diagnostics: { natlangTeacher: teacher, githubSetup: fixture },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as GitHubSetupCapture["teacher"] | undefined;
      const fixture = result.diagnostics?.["githubSetup"] as Omit<GitHubSetupCapture, "teacher"> | undefined;
      return { passed: teacher?.trainingEligible === true && fixture?.verification.passed === true, details: fixture?.verification.checks };
    },
  },
  {
    ...githubSetupSettings,
    name: `github-setup-oracle-qualification-${world.id}`,
    description: "Verify one Personal GitHub setup route from the live credential inventory",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const start = Date.now();
      const result = await runner.runGitHubSetup(world.id, true, signal);
      if (result.kind !== "reference") throw new Error("GitHub setup qualification invoked a model");
      return { messages: [], duration: Date.now() - start, diagnostics: { githubSetup: result.value } };
    },
    validate(result) {
      const qualification = result.diagnostics?.["githubSetup"] as GitHubSetupQualification | undefined;
      return { passed: qualification?.caseId === world.id && qualification.passed === true, details: qualification?.checks };
    },
  },
]));
