import type { ChatMessage } from "@workspace/agentic-core";
import type {
  HeadlessSession,
  ObservedUiFeedback,
} from "@workspace/agentic-session";
import type { PanelHandle } from "@workspace/runtime";
import { isAgentCompletionMessage } from "./agent-message.js";

/**
 * A real chat panel participant for a headless test session.
 *
 * The stock `panels/chat` is opened in the session's own agent context and
 * bound to the session's channel through its ordinary `channelName` state arg.
 * The server hosts it in its CDP-capable panel host (a headless Chromium of
 * last resort when no client can present it), so it joins the channel with
 * the same participant methods users get (inline_ui, feedback_form, ...) and
 * compiles and renders every message exactly as users see it. Its failures
 * reach the channel as the real `ui.feedback` events.
 */
export const CHAT_PANEL_SOURCE = "panels/chat";

/** Agent-authored UI failures that make a response not render as authored. */
export const RENDER_FAILURE_CATEGORIES: ReadonlySet<string> = new Set([
  "compile_failed",
  "render_failed",
  "props_invalid",
]);

/** A failure reporter still mounted in the settled panel. */
export interface MountedFailureReport {
  occurrenceKey: string;
  category: string;
  delivery: "sending" | "sent" | "failed";
}

/** What the settled panel shows, read from its rendered DOM contract. */
export interface SettledChatPanel {
  /** Failure reporters mounted (failures still shown) after settlement. */
  reports: MountedFailureReport[];
  /** Agent-authored surfaces currently rendered, as `kind:id` subjects. */
  subjects: string[];
}

export interface ChatPanelRenderEvidence {
  panelId: string;
  settled: SettledChatPanel;
  /** Every `ui.feedback` event observed on the channel. */
  feedback: ObservedUiFeedback[];
  /** Render failures whose subject's final revision still fails (or never re-rendered). */
  unresolved: ObservedUiFeedback[];
  /** Render failures superseded by a successful render of the same subject. */
  resolved: ObservedUiFeedback[];
  /** Failures the panel shows but could not report to their author. */
  undelivered: MountedFailureReport[];
  screenshot?: { digest: string; mimeType: string; width: number; height: number };
}

/**
 * The agent-authored surface a feedback event is about. A message's inline UI
 * or action bar is the narrower subject; a bare message ref is an MDX message.
 */
export function feedbackSubject(event: ObservedUiFeedback): string | null {
  const refs = event.payload.refs;
  if (refs?.inlineUiId) return `inline_ui:${refs.inlineUiId}`;
  if (refs?.actionBarId) return `action_bar:${refs.actionBarId}`;
  if (refs?.messageId) return `message:${refs.messageId}`;
  return null;
}

/**
 * Split render-failure reports into unresolved and resolved.
 *
 * A failure occurrence is identified by its `occurrenceKey`, which the panel
 * derives from the subject's rendered revision. The panel mounts a reporter
 * exactly while it shows that failure. In the settled panel a reported
 * failure is therefore:
 *  - unresolved when its reporter is still mounted (the subject's final
 *    revision fails this way), or when its subject is no longer rendered at
 *    all (nothing replaced it with a working render), or when it names no
 *    subject that could be re-rendered;
 *  - resolved when its subject is rendered and the failure is no longer shown,
 *    i.e. a later revision of the same inline UI / action bar / message
 *    compiled and rendered without it.
 * Repeated events with one occurrence key count once.
 */
export function classifyRenderFailures(
  feedback: readonly ObservedUiFeedback[],
  settled: SettledChatPanel,
): { unresolved: ObservedUiFeedback[]; resolved: ObservedUiFeedback[] } {
  const shown = new Set(settled.reports.map((report) => report.occurrenceKey));
  const rendered = new Set(settled.subjects);
  const seen = new Set<string>();
  const unresolved: ObservedUiFeedback[] = [];
  const resolved: ObservedUiFeedback[] = [];
  for (const event of feedback) {
    if (!RENDER_FAILURE_CATEGORIES.has(event.payload.category)) continue;
    if (seen.has(event.payload.occurrenceKey)) continue;
    seen.add(event.payload.occurrenceKey);
    const subject = feedbackSubject(event);
    if (shown.has(event.payload.occurrenceKey) || !subject || !rendered.has(subject))
      unresolved.push(event);
    else resolved.push(event);
  }
  return { unresolved, resolved };
}

/**
 * Evaluate an in-page promise; aborting `signal` closes the page session so
 * the evaluation settles with the abort instead of being abandoned.
 */
async function evaluateInPanel<T>(
  panel: PanelHandle,
  expression: string,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const page = await panel.cdp.page();
  const abort = () => void page.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await page.evaluate<T>(expression);
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!signal?.aborted) await page.close();
  }
}

