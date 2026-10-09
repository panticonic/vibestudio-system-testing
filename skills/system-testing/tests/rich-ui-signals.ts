import type { ChatMessage } from "@workspace/agentic-core";
import type { TestExecutionResult } from "../types.js";
import { isAgentCompletionMessage } from "../agent-message.js";
import { getToolCalls } from "./_helpers.js";
import {
  feedbackSubject,
  type ChatPanelRenderEvidence,
  type FeedbackRepairEvidence,
} from "../real-chat-panel.js";

/** Rich-UI evidence observed in one agent response (one fresh session). */
export interface RichUiSignals {
  /** Ids of completed inline_ui calls whose ok receipt matches a transcript card. */
  inlineUiCalls: string[];
  /** Distinct capitalized JSX tags in agent message prose, outside code. */
  mdxTags: string[];
  mermaidFences: number;
  /** Components defined in agent MDX (top-level export) and used as a tag. */
  customComponents: string[];
  /** A defined-and-used custom component imports from "react" or calls use* hooks. */
  usesHooks: boolean;
  usedRichUi: boolean;
}

export interface RichUiPrompt {
  id: string;
  kind: "ui-worthy" | "bespoke" | "plain";
  prompt: string;
}

/** One render failure the real chat panel reported via `ui.feedback`. */
export interface RichUiRenderFailure {
  category: string;
  /** `inline_ui:<id>`, `action_bar:<id>`, or `message:<id>`. */
  subject: string | null;
  message: string;
  occurrenceKey: string;
}

/** The answered turn's feedback repair (see `FeedbackRepairEvidence`). */
export interface RichUiRepairSummary {
  /** Whether Base owed and ran a repair turn for the answered turn. */
  ran: boolean;
  outcome: FeedbackRepairEvidence["outcome"];
  repairTurnId: string | null;
  /** Feedback occurrences that admitted the repair turn. */
  admittedBy: string[];
  notOwed?: string;
  closeReason?: string;
  /** Subjects the repair turn produced. */
  subjects: string[];
}

/** What the session's real chat panel rendered once settled. */
export interface RichUiRenderEvidence {
  panelId: string;
  feedbackCount: number;
  /** Failures shown once the answered turn's own output settled. */
  initialFailures: RichUiRenderFailure[];
  repair: RichUiRepairSummary;
  unresolved: RichUiRenderFailure[];
  /** Fixed by a clean re-render of the same subject. */
  resolved: RichUiRenderFailure[];
  /** Fixed by the answered turn's repair turn. */
  repaired: RichUiRenderFailure[];
  /** Occurrence keys of failures shown but not deliverable to their author. */
  undelivered: string[];
  screenshot?: ChatPanelRenderEvidence["screenshot"];
}

export interface RichUiResponseEvidence {
  promptId: string;
  kind: RichUiPrompt["kind"];
  signals: RichUiSignals;
  render?: RichUiRenderEvidence;
  /** Transport/session failure that ended this prompt's session early. */
  error?: string;
}

