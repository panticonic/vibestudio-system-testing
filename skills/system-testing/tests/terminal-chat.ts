import { extensions, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import { readEventWatchRecords } from "@vibestudio/service-schemas/events";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { TerminalSessionEntry } from "@vibestudio/shared/terminalSessions";
import type { PtyAttachOptions } from "@workspace/pty-stream";
import {
  appendSystemTestCleanupFailure,
  systemTestFailure,
} from "../structured-error.js";
import {
  requiringUnits,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
  type TestResult,
} from "../types.js";
import {
  TerminalApprovalResponder,
  type AnsweredApproval,
  type TerminalApprovalRule,
} from "./_terminal-approvals.js";
import {
  attachTerminalScreen,
  type AttachedTerminalScreen,
  type ScreenCondition,
  type TerminalSize,
} from "./_terminal-screen.js";

/**
 * The terminal chat, driven end to end the way a person uses it from a
 * terminal client: launched through the terminal launch service, read from its
 * PTY through the shell extension's framed attach stream into a headless
 * terminal, typed into, its approvals answered from the person's approval
 * queue, and finally killed and resumed from the session's kept state.
 */

export const TERMINAL_CHAT_SOURCE = "terminal-apps/chat";
export const TERMINAL_CHAT_TEST = "terminal-chat-approval-fork-resume";
const SHELL_EXTENSION = "@workspace-extensions/shell";
const SCREEN_SIZE: TerminalSize = { cols: 160, rows: 100 };
const MAX_RETAINED_SCREEN = 12_000;

/** The approval the scenario requires: the agent's own eval reading permissions. */
export const AGENT_EVAL_APPROVAL_RULE = "agent-eval-permissions-read";

/**
 * Every request this session may raise. The launch is the harness's own
 * (normally pre-cleared by the runner's reviewed manifest); the agent the chat
 * starts uses the person's model account and, for the scenario's question,
 * reads the permission inventory from its eval.
 */
export const TERMINAL_CHAT_APPROVAL_RULES: readonly TerminalApprovalRule[] = [
  {
    ruleId: "launch-terminal-chat",
    actor: "launcher",
    capability: "terminal-apps.run",
    // A code caller's run request is the generic gated one, resolved to the
    // capability itself; the terminal app is named by the launch the harness
    // makes, not by the approval.
    resourceValue: "terminal-apps.run",
    decision: "once",
  },
  {
    ruleId: "agent-model-credential",
    actor: "agent",
    capability: "credential.use",
    decision: "once",
  },
  {
    ruleId: AGENT_EVAL_APPROVAL_RULE,
    actor: "agent",
    capability: "permissions.read",
    requesterCategories: ["eval"],
    decision: "once",
  },
];

/** A collapsed eval tool card whose result summary line follows its header. */
export const EVAL_CARD_SUMMARY = /^.*\bEval\b.*\bComplete\b.*\n(.*→ \S.*)$/mu;
const ONLINE = /● online/u;
const IDLE = /◇ idle/u;

export interface TerminalChatEvidence {
  phase: string;
  completedPhases: string[];
  nonce: string;
  model: string;
  launch?: TerminalSessionEntry;
  appContextId?: string;
  approvals: AnsweredApproval[];
  evalSummary?: string;
  afterTurnScreen?: string;
  forked: boolean;
  exit?: { code: number | null; signal?: string };
  resume?: TerminalSessionEntry;
  restoredScreen?: string;
  lastScreen?: string;
  closed: boolean;
}

function retainScreen(screen: string): string {
  return screen.length > MAX_RETAINED_SCREEN
    ? screen.slice(screen.length - MAX_RETAINED_SCREEN)
    : screen;
}

function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length))
    count += 1;
  return count;
}

/**
 * The shell extension calls this scenario makes on a PTY session. Declared
 * here from the public attach protocol (`@workspace/pty-stream`) rather than
 * imported from the extension's source, which is not part of this unit's
 * dependency closure.
 */
interface ShellPty {
  attach(sessionId: string, options?: PtyAttachOptions): Promise<Response>;
  acknowledge(sessionId: string, attachId: string, bytes: number): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  kill(sessionId: string, signal?: "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGHUP"): Promise<void>;
}

/**
 * Follow the person's approval queue. Each change delivers the whole pending
 * set; the returned `done` settles when the watch ends (rejecting when it
 * ended for any reason other than `signal`).
 */
