import type { ChatMessage } from "@workspace/agentic-core";
import type {
  HeadlessSession,
  ObservedUiFeedback,
} from "@workspace/agentic-session";
import type { ProjectedTurn } from "@workspace/agentic-protocol";
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

/**
 * The one repair turn Base owes an ordinary agent turn whose output the panel
 * reported failing (see Base `feedbackRepairAdmission`): a `ui.feedback`
 * addressed to the agent whose `refs.turnId` names that turn wakes the agent
 * once; failures of the repair turn's own output never wake it again.
 */
export interface FeedbackRepairEvidence {
  /** The ordinary turn being judged. */
  turnId: string;
  /** Occurrence keys of delivered feedback that admitted the repair turn. */
  admittedBy: string[];
  /** Why no repair turn was owed, when `admittedBy` is empty. */
  notOwed?: string;
  /** The repair turn the agent opened, or null when none was owed. */
  repairTurnId: string | null;
  /** `completed` when the repair turn closed normally. */
  outcome: "not_owed" | "completed" | "failed";
  /** The repair turn's close reason when it did not complete. */
  closeReason?: string;
  /** `kind:id` subjects the repair turn produced. */
  subjects: string[];
}

export interface ChatPanelRenderEvidence {
  panelId: string;
  settled: SettledChatPanel;
  /** Every `ui.feedback` event observed on the channel. */
  feedback: ObservedUiFeedback[];
  /** Render failures still shown once the judged turn's own output settled. */
  initialFailures: ObservedUiFeedback[];
  /** The judged turn's feedback repair lifecycle. */
  repair: FeedbackRepairEvidence;
  /** Render failures neither re-rendered cleanly nor repaired. */
  unresolved: ObservedUiFeedback[];
  /** Render failures superseded by a successful render of the same subject. */
  resolved: ObservedUiFeedback[];
  /** Render failures of the judged turn fixed by its repair turn. */
  repaired: ObservedUiFeedback[];
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
 * Split render-failure reports into unresolved, resolved, and repaired.
 *
 * A failure occurrence is identified by its `occurrenceKey`, which the panel
 * derives from the subject's rendered revision. The panel mounts a reporter
 * exactly while it shows that failure. In the settled panel a reported
 * failure F of subject S is:
 *  - resolved when S is rendered and F is no longer shown, i.e. a later
 *    revision of the same inline UI / action bar / message compiled and
 *    rendered without it;
 *  - repaired when F came from the judged turn's output (`refs.turnId`), that
 *    turn's repair turn completed and produced at least one replacement
 *    output, and every subject the repair turn produced is rendered without
 *    an unresolved failure. An MDX message never re-renders, so this is how a
 *    failed message is fixed: by a new message from the repair turn;
 *  - unresolved otherwise: still shown, its subject gone, no subject at all,
 *    or nothing repaired it. Failures of the repair turn's own output are
 *    never repaired; they are resolved only by a clean re-render.
 * Repeated events with one occurrence key count once.
 */
export function classifyRenderFailures(
  feedback: readonly ObservedUiFeedback[],
  settled: SettledChatPanel,
  repair?: FeedbackRepairEvidence,
): {
  unresolved: ObservedUiFeedback[];
  resolved: ObservedUiFeedback[];
  repaired: ObservedUiFeedback[];
} {
  const shown = new Set(settled.reports.map((report) => report.occurrenceKey));
  const rendered = new Set(settled.subjects);
  const seen = new Set<string>();
  const failing: ObservedUiFeedback[] = [];
  const resolved: ObservedUiFeedback[] = [];
  for (const event of feedback) {
    if (!RENDER_FAILURE_CATEGORIES.has(event.payload.category)) continue;
    if (seen.has(event.payload.occurrenceKey)) continue;
    seen.add(event.payload.occurrenceKey);
    const subject = feedbackSubject(event);
    if (shown.has(event.payload.occurrenceKey) || !subject || !rendered.has(subject))
      failing.push(event);
    else resolved.push(event);
  }
  const failingSubjects = new Set(failing.map(feedbackSubject));
  const repairHeld =
    repair?.outcome === "completed" &&
    repair.subjects.length > 0 &&
    repair.subjects.every(
      (subject) => rendered.has(subject) && !failingSubjects.has(subject),
    );
  const unresolved: ObservedUiFeedback[] = [];
  const repaired: ObservedUiFeedback[] = [];
  for (const event of failing)
    (repairHeld && event.payload.refs?.turnId === repair.turnId
      ? repaired
      : unresolved
    ).push(event);
  return { unresolved, resolved, repaired };
}

const NATIVE_RUN_TURN = /^native-run:([^:]+):([1-9]\d*)$/u;

/**
 * Native runs of the judged turn's conversation opened after it. No user
 * input follows the judged turn while it is observed, so each such run was
 * opened by a non-user input; Base admits exactly one, the feedback repair.
 */
function laterNativeRuns(
  session: HeadlessSession,
  turnId: string,
): ProjectedTurn[] {
  const judged = NATIVE_RUN_TURN.exec(turnId);
  if (!judged) return [];
  return Object.values(session.channelView.turns).filter((turn) => {
    const run = NATIVE_RUN_TURN.exec(turn.turnId);
    return run !== null && run[1] === judged[1] && Number(run[2]) > Number(judged[2]);
  });
}

/** The agent-authored surfaces one turn produced, as `kind:id` subjects. */
function turnSubjects(session: HeadlessSession, turnId: string): string[] {
  const subjects = new Set<string>();
  for (const message of session.messages) {
    if (isRenderedAgentText(message) && message.turnId === turnId)
      subjects.add(`message:${message.id}`);
    if (
      message.contentType === "inline_ui" &&
      message.inlineUi?.id &&
      (message.inlineUi.turnId ?? message.turnId) === turnId
    )
      subjects.add(`inline_ui:${message.inlineUi.id}`);
  }
  for (const bar of Object.values(session.channelView.actionBars))
    if (bar?.id && bar.turnId === turnId && !bar.cleared)
      subjects.add(`action_bar:${bar.id}`);
  return [...subjects];
}

/**
 * Join the judged turn's feedback repair through its real lifecycle.
 *
 * Whether a repair is owed is decided from the admission rule's own inputs,
 * not from elapsed time: a `ui.feedback` the channel accepted (the session
 * observed it) is delivered to its target durably, and Base admits a repair
 * input for the first such feedback addressed to the agent that names an
 * ordinary native turn. When owed, the repair run's `turn.closed` on the
 * channel is the terminal event; it follows the run's published answers in
 * the same ordered delivery chain.
 */
export async function observeFeedbackRepair(
  session: HeadlessSession,
  answer: ChatMessage,
  signal?: AbortSignal,
): Promise<FeedbackRepairEvidence> {
  const turnId = answer.turnId;
  if (!turnId || !NATIVE_RUN_TURN.test(turnId))
    return {
      turnId: turnId ?? "",
      admittedBy: [],
      notOwed: `the answer names no ordinary native turn (${turnId ?? "no turnId"})`,
      repairTurnId: null,
      outcome: "not_owed",
      subjects: [],
    };
  const naming = session.uiFeedback.filter(
    (event) => event.payload.refs?.turnId === turnId,
  );
  const admittedBy = [
    ...new Set(
      naming
        .filter((event) => event.payload.target.participantId === answer.senderId)
        .map((event) => event.payload.occurrenceKey),
    ),
  ];
  if (admittedBy.length === 0) {
    const unaddressed = session.uiFeedback.filter(
      (event) =>
        RENDER_FAILURE_CATEGORIES.has(event.payload.category) &&
        event.payload.refs?.turnId !== turnId,
    );
    return {
      turnId,
      admittedBy,
      ...(naming.length > 0
        ? {
            notOwed: `feedback naming ${turnId} was addressed to ${naming
              .map((event) => event.payload.target.participantId ?? "no participant")
              .join(", ")}, not the agent ${answer.senderId}`,
          }
        : unaddressed.length > 0
          ? {
              notOwed: `render failures named no ordinary turn of this answer: ${unaddressed
                .map((event) => `${event.payload.occurrenceKey} (turn ${event.payload.refs?.turnId ?? "none"})`)
                .join(", ")}`,
            }
          : { notOwed: "no feedback was delivered" }),
      repairTurnId: null,
      outcome: "not_owed",
      subjects: [],
    };
  }
  const repairTurn = await session.waitUntil(
    () => {
      const later = laterNativeRuns(session, turnId);
      if (later.length > 1)
        throw new Error(
          `Feedback for ${turnId} opened more than one later run: ${later
            .map((turn) => turn.turnId)
            .join(", ")}`,
        );
      return later[0]?.status === "closed" ? later[0] : undefined;
    },
    signal ? { signal } : undefined,
  );
  return {
    turnId,
    admittedBy,
    repairTurnId: repairTurn.turnId,
    outcome: repairTurn.reason ? "failed" : "completed",
    ...(repairTurn.reason ? { closeReason: repairTurn.reason } : {}),
    subjects: turnSubjects(session, repairTurn.turnId),
  };
}

/** The caller's abort signal joined with the session's own close. */
export function sessionBoundSignal(
  session: Pick<HeadlessSession, "lifetime">,
  signal?: AbortSignal,
): AbortSignal {
  return signal ? AbortSignal.any([signal, session.lifetime]) : session.lifetime;
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
  const session = await panel.cdp.session();
  const page = session.page;
  // Closing the session rejects the in-flight evaluation; the evaluation's own
  // rejection is what the caller sees, so a close failure is not a second
  // unhandled one.
  const abort = () => void session.close().catch(() => undefined);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([
      page.evaluate<T>(expression),
      ...(signal
        ? [
            new Promise<never>((_, reject) => {
              const rejectAborted = () => reject(signal.reason);
              if (signal.aborted) rejectAborted();
              else signal.addEventListener("abort", rejectAborted, { once: true });
            }),
          ]
        : []),
    ]);
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!signal?.aborted) await session.close();
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
 * Settle every agent-authored surface the session's transcript holds in the
 * panel, then wait until each shown failure whose report the channel accepted
 * has reached this session too (that exact occurrence, not a sample).
 */
async function settleChatPanel(
  session: HeadlessSession,
  panel: PanelHandle,
  signal?: AbortSignal,
): Promise<SettledChatPanel> {
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
    sessionBoundSignal(session, signal),
  );
  const sent = settled.reports.filter((report) => report.delivery === "sent");
  await session.waitUntil(
    () =>
      sent.every((report) =>
        session.uiFeedback.some(
          (event) => event.payload.occurrenceKey === report.occurrenceKey,
        ),
      ) || undefined,
    signal ? { signal } : undefined,
  );
  return settled;
}

/**
 * Observe the rendered outcome of one answered turn in the session's real
 * chat panel: settle its output, join the feedback repair turn Base owes it
 * when the panel reported that output failing, settle again with the repair's
 * output, and classify every reported failure (`classifyRenderFailures`).
 */
export async function observeChatPanelRendering(
  session: HeadlessSession,
  panel: PanelHandle,
  answer: ChatMessage,
  options: {
    signal?: AbortSignal;
    storeScreenshot?: (base64: string) => Promise<{ digest: string }>;
  } = {},
): Promise<ChatPanelRenderEvidence> {
  let settled = await settleChatPanel(session, panel, options.signal);
  const initialFailures = classifyRenderFailures(session.uiFeedback, settled).unresolved;
  const repair = await observeFeedbackRepair(session, answer, options.signal);
  if (repair.repairTurnId)
    settled = await settleChatPanel(session, panel, options.signal);
  const feedback = [...session.uiFeedback];
  const { unresolved, resolved, repaired } = classifyRenderFailures(
    feedback,
    settled,
    repair,
  );
  const evidence: ChatPanelRenderEvidence = {
    panelId: panel.id,
    settled,
    feedback,
    initialFailures,
    repair,
    unresolved,
    resolved,
    repaired,
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