export interface RichUiScore {
  positiveRate: number;
  /** Fraction of bespoke prompts answered with a custom component or inline_ui. */
  bespokeCustomRate: number;
  bespokeCount: number;
  negativeLeak: number;
  uiWorthyCount: number;
  plainCount: number;
  erroredPrompts: string[];
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/** Split Markdown into prose (code removed) and the fence info strings seen. */
function stripCode(content: string): { prose: string; fenceInfos: string[] } {
  const prose: string[] = [];
  const fenceInfos: string[] = [];
  let fence: { char: string; length: number } | undefined;
  for (const line of content.split("\n")) {
    if (fence) {
      const close = FENCE_OPEN.exec(line);
      if (
        close &&
        close[1]![0] === fence.char &&
        close[1]!.length >= fence.length &&
        close[2]!.trim() === ""
      ) {
        fence = undefined;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      fenceInfos.push(open[2]!.trim().toLowerCase());
      continue;
    }
    prose.push(line);
  }
  return { prose: prose.join("\n").replace(/`[^`\n]*`/gu, ""), fenceInfos };
}

const JSX_TAG = /<([A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*)(?=[\s/>])/gu;

export function extractMdxTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of stripCode(content).prose.matchAll(JSX_TAG)) {
    tags.add(match[1]!);
  }
  return [...tags];
}

const COMPONENT_DEFINITION =
  /^export\s+(?:default\s+)?(?:function\s+([A-Z][A-Za-z0-9]*)|const\s+([A-Z][A-Za-z0-9]*)\s*=)/gmu;
const REACT_IMPORT = /^\s*import\s[^;\n]*\sfrom\s+["']react["']/mu;
const HOOK_CALL = /\buse[A-Z][A-Za-z0-9]*\s*\(/u;

/**
 * Components an agent message defines at top level (outside code) and then
 * uses as a JSX tag, and whether the message's definitions use React hooks.
 */
export function extractCustomComponents(content: string): {
  names: string[];
  usesHooks: boolean;
} {
  const { prose } = stripCode(content);
  const tags = new Set(extractMdxTags(content));
  const names = new Set<string>();
  for (const match of prose.matchAll(COMPONENT_DEFINITION)) {
    const name = match[1] ?? match[2]!;
    if (tags.has(name)) names.add(name);
  }
  return {
    names: [...names],
    usesHooks:
      names.size > 0 && (REACT_IMPORT.test(prose) || HOOK_CALL.test(prose)),
  };
}

function nativeChannelMethodValue(
  call: ReturnType<typeof getToolCalls>[number],
): Record<string, unknown> | undefined {
  const details = (
    call.execution?.result as
      | { details?: { protocol?: string; value?: Record<string, unknown> } }
      | undefined
  )?.details;
  return details?.protocol === "native-channel-method-outcome.v1"
    ? details.value
    : undefined;
}

function inlineUiCallIds(result: TestExecutionResult): string[] {
  const ids: string[] = [];
  for (const call of getToolCalls(result)) {
    if (
      call.name !== "inline_ui" ||
      call.execution?.status !== "complete" ||
      call.execution.isError
    )
      continue;
    const receipt = nativeChannelMethodValue(call);
    const id = receipt?.["id"];
    if (
      receipt?.["ok"] === true &&
      typeof id === "string" &&
      result.messages.some(
        (message: ChatMessage) =>
          message.contentType === "inline_ui" && message.inlineUi?.id === id,
      ) &&
      !ids.includes(id)
    )
      ids.push(id);
  }
  return ids;
}

/** Extract rich-UI signals from one response's execution. */
export function extractRichUiSignals(
  result: TestExecutionResult,
): RichUiSignals {
  const tags = new Set<string>();
  const custom = new Set<string>();
  let usesHooks = false;
  let mermaidFences = 0;
  for (const message of result.messages) {
    if (!isAgentCompletionMessage(message)) continue;
    const content = message.content ?? "";
    for (const tag of extractMdxTags(content)) tags.add(tag);
    const defined = extractCustomComponents(content);
    for (const name of defined.names) custom.add(name);
    usesHooks ||= defined.usesHooks;
    mermaidFences += stripCode(content).fenceInfos.filter(
      (info) => info.split(/\s+/u)[0] === "mermaid",
    ).length;
  }
  const inlineUiCalls = inlineUiCallIds(result);
  const mdxTags = [...tags];
  const customComponents = [...custom];
  return {
    inlineUiCalls,
    mdxTags,
    mermaidFences,
    customComponents,
    usesHooks,
    usedRichUi:
      inlineUiCalls.length > 0 ||
      mdxTags.length > 0 ||
      mermaidFences > 0 ||
      customComponents.length > 0,
  };
}

/** Aggregate per-prompt evidence into the propensity metrics. */
export function usedCustomUi(signals: RichUiSignals): boolean {
  return signals.customComponents.length > 0 || signals.inlineUiCalls.length > 0;
}

export function scoreRichUi(responses: RichUiResponseEvidence[]): RichUiScore {
  const bespoke = responses.filter((r) => r.kind === "bespoke");
  const worthy = responses.filter(
    (r) => r.kind === "ui-worthy" || r.kind === "bespoke",
  );
  const plain = responses.filter((r) => r.kind === "plain");
  return {
    positiveRate:
      worthy.length === 0
        ? 0
        : worthy.filter((r) => r.signals.usedRichUi).length / worthy.length,
    bespokeCustomRate:
      bespoke.length === 0
        ? 0
        : bespoke.filter((r) => usedCustomUi(r.signals)).length /
          bespoke.length,
    bespokeCount: bespoke.length,
    negativeLeak: plain.filter((r) => r.signals.usedRichUi).length,
    uiWorthyCount: worthy.length - bespoke.length,
    plainCount: plain.length,
    erroredPrompts: responses.filter((r) => r.error).map((r) => r.promptId),
  };
}

function renderFailure(
  event: ChatPanelRenderEvidence["feedback"][number],
): RichUiRenderFailure {
  return {
    category: event.payload.category,
    subject: feedbackSubject(event),
    message: event.payload.error.message,
    occurrenceKey: event.payload.occurrenceKey,
  };
}

/** Bounded per-response projection of the panel's render evidence. */
export function summarizeRender(
  evidence: ChatPanelRenderEvidence,
): RichUiRenderEvidence {
  const { repair } = evidence;
  return {
    panelId: evidence.panelId,
    feedbackCount: evidence.feedback.length,
    initialFailures: evidence.initialFailures.map(renderFailure),
    repair: {
      ran: repair.repairTurnId !== null,
      outcome: repair.outcome,
      repairTurnId: repair.repairTurnId,
      admittedBy: repair.admittedBy,
      ...(repair.notOwed ? { notOwed: repair.notOwed } : {}),
      ...(repair.closeReason ? { closeReason: repair.closeReason } : {}),
      subjects: repair.subjects,
    },
    unresolved: evidence.unresolved.map(renderFailure),
    resolved: evidence.resolved.map(renderFailure),
    repaired: evidence.repaired.map(renderFailure),
    undelivered: evidence.undelivered.map((report) => report.occurrenceKey),
    ...(evidence.screenshot ? { screenshot: evidence.screenshot } : {}),
  };
}

/**
 * Final unresolved render failures summed over sessions; null when any
 * session has no rendered-panel evidence, so it is never a vacuous zero.
 */
export function compileFailureCount(
  responses: readonly RichUiResponseEvidence[],
): number | null {
  let count = 0;
  for (const response of responses) {
    if (!response.render) return null;
    count += response.render.unresolved.length;
  }
  return count;
}

/**
 * Render failures fixed (re-rendered cleanly or repaired by the answered
 * turn's repair turn) and left unresolved, summed over sessions; null when any
 * session has no rendered-panel evidence.
 */
export function repairCounts(
  responses: readonly RichUiResponseEvidence[],
): { repairedCount: number | null; unrepairedCount: number | null } {
  let repairedCount = 0;
  let unrepairedCount = 0;
  for (const response of responses) {
    if (!response.render) return { repairedCount: null, unrepairedCount: null };
    repairedCount += response.render.resolved.length + response.render.repaired.length;
    unrepairedCount += response.render.unresolved.length;
  }
  return { repairedCount, unrepairedCount };
}
