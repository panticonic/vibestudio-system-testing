import { extensions, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import { readEventWatchRecords, type EventWatchRecord } from "@vibestudio/service-schemas/events";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { TerminalSessionEntry } from "@vibestudio/shared/terminalSessions";
import type { PtyAttachOptions } from "@workspace/pty-stream";
import { appendSystemTestCleanupFailure, systemTestFailure } from "../structured-error.js";
import {
  requiringUnits,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
  type TestResult,
} from "../types.js";
import { TerminalApprovalGuard } from "./_terminal-approvals.js";
import {
  attachTerminalScreen,
  type AttachedTerminalScreen,
  type ScreenCondition,
  type TerminalSize,
  type TerminalScreen,
} from "./_terminal-screen.js";

/**
 * The terminal chat, driven end to end the way a person uses it from a
 * terminal client: launched through the terminal launch service, read from its
 * PTY through the shell extension's framed attach stream into a headless
 * terminal, typed into, and finally killed and resumed from the session's kept
 * state. The session runs under the harness's test authority policy (the launch
 * gives the app's context the policy of the call that launched it), so its
 * model credential and the agent's gated eval request are decided exactly as
 * they are for every other system test; the person's approval queue is watched
 * only to end the run when something the policy did not decide reaches it.
 */

export const TERMINAL_CHAT_SOURCE = "terminal-apps/chat";
export const TERMINAL_CHAT_TEST = "terminal-chat-approval-fork-resume";
const SHELL_EXTENSION = "@workspace-extensions/shell";
const SCREEN_SIZE: TerminalSize = { cols: 160, rows: 100 };
const MAX_RETAINED_SCREEN = 12_000;

/** A collapsed eval tool card whose result summary line follows its header. */
export const EVAL_CARD_SUMMARY = /^.*\bEval\b.*\bComplete\b.*\n(.*→ \S.*)$/mu;
export function completedInvocationTitles(text: string): string[] {
  return [...text.matchAll(/^[ ▌]*[▸▾] (.*?) {2,}Complete$/gmu)].map((match) => match[1]!.trim());
}
const ONLINE = /● online/u;
const IDLE = /◇ idle/u;

/** The action confirms only after navigation settles; the parent transcript
 * also contains an inline "Forked" annotation before that boundary. */
export const FORK_READY = /^✓ Forked — You are in the new fork\. \/forks switches back\.$/mu;

export interface TerminalChatEvidence {
  phase: string;
  completedPhases: string[];
  nonce: string;
  model: string;
  launch?: TerminalSessionEntry;
  appContextId?: string;
  /** In-scope requests that reached the person's approval queue. */
  escalatedApprovals: string[];
  evalSummary?: string;
  firstInvocationTitle?: string;
  afterTurnScreen?: string;
  forked: boolean;
  parentDraft?: string;
  forkDraft?: string;
  forkComposeScreen?: string;
  parentDraftScreen?: string;
  restoredDraftScreen?: string;
  restoredForkDraftScreen?: string;
  exportPath?: string;
  exportScreen?: string;
  attachmentScreen?: string;
  attachmentRemovedScreen?: string;
  searchScreen?: string;
  searchDetailScreen?: string;
  switchedBackScreen?: string;
  switchedBackSummaryScreen?: string;
  exit?: { code: number | null; signal?: string };
  resume?: TerminalSessionEntry;
  restoredScreen?: string;
  restoredSummaryScreen?: string;
  restoredInvocationScreen?: string;
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

/** A portable path advertised only after the ordinary export has completed. */
export function exportedWorkspacePath(screen: string): string | undefined {
  if (!screen.includes("Exported") || !screen.includes("Download file action")) return undefined;
  return /(?:^|\s)(chat-exports\/[^\s]+\.(?:md|json)) —/u.exec(screen)?.[1];
}

export function hasComposerDraft(screen: string, draft: string): boolean {
  return screen.split("\n").some((line) => line.trimEnd() === `› ${draft}`);
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
  signal: AbortSignal
): Promise<{ done: Promise<void> }> {
  const response = await EventsClient.openWatch(
    rpc,
    ["shell-approval:pending-changed"],
    `system-test-${TERMINAL_CHAT_TEST}-${crypto.randomUUID()}`,
    { signal, bodyIdleTimeoutMs: null }
  );
  const records = readEventWatchRecords(response);
  const first = await records.next();
  if (first.done || first.value.kind !== "watching")
    throw new Error("The approval queue watch did not acknowledge its subscription");
  return { done: consumeApprovalRecords(records, onPending, signal) };
}

export async function consumeApprovalRecords(
  records: AsyncIterable<EventWatchRecord>,
  onPending: (pending: readonly PendingApproval[]) => void,
  signal: AbortSignal
): Promise<void> {
  try {
    for await (const record of records) {
      if (record.kind === "watching") continue;
      if (record.event !== "shell-approval:pending-changed") continue;
      const payload = record.payload as { pending?: PendingApproval[] } | null;
      onPending(payload?.pending ?? []);
    }
  } catch (error) {
    if (signal.aborted && error === signal.reason) return;
    throw error;
  }
  if (!signal.aborted)
    throw new Error("The approval queue watch closed while the session was running");
}

/** Inspect finite history through ordinary selected-message navigation.
 * Reaching the oldest loaded row requests preceding history while preserving
 * the selection anchor; the next Up moves into that prepended history. */
export async function revealTerminalHistory(
  terminal: TerminalScreen,
  write: (keys: string) => Promise<void>,
  matches: (text: string) => boolean,
  description: string,
  signal: AbortSignal
): Promise<string> {
  await terminal.waitFor((text) => !text.includes("Loading the conversation…"), {
    signal,
    description: "the initial conversation replay",
  });
  if (terminal.screen().includes("New conversation"))
    throw new Error(`${description} is absent: the session opened an empty conversation`);
  if (matches(terminal.screen())) return terminal.screen();
  const action = async (keys: string, condition: ScreenCondition, description: string) => {
    const afterRevision = terminal.revision;
    await write(keys);
    return terminal.waitFor(condition, {
      afterRevision,
      signal,
      description,
      failOn: /Older messages didn't load:/u,
    });
  };
  let shown = await action("\x1b[1;5A", /↑↓ move · y copy · Esc back/u, "selecting the transcript");
  while (!matches(shown)) {
    if (shown.includes("↑ start of conversation"))
      throw new Error(`${description} is absent from the completed conversation history`);
    shown = await action(
      "\x1b[A",
      (text) => !text.includes("loading older messages"),
      "selecting the preceding message and settling its history page"
    );
  }
  const found = shown;
  await action(
    "i",
    (text) => !text.includes("↑↓ move · y copy · Esc back"),
    "returning to the composer"
  );
  return found;
}

async function appContextOf(principalId: string): Promise<string> {
  const entities = await rpc.call("main", mainRpcMethods["runtime.listEntities"], []);
  const app = entities.find((entity) => entity.id === principalId);
  if (!app?.contextId)
    throw new Error(
      `The terminal app's principal ${principalId} is not a live runtime entity with a context`
    );
  return app.contextId;
}

async function orchestrateTerminalChat(
  context: TestOrchestrationContext
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const nonce = `tc-${crypto.randomUUID().slice(0, 8)}`;
  const evidence: TerminalChatEvidence = {
    phase: "watch-approvals",
    completedPhases: [],
    nonce,
    model: context.runner.modelRef,
    escalatedApprovals: [],
    forked: false,
    closed: false,
  };
  const execution: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { terminalChat: evidence },
  };
  // Reported even if the scenario never returns (a deadline or cancellation).
  context.diagnostics["terminalChat"] = evidence;
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
  const guard = new TerminalApprovalGuard(
    { launcherId: rpc.selfId, appPrincipalId: null, appContextId: null },
    abortScenario
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
  const write = (keys: string) => shell.write(session!.shellSessionId!, keys);
  const action = async (
    keys: string,
    shown: ScreenCondition,
    description: string,
    failOn?: RegExp
  ) => {
    const afterRevision = screen().revision;
    await write(keys);
    return screen().waitFor(shown, {
      afterRevision,
      description,
      signal,
      ...(failOn ? { failOn } : {}),
    });
  };
  // Palette actions do not replace an unsent composer draft with a command.
  const command = async (name: string) => {
    await action("\x0b", /^Command palette$/mu, "opening the command palette");
    await action(
      `\x1b[200~/${name}\x1b[201~`,
      (text) =>
        text
          .split("\n")
          .some((line) => line.includes(`❯ /${name}`) && !line.includes(`❯ /${name}s`)),
      `selecting /${name} in the palette`
    );
    await write("\r");
  };
  const switchConversation = async (fork: boolean, draft: string) => {
    await command("forks");
    await waitFor(/^Forks$/mu, "the fork tree picker", /Couldn't load the fork tree/u);
    if (fork) await action("\x1b[B", /^❯ {3}\S/mu, "selecting the child fork");
    return action(
      "\r",
      (text) => !/^Forks$/mu.test(text) && ONLINE.test(text) && hasComposerDraft(text, draft),
      `restoring the ${fork ? "fork" : "parent"} draft`,
      /Could not switch conversations/u
    );
  };

  try {
    watch = await watchPendingApprovals(
      (pending) => guard.observe(pending),
      AbortSignal.any([context.signal, watchController.signal])
    );
    void watch.done.catch(abortScenario);

    enter("launch");
    session = await rpc.call(
      "main",
      mainRpcMethods["terminalApps.launch"],
      [{ source: TERMINAL_CHAT_SOURCE, ...SCREEN_SIZE }],
      { signal }
    );
    evidence.launch = session;
    if (!session.running || !session.shellSessionId || !session.principalId)
      throw new Error(
        `terminalApps.launch returned a session that is not running with a PTY and principal: ${JSON.stringify(session)}`
      );
    evidence.appContextId = await appContextOf(session.principalId);
    guard.setScope({
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
      `choosing ${model} from the loaded model catalog`
    );
    await waitFor(
      /Model set to/u,
      `the chat confirming model ${model}`,
      /No model called|Models are still loading|isn't ready|Can't choose a model yet/u
    );

    enter("approval-ask");
    await submit("/approval ask", (text) => text.includes("/approval ask"), "/approval ask");
    await waitFor(
      /Approvals: Ask for everything/u,
      "the chat confirming the ask approval level",
      /Can't change approvals yet|Couldn't change the approval level/u
    );

    enter("agent-eval");
    await submit(
      `Quick check ${nonce}: how many workspace permissions are granted here right now? Count them without changing anything.`,
      (text) => text.includes(nonce),
      "the question"
    );
    const afterTurn = await waitFor(
      (text) => EVAL_CARD_SUMMARY.test(text) && IDLE.test(text),
      "a completed eval tool card with its result summary and the agent idle"
    );
    evidence.afterTurnScreen = retainScreen(afterTurn);
    evidence.evalSummary = EVAL_CARD_SUMMARY.exec(afterTurn)?.[1]?.trim();
    evidence.firstInvocationTitle = completedInvocationTitles(afterTurn)[0];
    if (!evidence.firstInvocationTitle)
      throw new Error("The original transcript showed no completed invocation title");

    enter("export");
    await command("export");
    const exported = await waitFor(
      (text) => !!exportedWorkspacePath(text),
      "the completed export's download-ready workspace path",
      /Couldn't export/u
    );
    evidence.exportScreen = retainScreen(exported);
    evidence.exportPath = exportedWorkspacePath(exported)!;

    enter("attachments");
    await command("attach");
    await waitFor(/^Attach a file$/mu, "the workspace attachment prompt");
    await action(
      `\x1b[200~${evidence.exportPath}\x1b[201~`,
      (text) => text.split("\n").some((line) => line.trimEnd() === `│ ${evidence.exportPath}`),
      "entering the exported workspace file"
    );
    await action(
      "\r",
      (text) => text.includes("attached:") && !/^Attach a file$/mu.test(text),
      "staging the exported file",
      /Couldn't attach/u
    );
    await command("attachments");
    evidence.attachmentScreen = retainScreen(
      await waitFor(
        (text) =>
          /^Pending attachments$/mu.test(text) &&
          text.includes(evidence.exportPath!.split("/").at(-1)!) &&
          text.includes("Workspace files are not deleted."),
        "inspecting the pending attachment"
      )
    );
    await action(
      "\r",
      (text) => !/^Pending attachments$/mu.test(text) && !text.includes("attached:"),
      "removing the attachment reference"
    );
    await command("attachments");
    evidence.attachmentRemovedScreen = retainScreen(
      await waitFor(/No pending attachments\./u, "the empty attachment tray")
    );
    await action(
      "\x1b",
      (text) => !/^Pending attachments$/mu.test(text),
      "closing the attachment tray"
    );

    enter("search");
    await command("search");
    await waitFor(/^Search this conversation$/mu, "the complete-history search prompt");
    await action(
      `\x1b[200~${nonce}\x1b[201~`,
      (text) => text.split("\n").some((line) => line.trimEnd() === `│ ${nonce}`),
      "entering the original question's search term"
    );
    await write("\r");
    evidence.searchScreen = retainScreen(
      await waitFor(
        (text) => text.includes(`Search: ${nonce}`) && text.includes("Quick check"),
        "finding the original question in complete history",
        /Couldn't search/u
      )
    );
    await action("\r", /↑↓ move · y copy · Esc back/u, "selecting the search result");
    evidence.searchDetailScreen = retainScreen(
      await action(
        "v",
        (text) => /^Message details$/mu.test(text) && text.includes(`Quick check ${nonce}`),
        "opening the complete search result"
      )
    );
    await action(
      "\x1b",
      (text) => !/^Message details$/mu.test(text) && text.includes("↑↓ move · y copy · Esc back"),
      "closing the message detail"
    );
    await action(
      "i",
      (text) => !text.includes("↑↓ move · y copy · Esc back"),
      "returning to the composer"
    );

    enter("parent-draft");
    evidence.parentDraft = `parent-draft-${nonce}`;
    evidence.forkDraft = `fork-draft-${nonce}`;
    await action(
      `\x1b[200~${evidence.parentDraft}\x1b[201~`,
      (text) => hasComposerDraft(text, evidence.parentDraft!),
      "typing the unsent parent draft"
    );
    enter("fork");
    await command("fork");
    await waitFor(
      (text) => FORK_READY.test(text) && ONLINE.test(text),
      "the completed fork navigation and the fork session online",
      /Couldn't fork the conversation/u
    );
    evidence.forked = true;

    if (hasComposerDraft(screen().screen(), evidence.parentDraft))
      throw new Error("The new fork inherited the parent's unsent draft");
    enter("fork-draft");
    evidence.forkComposeScreen = retainScreen(
      await action(
        `\x1b[200~${evidence.forkDraft}\x1b[201~`,
        (text) => hasComposerDraft(text, evidence.forkDraft!),
        "typing the independent unsent fork draft"
      )
    );

    enter("switch-to-parent");
    evidence.parentDraftScreen = retainScreen(
      await switchConversation(false, evidence.parentDraft)
    );
    evidence.switchedBackSummaryScreen = retainScreen(
      await revealTerminalHistory(
        screen(),
        (keys) => shell.write(session!.shellSessionId!, keys),
        (text) => text.includes(evidence.evalSummary!),
        "The parent's completed eval result",
        signal
      )
    );
    evidence.switchedBackScreen = retainScreen(
      await revealTerminalHistory(
        screen(),
        (keys) => shell.write(session!.shellSessionId!, keys),
        (text) => text.includes(nonce),
        "The original question",
        signal
      )
    );

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
      [{ sessionId: session.sessionId, ...SCREEN_SIZE }]
    );
    evidence.resume = resumed;
    if (!resumed.running || !resumed.shellSessionId || !resumed.principalId)
      throw new Error(
        `terminalApps.resume returned a session that is not running with a PTY and principal: ${JSON.stringify(resumed)}`
      );
    if (resumed.shellSessionId === firstShellSessionId)
      throw new Error(
        `terminalApps.resume returned the PTY ${firstShellSessionId} whose program already exited (${JSON.stringify(evidence.exit)}): the session registry had not recorded the exit when resume was admitted, so it did not relaunch`
      );
    session = resumed;
    const resumedContextId = await appContextOf(resumed.principalId);
    guard.setScope({ appPrincipalId: resumed.principalId, appContextId: resumedContextId });

    enter("restore");
    attached = await attachTerminalScreen(shell, resumed.shellSessionId, SCREEN_SIZE);
    await waitFor(ONLINE, "the relaunched chat's status line to show it online");
    evidence.restoredDraftScreen = retainScreen(
      await waitFor(
        (text) => hasComposerDraft(text, evidence.parentDraft!),
        "the durable parent draft after process resume"
      )
    );
    evidence.restoredForkDraftScreen = retainScreen(
      await switchConversation(true, evidence.forkDraft)
    );
    await switchConversation(false, evidence.parentDraft);
    const summary = evidence.evalSummary;
    evidence.restoredSummaryScreen = retainScreen(
      await revealTerminalHistory(
        screen(),
        (keys) => shell.write(resumed.shellSessionId!, keys),
        (text) => !!summary && text.includes(summary),
        "The restored completed eval result",
        signal
      )
    );
    evidence.restoredScreen = retainScreen(
      await revealTerminalHistory(
        screen(),
        (keys) => shell.write(resumed.shellSessionId!, keys),
        (text) => text.includes(nonce),
        "The restored original question",
        signal
      )
    );
    evidence.restoredInvocationScreen = retainScreen(
      await revealTerminalHistory(
        screen(),
        (keys) => shell.write(resumed.shellSessionId!, keys),
        (text) => completedInvocationTitles(text).includes(evidence.firstInvocationTitle!),
        "The original completed invocation title",
        signal
      )
    );
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
    watchController.abort(new Error("The terminal chat scenario finished"));
    if (watch) {
      try {
        await watch.done;
      } catch (cause) {
        appendSystemTestCleanupFailure(execution, "stop approval watch", cause);
      }
    }
    evidence.escalatedApprovals = [...guard.escalated];
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
    escalatedApprovals: evidence.escalatedApprovals,
    ...(evidence.lastScreen ? { lastScreen: evidence.lastScreen } : {}),
  };
  if (result.error)
    return {
      passed: false,
      reason: `The terminal chat scenario failed during ${evidence.phase}: ${result.error}`,
      details,
    };
  if (evidence.escalatedApprovals.length > 0)
    return {
      passed: false,
      reason: `The session raised approvals the test authority policy did not decide: ${evidence.escalatedApprovals.join("; ")}`,
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
  if (
    !evidence.parentDraft ||
    !evidence.forkDraft ||
    evidence.parentDraft === evidence.forkDraft ||
    !hasComposerDraft(evidence.forkComposeScreen ?? "", evidence.forkDraft) ||
    !hasComposerDraft(evidence.parentDraftScreen ?? "", evidence.parentDraft)
  )
    return {
      passed: false,
      reason: "The fork and parent did not retain independent unsent drafts",
      details,
    };
  if (
    !evidence.exportPath ||
    exportedWorkspacePath(evidence.exportScreen ?? "") !== evidence.exportPath
  )
    return {
      passed: false,
      reason: "The export did not advertise a download-ready workspace path",
      details,
    };
  if (
    !evidence.attachmentScreen?.includes(evidence.exportPath.split("/").at(-1)!) ||
    !evidence.attachmentScreen.includes("Pending attachments") ||
    !evidence.attachmentRemovedScreen?.includes("No pending attachments.")
  )
    return {
      passed: false,
      reason: "The exported attachment was not inspected and removed from the draft",
      details,
    };
  if (
    !evidence.searchScreen?.includes(`Search: ${evidence.nonce}`) ||
    !evidence.searchDetailScreen?.includes("Message details") ||
    !evidence.searchDetailScreen.includes(`Quick check ${evidence.nonce}`)
  )
    return {
      passed: false,
      reason: "Complete-history search did not open the original question's full details",
      details,
    };
  if (
    !evidence.switchedBackScreen?.includes(evidence.nonce) ||
    !evidence.switchedBackSummaryScreen?.includes(evidence.evalSummary) ||
    hasComposerDraft(evidence.switchedBackScreen, evidence.forkDraft)
  )
    return {
      passed: false,
      reason: "The chat did not switch back from the fork to the original conversation",
      details,
    };
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
    !hasComposerDraft(evidence.restoredDraftScreen ?? "", evidence.parentDraft) ||
    !hasComposerDraft(evidence.restoredForkDraftScreen ?? "", evidence.forkDraft)
  )
    return {
      passed: false,
      reason: "Process resume did not restore both conversations' durable unsent drafts",
      details,
    };
  if (
    !evidence.restoredScreen?.includes(evidence.nonce) ||
    !evidence.restoredSummaryScreen?.includes(evidence.evalSummary) ||
    !evidence.firstInvocationTitle ||
    !completedInvocationTitles(evidence.restoredInvocationScreen ?? "").includes(
      evidence.firstInvocationTitle
    )
  )
    return {
      passed: false,
      reason:
        "The relaunched chat did not preserve the earlier question, eval result and invocation title: its conversation was not restored from the session's state",
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
    },
  };
}

export const terminalChatTests: TestCase[] = requiringUnits(
  [TERMINAL_CHAT_SOURCE, "extensions/shell"],
  [
    {
      name: TERMINAL_CHAT_TEST,
      description:
        "Drive the terminal chat in a workspace PTY: its agent answers a question through a gated eval under the test authority policy, then fork, kill the program and resume it with the conversation restored",
      category: "terminal-apps",
      timeoutMs: 900_000,
      prompt:
        "Harness-orchestrated terminal chat session read through the shell PTY attach stream.",
      validation: "harness",
      orchestrate: orchestrateTerminalChat,
      validate: validateTerminalChat,
    },
  ]
);
