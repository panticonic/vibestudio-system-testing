import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";
import {
  compileFailureCount,
  extractRichUiSignals,
  scoreRichUi,
  summarizeRender,
  type RichUiPrompt,
  type RichUiResponseEvidence,
} from "./rich-ui-signals.js";

export const RICH_UI_PROMPTS: readonly RichUiPrompt[] = [
  {
    id: "lisbon-day",
    kind: "ui-worthy",
    prompt: "Plan a day in Lisbon for me — I like food and viewpoints.",
  },
  {
    id: "phone-plans",
    kind: "ui-worthy",
    prompt:
      "I'm choosing between three phone plans: Northwind at $25/month with 5 GB, Skyline at $40/month with 20 GB, and Orbit at $55/month with unlimited data and a free streaming service. Help me compare them.",
  },
  {
    id: "bill-split",
    kind: "ui-worthy",
    prompt: "Help me split a $180 dinner bill among 4 people with an 18% tip.",
  },
  {
    id: "inflation",
    kind: "ui-worthy",
    prompt:
      "How did US inflation move from 2019 to 2024? Give me the yearly numbers.",
  },
  {
    id: "mortgage",
    kind: "ui-worthy",
    prompt:
      "I'm deciding between a 15- and 30-year mortgage on $400k at 6.1% and 6.6% — help me see the difference.",
  },
  {
    id: "hiking-packing",
    kind: "ui-worthy",
    prompt: "Help me pack for a 3-day hiking trip.",
  },
  {
    id: "four-stroke",
    kind: "ui-worthy",
    prompt: "Explain how a 4-stroke engine works.",
  },
  { id: "peru-capital", kind: "plain", prompt: "What's the capital of Peru?" },
  { id: "typo-fix", kind: "plain", prompt: "Fix the typo: 'recieve'" },
  { id: "multiply", kind: "plain", prompt: "What's 17 times 23?" },
];

export const POSITIVE_RATE_THRESHOLD = 0.75;
const EVIDENCE_KEY = "richUiPropensity";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One fresh session for one prompt, with the stock chat panel rendering the
 * channel. After the response, the settled panel reports what it rendered.
 */
async function runPrompt(
  context: TestOrchestrationContext,
  prompt: RichUiPrompt,
): Promise<{ execution: TestExecutionResult; evidence: RichUiResponseEvidence }> {
  const start = Date.now();
  const session = await context.runner.spawn({
    realChatPanel: true,
    signal: context.signal,
  });
  let sendError: unknown;
  let render: RichUiResponseEvidence["render"];
  try {
    await context.sendAndWait(session, prompt.prompt, prompt.id);
    render = summarizeRender(
      await context.runner.observeChatPanelRendering(session, {
        signal: context.signal,
        screenshot: true,
      }),
    );
  } catch (error) {
    sendError = error;
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - start,
    snapshot: session.snapshot(),
    ...(sendError ? { error: formatError(sendError) } : {}),
  };
  try {
    await session.close();
  } catch (error) {
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      `close: ${formatError(error)}`,
    ];
  }
  const cleanupErrors = session
    .snapshot()
    .cleanupErrors.map((error) => `${error.phase}: ${error.message}`);
  if (cleanupErrors.length > 0) {
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      ...cleanupErrors,
    ];
    execution.error ??= `Headless cleanup failed: ${cleanupErrors.join("; ")}`;
  }
  return {
    execution,
    evidence: {
      promptId: prompt.id,
      kind: prompt.kind,
      signals: extractRichUiSignals(execution),
      ...(render ? { render } : {}),
      ...(execution.error ? { error: execution.error } : {}),
    },
  };
}

/** Run prompts one after another, each in its own session. */
async function runPromptSet(
  context: TestOrchestrationContext,
  prompts: readonly RichUiPrompt[],
): Promise<TestExecutionResult> {
  const start = Date.now();
  const messages: TestExecutionResult["messages"] = [];
  const cleanupErrors: string[] = [];
  const responses: RichUiResponseEvidence[] = [];
  for (const prompt of prompts) {
    const { execution, evidence } = await runPrompt(context, prompt);
    messages.push(...execution.messages);
    cleanupErrors.push(...(execution.cleanupErrors ?? []));
    responses.push(evidence);
  }
  return {
    messages,
    duration: Date.now() - start,
    ...(cleanupErrors.length > 0 ? { cleanupErrors } : {}),
    diagnostics: { [EVIDENCE_KEY]: { responses } },
  };
}

