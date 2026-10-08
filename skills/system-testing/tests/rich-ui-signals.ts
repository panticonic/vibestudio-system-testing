import type { ChatMessage } from "@workspace/agentic-core";
import type { TestExecutionResult } from "../types.js";
import { isAgentCompletionMessage } from "../agent-message.js";
import { getToolCalls } from "./_helpers.js";
import {
  feedbackSubject,
  type ChatPanelRenderEvidence,
} from "../real-chat-panel.js";

/** Rich-UI evidence observed in one agent response (one fresh session). */
export interface RichUiSignals {
  /** Ids of completed inline_ui calls whose ok receipt matches a transcript card. */
  inlineUiCalls: string[];
  /** Distinct capitalized JSX tags in agent message prose, outside code. */
  mdxTags: string[];
  mermaidFences: number;
  usedRichUi: boolean;
}

export interface RichUiPrompt {
  id: string;
  kind: "ui-worthy" | "plain";
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

/** What the session's real chat panel rendered once settled. */
export interface RichUiRenderEvidence {
  panelId: string;
  feedbackCount: number;
  unresolved: RichUiRenderFailure[];
  resolved: RichUiRenderFailure[];
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
  let mermaidFences = 0;
  for (const message of result.messages) {
    if (!isAgentCompletionMessage(message)) continue;
    const content = message.content ?? "";
    for (const tag of extractMdxTags(content)) tags.add(tag);
    mermaidFences += stripCode(content).fenceInfos.filter(
      (info) => info.split(/\s+/u)[0] === "mermaid",
    ).length;
  }
  const inlineUiCalls = inlineUiCallIds(result);
  const mdxTags = [...tags];
  return {
    inlineUiCalls,
    mdxTags,
    mermaidFences,
    usedRichUi: inlineUiCalls.length > 0 || mdxTags.length > 0 || mermaidFences > 0,
  };
}

/** Aggregate per-prompt evidence into the propensity metrics. */
export function scoreRichUi(responses: RichUiResponseEvidence[]): RichUiScore {
  const worthy = responses.filter((r) => r.kind === "ui-worthy");
  const plain = responses.filter((r) => r.kind === "plain");
  return {
    positiveRate:
      worthy.length === 0
        ? 0
        : worthy.filter((r) => r.signals.usedRichUi).length / worthy.length,
    negativeLeak: plain.filter((r) => r.signals.usedRichUi).length,
    uiWorthyCount: worthy.length,
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
  return {
    panelId: evidence.panelId,
    feedbackCount: evidence.feedback.length,
    unresolved: evidence.unresolved.map(renderFailure),
    resolved: evidence.resolved.map(renderFailure),
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
