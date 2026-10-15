import { describe, expect, it } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { TestExecutionResult } from "../types.js";
import { assertSystemTestDeclaration } from "../prompt-contract.js";
import { TerminalApprovalGuard, approvalActor } from "./_terminal-approvals.js";
import {
  EVAL_CARD_SUMMARY,
  FORK_READY,
  TERMINAL_CHAT_TEST,
  terminalChatTests,
  validateTerminalChat,
  consumeApprovalRecords,
  completedInvocationTitles,
  exportedWorkspacePath,
  hasComposerDraft,
  type TerminalChatEvidence,
} from "./terminal-chat.js";

const scope = {
  launcherId: "do:eval-runner",
  appPrincipalId: "panel:nav-term-1",
  appContextId: "ctx-app",
};

function capabilityApproval(
  overrides: Partial<Extract<PendingApproval, { kind: "capability" }>> & {
    approvalId: string;
    capability: string;
  }
): PendingApproval {
  return {
    kind: "capability",
    callerId: "do:agent-1",
    callerKind: "do",
    repoPath: "workers/agent-worker",
    effectiveVersion: "v1",
    requestedAt: 1,
    title: "Allow?",
    ...overrides,
  } as PendingApproval;
}

function requester(category: string, contextId: string, id = "do:eval-1") {
  return {
    id,
    kind: "do" as const,
    category,
    repoPath: "workers/agent-worker",
    effectiveVersion: "v1",
    contextId,
    stableIdentityKey: id,
    ephemeralInstanceKey: id,
    breadcrumbs: [],
  } as unknown as NonNullable<PendingApproval["requester"]>;
}

describe("terminal session approvals", () => {
  it("attributes requests to the launcher, the app principal, or agents in the app's context", () => {
    expect(
      approvalActor(
        capabilityApproval({ approvalId: "a", capability: "x", callerId: scope.launcherId }),
        scope
      )
    ).toBe("launcher");
    expect(
      approvalActor(
        capabilityApproval({ approvalId: "b", capability: "x", callerId: scope.appPrincipalId }),
        scope
      )
    ).toBe("app");
    expect(
      approvalActor(
        capabilityApproval({
          approvalId: "c",
          capability: "x",
          requester: requester("eval", "ctx-app"),
        }),
        scope
      )
    ).toBe("agent");
    expect(
      approvalActor(
        capabilityApproval({
          approvalId: "d",
          capability: "x",
          requester: requester("eval", "ctx-other"),
        }),
        scope
      )
    ).toBeNull();
  });

  it("ends the scenario on a request in the session's scope and ignores others", () => {
    const escalated: Error[] = [];
    const guard = new TerminalApprovalGuard(
      { launcherId: scope.launcherId, appPrincipalId: null, appContextId: null },
      (error) => escalated.push(error)
    );
    const evalRead = capabilityApproval({
      approvalId: "eval-read",
      capability: "permissions.read",
      requester: requester("eval", "ctx-app"),
    });
    const foreign = capabilityApproval({
      approvalId: "foreign",
      capability: "permissions.read",
      requester: requester("eval", "ctx-elsewhere"),
    });
    // Before the session's identity is known, its requests cannot be attributed.
    guard.observe([evalRead, foreign]);
    expect(escalated).toEqual([]);

    guard.setScope({ appPrincipalId: scope.appPrincipalId, appContextId: scope.appContextId });
    expect(escalated.map((error) => error.message)).toEqual([
      expect.stringContaining(
        "capability approval eval-read from the agent, capability permissions.read"
      ),
    ]);
    expect(guard.escalated).toHaveLength(1);

    // The same pending set delivered again is not reported twice.
    guard.observe([evalRead, foreign]);
    expect(escalated).toHaveLength(1);
  });
});

describe("eval tool card summary", () => {
  it("records the actual completed tool title in ordinary and selected rows", () => {
    expect(
      completedInvocationTitles(
        "  ▸ Get Agent Settings                Complete\n▌ ▸ Eval code: 1+1                   Complete\n  ▸ Invocation                       Running"
      )
    ).toEqual(["Get Agent Settings", "Eval code: 1+1"]);
  });
  it("finds the summary line under a completed eval card", () => {
    const screen = [
      "you  Quick check tc-1234abcd: how many workspace permissions are granted here right now?",
      "▸ Eval services.permissions.list()                                       Complete",
      "  → 7",
      "agent  There are 7 permissions granted.",
    ].join("\n");
    expect(EVAL_CARD_SUMMARY.exec(screen)?.[1]?.trim()).toBe("→ 7");
    expect(EVAL_CARD_SUMMARY.test("▸ Eval services.permissions.list()      Running\n  → 7")).toBe(
      false
    );
  });
});