async function watchPendingApprovals(
  onPending: (pending: readonly PendingApproval[]) => void,
  signal: AbortSignal,
): Promise<{ done: Promise<void> }> {
  const response = await EventsClient.openWatch(
    rpc,
    ["shell-approval:pending-changed"],
    `system-test-${TERMINAL_CHAT_TEST}-${crypto.randomUUID()}`,
    { signal, bodyIdleTimeoutMs: null },
  );
  const records = readEventWatchRecords(response);
  const first = await records.next();
  if (first.done || first.value.kind !== "watching")
    throw new Error("The approval queue watch did not acknowledge its subscription");
  const done = (async () => {
    try {
      for await (const record of records) {
        if (record.kind === "watching") continue;
        if (record.event !== "shell-approval:pending-changed") continue;
        const payload = record.payload as { pending?: PendingApproval[] } | null;
        onPending(payload?.pending ?? []);
      }
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    if (!signal.aborted) throw new Error("The approval queue watch closed while the session was running");
  })();
  return { done };
}

async function appContextOf(principalId: string): Promise<string> {
  const entities = await rpc.call("main", mainRpcMethods["runtime.listEntities"], []);
  const app = entities.find((entity) => entity.id === principalId);
  if (!app?.contextId)
    throw new Error(
      `The terminal app's principal ${principalId} is not a live runtime entity with a context`,
    );
  return app.contextId;
}

async function orchestrateTerminalChat(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const nonce = `tc-${crypto.randomUUID().slice(0, 8)}`;
  const evidence: TerminalChatEvidence = {
    phase: "watch-approvals",
    completedPhases: [],
    nonce,
    model: context.runner.modelRef,
    approvals: [],
    forked: false,
    closed: false,
  };
  const execution: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { terminalChat: evidence },
  };
  // One cancellation boundary for the whole scenario: the harness deadline or
  // cancellation, an unexpected approval, or a lost approval watch ends every
  // wait with that cause.
  const scenario = new AbortController();
  const abortScenario = (reason: unknown) => {
    if (!scenario.signal.aborted) scenario.abort(reason);
  };
  const onHarnessAbort = () => abortScenario(context.signal.reason);
  if (context.signal.aborted) onHarnessAbort();
  else context.signal.addEventListener("abort", onHarnessAbort, { once: true });
  const signal = scenario.signal;
  const shell: ShellPty = extensions.use(SHELL_EXTENSION);
  const responder = new TerminalApprovalResponder(
    TERMINAL_CHAT_APPROVAL_RULES,
    { launcherId: rpc.selfId, appPrincipalId: null, appContextId: null },
    (approvalId, decision) =>
      rpc.call("main", mainRpcMethods["shellApproval.resolve"], [approvalId, decision]),
    abortScenario,
  );
  const watchController = new AbortController();
  let watch: { done: Promise<void> } | null = null;
  let session: TerminalSessionEntry | null = null;
  let attached: AttachedTerminalScreen | null = null;

  const enter = (phase: string) => {
    evidence.completedPhases.push(evidence.phase);
    evidence.phase = phase;
  };
  const screen = () => {
    if (!attached) throw new Error("No terminal screen is attached");
    return attached.screen;
  };
  const waitFor = (condition: ScreenCondition, description: string, failOn?: RegExp) =>
    screen().waitFor(condition, { description, signal, ...(failOn ? { failOn } : {}) });
  /** Paste `text` into the composer, wait until it is shown, then press Enter. */
  const submit = async (text: string, shown: ScreenCondition, description: string) => {
    const shellSessionId = session?.shellSessionId;
    if (!shellSessionId) throw new Error("The terminal session has no running PTY");
    await shell.write(shellSessionId, `\x1b[200~${text}\x1b[201~`);
    await waitFor(shown, `${description} (typed into the composer)`);
    await shell.write(shellSessionId, "\r");
  };

  try {
    watch = await watchPendingApprovals(
      (pending) => responder.observe(pending),
      watchController.signal,
    );
    void watch.done.catch(abortScenario);

    enter("launch");
    session = await rpc.call("main", mainRpcMethods["terminalApps.launch"], [
      { source: TERMINAL_CHAT_SOURCE, ...SCREEN_SIZE },
    ]);
    evidence.launch = session;
    if (!session.running || !session.shellSessionId || !session.principalId)
      throw new Error(
        `terminalApps.launch returned a session that is not running with a PTY and principal: ${JSON.stringify(session)}`,
      );
    evidence.appContextId = await appContextOf(session.principalId);
    responder.setScope({
      appPrincipalId: session.principalId,
      appContextId: evidence.appContextId,
    });

    enter("attach");
    attached = await attachTerminalScreen(shell, session.shellSessionId, SCREEN_SIZE);
    await waitFor(ONLINE, "the chat's status line to show it online");

    enter("choose-model");
    // The completion menu lists the model once the catalog has loaded; the
    // draft alone shows the ref once.
    const model = context.runner.modelRef;
    await submit(
      `/model ${model}`,
      (text) => occurrences(text, model) >= 2,
      `choosing ${model} from the loaded model catalog`,
    );
    await waitFor(
      /Model set to/u,
      `the chat confirming model ${model}`,
      /No model called|Models are still loading|isn't ready|Can't choose a model yet/u,
    );

    enter("approval-ask");
    await submit("/approval ask", (text) => text.includes("/approval ask"), "/approval ask");
    await waitFor(
      /Approvals: Ask for everything/u,
      "the chat confirming the ask approval level",
      /Can't change approvals yet|Couldn't change the approval level/u,
    );

    enter("agent-eval");
    await submit(
      `Quick check ${nonce}: how many workspace permissions are granted here right now? Count them without changing anything.`,
      (text) => text.includes(nonce),
      "the question",
    );
    const [, afterTurn] = await Promise.all([
      responder.waitForRule(AGENT_EVAL_APPROVAL_RULE, signal),
      waitFor(
        (text) => EVAL_CARD_SUMMARY.test(text) && IDLE.test(text),
        "a completed eval tool card with its result summary and the agent idle",
      ),
    ]);
    evidence.afterTurnScreen = retainScreen(afterTurn);
    evidence.evalSummary = EVAL_CARD_SUMMARY.exec(afterTurn)?.[1]?.trim();

    enter("fork");
    await submit("/fork", (text) => /^.*\/fork\s*$/mu.test(text), "/fork");
    await waitFor(/Forked/u, "the fork confirmation", /Couldn't fork the conversation/u);
    evidence.forked = true;

    enter("kill");
    const firstShellSessionId = session.shellSessionId;
    const exited = screen().exited(signal);
    await shell.kill(firstShellSessionId, "SIGHUP");
    evidence.exit = await exited;
    evidence.lastScreen = retainScreen(screen().screen());
    await attached.detach();
    attached = null;

    enter("resume");
    const resumed: TerminalSessionEntry = await rpc.call(
      "main",
      mainRpcMethods["terminalApps.resume"],
      [{ sessionId: session.sessionId, ...SCREEN_SIZE }],
    );
    evidence.resume = resumed;
    if (!resumed.running || !resumed.shellSessionId || !resumed.principalId)
      throw new Error(
        `terminalApps.resume returned a session that is not running with a PTY and principal: ${JSON.stringify(resumed)}`,
      );
    if (resumed.shellSessionId === firstShellSessionId)
      throw new Error(
        `terminalApps.resume returned the PTY ${firstShellSessionId} whose program already exited (${JSON.stringify(evidence.exit)}): the session registry had not recorded the exit when resume was admitted, so it did not relaunch`,
      );
    session = resumed;
    const resumedContextId = await appContextOf(resumed.principalId);
    responder.setScope({ appPrincipalId: resumed.principalId, appContextId: resumedContextId });

    enter("restore");
    attached = await attachTerminalScreen(shell, resumed.shellSessionId, SCREEN_SIZE);
    await waitFor(ONLINE, "the relaunched chat's status line to show it online");
    const summary = evidence.evalSummary;
    const restored = await waitFor(
      (text) => text.includes(nonce) && (!summary || text.includes(summary)),
      "the relaunched chat restoring the earlier transcript (question and eval result)",
    );
    evidence.restoredScreen = retainScreen(restored);
    enter("done");
  } catch (cause) {
    const failure = signal.aborted && signal.reason !== cause ? signal.reason : cause;
    execution.failure = systemTestFailure(`terminal-chat:${evidence.phase}`, failure);
    execution.error = `${evidence.phase}: ${execution.failure.error.message}`;
    if (attached) evidence.lastScreen = retainScreen(attached.screen.screen());
    const shown = (cause as { screen?: unknown } | null)?.screen;
    if (typeof shown === "string") evidence.lastScreen = retainScreen(shown);
  } finally {
    context.signal.removeEventListener("abort", onHarnessAbort);
    if (attached) {
      try {
        await attached.detach();
      } catch (cause) {
        appendSystemTestCleanupFailure(execution, "detach terminal screen", cause);
      }
    }
    if (session) {
      try {
        await rpc.call("main", mainRpcMethods["terminalApps.close"], [session.sessionId]);
        evidence.closed = true;
      } catch (cause) {
        appendSystemTestCleanupFailure(execution, "close terminal session", cause);
      }
    }
    try {
      await responder.settled();
    } catch (cause) {
      appendSystemTestCleanupFailure(execution, "settle approval answers", cause);
    }
    watchController.abort(new Error("The terminal chat scenario finished"));
    if (watch) {
      try {
        await watch.done;
      } catch (cause) {
        appendSystemTestCleanupFailure(execution, "stop approval watch", cause);
      }
    }
    evidence.approvals = [...responder.answered];
    execution.duration = Date.now() - startedAt;
  }
  return execution;
}

function evidenceOf(result: TestExecutionResult): TerminalChatEvidence | null {
  const value = result.diagnostics?.["terminalChat"];
  return value && typeof value === "object" ? (value as TerminalChatEvidence) : null;
}

/**
 * Judge the retained evidence in the order a failure is most specific:
 * the scenario's own failure, then the approval queue, then each stage of the
 * lifecycle, then cleanup.
 */
export function validateTerminalChat(result: TestExecutionResult): TestResult {
  const evidence = evidenceOf(result);
  if (!evidence)
    return { passed: false, reason: "The terminal chat scenario retained no evidence" };
  const details = {
    phase: evidence.phase,
    approvals: evidence.approvals,
    ...(evidence.lastScreen ? { lastScreen: evidence.lastScreen } : {}),
  };
  if (result.error)
    return {
      passed: false,
      reason: `The terminal chat scenario failed during ${evidence.phase}: ${result.error}`,
      details,
    };
  const unanswerable = evidence.approvals.filter((entry) => entry.outcome === "failed");
  if (unanswerable.length > 0)
    return {
      passed: false,
      reason: `Approvals the session raised could not be answered: ${unanswerable
        .map((entry) => `${entry.capability ?? entry.kind} (${entry.error ?? "unknown error"})`)
        .join("; ")}`,
      details,
    };
  const unexpected = evidence.approvals.filter((entry) => entry.ruleId === null);
  if (unexpected.length > 0)
    return {
      passed: false,
      reason: `The session raised approvals the test does not expect: ${unexpected
        .map((entry) => `${entry.capability ?? entry.kind} from the ${entry.actor}`)
        .join("; ")}`,
      details,
    };
  const evalApproval = evidence.approvals.find(
    (entry) => entry.ruleId === AGENT_EVAL_APPROVAL_RULE && entry.outcome === "resolved",
  );
  if (!evalApproval)
    return {
      passed: false,
      reason:
        "The agent's eval never raised the permissions.read approval, so the approval path through the person's queue was not exercised",
      details,
    };
  if (
    evalApproval.requesterCategory !== "eval" ||
    evalApproval.callerId === evidence.launch?.principalId
  )
    return {
      passed: false,
      reason: `The permissions.read approval was attributed to ${evalApproval.callerId} (${evalApproval.requesterCategory ?? "no requester"}), not to the agent's own eval`,
      details,
    };
  if (!evidence.evalSummary)
    return {
      passed: false,
      reason: "No completed eval tool card showed a result summary",
      details,
    };
  if (!evidence.forked)
    return { passed: false, reason: "The chat never confirmed the fork", details };
  if (!evidence.exit)
    return { passed: false, reason: "The killed program's exit was never observed", details };
  if (
    !evidence.resume?.running ||
    !evidence.resume.shellSessionId ||
    evidence.resume.shellSessionId === evidence.launch?.shellSessionId ||
    evidence.resume.sessionId !== evidence.launch?.sessionId
  )
    return {
      passed: false,
      reason: "terminalApps.resume did not relaunch the same session in a new PTY",
      details,
    };
  if (
    !evidence.restoredScreen?.includes(evidence.nonce) ||
    !evidence.restoredScreen.includes(evidence.evalSummary)
  )
    return {
      passed: false,
      reason:
        "The relaunched chat did not show the earlier question and eval result: its conversation was not restored from the session's state",
      details,
    };
  if (result.cleanupErrors?.length || !evidence.closed)
    return {
      passed: false,
      reason: `The terminal session was not cleaned up: ${result.cleanupErrors?.join("; ") ?? "it was not closed"}`,
      details,
    };
  return {
    passed: true,
    details: {
      evalSummary: evidence.evalSummary,
      exit: evidence.exit,
      approvals: evidence.approvals.map((entry) => ({
        ruleId: entry.ruleId,
        actor: entry.actor,
        capability: entry.capability,
        decision: entry.decision,
      })),
    },
  };
}

export const terminalChatTests: TestCase[] = requiringUnits(
  [TERMINAL_CHAT_SOURCE, "extensions/shell"],
  [
    {
      name: TERMINAL_CHAT_TEST,
      description:
        "Drive the terminal chat in a workspace PTY: answer its agent's eval approval from the approval queue, fork, then kill the program and resume it with the conversation restored",
      category: "terminal-apps",
      timeoutMs: 900_000,
      prompt:
        "Harness-orchestrated terminal chat session read through the shell PTY attach stream.",
      validation: "harness",
      orchestrate: orchestrateTerminalChat,
      validate: validateTerminalChat,
    },
  ],
);
