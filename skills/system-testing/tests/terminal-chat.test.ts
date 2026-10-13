import { describe, expect, it, vi } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { TestExecutionResult } from "../types.js";
import { assertSystemTestDeclaration } from "../prompt-contract.js";
import {
  TerminalApprovalResponder,
  approvalActor,
  type AnsweredApproval,
} from "./_terminal-approvals.js";
import {
  AGENT_EVAL_APPROVAL_RULE,
  EVAL_CARD_SUMMARY,
  TERMINAL_CHAT_APPROVAL_RULES,
  TERMINAL_CHAT_TEST,
  terminalChatTests,
  validateTerminalChat,
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
  },
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
      approvalActor(capabilityApproval({ approvalId: "a", capability: "x", callerId: scope.launcherId }), scope),
    ).toBe("launcher");
    expect(
      approvalActor(capabilityApproval({ approvalId: "b", capability: "x", callerId: scope.appPrincipalId }), scope),
    ).toBe("app");
    expect(
      approvalActor(
        capabilityApproval({ approvalId: "c", capability: "x", requester: requester("eval", "ctx-app") }),
        scope,
      ),
    ).toBe("agent");
    expect(
      approvalActor(
        capabilityApproval({ approvalId: "d", capability: "x", requester: requester("eval", "ctx-other") }),
        scope,
      ),
    ).toBeNull();
  });

  it("answers expected requests from the rule table and denies and reports anything else", async () => {
    const resolve = vi.fn(async () => {});
    const unexpected: Error[] = [];
    const responder = new TerminalApprovalResponder(
      TERMINAL_CHAT_APPROVAL_RULES,
      { launcherId: scope.launcherId, appPrincipalId: null, appContextId: null },
      resolve,
      (error) => unexpected.push(error),
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
    const appClipboard = capabilityApproval({
      approvalId: "app-clipboard",
      capability: "clipboard",
      callerId: scope.appPrincipalId,
    });
    const waiting = responder.waitForRule(AGENT_EVAL_APPROVAL_RULE);
    // Before the session's identity is known, its requests are held, not answered.
    responder.observe([evalRead, foreign, appClipboard]);
    await responder.settled();
    expect(resolve).not.toHaveBeenCalled();

    responder.setScope({ appPrincipalId: scope.appPrincipalId, appContextId: scope.appContextId });
    await responder.settled();
    await expect(waiting).resolves.toMatchObject({
      approvalId: "eval-read",
      ruleId: AGENT_EVAL_APPROVAL_RULE,
      actor: "agent",
      requesterCategory: "eval",
      decision: "once",
      outcome: "resolved",
    });
    expect(resolve.mock.calls).toEqual([
      ["eval-read", "once"],
      ["app-clipboard", "deny"],
    ]);
    expect(unexpected.map((error) => error.message)).toEqual([
      `The terminal session raised an approval the test does not expect (denied): capability approval app-clipboard from the app, capability clipboard, caller ${scope.appPrincipalId}`,
    ]);

    // The same pending set delivered again is not answered twice.
    responder.observe([evalRead, appClipboard]);
    await responder.settled();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("matches the launch only for the exact terminal app resource", async () => {
    const resolve = vi.fn(async () => {});
    const unexpected: Error[] = [];
    const responder = new TerminalApprovalResponder(
      TERMINAL_CHAT_APPROVAL_RULES,
      scope,
      resolve,
      (error) => unexpected.push(error),
    );
    responder.observe([
      capabilityApproval({
        approvalId: "launch-chat",
        capability: "terminal-apps.run",
        callerId: scope.launcherId,
        resource: { type: "terminal-app", label: "Chat", value: "terminal-app:terminal-apps/chat" },
      }),
      capabilityApproval({
        approvalId: "launch-shell",
        capability: "terminal-apps.run",
        callerId: scope.launcherId,
        resource: { type: "terminal-app", label: "Shell", value: "terminal-app:shell" },
      }),
    ]);
    await responder.settled();
    expect(resolve.mock.calls).toEqual([
      ["launch-chat", "once"],
      ["launch-shell", "deny"],
    ]);
    expect(unexpected).toHaveLength(1);
  });

  it("reports a request whose offered decisions exclude the rule's, and a failed answer", async () => {
    const unexpected: Error[] = [];
    const responder = new TerminalApprovalResponder(
      TERMINAL_CHAT_APPROVAL_RULES,
      scope,
      async (approvalId) => {
        if (approvalId === "credential") throw new Error("No pending approval found");
      },
      (error) => unexpected.push(error),
    );
    responder.observe([
      capabilityApproval({
        approvalId: "restricted",
        capability: "permissions.read",
        requester: requester("eval", "ctx-app"),
        allowedDecisions: ["task", "deny"],
      }),
      capabilityApproval({
        approvalId: "credential",
        capability: "credential.use",
        requester: requester("agent", "ctx-app", "do:agent-1"),
      }),
    ]);
    await responder.settled();
    expect(responder.answered.map((entry) => [entry.approvalId, entry.outcome, entry.error])).toEqual([
      ["restricted", "failed", "it offers task, deny, not once"],
      ["credential", "failed", "No pending approval found"],
    ]);
    expect(unexpected.map((error) => error.message)).toEqual([
      expect.stringContaining("Answering capability approval restricted from the agent"),
      expect.stringContaining("with once failed: No pending approval found"),
    ]);
  });

  it("aborts a rule wait with its caller's signal", async () => {
    const responder = new TerminalApprovalResponder(TERMINAL_CHAT_APPROVAL_RULES, scope, async () => {}, () => {});
    const controller = new AbortController();
    const waiting = responder.waitForRule(AGENT_EVAL_APPROVAL_RULE, controller.signal);
    controller.abort(new Error("deadline"));
    await expect(waiting).rejects.toThrow("deadline");
  });
});

describe("eval tool card summary", () => {
  it("finds the summary line under a completed eval card", () => {
    const screen = [
      "you  Quick check tc-1234abcd: how many workspace permissions are granted here right now?",
      "▸ Eval services.permissions.list()                                       Complete",
      "  → 7",
      "agent  There are 7 permissions granted.",
    ].join("\n");
    expect(EVAL_CARD_SUMMARY.exec(screen)?.[1]?.trim()).toBe("→ 7");
    expect(
      EVAL_CARD_SUMMARY.test("▸ Eval services.permissions.list()      Running\n  → 7"),
    ).toBe(false);
  });
});

const approved: AnsweredApproval = {
  approvalId: "eval-read",
  actor: "agent",
  ruleId: AGENT_EVAL_APPROVAL_RULE,
  kind: "capability",
  capability: "permissions.read",
  resource: "permissions.read",
  callerId: "do:eval-1",
  requesterCategory: "eval",
  requesterId: "do:eval-1",
  decision: "once",
  outcome: "resolved",
};

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
    approvals: [approved],
    evalSummary: "→ 7",
    forked: true,
    exit: { code: null, signal: "SIGHUP" },
    resume: { ...entry, principalId: "panel:nav-term-2", shellSessionId: "pty-2" },
    restoredScreen: "Quick check tc-1234abcd ...\n▸ Eval ... Complete\n  → 7",
    closed: true,
  };
}