describe("fork navigation readiness", () => {
  it("waits for completed navigation instead of the parent's fork annotation", () => {
    const parent = '  ⑂ Forked "New direction" from here. /forks lists forks and switches to them.';
    const confirmation = "✓ Forked — You are in the new fork. /forks switches back.";
    expect(FORK_READY.test(parent)).toBe(false);
    expect(FORK_READY.test(`${parent}\n${confirmation}`)).toBe(true);
  });
});

describe("terminal chat UI evidence", () => {
  it("recognizes only the composer draft, not a transcript mention or prefix", () => {
    expect(hasComposerDraft("you  parent-draft\n› fork-draft", "parent-draft")).toBe(false);
    expect(hasComposerDraft("› parent-draft-extra", "parent-draft")).toBe(false);
    expect(hasComposerDraft("● online\n› parent-draft   ", "parent-draft")).toBe(true);
  });

  it("accepts a completed portable export path but not an absolute or unfinished export", () => {
    const hint = " — use the terminal browser's Download file action to save it on your computer.";
    expect(exportedWorkspacePath(`✓ Exported — chat-exports/conversation.md${hint}`)).toBe(
      "chat-exports/conversation.md"
    );
    expect(exportedWorkspacePath("Exporting chat-exports/conversation.md")).toBeUndefined();
    expect(exportedWorkspacePath(`✓ Exported — /tmp/conversation.md${hint}`)).toBeUndefined();
  });
});

function passingEvidence(): TerminalChatEvidence {
  const entry = {
    sessionId: "session-1",
    kind: "app" as const,
    source: "terminal-apps/chat",
    title: "Chat",
    running: true,
    createdAt: 1,
    lastActiveAt: 1,
  };
  return {
    phase: "done",
    completedPhases: [],
    nonce: "tc-1234abcd",
    model: "openai-codex:gpt-6-luna",
    launch: { ...entry, principalId: "panel:nav-term-1", shellSessionId: "pty-1" },
    appContextId: "ctx-app",
    escalatedApprovals: [],
    evalSummary: "→ 7",
    firstInvocationTitle: "Get Agent Settings",
    forked: true,
    parentDraft: "parent-draft-tc-1234abcd",
    forkDraft: "fork-draft-tc-1234abcd",
    forkComposeScreen: "› fork-draft-tc-1234abcd",
    parentDraftScreen: "› parent-draft-tc-1234abcd",
    restoredDraftScreen: "› parent-draft-tc-1234abcd",
    restoredForkDraftScreen: "› fork-draft-tc-1234abcd",
    exportPath: "chat-exports/conversation.md",
    exportScreen:
      "✓ Exported — chat-exports/conversation.md — use the terminal browser's Download file action to save it on your computer.",
    attachmentScreen:
      "Pending attachments\n❯ conversation.md  200 bytes\nWorkspace files are not deleted.",
    attachmentRemovedScreen:
      "Pending attachments\nNo pending attachments. /attach adds a workspace file.",
    searchScreen: "Search: tc-1234abcd\n❯ Quick check tc-1234abcd",
    searchDetailScreen:
      "Message details\nQuick check tc-1234abcd: how many workspace permissions are granted here right now?",
    switchedBackScreen: "Quick check tc-1234abcd ...\n◇ idle",
    switchedBackSummaryScreen: "▸ Eval ... Complete\n  → 7\n◇ idle",
    exit: { code: null, signal: "SIGHUP" },
    resume: { ...entry, principalId: "panel:nav-term-2", shellSessionId: "pty-2" },
    restoredScreen: "Quick check tc-1234abcd ...\n▸ Eval ... Complete\n  → 7",
    restoredSummaryScreen: "▸ Eval ... Complete\n  → 7",
    restoredInvocationScreen: "▌ ▸ Get Agent Settings       Complete",
    closed: true,
  };
}

function execution(
  evidence: TerminalChatEvidence,
  extra: Partial<TestExecutionResult> = {}
): TestExecutionResult {
  return { messages: [], duration: 1, diagnostics: { terminalChat: evidence }, ...extra };
}

