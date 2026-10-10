import { appendSystemTestCleanupFailure } from "../structured-error.js";
import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";
import {
  compileFailureCount,
  extractRichUiSignals,
  repairCounts,
  scoreRichUi,
  summarizeRender,
  usedCustomUi,
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
    kind: "plain",
    prompt: "Help me split a $180 dinner bill among 4 people with an 18% tip.",
  },
  {
    id: "bill-split-what-if",
    kind: "ui-worthy",
    prompt:
      "Help me explore how each person's share of a $180 dinner changes as we adjust the tip and number of people. Consider a small group of 4 and a larger group of 6, and show what happens from a 15% tip to a 22% tip.",
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
  // Bespoke: interactive and UI-worthy, but no catalog component fits. The
  // catalog's Chart/Stats/Compare/Timeline/Checklist/PlaceMap/Choices/
  // Calculator/ActionButton present data, sequences of text, or numeric forms
  // with a single formula. Mixing light needs a live swatch driven by three
  // sliders; stepping an engine needs a drawn, animated state per stroke
  // (Timeline is static text); a pendulum needs a simulation whose motion
  // depends on a continuously changed length (Calculator yields numbers only).
  {
    id: "rgb-light-mixing",
    kind: "bespoke",
    prompt:
      "I want to get a feel for how mixing red, green and blue light makes colors — let me play with it.",
  },
  {
    id: "engine-strokes",
    kind: "bespoke",
    prompt: "Let me step through what happens inside a 4-stroke engine, one stroke at a time.",
  },
  {
    id: "pendulum-length",
    kind: "bespoke",
    prompt:
      "Show me how a pendulum's swing changes when I make the string longer or shorter, so I can try different lengths.",
  },
  { id: "peru-capital", kind: "plain", prompt: "What's the capital of Peru?" },
  { id: "typo-fix", kind: "plain", prompt: "Fix the typo: 'recieve'" },
  { id: "multiply", kind: "plain", prompt: "What's 17 times 23?" },
];

export const POSITIVE_RATE_THRESHOLD = 0.75;
export const BESPOKE_CUSTOM_RATE_THRESHOLD = 2 / 3;
const EVIDENCE_KEY = "richUiPropensity";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One fresh session for one prompt, with the stock chat panel rendering the
 * channel. After the response (and the feedback repair turn Base owes it when
 * its output failed), the settled panel reports what it rendered.
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
    const answer = await context.sendAndWait(session, prompt.prompt, prompt.id);
    render = summarizeRender(
      await context.runner.observeChatPanelRendering(session, answer, {
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
    appendSystemTestCleanupFailure(execution, "close", error);
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
  const cleanupFailures: NonNullable<TestExecutionResult["cleanupFailures"]> = [];
  const responses: RichUiResponseEvidence[] = [];
  for (const prompt of prompts) {
    const { execution, evidence } = await runPrompt(context, prompt);
    messages.push(...execution.messages);
    cleanupErrors.push(...(execution.cleanupErrors ?? []));
    cleanupFailures.push(...(execution.cleanupFailures ?? []));
    responses.push(evidence);
  }
  return {
    messages,
    duration: Date.now() - start,
    ...(cleanupErrors.length > 0 ? { cleanupErrors } : {}),
    ...(cleanupFailures.length > 0 ? { cleanupFailures } : {}),
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
  if (render.unresolved.length > 0) {
    const repair = render.repair.ran
      ? `repair turn ${render.repair.outcome}${render.repair.closeReason ? ` (${render.repair.closeReason})` : ""}, produced ${render.repair.subjects.length} output(s)`
      : `no repair turn: ${render.repair.notOwed ?? "not owed"}`;
    return `Rich UI failed to render (${repair}): ${render.unresolved
      .map((failure) => `${failure.category} ${failure.subject ?? "?"}: ${failure.message}`)
      .join("; ")}`;
  }
  return undefined;
}

/**
 * `compileFailureCount` (= `unrepairedCount`) is the number of final
 * unresolved render failures (compile_failed / render_failed / props_invalid
 * `ui.feedback` from the real chat panel) summed over sessions, after each
 * answer's feedback repair turn; `repairedCount` counts the failures that a
 * clean re-render or the repair turn fixed. See `classifyRenderFailures`.
 */
export function validatePropensityScore(result: TestExecutionResult) {
  const responses = responsesOf(result);
  const score = scoreRichUi(responses);
  const details = {
    ...score,
    compileFailureCount: compileFailureCount(responses),
    ...repairCounts(responses),
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
      .filter((r) => r.kind !== "plain" && !r.signals.usedRichUi)
      .map((r) => r.promptId);
    return {
      passed: false,
      reason: `positiveRate ${score.positiveRate.toFixed(2)} is below ${POSITIVE_RATE_THRESHOLD}; plain-text answers for: ${missed.join(", ")}`,
      details,
    };
  }
  if (
    score.bespokeCount > 0 &&
    score.bespokeCustomRate < BESPOKE_CUSTOM_RATE_THRESHOLD - 1e-9
  ) {
    const missed = responses
      .filter((r) => r.kind === "bespoke" && !usedCustomUi(r.signals))
      .map((r) => r.promptId);
    return {
      passed: false,
      reason: `bespokeCustomRate ${score.bespokeCustomRate.toFixed(2)} is below ${BESPOKE_CUSTOM_RATE_THRESHOLD.toFixed(2)}; no custom component or inline_ui for: ${missed.join(", ")}`,
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
    ...repairCounts([response]),
  };
  if (response.error)
    return { passed: false, reason: response.error, details };
  const problem = renderProblem(response);
  if (problem) return { passed: false, reason: problem, details };
  if (response.kind === "bespoke")
    return usedCustomUi(response.signals)
      ? { passed: true, details }
      : {
          passed: false,
          reason:
            "Answered a bespoke interactive prompt without a custom component or inline_ui",
          details,
        };
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