/**
 * Wait until the rendered chat reports its channel subscription established.
 *
 * Roster presence is a disposable signal that the channel delivers only to
 * live subscription streams, never to resident (headless) participants, so
 * the session cannot observe the panel joining. The panel's own connection
 * state is the authoritative join: "connected" follows the subscribe call
 * that registered its membership and advertised methods.
 */
export function awaitChatPanelConnected(
  panel: PanelHandle,
  signal?: AbortSignal,
): Promise<true> {
  return evaluateInPanel<true>(
    panel,
    `(async () => {
      const connected = () => document.querySelector('[data-chat-connection="connected"]');
      if (!connected())
        await new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            if (connected()) { observer.disconnect(); resolve(); }
          });
          observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
        });
      return true;
    })()`,
    signal,
  );
}

function isRenderedAgentText(message: ChatMessage): boolean {
  return (
    isAgentCompletionMessage(message) &&
    (!message.contentType || message.contentType === "text") &&
    (message.content ?? "").length > 0
  );
}

/**
 * In-page settlement: every expected agent message and inline UI is mounted,
 * no message is still a placeholder for its MDX render, and no failure report
 * is still being published. Re-evaluated on each DOM mutation; no clock.
 */
const SETTLE_EXPRESSION = `(async (expected) => {
  const q = (s) => document.querySelector(s);
  const settled = () => {
    for (const id of expected.messageIds) {
      const el = q('.message-content[data-message-id="' + CSS.escape(id) + '"]');
      if (!el || el.querySelector('[data-ui-render="pending"]')) return false;
    }
    for (const id of expected.inlineUiIds)
      if (!q('[data-inline-ui-id="' + CSS.escape(id) + '"]')) return false;
    return !q('[data-ui-feedback-delivery="sending"]');
  };
  if (!settled())
    await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (settled()) { observer.disconnect(); resolve(); }
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    });
  const all = (s) => [...document.querySelectorAll(s)];
  return {
    reports: all('[data-ui-feedback-occurrence]').map((el) => ({
      occurrenceKey: el.dataset.uiFeedbackOccurrence,
      category: el.dataset.uiFeedbackCategory,
      delivery: el.dataset.uiFeedbackDelivery,
    })),
    subjects: [
      ...all('.message-content[data-message-id]').map((el) => 'message:' + el.dataset.messageId),
      ...all('[data-inline-ui-id]').map((el) => 'inline_ui:' + el.dataset.inlineUiId),
      ...all('[data-action-bar-id]').map((el) => 'action_bar:' + el.dataset.actionBarId),
    ],
  };
})`;

/**
 * Observe the rendered outcome of the session's transcript in its real chat
 * panel: wait until the panel has settled every agent-authored surface, then
 * join each failure it shows to the `ui.feedback` event it published.
 */
export async function observeChatPanelRendering(
  session: HeadlessSession,
  panel: PanelHandle,
  options: {
    signal?: AbortSignal;
    storeScreenshot?: (base64: string) => Promise<{ digest: string }>;
  } = {},
): Promise<ChatPanelRenderEvidence> {
  const messageIds = session.messages.filter(isRenderedAgentText).map((m) => m.id);
  const inlineUiIds = [
    ...new Set(
      session.messages
        .map((m) => (m.contentType === "inline_ui" ? m.inlineUi?.id : undefined))
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const settled = await evaluateInPanel<SettledChatPanel>(
    panel,
    `${SETTLE_EXPRESSION}(${JSON.stringify({ messageIds, inlineUiIds })})`,
    options.signal,
  );
  // A shown failure whose report was accepted by the channel must reach this
  // session too; wait for that exact occurrence rather than sampling.
  const sent = settled.reports.filter((report) => report.delivery === "sent");
  await session.waitUntil(
    () =>
      sent.every((report) =>
        session.uiFeedback.some(
          (event) => event.payload.occurrenceKey === report.occurrenceKey,
        ),
      ) || undefined,
    options.signal ? { signal: options.signal } : undefined,
  );
  const feedback = [...session.uiFeedback];
  const { unresolved, resolved } = classifyRenderFailures(feedback, settled);
  const evidence: ChatPanelRenderEvidence = {
    panelId: panel.id,
    settled,
    feedback,
    unresolved,
    resolved,
    undelivered: settled.reports.filter((report) => report.delivery === "failed"),
  };
  if (options.storeScreenshot) {
    const shot = await panel.cdp.screenshot({ format: "png" });
    const stored = await options.storeScreenshot(shot.data);
    evidence.screenshot = {
      digest: stored.digest,
      mimeType: shot.mimeType,
      width: shot.width,
      height: shot.height,
    };
  }
  return evidence;
}