function execution(evidence: TerminalChatEvidence, extra: Partial<TestExecutionResult> = {}): TestExecutionResult {
  return { messages: [], duration: 1, diagnostics: { terminalChat: evidence }, ...extra };
}

describe("terminal chat validator", () => {
  it("passes the complete lifecycle", () => {
    expect(validateTerminalChat(execution(passingEvidence()))).toMatchObject({ passed: true });
  });

  it("names the phase of a scenario failure first", () => {
    const evidence = { ...passingEvidence(), phase: "agent-eval" };
    expect(
      validateTerminalChat(execution(evidence, { error: "agent-eval: deadline" })).reason,
    ).toBe("The terminal chat scenario failed during agent-eval: agent-eval: deadline");
  });

  it("fails when the agent's eval approval was not answered under its own principal", () => {
    expect(validateTerminalChat(execution({ ...passingEvidence(), approvals: [] })).reason).toContain(
      "never raised the permissions.read approval",
    );
    expect(
      validateTerminalChat(
        execution({
          ...passingEvidence(),
          approvals: [{ ...approved, requesterCategory: "panel", callerId: "panel:nav-term-1" }],
        }),
      ).reason,
    ).toContain("not to the agent's own eval");
  });

  it("fails on an unexpected approval", () => {
    expect(
      validateTerminalChat(
        execution({
          ...passingEvidence(),
          approvals: [approved, { ...approved, approvalId: "x", ruleId: null, capability: "clipboard", actor: "app", decision: "deny" }],
        }),
      ).reason,
    ).toBe("The session raised approvals the test does not expect: clipboard from the app");
  });

  it("fails when resume reused the exited PTY or the transcript was not restored", () => {
    const evidence = passingEvidence();
    expect(
      validateTerminalChat(execution({ ...evidence, resume: { ...evidence.resume!, shellSessionId: "pty-1" } })).reason,
    ).toBe("terminalApps.resume did not relaunch the same session in a new PTY");
    expect(
      validateTerminalChat(execution({ ...evidence, restoredScreen: "● online" })).reason,
    ).toContain("its conversation was not restored");
  });

  it("fails when cleanup did not close the session", () => {
    expect(
      validateTerminalChat(
        execution(passingEvidence(), { cleanupErrors: ["close terminal session: ENOENT"] }),
      ).reason,
    ).toBe("The terminal session was not cleaned up: close terminal session: ENOENT");
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