function responsesOf(result: TestExecutionResult): RichUiResponseEvidence[] {
  const evidence = result.diagnostics?.[EVIDENCE_KEY] as
    | { responses?: RichUiResponseEvidence[] }
    | undefined;
  return evidence?.responses ?? [];
}

/** Rendered rich UI must work: unresolved or unreported failures fail the response. */
function renderProblem(response: RichUiResponseEvidence): string | undefined {
  const render = response.render;
  if (!render) return "No rendered-panel evidence was recorded";
  if (render.undelivered.length > 0)
    return `The panel showed failures it could not report: ${render.undelivered.join(", ")}`;
  if (render.unresolved.length > 0)
    return `Rich UI failed to render: ${render.unresolved
      .map((failure) => `${failure.category} ${failure.subject ?? "?"}: ${failure.message}`)
      .join("; ")}`;
  return undefined;
}

/**
 * `compileFailureCount` is the number of final unresolved render failures
 * (compile_failed / render_failed / props_invalid `ui.feedback` from the real
 * chat panel) summed over sessions; see `classifyRenderFailures`.
 */
export function validatePropensityScore(result: TestExecutionResult) {
  const responses = responsesOf(result);
  const score = scoreRichUi(responses);
  const details = {
    ...score,
    compileFailureCount: compileFailureCount(responses),
    perPrompt: responses,
  };
  if (score.erroredPrompts.length > 0) {
    return {
      passed: false,
      reason: `Sessions failed for: ${score.erroredPrompts.join(", ")}`,
      details,
    };
  }
  const broken = responses
    .map((response) => [response.promptId, renderProblem(response)] as const)
    .filter(([, problem]) => problem);
  if (broken.length > 0) {
    return {
      passed: false,
      reason: broken.map(([id, problem]) => `${id}: ${problem}`).join("; "),
      details,
    };
  }
  if (score.positiveRate < POSITIVE_RATE_THRESHOLD) {
    const missed = responses
      .filter((r) => r.kind === "ui-worthy" && !r.signals.usedRichUi)
      .map((r) => r.promptId);
    return {
      passed: false,
      reason: `positiveRate ${score.positiveRate.toFixed(2)} is below ${POSITIVE_RATE_THRESHOLD}; plain-text answers for: ${missed.join(", ")}`,
      details,
    };
  }
  if (score.negativeLeak > 0) {
    const leaked = responses
      .filter((r) => r.kind === "plain" && r.signals.usedRichUi)
      .map((r) => r.promptId);
    return {
      passed: false,
      reason: `Rich UI leaked into plain prompts: ${leaked.join(", ")}`,
      details,
    };
  }
  return { passed: true, details };
}

export function validateSinglePrompt(result: TestExecutionResult) {
  const [response] = responsesOf(result);
  if (!response)
    return { passed: false, reason: "No prompt evidence was recorded" };
  const details = {
    ...response,
    compileFailureCount: compileFailureCount([response]),
  };
  if (response.error)
    return { passed: false, reason: response.error, details };
  const problem = renderProblem(response);
  if (problem) return { passed: false, reason: problem, details };
  const wanted = response.kind === "ui-worthy";
  return response.signals.usedRichUi === wanted
    ? { passed: true, details }
    : {
        passed: false,
        reason: wanted
          ? "Answered a UI-worthy prompt with plain text"
          : "Used rich UI on a plain prompt",
        details,
      };
}

export const richUiPropensityTests: TestCase[] = [
  {
    name: "rich-ui-propensity-score",
    description:
      "Measure how often the chat agent reaches for rich UI on UI-worthy prompts and how often it over-reaches on plain ones",
    category: "rich-ui-propensity",
    explicitOnly: true,
    timeoutMs: null,
    prompt: RICH_UI_PROMPTS.map((p) => p.prompt).join("\n"),
    orchestrate: (context) => runPromptSet(context, RICH_UI_PROMPTS),
    validate: validatePropensityScore,
  },
  ...RICH_UI_PROMPTS.map(
    (prompt): TestCase => ({
      name: `rich-ui-propensity-${prompt.id}`,
      description: `Rich-UI propensity for one ${prompt.kind} prompt: ${prompt.prompt}`,
      category: "rich-ui-propensity",
      explicitOnly: true,
      prompt: prompt.prompt,
      orchestrate: (context) => runPromptSet(context, [prompt]),
      validate: validateSinglePrompt,
    }),
  ),
];
