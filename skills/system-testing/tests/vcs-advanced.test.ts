import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { vcsTests } from "./vcs.js";
import { vcsAdvancedTests } from "./vcs-advanced.js";
import { requireCausalEdgeEvidence } from "./_helpers.js";
import {
  nativeInvocationId,
  nativeInvocationIdentity,
  type NativeInvocationSource,
} from "@vibestudio/service-schemas/nativeInvocation";
import {
  channelTrajectoryFor,
  commandIdForTrajectoryInvocation,
} from "@vibestudio/trajectory-identity";

function invocation(
  id: string,
  name: string,
  code: string | Record<string, unknown>,
  result: unknown,
) {
  return {
    kind: "message" as const,
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    contentType: "invocation" as const,
    invocation: {
      id,
      name,
      arguments: typeof code === "string" ? (code ? { code } : {}) : code,
      execution: { status: "complete", result, isError: false },
    },
  };
}

function execution(
  final: string,
  calls: ReturnType<typeof invocation>[],
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      { kind: "message", senderId: "user", complete: true, content: "prompt" },
      ...calls,
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content: final,
      },
    ],
  } as TestExecutionResult;
}

describe("reduced VCS agentic catalog", () => {
  it("joins native read memory to retained task input and rejects foreign commands and input identities", () => {
    const nativeSource: NativeInvocationSource = {
      owner: {
        runtimeId: "agent:author",
        authoritySessionId: "lifetime:author",
        contextId: "context:author",
        incarnation: "storage:author",
        channelId: "agent-channel",
        source: "workers/agent",
        effectiveVersion: "state:author",
        className: "Agent",
        objectKey: "author",
        executionDigest: "a".repeat(64),
      },
      task: { conversationId: 1, taskId: 3, kind: "pi.tool", version: 1 },
      operation: {
        kind: "tool",
        assistantEntryId: 4,
        callId: "write:author",
        name: "write",
        argumentsDigest: "b".repeat(64),
      },
    };
    const originatingInput = {
      conversationId: 1,
      submissionId: 2,
      entryId: 2,
      channelRef: {
        source: "workers/pubsub-channel",
        className: "PubSubChannel",
        objectKey: "input-channel",
      },
      eventSequence: 1,
      envelopeId: "input-envelope",
      messageId: "input-message",
      receiverParticipantId: "agent:author",
    };
    const coordinate = {
      ...channelTrajectoryFor(nativeSource.owner.channelId),
      invocationId: nativeInvocationId(nativeSource),
    };
    const cause = {
      invocation: { kind: "trajectory-invocation", ...coordinate },
      nativeInvocation: nativeInvocationIdentity(nativeSource),
      originatingInput,
      turn: null,
      message: {
        kind: "trajectory-message",
        ...channelTrajectoryFor("input-channel"),
        messageId: "input-message",
      },
      sender: { kind: "user", id: "user:author" },
      triggerText: "Preserve the delayed acknowledgement reserve.",
    };
    const commandId = commandIdForTrajectoryInvocation(coordinate);
    const readValue = {
      details: {
        provenance: {
          status: "attached",
          episodes: [
            {
              change: { kind: "change", changeId: "change:authored" },
              workUnit: { kind: "work-unit", workUnitId: "work:authored" },
              command: { kind: "command", commandId },
              cause,
            },
          ],
        },
      },
    };
    const author = invocation(
      coordinate.invocationId,
      "write",
      { path: "packages/demo/retry.ts" },
      {},
    );
    Object.assign(author.invocation, { nativeSource, originatingInput });
    const check = (
      value: typeof readValue,
      submittedInputs?: TestExecutionResult["submittedInputs"],
    ) =>
      requireCausalEdgeEvidence(
        {
          ...execution("The recorded request explains the reserve.", [
            author,
            invocation(
              "read:memory",
              "read",
              { path: "packages/demo/retry.ts" },
              value,
            ),
          ]),
          submittedInputs,
        },
        cause.triggerText,
      );
    expect(check(readValue).passed).toBe(true);
    const prepared = structuredClone(readValue);
    prepared.details.provenance.episodes[0]!.cause.triggerText = `The supplied project is at packages/demo.\n\n${cause.triggerText}`;
    const submittedInputs = [
      {
        channelId: "input-channel",
        requestedPrompt: cause.triggerText,
        submittedPrompt:
          prepared.details.provenance.episodes[0]!.cause.triggerText,
      },
    ];
    expect(check(prepared).passed).toBe(false);
    expect(check(prepared, submittedInputs).passed).toBe(true);
    expect(
      check(prepared, [
        { ...submittedInputs[0]!, submittedPrompt: "An unrelated request" },
      ]).passed,
    ).toBe(false);
    const foreignCommand = structuredClone(readValue);
    foreignCommand.details.provenance.episodes[0]!.command.commandId =
      "command:unrelated";
    expect(check(foreignCommand).passed).toBe(false);
    Object.assign(foreignCommand.details.provenance.episodes[0]!.cause, {
      turn: {
        kind: "trajectory-turn",
        logId: coordinate.logId,
        head: coordinate.head,
        turnId: "forged-turn",
      },
    });
    expect(check(foreignCommand).passed).toBe(false);
    const foreignInput = structuredClone(readValue);
    foreignInput.details.provenance.episodes[0]!.cause.originatingInput.messageId =
      "input:unrelated";
    expect(check(foreignInput).passed).toBe(false);
    const foreignOwner = structuredClone(readValue);
    const foreignIdentity =
      foreignOwner.details.provenance.episodes[0]!.cause.nativeInvocation;
    foreignOwner.details.provenance.episodes[0]!.cause.nativeInvocation = {
      ...foreignIdentity,
      owner: {
        ...foreignIdentity.owner,
        authoritySessionId: "lifetime:unrelated",
      },
    };
    expect(check(foreignOwner).passed).toBe(false);

    const graph = {
      blame: {
        spans: [
          {
            start: 0,
            end: 1,
            path: [],
            ...readValue.details.provenance.episodes[0],
          },
        ],
      },
      edges: [
        {
          kind: "authored-change",
          from: readValue.details.provenance.episodes[0]!.workUnit,
          to: readValue.details.provenance.episodes[0]!.change,
        },
        {
          kind: "caused-by",
          from: readValue.details.provenance.episodes[0]!.workUnit,
          to: readValue.details.provenance.episodes[0]!.command,
        },
        {
          kind: "caused-by",
          from: readValue.details.provenance.episodes[0]!.command,
          to: cause.invocation,
        },
        { kind: "triggered-by", from: cause.invocation, to: cause.message },
      ],
      inspected: [
        {
          node: {
            kind: "trajectory-invocation",
            value: {
              ...coordinate,
              turnId: null,
              nativeInvocation: cause.nativeInvocation,
              originatingInput,
              requestRef: { digest: "a".repeat(64) },
            },
          },
        },
        {
          node: {
            kind: "trajectory-message",
            value: {
              ...cause.message,
              role: "user",
              sourceMessageId: "input-message",
              senderRef: cause.sender,
              textBlocks: [{ content: cause.triggerText }],
            },
          },
        },
      ],
    };
    const graphCheck = (value: typeof graph) =>
      requireCausalEdgeEvidence(
        execution("The request explains the reserve.", [
          author,
          invocation(
            "inspect:causal",
            "eval",
            "await vcs.inspect(input)",
            value,
          ),
        ]),
        cause.triggerText,
      );
    expect(graphCheck(graph).passed).toBe(true);
    const brokenGraph = structuredClone(graph);
    brokenGraph.edges[3]!.to = { ...cause.message, messageId: "unrelated" };
    expect(graphCheck(brokenGraph).passed).toBe(false);
  });
  it("keeps every agent prompt user-like and free of method choreography", () => {
    const tests = [...vcsTests, ...vcsAdvancedTests];
    expect(new Set(tests.map((test) => test.name)).size).toBe(tests.length);
    for (const test of tests) {
      expect(test.prompt).not.toContain("vcs.");
      expect(test.prompt).not.toContain("expectedWorkingHead");
      expect(test.prompt).not.toContain("commandId");
      expect(test.prompt).not.toContain("frontier");
      expect(test.prompt).not.toContain("certificate");
      expect(test.prompt).not.toContain("outcome");
      expect(test.prompt).not.toContain("atom");
    }
    for (const test of vcsAdvancedTests) {
      expect(test.prompt).not.toMatch(/\bVCS_[A-Z_]+\b/u);
      expect(test.prompt).not.toMatch(
        /\b(?:restored|original|counteraction|refusal|recovered):/u,
      );
    }
  });

  it("requires ordinary read output to carry exact blame-backed memory", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-read-injected-memory",
    )!;
    const originalPrompt =
      "Meridian relays reserve one retry slot for delayed acknowledgements, so seven is deliberate.";
    const nativeSource: NativeInvocationSource = {
      owner: {
        runtimeId: "agent:author",
        authoritySessionId: "lifetime:author",
        contextId: "context:author",
        incarnation: "storage:author",
        channelId: "agent-channel",
        source: "workers/agent",
        effectiveVersion: "state:author",
        className: "Agent",
        objectKey: "author",
        executionDigest: "a".repeat(64),
      },
      task: { conversationId: 1, taskId: 3, kind: "pi.tool", version: 1 },
      operation: {
        kind: "tool",
        assistantEntryId: 4,
        callId: "write:author",
        name: "write",
        argumentsDigest: "b".repeat(64),
      },
    };
    const originatingInput = {
      conversationId: 1,
      submissionId: 2,
      entryId: 2,
      channelRef: {
        source: "workers/pubsub-channel",
        className: "PubSubChannel",
        objectKey: "input-channel",
      },
      eventSequence: 1,
      envelopeId: "input-envelope",
      messageId: "input-message",
      receiverParticipantId: "agent:author",
    };
    const coordinate = {
      ...channelTrajectoryFor(nativeSource.owner.channelId),
      invocationId: nativeInvocationId(nativeSource),
    };
    const author = invocation(
      coordinate.invocationId,
      "write",
      { path: "projects/demo/src/retry-policy.ts" },
      {},
    );
    Object.assign(author.invocation, { nativeSource, originatingInput });
    const cause = {
      invocation: { kind: "trajectory-invocation", ...coordinate },
      nativeInvocation: nativeInvocationIdentity(nativeSource),
      originatingInput,
      turn: null,
      message: {
        kind: "trajectory-message",
        ...channelTrajectoryFor("input-channel"),
        messageId: "input-message",
      },
      sender: { kind: "user", id: "user:author" },
      triggerText: originalPrompt,
    };
    const read = invocation(
      "read-memory",
      "read",
      { path: "projects/demo/src/retry-policy.ts" },
      {
        content: [
          { type: "text", text: "export const retryCeiling = 7;\n" },
          {
            type: "text",
            text: "memory · projects/demo/src/retry-policy.ts · shown lines 1-1",
          },
        ],
        details: {
          path: "projects/demo/src/retry-policy.ts",
          displayedRange: {
            coordinateKind: "utf16",
            start: 0,
            end: 31,
            startLine: 1,
            endLine: 1,
          },
          provenance: {
            status: "attached",
            path: "projects/demo/src/retry-policy.ts",
            contentHash: "c".repeat(64),
            coordinateKind: "utf16",
            range: { start: 0, end: 31 },
            episodes: [
              {
                change: { kind: "change", changeId: "change:retry" },
                workUnit: { kind: "work-unit", workUnitId: "work-unit:retry" },
                command: {
                  kind: "command",
                  commandId: commandIdForTrajectoryInvocation(coordinate),
                },
                cause,
                authorContextId: "context:author",
                intent: {
                  tier: "trigger",
                  text: "asked by user:test: Meridian relays reserve one retry slot for delayed acknowledgements",
                },
              },
            ],
          },
        },
      },
    );
    const final =
      "The retry ceiling stays at seven because Meridian relays reserve one slot for delayed acknowledgements.";

    const check = (value: typeof read) =>
      test.validate({
        ...execution(final, [author, value]),
        submittedInputs: [
          {
            channelId: "input-channel",
            requestedPrompt: originalPrompt,
            submittedPrompt: originalPrompt,
          },
        ],
      });
    expect(check(read)).toEqual({
      passed: true,
      reason: undefined,
    });

    const withoutMemory = structuredClone(read);
    const details = (
      withoutMemory.invocation.execution.result as {
        details: Record<string, unknown>;
      }
    ).details;
    delete details["provenance"];
    expect(check(withoutMemory).passed).toBe(false);
    const explicitIntent = structuredClone(read);
    const explicitDetails = (
      explicitIntent.invocation.execution.result as {
        details: {
          provenance: {
            episodes: Array<{
              intent: { tier: string; text: string };
              cause: typeof cause;
            }>;
          };
        };
      }
    ).details;
    explicitDetails.provenance.episodes[0]!.intent.tier = "stated";
    explicitDetails.provenance.episodes[0]!.intent.text =
      "Preserve Meridian's reserved delayed-acknowledgement retry slot by keeping the ceiling below eight.";
    expect(check(explicitIntent).passed).toBe(true);
    const emptyIntent = structuredClone(explicitIntent);
    (
      emptyIntent.invocation.execution
        .result as typeof explicitIntent.invocation.execution.result as {
        details: {
          provenance: { episodes: Array<{ intent: { text: string } }> };
        };
      }
    ).details.provenance.episodes[0]!.intent.text = " ";
    expect(check(emptyIntent).passed).toBe(false);
    explicitDetails.provenance.episodes[0]!.cause.triggerText =
      "An unrelated request";
    expect(check(explicitIntent).passed).toBe(false);
  });

  it("requires sizable-history recall to expose the buried decision at a committed event", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-sizable-history-memory-recall",
    )!;
    const recall = invocation(
      "historical-recall",
      "memory_recall",
      { query: "retired rollout codename", kinds: ["commit"], limit: 10 },
      {
        protocolContent: [
          {
            type: "text",
            text: "[commit] workspace-event:retire-codename\nRetire Harbor Lantern after launch; use Retention Service in support and audit records",
          },
        ],
        details: { resultCount: 1 },
      },
    );
    const final =
      "The codename was Harbor Lantern. It was retired after launch so support and audit records consistently use the public Retention Service name. The recorded evidence is the committed workspace event.";

    expect(test.validate(execution(final, [recall]))).toEqual({
      passed: true,
      reason: undefined,
    });
    expect(test.validate(execution(final, [])).passed).toBe(false);

    const unanchored = structuredClone(recall);
    const result = unanchored.invocation.execution.result as {
      protocolContent: Array<{ text: string }>;
    };
    result.protocolContent[0]!.text = result.protocolContent[0]!.text.replace(
      "workspace-event:retire-codename",
      "unknown",
    );
    expect(test.validate(execution(final, [unanchored])).passed).toBe(false);
  });

  it("accepts resolved native provenance for the imported historical decision with or without search", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-sizable-history-memory-recall",
    )!;
    const final =
      "The codename was Harbor Lantern. It was retired after launch so support and audit records use Retention Service. The recorded evidence is the imported work-unit history.";
    const search = invocation(
      "history-search",
      "provenance",
      { target: "search: rollout codename retired", limit: 5 },
      {
        protocolContent: [{
          type: "text",
          text: 'prov search · "rollout codename retired" · 1 hit\n  work-unit · stated: "Retire the Harbor Lantern rollout codename after launch so support and audit records consistently use the public Retention Service name" · @r3-740b',
        }],
        details: { subjectKind: "command", hitCount: 1 },
      },
    );
    const inspect = invocation(
      "history-inspect",
      "provenance",
      { target: "@r3-740b", limit: 5 },
      {
        protocolContent: [{
          type: "text",
          text: 'prov · @r3-740b · 5 edges\n  node · work-unit · import · stated: "Retire the Harbor Lantern rollout codename after launch so support and audit records consistently use the public Retention Service name" · command @r4-45cb · 2 authored changes (2 in preview) · 0 incorporated changes (0 in preview) · external snapshot generated:"system-test://vcs-sizable-history-memory-recall/project/history" @ "fixture:history:11:abc"\n  work-unit @r3-740b —caused-by→ command @r4-45cb\n  work-unit @r3-740b —authored-change→ change @r6-3ff3\n  work-unit @r3-740b —authored-change→ change @r7-aaad\n  work-unit @r3-740b —imports-repository→ repository @r8-9a3e',
        }],
        details: { subjectKind: "work-unit", adjacencyCount: 5 },
      },
    );

    expect(test.validate(execution(final, [search, inspect])).passed).toBe(true);
    expect(test.validate(execution(final, [search])).passed).toBe(false);
    expect(test.validate(execution(final, [inspect])).passed).toBe(true);

    const unrelatedNode = structuredClone(inspect);
    unrelatedNode.invocation.arguments["target"] = "@r9-dead";
    expect(test.validate(execution(final, [search, unrelatedNode])).passed).toBe(false);

    const noCause = structuredClone(inspect);
    const noCauseResult = noCause.invocation.execution.result as {
      protocolContent: Array<{ text: string }>;
    };
    noCauseResult.protocolContent[0]!.text = noCauseResult.protocolContent[0]!.text.replace(
      /  work-unit @r3-740b —caused-by→ command @r4-45cb\n/u,
      "",
    );
    expect(test.validate(execution(final, [search, noCause])).passed).toBe(false);

    const foreignHistory = structuredClone(inspect);
    const foreignResult = foreignHistory.invocation.execution.result as {
      protocolContent: Array<{ text: string }>;
    };
    foreignResult.protocolContent[0]!.text = foreignResult.protocolContent[0]!.text.replace(
      "system-test://vcs-sizable-history-memory-recall/",
      "system-test://another-history/",
    );
    expect(test.validate(execution(final, [search, foreignHistory])).passed).toBe(false);

    const foreignEdge = structuredClone(inspect);
    const foreignEdgeResult = foreignEdge.invocation.execution.result as {
      protocolContent: Array<{ text: string }>;
    };
    foreignEdgeResult.protocolContent[0]!.text +=
      "\n  work-unit @r9-dead —authored-change→ change @ra-dead";
    (foreignEdge.invocation.execution.result as {
      details: { adjacencyCount: number };
    }).details.adjacencyCount += 1;
    expect(test.validate(execution(final, [search, foreignEdge])).passed).toBe(false);

    const wrongDecision = structuredClone(inspect);
    const wrongDecisionResult = wrongDecision.invocation.execution.result as {
      protocolContent: Array<{ text: string }>;
    };
    wrongDecisionResult.protocolContent[0]!.text = wrongDecisionResult.protocolContent[0]!.text.replace(
      "support and audit records consistently use the public Retention Service name",
      "technical support requested a temporary alias",
    );
    expect(test.validate(execution(final, [search, wrongDecision])).passed).toBe(false);

    const failedInspection = structuredClone(inspect);
    failedInspection.invocation.execution.status = "failed";
    expect(test.validate(execution(final, [search, failedInspection])).passed).toBe(false);

    const proseOnly = invocation("unrelated", "search", { query: "history" }, {
      protocolContent: [{
        type: "text",
        text: "Harbor Lantern was retired after launch; Retention Service replaced it.",
      }],
      details: { resultCount: 1 },
    });
    expect(test.validate(execution(final, [proseOnly])).passed).toBe(false);
  });

  it("joins an exact edited-file read to preserved and buried historical evidence", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-sizable-history-edited-file-context",
    )!;
    const path = "projects/history/src/retention-policy.ts";
    const contentHash = "a".repeat(64);
    const read = invocation(
      "historical-file-read",
      "read",
      { path },
      {
        protocolContent: [
          {
            type: "text",
            text: "export const archiveWindowDays = 21;\nexport const policyRevision = 36;\n",
          },
        ],
        details: {
          path,
          displayedRange: {
            coordinateKind: "utf16",
            start: 0,
            end: 75,
            startLine: 1,
            endLine: 2,
          },
          provenance: {
            status: "attached",
            path,
            contentHash,
            coordinateKind: "utf16",
            range: { start: 0, end: 75 },
            episodes: [
              {
                intent: {
                  tier: "stated",
                  text: "Record retention-policy audit checkpoint 36 without changing the approved archive window",
                },
                change: { kind: "change", changeId: "change:checkpoint-36" },
                workUnit: {
                  kind: "work-unit",
                  workUnitId: "work:checkpoint-36",
                },
                command: {
                  kind: "command",
                  commandId: "command:checkpoint-36",
                },
              },
            ],
          },
        },
      },
    );
    const final =
      "The window moved from 14 to 21 days because regional exports can arrive through day 18. Later checkpoints retained 21 and did not reverse that decision.";
    const history = invocation(
      "historical-file-provenance",
      "provenance",
      { target: path },
      {
        protocolContent: [
          {
            type: "text",
            // Subjects render as a kind plus a compact ref; identifier hygiene
            // means a rendered block never spells a change identity.
            text: 'past · change @r4-91af · stated: "Extend the archive window from 14 to 21 days because delayed regional exports can arrive through day 18; a three-day buffer prevents premature deletion"',
          },
        ],
      },
    );

    expect(test.validate(execution(final, [read, history]))).toEqual({
      passed: true,
      reason: undefined,
    });

    const mismatchedRange = structuredClone(read);
    const details = (
      mismatchedRange.invocation.execution.result as {
        details: { provenance: { range: { start: number; end: number } } };
      }
    ).details;
    details.provenance.range.end = 74;
    expect(
      test.validate(execution(final, [mismatchedRange, history])).passed,
    ).toBe(false);

    const missingRoots = structuredClone(read);
    const episode = (
      missingRoots.invocation.execution.result as {
        details: { provenance: { episodes: Array<Record<string, unknown>> } };
      }
    ).details.provenance.episodes[0]!;
    delete episode["command"];
    expect(
      test.validate(execution(final, [missingRoots, history])).passed,
    ).toBe(false);

    const wrongFileHistory = structuredClone(history);
    wrongFileHistory.invocation.arguments["target"] =
      "projects/history/src/unrelated.ts";
    expect(
      test.validate(execution(final, [read, wrongFileHistory])).passed,
    ).toBe(false);

    const page = invocation(
      "history-page",
      "provenance",
      { target: path },
      {
        protocolContent: [
          { type: "text", text: "more file history → @r7-ed9a" },
        ],
      },
    );
    const continued = structuredClone(history);
    continued.invocation.arguments["target"] = "@r7-ed9a";
    expect(
      test.validate(execution(final, [read, page, continued])).passed,
    ).toBe(true);
    expect(test.validate(execution(final, [read, continued])).passed).toBe(
      false,
    );
    expect(
      test.validate(execution(final, [read, continued, page])).passed,
    ).toBe(false);

    const recalledDecision = invocation(
      "historical-decision-recall",
      "memory_recall",
      { query: "regional exports day 18", kinds: ["commit"], limit: 10 },
      {
        protocolContent: [
          {
            type: "text",
            text: "[commit] workspace-event:archive-window\nExtend the archive window from 14 to 21 days because delayed regional exports can arrive through day 18",
          },
        ],
        details: { resultCount: 1 },
      },
    );
    expect(test.validate(execution(final, [read, recalledDecision]))).toEqual({
      passed: true,
      reason: undefined,
    });
  });

  it("accepts conclusive move/copy receipts with or without shallow history inspection", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-explicit-move-copy",
    )!;
    const moveState = {
      kind: "application",
      applicationId: "application:move",
    };
    const copyState = {
      kind: "application",
      applicationId: "application:copy",
    };
    const copySource = {
      state: moveState,
      repositoryId: "repository:fixture",
      fileId: "file:source",
    };
    const calls = [
      invocation("move", "move_file", "", {
        operation: "moved",
        source: {
          state: { kind: "event", eventId: "event:base" },
          repositoryId: "repository:fixture",
          fileId: "file:moved",
        },
        destination: {
          state: moveState,
          repositoryId: "repository:fixture",
          fileId: "file:moved",
        },
        workUnitId: "work:move",
        applicationId: "application:move",
        changeId: "change:move",
      }),
      invocation("copy", "copy_file", "", {
        operation: "copied",
        source: copySource,
        destination: {
          state: copyState,
          repositoryId: "repository:fixture",
          fileId: "file:copy",
        },
        workUnitId: "work:copy",
        applicationId: "application:copy",
        changeId: "change:copy",
      }),
    ];
    const shallowCopyHistory = invocation(
      "copy-history",
      "provenance",
      { target: "projects/fixture/src/copies/source.ts" },
      {
        details: {
          target: "projects/fixture/src/copies/source.ts",
          ref: "@r8-9feb",
          subjectKind: "file",
          limit: 5,
          adjacencyCount: 1,
          historyCount: 1,
          continuations: [],
        },
      },
    );
    const final =
      "The relocated file retained its identity; the duplicate has linked ancestry.";
    // Exact authored-copy-source and copies-content edges are asserted in
    // semanticWorkspace graph tests; this agentic validator checks operation
    // receipts and tolerates the bounded one-hop history view.
    expect(test.validate(execution(final, calls.slice(0, 2)))).toEqual({
      passed: true,
      reason: undefined,
    });
    expect(
      test.validate(execution(final, [...calls, shallowCopyHistory])),
    ).toEqual({ passed: true, reason: undefined });

    const malformedReceipt = structuredClone(calls);
    (malformedReceipt[1]!.invocation.execution.result as Record<string, unknown>)[
      "destination"
    ] = { ...copySource };
    expect(test.validate(execution(final, malformedReceipt)).passed).toBe(false);

    const missingStateIdentity = structuredClone(calls);
    const moveDetails = missingStateIdentity[0]!.invocation.execution
      .result as Record<string, unknown>;
    (moveDetails["destination"] as Record<string, unknown>)["state"] = {
      kind: "application",
    };
    expect(test.validate(execution(final, missingStateIdentity)).passed).toBe(
      false,
    );

    const mismatchedApplication = structuredClone(calls);
    const copyDetails = mismatchedApplication[1]!.invocation.execution
      .result as Record<string, unknown>;
    (copyDetails["destination"] as Record<string, unknown>)["state"] = {
      kind: "application",
      applicationId: "application:unrelated",
    };
    expect(test.validate(execution(final, mismatchedApplication)).passed).toBe(
      false,
    );

    const failedReceipt = structuredClone(calls);
    failedReceipt[1]!.invocation.execution.status = "failed";
    expect(test.validate(execution(final, failedReceipt)).passed).toBe(false);
  });

  it("requires a harness-owned vcs-stale-basis-recovery protocol probe instead of guest-authored command claims", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-stale-basis-recovery",
    )!;
    expect(test.validation).toBe("harness");
    expect(test.orchestrate).toBeTypeOf("function");
    expect(test.validate(execution("The edit was safe.", [])).passed).toBe(
      false,
    );
  });

  it("requires a harness-owned vcs-command-idempotency protocol probe instead of guest-authored command claims", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-command-idempotency",
    )!;
    expect(test.validation).toBe("harness");
    expect(test.orchestrate).toBeTypeOf("function");
    expect(test.validate(execution("The edit was safe.", [])).passed).toBe(
      false,
    );
  });

  it("joins revert to its exact counteracted change and restored final content", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-revert-preserves-history",
    )!;
    const path = "projects/demo/src/value.ts";
    const calls = [
      invocation(
        "edit",
        "edit",
        { path, oldText: "value = 1", newText: "value = 2" },
        {
          storage: "vcs",
          vcsResult: {
            applicationId: "application:original",
            changeCount: 1,
            changeIds: ["change:original"],
            workingHead: {
              kind: "application",
              applicationId: "application:original",
            },
          },
        },
      ),
      invocation(
        "commit-original",
        "vcs",
        { operation: "commit", message: "Named change" },
        {
          operation: "commit",
          result: {
            event: { kind: "event", eventId: "event:original" },
            committedApplicationIds: ["application:original"],
            integrationSourceEventIds: [],
          },
        },
      ),
      invocation(
        "revert",
        "vcs",
        {
          operation: "revert",
          changeIds: ["change:original"],
        },
        {
          operation: "revert",
          result: {
            applicationId: "application:counteraction",
            changeIds: ["change:counteraction"],
            workingHead: {
              kind: "application",
              applicationId: "application:counteraction",
            },
          },
        },
      ),
      invocation(
        "counteracts",
        "provenance",
        {},
        {
          adjacency: [
            {
              kind: "counteracts",
              from: { kind: "change", changeId: "change:counteraction" },
              to: { kind: "change", changeId: "change:original" },
            },
          ],
        },
      ),
      invocation(
        "commit-counteraction",
        "vcs",
        { operation: "commit", message: "Undo named change" },
        {
          operation: "commit",
          result: {
            event: { kind: "event", eventId: "event:restored" },
            committedApplicationIds: ["application:counteraction"],
            integrationSourceEventIds: [],
          },
        },
      ),
      invocation(
        "status",
        "vcs",
        { operation: "status" },
        {
          operation: "status",
          result: {
            clean: true,
            committed: { kind: "event", eventId: "event:restored" },
            workingHead: { kind: "event", eventId: "event:restored" },
            workingCounts: { applications: 0, workUnits: 0, changes: 0 },
            integrating: [],
          },
        },
      ),
      invocation(
        "read",
        "read",
        { path },
        {
          protocolContent: [
            { type: "text", text: "export const value = 1;\n" },
          ],
          details: { path },
        },
      ),
    ];
    const final =
      "The file is restored and both the original edit and its reversal remain in history.";
    expect(test.validate(execution(final, calls))).toEqual({
      passed: true,
      reason: undefined,
    });

    const arbitrary = structuredClone(calls);
    const edge = arbitrary[3]!.invocation.execution.result as {
      adjacency: Array<{ to: { changeId: string } }>;
    };
    edge.adjacency[0]!.to.changeId = "change:other";
    expect(test.validate(execution(final, arbitrary)).passed).toBe(false);

    const attachedCounteraction = structuredClone(calls);
    attachedCounteraction.splice(3, 1);
    const finalRead = attachedCounteraction.at(-1)!.invocation.execution
      .result as {
      details: Record<string, unknown>;
    };
    finalRead.details["provenance"] = {
      status: "attached",
      state: { kind: "event", eventId: "event:restored" },
      episodes: [
        {
          change: { kind: "change", changeId: "change:counteraction" },
          counteractsChangeIds: ["change:original"],
        },
      ],
    };
    expect(test.validate(execution(final, attachedCounteraction))).toEqual({
      passed: true,
      reason: undefined,
    });

    const opaqueTarget = structuredClone(attachedCounteraction);
    opaqueTarget[2]!.invocation.arguments = {
      operation: "revert",
      changeIds: ["@r5-native"],
    };
    const opaqueRead = opaqueTarget.at(-1)!.invocation.execution.result as {
      details: Record<string, unknown>;
    };
    const opaqueProvenance = opaqueRead.details["provenance"] as {
      episodes: Record<string, unknown>[];
    };
    opaqueProvenance.episodes[0]!["cause"] = {
      toolName: "vcs",
      requestRef: { operation: "revert", changeIds: ["@r5-native"] },
    };
    expect(test.validate(execution(final, opaqueTarget)).passed).toBe(true);
    const foreignTarget = structuredClone(opaqueTarget);
    foreignTarget[2]!.invocation.arguments = {
      operation: "revert",
      changeIds: ["@r6-foreign"],
    };
    expect(test.validate(execution(final, foreignTarget)).passed).toBe(false);
    const unrelatedCounteraction = structuredClone(opaqueTarget);
    const unrelatedRead = unrelatedCounteraction.at(-1)!.invocation.execution
      .result as { details: Record<string, unknown> };
    const unrelatedProvenance = unrelatedRead.details["provenance"] as {
      episodes: Record<string, unknown>[];
    };
    unrelatedProvenance.episodes[0]!["counteractsChangeIds"] = ["change:other"];
    expect(test.validate(execution(final, unrelatedCounteraction)).passed).toBe(
      false,
    );

    const committedReadWithoutStatus = structuredClone(attachedCounteraction);
    committedReadWithoutStatus.splice(4, 1);
    committedReadWithoutStatus.unshift(
      invocation(
        "initial-status",
        "vcs",
        { operation: "status" },
        {
          operation: "status",
          result: {
            clean: true,
            committed: { kind: "event", eventId: "event:base" },
            workingHead: { kind: "event", eventId: "event:base" },
            workingCounts: { applications: 0, workUnits: 0, changes: 0 },
            integrating: [],
          },
        },
      ),
    );
    expect(test.validate(execution(final, committedReadWithoutStatus))).toEqual(
      {
        passed: true,
        reason: undefined,
      },
    );

    const inverseEffectProof = structuredClone(calls);
    inverseEffectProof.pop();
    inverseEffectProof.splice(
      4,
      0,
      invocation(
        "original-change",
        "provenance",
        { target: "change:original" },
        {
          node: {
            kind: "change",
            value: {
              changeId: "change:original",
              effects: [
                {
                  kind: "content",
                  fileId: "file:value",
                  beforeContentHash: "hash:one",
                  afterContentHash: "hash:two",
                },
              ],
            },
          },
        },
      ),
      invocation(
        "counteraction-change",
        "provenance",
        { target: "change:counteraction" },
        {
          node: {
            kind: "change",
            value: {
              changeId: "change:counteraction",
              effects: [
                {
                  kind: "content",
                  fileId: "file:value",
                  beforeContentHash: "hash:two",
                  afterContentHash: "hash:one",
                },
              ],
            },
          },
        },
      ),
    );
    expect(test.validate(execution(final, inverseEffectProof))).toEqual({
      passed: true,
      reason: undefined,
    });

    const notRestored = structuredClone(calls);
    const read = notRestored[6]!.invocation.execution.result as {
      protocolContent: Array<{ text: string }>;
    };
    read.protocolContent[0]!.text = "export const value = 2;\n";
    expect(test.validate(execution(final, notRestored)).passed).toBe(false);
  });

  it("joins blame identities through exact causal endpoints to an inspected invocation", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-walkable-causality-blame",
    )!;
    const resultValue = {
      blame: {
        spans: [
          {
            start: 0,
            end: 12,
            change: { kind: "change", changeId: "change:origin" },
            workUnit: { kind: "work-unit", workUnitId: "work-unit:origin" },
            command: { kind: "command", commandId: "command:origin" },
            path: [],
            stop: "authored",
          },
        ],
      },
      walks: [
        {
          edges: [
            {
              kind: "authored-change",
              from: { kind: "work-unit", workUnitId: "work-unit:origin" },
              to: { kind: "change", changeId: "change:origin" },
            },
            {
              kind: "caused-by",
              from: { kind: "work-unit", workUnitId: "work-unit:origin" },
              to: { kind: "command", commandId: "command:origin" },
            },
            {
              kind: "caused-by",
              from: { kind: "command", commandId: "command:origin" },
              to: {
                kind: "trajectory-invocation",
                logId: "log:causal",
                head: "head:causal",
                invocationId: "invocation:causal",
              },
            },
            {
              kind: "part-of-turn",
              from: {
                kind: "trajectory-invocation",
                logId: "log:causal",
                head: "head:causal",
                invocationId: "invocation:causal",
              },
              to: {
                kind: "trajectory-turn",
                logId: "log:causal",
                head: "head:causal",
                turnId: "turn:causal",
              },
            },
            {
              kind: "triggered-by",
              from: {
                kind: "trajectory-turn",
                logId: "log:causal",
                head: "head:causal",
                turnId: "turn:causal",
              },
              to: {
                kind: "trajectory-message",
                logId: "log:causal",
                head: "head:causal",
                messageId: "message:causal",
              },
            },
          ],
        },
      ],
      inspected: [
        {
          node: {
            kind: "trajectory-invocation",
            value: {
              logId: "log:causal",
              head: "head:causal",
              invocationId: "invocation:causal",
              turnId: "turn:causal",
              name: "write",
              status: "complete",
              terminalOutcome: "success",
              requestRef: {
                protocol: "vibestudio.blob-ref.v1",
                digest:
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                size: 64,
                encoding: "json",
                originalBytes: 64,
              },
              startedEventId: "trajectory-event:start",
              completedEventId: "trajectory-event:complete",
            },
          },
        },
        {
          node: {
            kind: "trajectory-turn",
            value: {
              logId: "log:causal",
              head: "head:causal",
              turnId: "turn:causal",
              triggerMessageId: "message:causal",
            },
          },
        },
        {
          node: {
            kind: "trajectory-message",
            value: {
              logId: "log:causal",
              head: "head:causal",
              messageId: "message:causal",
              role: "user",
              sourceMessageId: "channel-message:causal",
              senderRef: {
                kind: "user",
                id: "user:fixture",
                participantId: "user:fixture",
              },
              textBlocks: [{ blockId: "block:causal", content: test.prompt }],
            },
          },
        },
      ],
    };
    const final =
      "The untouched content traces to the recorded user request; private reasoning is not evidence.";
    const valid = execution(final, [
      invocation(
        "causality",
        "eval",
        "await vcs.edit(change); await vcs.commit(commit); await vcs.push(push); await vcs.blame(input); await vcs.neighbors(walk); await vcs.inspect(invocation);",
        resultValue,
      ),
    ]);
    expect(test.validate(valid)).toEqual({ passed: true, reason: undefined });

    const attached = invocation(
      "causal-read",
      "read",
      { path: "projects/demo/distinctive-note.txt" },
      {
        details: {
          provenance: {
            status: "attached",
            episodes: [
              {
                change: { kind: "change", changeId: "change:origin" },
                workUnit: { kind: "work-unit", workUnitId: "work-unit:origin" },
                command: { kind: "command", commandId: "command:origin" },
                cause: {
                  invocation: {
                    kind: "trajectory-invocation",
                    logId: "log:causal",
                    head: "head:causal",
                    invocationId: "invocation:causal",
                  },
                  turn: {
                    kind: "trajectory-turn",
                    logId: "log:causal",
                    head: "head:causal",
                    turnId: "turn:causal",
                  },
                  message: {
                    kind: "trajectory-message",
                    logId: "log:causal",
                    head: "head:causal",
                    messageId: "message:causal",
                  },
                  sender: {
                    kind: "user",
                    id: "user:fixture",
                    participantId: "user:fixture",
                  },
                  requestRef: {
                    protocol: "vibestudio.blob-ref.v1",
                    digest: "a".repeat(64),
                    size: 64,
                    encoding: "json",
                    originalBytes: 64,
                  },
                  terminalOutcome: "success",
                  triggerText: test.prompt,
                },
              },
            ],
          },
        },
      },
    );
    expect(test.validate(execution(final, [attached]))).toEqual({
      passed: true,
      reason: undefined,
    });

    const minimalAttached = structuredClone(attached);
    const minimalCause = (
      minimalAttached.invocation.execution.result as {
        details: {
          provenance: { episodes: Array<{ cause: Record<string, unknown> }> };
        };
      }
    ).details.provenance.episodes[0]!.cause;
    delete minimalCause["requestRef"];
    delete minimalCause["terminalOutcome"];
    expect(test.validate(execution(final, [minimalAttached]))).toEqual({
      passed: true,
      reason: undefined,
    });

    const mismatched = structuredClone(resultValue);
    mismatched.walks[0]!.edges[0]!.to = {
      kind: "change",
      changeId: "change:other",
    };
    expect(
      test.validate(
        execution(final, [
          invocation(
            "causality-mismatch",
            "eval",
            "await vcs.edit(change); await vcs.commit(commit); await vcs.push(push); await vcs.blame(input); await vcs.neighbors(walk); await vcs.inspect(invocation);",
            mismatched,
          ),
        ]),
      ).passed,
    ).toBe(false);

    const unrelatedPrompt = structuredClone(resultValue);
    unrelatedPrompt.inspected[2]!.node.value.textBlocks = [
      { blockId: "block:older", content: "An older, unrelated request" },
    ];
    expect(
      test.validate(
        execution(final, [
          invocation(
            "causality-wrong-prompt",
            "eval",
            "await vcs.edit(change); await vcs.commit(commit); await vcs.push(push); await vcs.blame(input); await vcs.neighbors(walk); await vcs.inspect(invocation);",
            unrelatedPrompt,
          ),
        ]),
      ).passed,
    ).toBe(false);
  });

  it("joins imported blame through its ordinary change, import work, and command", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-honest-import-boundary",
    )!;
    expect(test.prompt).toBe(
      "Who changed an untouched line in the disposable project, and what can we actually establish about why it is here?",
    );
    expect(test.prompt).not.toMatch(
      /pre-import|unknown|source URI|revision|digest|work unit|command|blame|inspect|neighbors/iu,
    );
    const snapshot = {
      sourceKind: "generated",
      sourceUri: "system-test://vcs-honest-import-boundary/project",
      snapshotRevision: "fixture:revision",
      snapshotDigest: `snapshot:${"a".repeat(64)}`,
      targetRepositoryIds: ["repository:fixture"],
    };
    const intentSummary = "Create the disposable imported fixture";
    const evidence = {
      blame: {
        spans: [
          {
            start: 0,
            end: 8,
            change: { kind: "change", changeId: "change:import" },
            workUnit: { kind: "work-unit", workUnitId: "work:import" },
            command: { kind: "command", commandId: "command:import" },
            path: [],
            stop: "import-boundary",
          },
        ],
      },
      inspections: [
        {
          node: {
            kind: "change",
            value: {
              changeId: "change:import",
              authoredByWorkUnitId: "work:import",
              kind: "file-create",
            },
          },
        },
        {
          node: {
            kind: "work-unit",
            value: {
              workUnitId: "work:import",
              commandId: "command:import",
              kind: "import",
              intentSummary,
              externalSnapshot: snapshot,
            },
          },
        },
        {
          node: {
            kind: "command",
            value: {
              commandId: "command:import",
              method: "importSnapshot",
              status: "complete",
              result: { kind: "work-unit", workUnitId: "work:import" },
            },
          },
        },
      ],
    };
    const final =
      "The line enters our knowledge at the imported snapshot; earlier authorship is not recorded here.";
    const evidenceCalls = (value: typeof evidence) => [
      invocation("boundary-blame", "vcs", { operation: "blame" }, value.blame),
      ...value.inspections.map((inspection, index) =>
        invocation(
          `boundary-inspection-${index}`,
          "provenance",
          {},
          inspection,
        ),
      ),
    ];
    const result = execution(final, evidenceCalls(evidence));
    expect(test.validate(result)).toEqual({ passed: true, reason: undefined });

    const attached = invocation(
      "import-read",
      "read",
      { path: "packages/demo/src/index.ts" },
      {
        details: {
          provenance: {
            status: "attached",
            episodes: [
              {
                stop: "import-boundary",
                changeKind: "file-create",
                change: { kind: "change", changeId: "change:import" },
                workUnit: { kind: "work-unit", workUnitId: "work:import" },
                command: { kind: "command", commandId: "command:import" },
                intent: { tier: "stated", text: intentSummary },
                externalSnapshot: snapshot,
              },
            ],
          },
        },
      },
    );
    expect(test.validate(execution(final, [attached]))).toEqual({
      passed: true,
      reason: undefined,
    });

    const mismatched = structuredClone(evidence);
    mismatched.inspections[0]!.node.value.authoredByWorkUnitId = "work:other";
    expect(
      test.validate(execution(final, evidenceCalls(mismatched))).passed,
    ).toBe(false);

    const pseudoBarrier = structuredClone(evidence);
    pseudoBarrier.inspections[0]!.node.value.kind = "import-barrier";
    expect(
      test.validate(execution(final, evidenceCalls(pseudoBarrier))).passed,
    ).toBe(false);

    const fakeProse =
      "The line was imported, but this answer has no canonical supporting walk.";
    expect(
      test.validate(
        execution(fakeProse, [
          invocation("boundary-prose-only", "eval", "await vcs.blame(input);", {
            blame: evidence.blame,
            claimedSnapshot: snapshot,
          }),
        ]),
      ).passed,
    ).toBe(false);

    expect(
      test.validate(
        execution(final, [
          invocation(
            "boundary-arbitrary-eval",
            "eval",
            "return evidence;",
            evidence,
          ),
        ]),
      ).passed,
    ).toBe(false);

    expect(
      test.validate(
        execution(
          "A concise explanation in ordinary prose.",
          evidenceCalls(evidence),
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("requires native intent and untouched import evidence to remain two exact joined origins", () => {
    const test = vcsAdvancedTests.find(
      ({ name }) => name === "vcs-edited-import-boundary",
    )!;
    const snapshot = {
      sourceKind: "generated",
      sourceUri: "system-test://vcs-edited-import-boundary/project",
      snapshotRevision: "fixture:revision",
      snapshotDigest: `snapshot:${"c".repeat(64)}`,
      targetRepositoryIds: ["repository:fixture"],
    };
    const importIntent = "Create the disposable imported fixture";
    const nativeSpan = {
      start: 0,
      end: 8,
      change: { kind: "change", changeId: "change:native" },
      workUnit: { kind: "work-unit", workUnitId: "work:native" },
      command: { kind: "command", commandId: "command:native" },
      path: [],
      stop: "authored",
    };
    const importSpan = {
      start: 9,
      end: 18,
      change: { kind: "change", changeId: "change:import" },
      workUnit: { kind: "work-unit", workUnitId: "work:import" },
      command: { kind: "command", commandId: "command:import" },
      path: [],
      stop: "import-boundary",
    };
    const calls = [
      invocation(
        "mixed-blame",
        "vcs",
        { operation: "blame" },
        { spans: [nativeSpan, importSpan] },
      ),
      invocation(
        "import-blame",
        "vcs",
        { operation: "blame" },
        { spans: [importSpan] },
      ),
      invocation(
        "native-walk",
        "provenance",
        {},
        {
          adjacency: [
            {
              kind: "authored-change",
              from: { kind: "work-unit", workUnitId: "work:native" },
              to: { kind: "change", changeId: "change:native" },
            },
            {
              kind: "caused-by",
              from: { kind: "work-unit", workUnitId: "work:native" },
              to: { kind: "command", commandId: "command:native" },
            },
            {
              kind: "caused-by",
              from: { kind: "command", commandId: "command:native" },
              to: {
                kind: "trajectory-invocation",
                logId: "log:mixed",
                head: "main",
                invocationId: "invocation:native",
              },
            },
            {
              kind: "part-of-turn",
              from: {
                kind: "trajectory-invocation",
                logId: "log:mixed",
                head: "main",
                invocationId: "invocation:native",
              },
              to: {
                kind: "trajectory-turn",
                logId: "log:mixed",
                head: "main",
                turnId: "turn:mixed",
              },
            },
            {
              kind: "triggered-by",
              from: {
                kind: "trajectory-turn",
                logId: "log:mixed",
                head: "main",
                turnId: "turn:mixed",
              },
              to: {
                kind: "trajectory-message",
                logId: "log:mixed",
                head: "main",
                messageId: "message:mixed",
              },
            },
          ],
        },
      ),
      invocation(
        "native-invocation",
        "provenance",
        {},
        {
          node: {
            kind: "trajectory-invocation",
            value: {
              logId: "log:mixed",
              head: "main",
              invocationId: "invocation:native",
              turnId: "turn:mixed",
              requestRef: { digest: "d".repeat(64) },
            },
          },
          adjacency: [],
        },
      ),
      invocation(
        "native-turn",
        "provenance",
        {},
        {
          node: {
            kind: "trajectory-turn",
            value: {
              logId: "log:mixed",
              head: "main",
              turnId: "turn:mixed",
              triggerMessageId: "message:mixed",
            },
          },
          adjacency: [],
        },
      ),
      invocation(
        "native-message",
        "provenance",
        {},
        {
          node: {
            kind: "trajectory-message",
            value: {
              logId: "log:mixed",
              head: "main",
              messageId: "message:mixed",
              role: "user",
              sourceMessageId: "channel-message:mixed",
              senderRef: { id: "user:fixture" },
              textBlocks: [{ blockId: "block:mixed", content: test.prompt }],
            },
          },
          adjacency: [],
        },
      ),
      invocation(
        "import-change",
        "provenance",
        {},
        {
          node: {
            kind: "change",
            value: {
              changeId: "change:import",
              authoredByWorkUnitId: "work:import",
              kind: "file-create",
            },
          },
          adjacency: [],
        },
      ),
      invocation(
        "import-work",
        "provenance",
        {},
        {
          node: {
            kind: "work-unit",
            value: {
              workUnitId: "work:import",
              commandId: "command:import",
              kind: "import",
              intentSummary: importIntent,
              externalSnapshot: snapshot,
            },
          },
          adjacency: [],
        },
      ),
      invocation(
        "import-command",
        "provenance",
        {},
        {
          node: {
            kind: "command",
            value: {
              commandId: "command:import",
              method: "importSnapshot",
              status: "complete",
              result: { kind: "work-unit", workUnitId: "work:import" },
            },
          },
          adjacency: [],
        },
      ),
    ];
    const final =
      "The edited line has native request history; the neighboring line is only known from the imported snapshot onward.";
    expect(test.validate(execution(final, calls))).toEqual({
      passed: true,
      reason: undefined,
    });

    const unjoinedNative = structuredClone(calls);
    const nativeWalk = unjoinedNative[2]!.invocation.execution.result as {
      adjacency: Array<{ to: Record<string, unknown> }>;
    };
    nativeWalk.adjacency[1]!.to["commandId"] = "command:unrelated";
    expect(test.validate(execution(final, unjoinedNative)).passed).toBe(false);

    const unjoinedImport = structuredClone(calls);
    const importChange = unjoinedImport[6]!.invocation.execution.result as {
      node: { value: Record<string, unknown> };
    };
    importChange.node.value["authoredByWorkUnitId"] = "work:unrelated";
    expect(test.validate(execution(final, unjoinedImport)).passed).toBe(false);
  });
});
