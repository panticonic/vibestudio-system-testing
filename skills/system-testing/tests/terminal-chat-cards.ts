import { extensions, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { TerminalSessionEntry } from "@vibestudio/shared/terminalSessions";
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
} from "./_terminal-screen.js";
import {
  SHELL_EXTENSION,
  TERMINAL_CHAT_SOURCE,
  appContextOf,
  watchPendingApprovals,
  type ShellPty,
} from "./terminal-chat.js";

/**
 * An agent's inline UI, written as for the browser panel, used in the
 * terminal chat: the agent renders it with `inline_ui`, the card draws in the
 * transcript in text cells, reads the workspace through the terminal's own
 * `@workspace/runtime`, and a click on its HTML button sends the person's
 * message through the card's `chat`, which the transcript then shows.
 */

export const TERMINAL_CHAT_CARDS_TEST = "terminal-chat-interactive-cards";
const SCREEN_SIZE: TerminalSize = { cols: 140, rows: 60 };
const MAX_RETAINED_SCREEN = 12_000;
const ONLINE = /● online/u;
const IDLE = /◇ idle/u;

export interface TerminalChatCardsEvidence {
  phase: string;
  completedPhases: string[];
  nonce: string;
  model: string;
  escalatedApprovals: string[];
  cardScreen?: string;
  clickedAt?: { x: number; y: number };
  sentScreen?: string;
  lastScreen?: string;
  /** The screen's non-empty lines at each step, kept short enough to survive evidence compaction. */
  lines: Record<string, string[]>;
  closed: boolean;
}

function screenLines(screen: string): string[] {
  return screen
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-40)
    .map((line) => line.slice(0, 160));
}

/** The card the agent is asked to render, unchanged. */
export function cardSource(nonce: string): string {
  return `import { useEffect, useState } from "react";
import { Flex, Text, Badge } from "@radix-ui/themes";
import { fs } from "@workspace/runtime";

export default function Probe({ props, chat }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    fs.readdir(".").then((names) => setEntries(names.length), (error) => setEntries("error: " + error.message));
  }, []);
  return (
    <Flex direction="column" gap="1">
      <Text>Card ${nonce}</Text>
      <Badge>{entries === null ? "reading" : "entries " + entries}</Badge>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => chat.send("pressed " + props.token)}>Press ${nonce}</button>
      </div>
    </Flex>
  );
}`;
}

function retainScreen(screen: string): string {
  return screen.length > MAX_RETAINED_SCREEN
    ? screen.slice(screen.length - MAX_RETAINED_SCREEN)
    : screen;
}

/**
 * The cell of the last `text` on the screen (0-based), or null when it is not
 * shown. The last: the request quoting the card's source is above the card.
 */
export function cellOf(screen: string, text: string): { x: number; y: number } | null {
  const lines = screen.split("\n");
  let y = lines.length - 1;
  while (y >= 0 && !lines[y]!.includes(text)) y--;
  return y < 0 ? null : { x: lines[y]!.indexOf(text), y };
}