describe("terminal chat validator", () => {
  it("retains the question and eval result even when they occupy separate viewports", () => {
    expect(
      validateTerminalChat(
        execution({ ...passingEvidence(), restoredScreen: "Quick check tc-1234abcd" })
      ).passed
    ).toBe(true);
    expect(
      validateTerminalChat(execution({ ...passingEvidence(), restoredSummaryScreen: "● online" }))
        .passed
    ).toBe(false);
    expect(
      validateTerminalChat(
        execution({ ...passingEvidence(), restoredInvocationScreen: "▸ Invocation       Complete" })
      ).passed
    ).toBe(false);
  });
  it("passes the complete lifecycle", () => {
    expect(validateTerminalChat(execution(passingEvidence()))).toMatchObject({ passed: true });
  });

  it("names the phase of a scenario failure first", () => {
    const evidence = { ...passingEvidence(), phase: "agent-eval" };
    expect(
      validateTerminalChat(execution(evidence, { error: "agent-eval: deadline" })).reason
    ).toBe("The terminal chat scenario failed during agent-eval: agent-eval: deadline");
  });

  it("fails on an approval the policy did not decide", () => {
    expect(
      validateTerminalChat(
        execution({
          ...passingEvidence(),
          escalatedApprovals: ["capability approval x from the app, capability clipboard"],
        })
      ).reason
    ).toBe(
      "The session raised approvals the test authority policy did not decide: capability approval x from the app, capability clipboard"
    );
  });

  it("fails without a completed eval card", () => {
    expect(
      validateTerminalChat(execution({ ...passingEvidence(), evalSummary: undefined })).reason
    ).toBe("No completed eval tool card showed a result summary");
  });

  it("fails when the fork or parent loses its independent unsent draft", () => {
    expect(
      validateTerminalChat(execution({ ...passingEvidence(), forkComposeScreen: undefined })).reason
    ).toBe("The fork and parent did not retain independent unsent drafts");
    expect(
      validateTerminalChat(
        execution({ ...passingEvidence(), parentDraftScreen: "› fork-draft-tc-1234abcd" })
      ).passed
    ).toBe(false);
  });

  it("requires both drafts to survive process resume without another model turn", () => {
    for (const field of ["restoredDraftScreen", "restoredForkDraftScreen"] as const) {
      expect(
        validateTerminalChat(execution({ ...passingEvidence(), [field]: undefined })).reason
      ).toBe("Process resume did not restore both conversations' durable unsent drafts");
    }
  });

  it("requires completed export, attachment removal and full search detail evidence", () => {
    expect(
      validateTerminalChat(execution({ ...passingEvidence(), exportScreen: "Exporting…" })).reason
    ).toContain("download-ready workspace path");
    expect(
      validateTerminalChat(
        execution({
          ...passingEvidence(),
          attachmentRemovedScreen: "Pending attachments\nconversation.md",
        })
      ).reason
    ).toContain("inspected and removed");
    expect(
      validateTerminalChat(
        execution({ ...passingEvidence(), searchDetailScreen: "Search: tc-1234abcd" })
      ).reason
    ).toContain("full details");
  });

  it("fails when the terminal does not switch back to the parent conversation", () => {
    expect(
      validateTerminalChat(execution({ ...passingEvidence(), switchedBackScreen: undefined }))
        .reason
    ).toBe("The chat did not switch back from the fork to the original conversation");
  });

  it("fails when resume reused the exited PTY or the transcript was not restored", () => {
    const evidence = passingEvidence();
    expect(
      validateTerminalChat(
        execution({ ...evidence, resume: { ...evidence.resume!, shellSessionId: "pty-1" } })
      ).reason
    ).toBe("terminalApps.resume did not relaunch the same session in a new PTY");
    expect(
      validateTerminalChat(execution({ ...evidence, restoredScreen: "● online" })).reason
    ).toContain("its conversation was not restored");
  });

  it("fails when cleanup did not close the session", () => {
    expect(
      validateTerminalChat(
        execution(passingEvidence(), { cleanupErrors: ["close terminal session: ENOENT"] })
      ).reason
    ).toBe("The terminal session was not cleaned up: close terminal session: ENOENT");
  });
});

describe("approval watch lifecycle", () => {
  it("joins harness cancellation through the watch's owned signal", async () => {
    const harness = new AbortController();
    const local = new AbortController();
    const signal = AbortSignal.any([harness.signal, local.signal]);
    const done = consumeApprovalRecords(
      (async function* () {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true })
        );
        throw signal.reason;
      })(),
      () => {},
      signal
    );
    harness.abort(new Error("Run cancelled"));
    await expect(done).resolves.toBeUndefined();
    expect(local.signal.aborted).toBe(false);
  });

  it("retains unrelated failures even when cancellation happens concurrently", async () => {
    const owner = new AbortController();
    const failure = new Error("Watch transport disconnected");
    const done = consumeApprovalRecords(
      (async function* () {
        owner.abort(new Error("Scenario finished"));
        throw failure;
      })(),
      () => {},
      owner.signal
    );
    await expect(done).rejects.toBe(failure);
  });

  it("does not mistake an unrelated AbortError for owned cancellation", async () => {
    const owner = new AbortController();
    const failure = new DOMException("An independent request aborted", "AbortError");
    const done = consumeApprovalRecords(
      (async function* () {
        owner.abort(new Error("Scenario finished"));
        throw failure;
      })(),
      () => {},
      owner.signal
    );
    await expect(done).rejects.toBe(failure);
  });
});

describe("terminal chat declaration", () => {
  it("is a harness-validated orchestration that requires the terminal chat and the shell", () => {
    const [test] = terminalChatTests;
    expect(test).toMatchObject({
      name: TERMINAL_CHAT_TEST,
      validation: "harness",
      requiresUnits: ["terminal-apps/chat", "extensions/shell"],
    });
    expect(typeof test!.orchestrate).toBe("function");
    expect(() => assertSystemTestDeclaration(test!)).not.toThrow();
  });
});