async function orchestrateTerminalChatCards(
  context: TestOrchestrationContext
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const nonce = `tcc-${crypto.randomUUID().slice(0, 8)}`;
  const evidence: TerminalChatCardsEvidence = {
    phase: "watch-approvals",
    completedPhases: [],
    nonce,
    model: context.runner.modelRef,
    escalatedApprovals: [],
    lines: {},
    closed: false,
  };
  const execution: TestExecutionResult = {
    messages: [],
    duration: 0,
    diagnostics: { terminalChatCards: evidence },
  };
  context.diagnostics["terminalChatCards"] = evidence;
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
  const write = (keys: string) => shell.write(session!.shellSessionId!, keys);
  const submit = async (text: string, shown: ScreenCondition, description: string) => {
    await write(`\x1b[200~${text}\x1b[201~`);
    await waitFor(shown, `${description} (typed into the composer)`);
    await write("\r");
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
    if (!session.running || !session.shellSessionId || !session.principalId)
      throw new Error(
        `terminalApps.launch returned a session that is not running with a PTY and principal: ${JSON.stringify(session)}`
      );
    guard.setScope({
      appPrincipalId: session.principalId,
      appContextId: await appContextOf(session.principalId),
    });

    enter("attach");
    attached = await attachTerminalScreen(shell, session.shellSessionId, SCREEN_SIZE);
    await waitFor(ONLINE, "the chat's status line to show it online");

    enter("choose-model");
    const model = context.runner.modelRef;
    await submit(
      `/model ${model}`,
      (text) => text.split(model).length - 1 >= 2,
      `choosing ${model} from the loaded model catalog`
    );
    await waitFor(
      /Model set to/u,
      `the chat confirming model ${model}`,
      /No model called|Models are still loading|isn't ready|Can't choose a model yet/u
    );

    enter("render-card");
    const request = [
      `Call the inline_ui tool once with id "card-${nonce}", props {"token": "${nonce}"}, and exactly this code, unchanged:`,
      "```tsx",
      cardSource(nonce),
      "```",
      "Then reply with the single word: shown.",
    ].join("\n");
    await submit(
      request,
      // A long draft shows only its tail in the composer.
      (text) => text.includes("Then reply with the single word: shown."),
      "the card request"
    );
    evidence.lines["sent"] = screenLines(screen().screen());
    // The request leaves the composer and an agent takes it.
    await waitFor(
      (text) => !/no agent yet/u.test(text),
      "the request sent and an agent working on it",
      /wasn't sent|Couldn't|isn't ready/u
    );
    const card = await waitFor(
      (text) => text.includes(`Press ${nonce}`) && /entries \d+/u.test(text) && IDLE.test(text),
      "the card drawn with the workspace listing it read, and the agent idle",
      /could not be drawn here|entries error:/u
    );
    evidence.cardScreen = retainScreen(card);

    enter("press");
    const at = cellOf(card, `Press ${nonce}`);
    if (!at) throw new Error("The card's button is not on the screen");
    evidence.clickedAt = at;
    await write(`\x1b[<0;${at.x + 1};${at.y + 1}M\x1b[<0;${at.x + 1};${at.y + 1}m`);
    evidence.sentScreen = retainScreen(
      await waitFor(
        (text) => text.includes(`pressed ${nonce}`),
        "the card's message in the transcript, sent as the person"
      )
    );
    enter("done");
  } catch (cause) {
    const failure = signal.aborted && signal.reason !== cause ? signal.reason : cause;
    execution.failure = systemTestFailure(`terminal-chat-cards:${evidence.phase}`, failure);
    execution.error = `${evidence.phase}: ${execution.failure.error.message}`;
    if (attached) {
      evidence.lastScreen = retainScreen(attached.screen.screen());
      evidence.lines["last"] = screenLines(attached.screen.screen());
    }
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
    watchController.abort(new Error("The terminal chat cards scenario finished"));
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

export function validateTerminalChatCards(result: TestExecutionResult): TestResult {
  const value = result.diagnostics?.["terminalChatCards"];
  const evidence = value && typeof value === "object" ? (value as TerminalChatCardsEvidence) : null;
  if (!evidence)
    return { passed: false, reason: "The terminal chat cards scenario retained no evidence" };
  const details = {
    phase: evidence.phase,
    escalatedApprovals: evidence.escalatedApprovals,
    ...(evidence.lastScreen ? { lastScreen: evidence.lastScreen } : {}),
  };
  if (result.error)
    return {
      passed: false,
      reason: `The terminal chat cards scenario failed during ${evidence.phase}: ${result.error}`,
      details,
    };
  if (evidence.escalatedApprovals.length > 0)
    return {
      passed: false,
      reason: `The session raised approvals the test authority policy did not decide: ${evidence.escalatedApprovals.join("; ")}`,
      details,
    };
  if (
    !evidence.cardScreen?.includes(`Press ${evidence.nonce}`) ||
    !/entries \d+/u.test(evidence.cardScreen)
  )
    return {
      passed: false,
      reason:
        "The card was not drawn with the workspace listing it read through @workspace/runtime",
      details,
    };
  if (!evidence.sentScreen?.includes(`pressed ${evidence.nonce}`))
    return {
      passed: false,
      reason: "Clicking the card's button did not send its message into the conversation",
      details,
    };
  if (result.cleanupErrors?.length || !evidence.closed)
    return {
      passed: false,
      reason: `The terminal session was not cleaned up: ${result.cleanupErrors?.join("; ") ?? "it was not closed"}`,
      details,
    };
  return { passed: true, details: { clickedAt: evidence.clickedAt } };
}

export const terminalChatCardsTests: TestCase[] = requiringUnits(
  [TERMINAL_CHAT_SOURCE, "extensions/shell"],
  [
    {
      name: TERMINAL_CHAT_CARDS_TEST,
      description:
        "Drive the terminal chat in a workspace PTY: the agent renders a browser-style inline UI that reads the workspace through @workspace/runtime, and clicking its HTML button sends the person's message",
      category: "terminal-apps",
      timeoutMs: 600_000,
      prompt:
        "Harness-orchestrated terminal chat session read through the shell PTY attach stream.",
      validation: "harness",
      orchestrate: orchestrateTerminalChatCards,
      validate: validateTerminalChatCards,
    },
  ]
);
