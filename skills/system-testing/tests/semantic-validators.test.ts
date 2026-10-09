import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/runtime", () => ({
  browserData: {
    listImportJobs: vi.fn(async () => []),
  },
}));

import type { TestExecutionResult } from "../types.js";
import { agenticRuntimeTests } from "./agentic-runtime.js";
import { agentCapabilityTests } from "./agent-capabilities.js";
import { blobstoreTests } from "./blobstore.js";
import { cdpGadDiagnosticTests } from "./cdp-gad-diagnostics.js";
import { credentialTests } from "./credentials.js";
import { docsDiscoveryTests } from "./docs-discovery.js";
import { multiUserTests } from "./multi-user.js";
import { docsProbeTests } from "./docs-probes.js";
import { agentMessageHasAll, finalMessageHasAll } from "./_helpers.js";
import { interactionSurfaceTests } from "./interaction-surfaces.js";
import { gitInteropTests } from "./git-interop.js";
import { harnessToolTests } from "./harness-tools.js";
import { notificationTests } from "./notifications.js";
import { oauthTests } from "./oauth.js";
import { rpcTests } from "./rpc-communication.js";
import { serverLogTests } from "./server-logs.js";
import { skillTests } from "./skills.js";
import { unitDiagnosticsTests } from "./unit-diagnostics.js";
import { vcsAdvancedTests } from "./vcs-advanced.js";
import { webhookTests } from "./webhooks.js";

function execution(
  final: string,
  invocations: Record<string, unknown>[] = [],
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      { kind: "message", senderId: "user", complete: true, content: "prompt" },
      ...invocations.map((invocation) => ({
        kind: "message" as const,
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation" as const,
        content: JSON.stringify(invocation),
      })),
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

describe("semantic system-test validators", () => {
  it("keeps the assigned diagnostic prompts user-like and free of proof choreography", () => {
    const tests = [
      ...agenticRuntimeTests,
      ...skillTests,
      ...unitDiagnosticsTests,
      ...credentialTests,
      ...oauthTests,
      ...harnessToolTests,
      ...notificationTests,
      ...cdpGadDiagnosticTests,
      ...blobstoreTests,
      ...docsDiscoveryTests,
      ...docsProbeTests,
      ...serverLogTests,
      ...webhookTests,
      ...gitInteropTests,
    ];
    for (const test of tests) {
      expect(test.prompt, test.name).not.toMatch(
        /Finish with|Return (?:only|exactly)|[A-Z][A-Z0-9_]{3,}_OK|\w+:<(?:count|number)>|\b(?:blobstore|credentials|docs|git|notifications|serverLog|webhooks|workspace|gad)\.\w+\s*\(/u,
      );
    }
  });

  it("joins actual blob operations independently of guest summaries and field names", () => {
    const test = blobstoreTests.find(
      (test) => test.name === "blob-text-roundtrip-grep",
    )!;
    const digest = "a".repeat(64);
    const receipts = [
      {
        method: "putText",
        digest,
        contentDigest: digest,
        size: 80,
        lineCount: 3,
      },
      { method: "getText", digest, contentDigest: digest, size: 80 },
      {
        method: "getRange",
        digest,
        offset: 2,
        length: 10,
        present: true,
        decodedSize: 10,
      },
      { method: "grep", digest, matchCount: 1, maxMatches: 5 },
    ];
    const run = (rows: Record<string, unknown>[], truncated = false) =>
      execution(
        "The document round-tripped exactly; the smaller byte range and marker search both succeeded.",
        [
          {
            name: "eval",
            arguments: { code: "return await inspectStoredDocument();" },
            execution: {
              status: "complete",
              isError: false,
              result: {
                details: {
                  returnValue: { everythingWorked: true },
                  operationJournal: {
                    protocol: "workspace-operations.v1",
                    truncated,
                    entries: rows.map((receipt) => ({
                      type: "blob-text.observation",
                      receipt: {
                        protocol: "blob-text-observation.v1",
                        ...receipt,
                      },
                    })),
                  },
                },
              },
            },
          },
        ],
      );
    expect(test.validate(run(receipts)).passed).toBe(true);
    expect(test.validate(run([])).passed).toBe(false);
    expect(test.validate(run(receipts, true)).passed).toBe(false);
    for (const changed of [
      { index: 0, field: "lineCount", value: 1 },
      { index: 1, field: "contentDigest", value: "b".repeat(64) },
      { index: 1, field: "size", value: 79 },
      { index: 2, field: "digest", value: "b".repeat(64) },
      { index: 2, field: "length", value: 80 },
      { index: 2, field: "offset", value: 75 },
      { index: 2, field: "present", value: false },
      { index: 3, field: "matchCount", value: 0 },
      { index: 3, field: "matchCount", value: 6 },
    ]) {
      expect(
        test.validate(
          run(
            receipts.map((receipt, index) =>
              index === changed.index
                ? { ...receipt, [changed.field]: changed.value }
                : receipt,
            ),
          ),
        ).passed,
        JSON.stringify(changed),
      ).toBe(false);
    }
  });

  it("verifies tree file reads through listing content addresses without prescribing a second traversal", () => {
    const test = blobstoreTests.find(
      (test) => test.name === "blob-tree-lifecycle",
    )!;
    const first = `state:${"a".repeat(64)}`,
      second = `state:${"b".repeat(64)}`,
      root = `manifest:${"c".repeat(64)}`,
      digest = "d".repeat(64);
    const rows = [
      {
        type: "blob-tree.observation",
        receipt: {
          protocol: "blob-tree-observation.v1",
          method: "putTree",
          treeHash: root,
          stateHash: first,
        },
      },
      {
        type: "blob-tree.observation",
        receipt: {
          protocol: "blob-tree-observation.v1",
          method: "putTree",
          treeHash: `manifest:${"e".repeat(64)}`,
          stateHash: second,
        },
      },
      {
        type: "blob-tree.observation",
        receipt: {
          protocol: "blob-tree-observation.v1",
          method: "listTree",
          ref: first,
          page: {
            basis: {
              ref: first,
              rootTreeHash: root,
              prefix: "",
              order: "tree-preorder-v1",
            },
            entries: [
              {
                path: "note.txt",
                kind: "file",
                contentHash: digest,
                mode: 33188,
              },
            ],
            completeness: "complete",
          },
        },
      },
      {
        type: "blob-text.observation",
        receipt: {
          protocol: "blob-text-observation.v1",
          method: "getText",
          digest,
          contentDigest: digest,
          size: 20,
        },
      },
      {
        type: "blob-tree.observation",
        receipt: {
          protocol: "blob-tree-observation.v1",
          method: "diffTrees",
          from: first,
          to: second,
          diff: {
            added: [],
            removed: [],
            changed: [
              {
                path: "note.txt",
                fromContentHash: digest,
                toContentHash: "f".repeat(64),
                fromMode: 33188,
                toMode: 33188,
              },
            ],
          },
        },
      },
      {
        type: "blob-tree.observation",
        receipt: {
          protocol: "blob-tree-observation.v1",
          method: "materializeTree",
          ref: first,
          written: 1,
          unchanged: 0,
        },
      },
    ];
    const run = (entries: unknown[]) =>
      execution(
        "The tree difference changes one file. I materialized the files successfully.",
        [
          {
            name: "eval",
            arguments: { code: "return await inspectTreeVersions();" },
            execution: {
              status: "complete",
              result: {
                details: {
                  returnValue: "summary",
                  operationJournal: {
                    protocol: "workspace-operations.v1",
                    truncated: false,
                    entries,
                  },
                },
              },
            },
          },
        ],
      );
    expect(test.validate(run(rows)).passed).toBe(true);
    for (let index = 0; index < rows.length; index++)
      expect(
        test.validate(run(rows.filter((_, i) => i !== index))).passed,
        `missing operation ${index}`,
      ).toBe(false);
    const wrongRead = structuredClone(rows);
    Object.assign(wrongRead[3]!.receipt, { contentDigest: "f".repeat(64) });
    expect(test.validate(run(wrongRead)).passed).toBe(false);
    const unrelated = structuredClone(rows);
    Object.assign(unrelated[5]!.receipt, { ref: `state:${"f".repeat(64)}` });
    expect(test.validate(run(unrelated)).passed).toBe(false);
  });

  it("verifies native webhook counts and lifecycle identities without requiring guest return flags", () => {
    const lifecycle = webhookTests.find(
      (test) => test.name === "webhook-subscription-lifecycle",
    )!;
    const listing = webhookTests.find(
      (test) => test.name === "webhook-list-bounded",
    )!;
    const rows = [
      {
        method: "createSubscription",
        subscriptionId: "subscription-a",
        hasSecret: true,
      },
      {
        method: "listSubscriptions",
        includeRevoked: false,
        subscriptions: [{ subscriptionId: "subscription-a", revoked: false }],
      },
      {
        method: "rotateSecret",
        subscriptionId: "subscription-a",
        secretPresent: true,
      },
      { method: "revokeSubscription", subscriptionId: "subscription-a" },
      { method: "listSubscriptions", includeRevoked: false, subscriptions: [] },
    ];
    const run = (
      facts: Record<string, unknown>[],
      final: string,
      returned: unknown = { reported: true },
    ) =>
      execution(final, [
        {
          name: "eval",
          arguments: { code: "return await inspectWebhookLifecycle();" },
          execution: {
            status: "complete",
            result: {
              details: {
                returnValue: returned,
                operationJournal: {
                  protocol: "workspace-operations.v1",
                  truncated: false,
                  entries: facts.map((receipt) => ({
                    type: "webhook.observation",
                    receipt: { protocol: "webhook-observation.v1", ...receipt },
                  })),
                },
              },
            },
          },
        },
      ]);
    const final =
      "The temporary webhook appeared, its secret rotated, and I revoked it and confirmed cleanup.";
    expect(lifecycle.validate(run(rows, final)).passed).toBe(true);
    // Revocation awaits the persisted tombstone; another read is not required.
    expect(lifecycle.validate(run(rows.slice(0, 4), final)).passed).toBe(true);
    // Any later active listing contradicts cleanup, even after an empty listing.
    expect(lifecycle.validate(run([...rows, rows[1]!], final)).passed).toBe(
      false,
    );
    for (let index = 0; index < 4; index++)
      expect(
        lifecycle.validate(
          run(
            rows.filter((_, i) => i !== index),
            final,
          ),
        ).passed,
      ).toBe(false);
    const foreign = rows.map((row, index) =>
      index === 2 ? { ...row, subscriptionId: "foreign-subscription" } : row,
    );
    expect(lifecycle.validate(run(foreign, final)).passed).toBe(false);
    expect(
      lifecycle.validate(run(rows, final, { secret: "PRIVATE SECRET" })).passed,
    ).toBe(false);
    const empty = [rows[4]!];
    expect(
      listing.validate(
        run(empty, "0 webhook subscriptions are registered.", {
          unrelatedName: 0,
        }),
      ).passed,
    ).toBe(true);
    expect(
      listing.validate(run(empty, "9 webhook subscriptions are registered."))
        .passed,
    ).toBe(false);
    expect(
      listing.validate(
        run(empty, "No errors occurred. 9 subscriptions are registered."),
      ).passed,
    ).toBe(false);
    expect(
      listing.validate(
        run(empty, "No active webhook subscriptions are registered."),
      ).passed,
    ).toBe(true);
    expect(
      listing.validate(
        run([], "0 webhook subscriptions are registered.", { count: 0 }),
      ).passed,
    ).toBe(false);
  });

  it("requires direct semantic causality and blame evidence", () => {
    const test = vcsAdvancedTests.find(
      (candidate) => candidate.name === "vcs-walkable-causality-blame",
    )!;
    expect(test.workspaceRepoFixture).toEqual({
      kind: "content",
      section: "projects",
    });
    const final =
      "The untouched line is supported by the recorded request and causal history.";
    const invocation = (code: string, result?: unknown) => [
      {
        name: "eval",
        arguments: { code },
        execution: { status: "complete", isError: false, result },
      },
    ];
    expect(
      test.validate(
        execution(
          final,
          invocation(
            "await vcs.edit(change); await vcs.commit(commit); await vcs.push(push); await vcs.blame(input); await vcs.inspect({ node: command }); await vcs.neighbors({ root: command });",
            {
              spans: [
                {
                  start: 0,
                  end: 8,
                  path: [],
                  change: { kind: "change", changeId: "change:1" },
                  workUnit: { kind: "work-unit", workUnitId: "work-unit:1" },
                  command: { kind: "command", commandId: "command:1" },
                },
              ],
              edges: [
                {
                  kind: "authored-change",
                  from: { kind: "work-unit", workUnitId: "work-unit:1" },
                  to: { kind: "change", changeId: "change:1" },
                },
                {
                  kind: "caused-by",
                  from: { kind: "work-unit", workUnitId: "work-unit:1" },
                  to: { kind: "command", commandId: "command:1" },
                },
                {
                  kind: "caused-by",
                  from: { kind: "command", commandId: "command:1" },
                  to: {
                    kind: "trajectory-invocation",
                    logId: "trajectory:1",
                    head: "main",
                    invocationId: "invocation:1",
                  },
                },
                {
                  kind: "part-of-turn",
                  from: {
                    kind: "trajectory-invocation",
                    logId: "trajectory:1",
                    head: "main",
                    invocationId: "invocation:1",
                  },
                  to: {
                    kind: "trajectory-turn",
                    logId: "trajectory:1",
                    head: "main",
                    turnId: "turn:1",
                  },
                },
                {
                  kind: "triggered-by",
                  from: {
                    kind: "trajectory-turn",
                    logId: "trajectory:1",
                    head: "main",
                    turnId: "turn:1",
                  },
                  to: {
                    kind: "trajectory-message",
                    logId: "trajectory:1",
                    head: "main",
                    messageId: "message:1",
                  },
                },
              ],
              inspected: [
                {
                  node: {
                    kind: "trajectory-invocation",
                    value: {
                      logId: "trajectory:1",
                      head: "main",
                      invocationId: "invocation:1",
                      turnId: "turn:1",
                      requestRef: {
                        digest:
                          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                      },
                    },
                  },
                },
                {
                  node: {
                    kind: "trajectory-turn",
                    value: {
                      logId: "trajectory:1",
                      head: "main",
                      turnId: "turn:1",
                      triggerMessageId: "message:1",
                    },
                  },
                },
                {
                  node: {
                    kind: "trajectory-message",
                    value: {
                      logId: "trajectory:1",
                      head: "main",
                      messageId: "message:1",
                      role: "user",
                      sourceMessageId: "channel-message:current-prompt",
                      senderRef: { id: "user:fixture" },
                      textBlocks: [
                        { blockId: "block:1", content: test.prompt },
                      ],
                    },
                  },
                },
              ],
            },
          ),
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
    expect(
      test.validate(execution(final, invocation("await vcs.blame(input);"))),
    ).toEqual({
      passed: false,
      reason:
        "Completed tool results did not join blame, authored work, its command and invocation to the exact originating input with source message and sender identities",
    });
  });

  it("joins service descriptions to observed methods without requiring prose casing or repeated qualifiers", () => {
    const test = docsDiscoveryTests.find(
      (candidate) => candidate.name === "docs-describe-service",
    )!;
    const reads = [
      {
        name: "docs_search",
        arguments: { surface: "service", limit: 10 },
        execution: {
          status: "complete",
          result: {
            details: [{ id: "service:blobstore", qualifiedName: "blobstore" }],
          },
        },
      },
      {
        name: "docs_open",
        arguments: { id: "service:blobstore" },
        execution: {
          status: "complete",
          result: {
            details: {
              id: "service:blobstore",
              qualifiedName: "blobstore",
              members: ["blobstore.putText", "blobstore.getText"],
            },
          },
        },
      },
    ];
    expect(
      test.validate(
        execution(
          "Blobstore stores content; putText writes and getText reads it.",
          reads,
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(execution("blobstore.putText writes content.", reads))
        .passed,
    ).toBe(true);
    expect(
      test.validate(
        execution("Blobstore stores content; inventedMethod reads it.", reads),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(execution("Blobstore: other.getText reads content.", reads))
        .passed,
    ).toBe(false);
    expect(
      test.validate(execution("Blobstore: getTextual reads content.", reads))
        .passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("Blobstore putText reads content.", reads.slice(1)),
      ).passed,
    ).toBe(false);
  });

  it("accepts identity-joined method documents without prescribing a parent-page read", () => {
    const test = docsDiscoveryTests.find(
      (candidate) => candidate.name === "docs-describe-service",
    )!;
    const hits = ["putText", "getText"].map((method) => ({
      id: `service:blobstore.${method}`,
      qualifiedName: `blobstore.${method}`,
      parent: "service:blobstore",
    }));
    const reads = [
      {
        name: "docs_search",
        arguments: { limit: 5 },
        execution: { status: "complete", result: { details: hits } },
      },
      ...hits.map((hit) => ({
        name: "docs_open",
        arguments: { id: hit.id },
        execution: { status: "complete", result: { details: hit } },
      })),
    ];
    expect(
      test.validate(
        execution(
          "Blobstore stores content; putText writes it and getText reads it.",
          reads,
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(execution("Other stores content with putText.", reads))
        .passed,
    ).toBe(false);
    expect(
      test.validate(execution("Blobstore has inventedMethod.", reads)).passed,
    ).toBe(false);
    const foreign = reads.map((read) =>
      read.name === "docs_open"
        ? {
            ...read,
            execution: {
              status: "complete",
              result: { details: { ...hits[0], parent: "service:foreign" } },
            },
          }
        : read,
    );
    expect(
      test.validate(
        execution("Blobstore stores content with putText.", foreign),
      ).passed,
    ).toBe(false);
  });

  it("requires stale RPC catalog guidance to preserve exact-build authority", () => {
    const test = docsProbeTests.find(
      (candidate) => candidate.name === "docs-do-rpc-catalog-mismatch",
    )!;
    const docsRead = {
      name: "docs_open",
      execution: {
        status: "complete",
        isError: false,
        result: {
          text: "WORKSPACE_RPC_METHOD_UNDECLARED means the exact active provider build does not declare the requested method. Inspect its declared methods.",
        },
      },
    };

    expect(
      test.validate(
        execution(
          "The source edit is not the live contract. Publish or activate the exact provider build, or use a declared method from the live service docs. Do not bypass this with raw addressing.",
          [docsRead],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution("Call the raw Durable Object target directly.", [docsRead]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "Adding source does not update the active RPC contract. Check the receiver declaration, commit and publish, then resolve the service again.",
          [
            {
              ...docsRead,
              execution: {
                status: "complete",
                result: {
                  text: "A successful build verifies the candidate; publication updates the active service.",
                },
              },
            },
          ],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "WORKSPACE_RPC_METHOD_UNDECLARED means the live Durable Object receiver has no declared RPC entry for this method. Workspace source alone does not change its live contract. Verify the candidate, commit and publish the provider, wait for publication, then resolve the service again and retry.",
          [docsRead],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "The declared RPC catalog belongs to the live receiver contract, while workspace source is its candidate view. Verification followed by publication activates that provider revision; resolve the service again before using it.",
          [docsRead],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "The active provider's declared RPC contract is published. Resolve the service again before calling it.",
          [docsRead],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "The source change alone does not update the live receiver contract; retry the method after checking the candidate.",
          [docsRead],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "Workspace source alone does not change the active provider contract. Verify the candidate, commit and publish, wait for publication, then resolve the service again.",
          [docsRead],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "The source change alone does not update the live service's declared RPC catalog. Verify the candidate, commit and publish, then retry.",
          [docsRead],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "Adding source does not update the active RPC contract. Check the receiver declaration, commit and publish, then resolve the service again.",
        ),
      ).passed,
    ).toBe(false);
  });

  it("judges read-only app triage by source-authoring actions rather than disclaimer wording", () => {
    const test = docsProbeTests.find(
      (candidate) => candidate.name === "docs-appdev-target-triage",
    )!;
    const docsRead = {
      name: "read",
      execution: {
        status: "complete",
        result: {
          text: "Appdev: isolate Electron target failures and gather reproduction evidence.",
        },
      },
    };
    const final =
      "I triaged the Electron report. What steps reproduce it, and does the same flow work in the browser?";
    expect(test.validate(execution(final, [docsRead])).passed).toBe(true);
    expect(test.validate(execution(final)).passed).toBe(false);
    expect(
      test.validate(
        execution(final, [
          docsRead,
          {
            name: "edit",
            execution: {
              status: "complete",
              result: { changed: true },
            },
          },
        ]),
      ).passed,
    ).toBe(false);
  });

  it("recognizes scoped extension authorization without requiring the word approval", () => {
    const test = docsProbeTests.find(
      (candidate) => candidate.name === "docs-extensiondev-risk-plan",
    )!;
    const docsRead = {
      name: "read",
      execution: {
        status: "complete",
        result: {
          text: "Extensiondev: host-held credentials, scoped network grants and schema ownership.",
        },
      },
    };
    expect(
      test.validate(
        execution(
          "Request only the network destinations and credential audience needed. Review the schema migration and publish only when authorized.",
          [docsRead],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "Fetch the network data, store credentials and change the schema.",
          [docsRead],
        ),
      ).passed,
    ).toBe(false);
  });

  it("accepts supplied-policy explanations without prescribing a redundant documentation read", () => {
    const ui = docsProbeTests.find(
      (candidate) => candidate.name === "docs-interaction-surface-choice",
    )!;
    expect(
      ui.validate(
        execution(
          "Use inline_ui for persistent links and controls, with visible operation errors and a retry path.",
        ),
      ).passed,
    ).toBe(true);
    expect(
      ui.validate(
        execution(
          "Use a static Markdown message for links and interactive error handling.",
        ),
      ).passed,
    ).toBe(false);
    const headless = docsProbeTests.find(
      (candidate) => candidate.name === "docs-headless-gad-diagnostics",
    )!;
    expect(
      headless.validate(
        execution(
          "Identify the session, inspect recent tool invocation state, and distinguish pending work from a terminal failure. Wait for completion.",
        ),
      ).passed,
    ).toBe(true);
    expect(
      headless.validate(
        execution("No final response means failure. Retry immediately."),
      ).passed,
    ).toBe(false);
  });

  it("accepts a natural singleton membership report while rejecting absent or incorrect roles", () => {
    const test = multiUserTests.find(
      (candidate) => candidate.name === "workspace-members",
    )!;
    const call = {
      name: "eval",
      arguments: {
        code: "return await services.account.listWorkspaceMembers();",
      },
      execution: {
        status: "complete",
        result: {
          details: { returnValue: [{ handle: "root", role: "admin" }] },
        },
      },
    };
    expect(
      test.validate(
        execution("This workspace has one member: Root (@root), Admin.", [
          call,
        ]),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution("This workspace has one member: Root (@root), Viewer.", [
          call,
        ]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("This workspace has two members: Root (@root), Admin.", [
          call,
        ]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("This workspace has one member: Root (@root), Admin."),
      ).passed,
    ).toBe(false);
  });

  it("requires provenance orientation to cite identity-joined public compact graph edges", () => {
    const test = harnessToolTests.find(
      (candidate) => candidate.name === "provenance-orientation",
    )!;
    const graph = (ref: string, text: string, adjacencyCount = 1) => ({
      name: "provenance",
      arguments: { target: "session" },
      execution: {
        status: "complete",
        result: {
          protocolContent: [{ type: "text", text }],
          details: {
            ref,
            subjectKind: "trajectory",
            adjacencyCount,
            continuations: [],
          },
        },
      },
    });
    const final =
      "The session trajectory root @r1-abcd carries the invocation's originating context.";
    const edge =
      "  trajectory-invocation @r2-abcd —part-of-trajectory→ trajectory @r1-abcd";
    expect(
      test.validate(execution(final, [graph("@r1-abcd", edge)])).passed,
    ).toBe(true);
    expect(test.validate(execution(final)).passed).toBe(false);
    expect(
      test.validate(execution(final, [graph("@r9-abcd", edge)])).passed,
    ).toBe(false);
    expect(
      test.validate(execution(final, [graph("@r1-abcd", edge, 0)])).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(final, [
          graph("@r1-abcd", "node · trajectory · this session"),
        ]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("The trajectory carries context @r9-abcd", [
          graph("@r1-abcd", edge),
        ]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(final, [
          graph("@r1-abcd", edge.replace("trajectory @r1", "file @r1")),
        ]),
      ).passed,
    ).toBe(false);
  });

  it("requires memory-search prose to be backed by canonical recall results", () => {
    const test = harnessToolTests.find(
      (candidate) => candidate.name === "memory-search",
    )!;
    const final =
      "Workspace memory found one prior conversation about a build failure, with the recalled message as its source provenance.";
    const recall = {
      name: "memory_recall",
      arguments: { query: "build failures", limit: 10 },
      execution: {
        status: "complete",
        isError: false,
        result: {
          details: { results: [{ kind: "message", snippet: "build failed" }] },
        },
      },
    };
    expect(test.validate(execution(final, [recall]))).toEqual({ passed: true });
    expect(test.validate(execution(final))).toMatchObject({ passed: false });
  });

  it("requires a large collection summary to be backed by its completed eval count", () => {
    const test = agentCapabilityTests.find(
      (candidate) => candidate.name === "large-output",
    )!;
    const invocation = {
      name: "eval",
      arguments: {
        code: "const values = Array.from({ length: 100000 }, (_, index) => index); return { count: values.length };",
      },
      execution: {
        status: "complete",
        isError: false,
        result: { details: { returnValue: { count: 100000 } } },
      },
    };
    expect(
      test.validate(
        execution(
          "The generated collection contained 100,000 items; I kept the report compact.",
          [invocation],
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
    expect(
      test.validate(execution("The collection contained 100,000 items.")),
    ).toMatchObject({
      passed: false,
    });
    expect(
      test.validate(
        execution("The generated collection contained 200,000 items.", [
          {
            ...invocation,
            execution: {
              status: "complete",
              isError: false,
              result: { details: { returnValue: { totalItems: 200000 } } },
            },
          },
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts the scalar identity returned by workspace.getActive", () => {
    const test = rpcTests.find(
      (candidate) => candidate.name === "cross-service-call",
    )!;
    expect(
      test.validate(
        execution("The active workspace ID is dev.", [
          {
            name: "eval",
            arguments: { code: "return workspace.getActive();" },
            execution: {
              status: "complete",
              isError: false,
              result: { details: { returnValue: "dev" } },
            },
          },
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("rejects natural-language channel claims without an executed bounded inspection", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "channel-envelope-inspection-bounded",
    )!;
    const result = test.validate(
      execution(
        "The nonexistent channel had no envelope history in the bounded inspection.",
      ),
    );
    expect(result).toMatchObject({ passed: false });
  });
  it("joins a reported worker count to the completed worker RPC result", () => {
    const test = rpcTests.find((candidate) => candidate.name === "worker-rpc")!;
    expect(
      test.validate(
        execution("The worker service reported 2 launchable worker sources.", [
          {
            name: "eval",
            arguments: { code: "return workers.listSources();" },
            execution: {
              status: "complete",
              isError: false,
              result: {
                details: {
                  returnValue: [
                    { source: "workers/alpha" },
                    { source: "workers/beta" },
                  ],
                },
              },
            },
          },
        ]),
      ),
    ).toEqual({ passed: true });
  });

  it("does not treat a prose limit as canonical bounded evidence", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "channel-envelope-inspection-bounded",
    )!;
    expect(
      test.validate(
        execution(
          "The channel history query used a limit of 5 and found no envelopes.",
        ),
      ),
    ).toMatchObject({ passed: false });
  });

  it("accepts a bounded executed channel-inspection call when prose omits the limit", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "channel-envelope-inspection-bounded",
    )!;
    expect(
      test.validate(
        execution(
          "The bounded channel history inspection found no envelopes.",
          [
            {
              name: "eval",
              arguments: {
                code: 'await gad.inspectChannelEnvelopes({ channelId: "fake", limit: 10 });',
              },
              execution: { status: "complete", isError: false },
            },
          ],
        ),
      ),
    ).toEqual({ passed: true });
  });

  it("accepts the bounded channel-health inspector as canonical channel history evidence", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "channel-envelope-inspection-bounded",
    )!;
    expect(
      test.validate(
        execution("The bounded channel health report found no history.", [
          {
            name: "eval",
            arguments: {
              code: 'await gad.inspectAgentHealth({ channelId: "fake", limit: 10 });',
            },
            execution: { status: "complete", isError: false },
          },
        ]),
      ),
    ).toEqual({ passed: true });
  });

  it("accepts agent.describe as canonical agent debug-state evidence", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "agent-debug-state-method",
    )!;
    expect(
      test.validate(
        execution(
          "The agent exposes debug state through its available description.",
          [
            {
              name: "eval",
              arguments: {
                code: "return await agent.describe();",
              },
              execution: { status: "complete", isError: false },
            },
          ],
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts the canonical direct VCS tool as runtime VCS evidence", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "runtime-vcs-client-helper",
    )!;
    expect(
      test.validate(
        execution("The VCS client is available and usable.", [
          {
            name: "vcs",
            arguments: { operation: "status" },
            execution: {
              status: "complete",
              isError: false,
              result: { clean: true },
            },
          },
        ]),
      ),
    ).toEqual({ passed: true });
  });

  it("accepts typed gad.status metrics", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "gad-status-summary",
    )!;
    expect(
      test.validate(
        execution("GAD reports one log_events metric with value 1.", [
          {
            name: "eval",
            arguments: {
              code: "return await gad.status();",
            },
            execution: {
              status: "complete",
              isError: false,
              result: {
                details: { returnValue: [{ metric: "log_events", value: 1 }] },
              },
            },
          },
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it.each([
    { metric: "Log events", value: 289 },
    { count: 6, metric: { metric: "Log events", value: 289 } },
    { summary: [{ metric: "Log events", value: 289 }] },
  ])("accepts a bounded typed status observation: %j", (returnValue) => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "gad-status-summary",
    )!;
    const call = {
      name: "eval",
      arguments: {
        code: "const metrics = await gad.status(); return { count: metrics.length, metric: metrics[0] };",
      },
      execution: {
        status: "complete",
        isError: false,
        result: { details: { returnValue } },
      },
    };
    expect(test.validate(execution("Log events — 289.", [call])).passed).toBe(
      true,
    );
    expect(test.validate(execution("Log events — 290.", [call])).passed).toBe(
      false,
    );
    expect(test.validate(execution("Other metric — 289.", [call])).passed).toBe(
      false,
    );
    expect(
      test.validate(
        execution("Log events — 289.", [
          { ...call, execution: { ...call.execution, isError: true } },
        ]),
      ).passed,
    ).toBe(false);
  });

  it("accepts metrics obtained from the documented workspace-source service", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "gad-status-summary",
    )!;
    const call = {
      name: "eval",
      arguments: {
        code: 'const svc = await workers.resolveService("vibestudio.workspace-source.v1"); return await rpc.call(svc.targetId, "getStatus", []);',
      },
      execution: {
        status: "complete",
        isError: false,
        result: {
          details: { returnValue: [{ metric: "Log events", value: 123 }] },
        },
      },
    };
    expect(
      test.validate(execution("The Log events metric is 123.", [call])).passed,
    ).toBe(true);
    expect(
      test.validate(execution("The Log events metric is 124.", [call])).passed,
    ).toBe(false);
    expect(
      test.validate(execution("A different metric is 123.", [call])).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("The Log events metric is 123.", [
          {
            ...call,
            arguments: {
              code: call.arguments.code.replace('"getStatus"', '"getConfig"'),
            },
          },
        ]),
      ).passed,
    ).toBe(false);
  });

  it("accepts a human-formatted two-thousand result", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "large-eval-result-terminal",
    )!;
    expect(
      test.validate(
        execution("Created a concise summary for 2,000 items.", [
          {
            name: "eval",
            arguments: {
              code: "return Array.from({ length: 2000 }, (_, i) => i).length;",
            },
            execution: { status: "complete", isError: false, result: 2000 },
          },
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts a first-class scoped test verification and passing result", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "workspace-test-runner-extension",
    )!;
    expect(
      test.validate(
        execution("Passed 12 tests, failed 0, in context ctx-1.", [
          {
            name: "verify",
            arguments: {
              operation: "test",
              target: "extensions/test-runner",
              file: "index.test.ts",
            },
            execution: {
              status: "complete",
              isError: false,
              result: {
                details: {
                  operation: "test",
                  status: "passed",
                  report: {
                    passed: 12,
                    failed: 0,
                    total: 12,
                    contextId: "ctx-1",
                  },
                },
              },
            },
          },
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });
    expect(test.validation).toBe("harness");
  });

  it("requires one atomic multi-file patch followed by a build of the same fixture", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "atomic-multifile-patch-build",
    )!;
    const repo = "packages/system-test-atomic";
    expect(
      test.validate(
        execution("The coherent change builds successfully.", [
          {
            name: "apply_patch",
            arguments: {
              operations: [
                {
                  kind: "replace",
                  path: `${repo}/src/index.ts`,
                  replacements: [
                    { oldText: "baseline", newText: "atomic-system-test" },
                  ],
                },
                {
                  kind: "write",
                  path: `${repo}/README.md`,
                  content: "fixtureValue is atomic-system-test",
                },
              ],
            },
            execution: {
              status: "complete",
              isError: false,
              result: { details: { status: "applied" } },
            },
          },
          {
            name: "verify",
            arguments: { operation: "build", target: repo },
            execution: {
              status: "complete",
              isError: false,
              result: { details: { operation: "build", status: "ok" } },
            },
          },
        ]),
      ),
    ).toEqual({ passed: true, reason: undefined });
    expect(test.validation).toBe("harness");
    expect(test.workspaceRepoFixture).toEqual({
      kind: "buildable-package",
      section: "packages",
    });
  });

  it("pregrants only the test-runner provider capability for the scenario", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "workspace-test-runner-extension",
    )!;
    expect(test.authorityPolicy).toEqual({
      authority: [
        {
          ruleId: "workspace-test-runner-execution",
          capability: {
            kind: "prefix",
            prefix:
              "userland:extensions/test-runner/native.code.execute-tests#",
          },
          resource: {
            kind: "exact",
            key: "native.code.tests:extension:@workspace-extensions/test-runner",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    });
  });

  it("requires a real completed tool before accepting a natural no-stall response", () => {
    const test = agenticRuntimeTests.find(
      (candidate) => candidate.name === "turn-no-silent-stall-after-tool",
    )!;
    const final =
      "The read-only check completed, and this is the visible final response.";
    const completed = {
      name: "read",
      arguments: { path: "README.md", limit: 1 },
      execution: {
        status: "complete",
        isError: false,
        result: { text: "Vibestudio" },
      },
    };
    expect(test.validate(execution(final, [completed]))).toEqual({
      passed: true,
    });
    expect(test.validate(execution(final))).toMatchObject({ passed: false });
  });

  it("does not require eval when action-bar files are already available", () => {
    const test = interactionSurfaceTests.find(
      (candidate) => candidate.name === "load-action-bar-transcript-event",
    )!;
    const completed = (id: string, args: Record<string, unknown>) => ({
      id,
      name: "load_action_bar",
      arguments: args,
      execution: {
        status: "complete",
        isError: false,
        result: {
          details: {
            protocol: "native-channel-method-outcome.v1",
            value:
              args["clear"] === true
                ? { ok: true, cleared: true }
                : { ok: true, id: "bar-1" },
          },
        },
      },
    });
    expect(
      test.validate(
        execution("Displayed the conversation action bar, then cleared it.", [
          completed("load", { path: "panels/tools/action-bar.tsx" }),
          completed("clear", { clear: true }),
        ]),
      ),
    ).toEqual({ passed: true });
  });

  it("requires the exact stable onboarding request and its native receiver acknowledgement", () => {
    const test = interactionSurfaceTests.find(
      (candidate) => candidate.name === "onboarding-stable-id-routing",
    )!;
    const code =
      'import { executeOnboardingSelection } from "@workspace-skills/onboarding"; return await executeOnboardingSelection({source:"onboarding-setup-hub",kind:"onboarding-capability",action:"setup",targetId:"connection.github"});';
    const call = (request: string, received: string, native = true) => ({
      name: "client_eval",
      arguments: { code: request },
      execution: {
        status: "complete",
        isError: false,
        result: native
          ? {
              details: {
                protocol: "native-channel-method-outcome.v1",
                value: { handled: true, received: { code: received } },
              },
            }
          : { handled: true, received: { code: received } },
      },
    });
    expect(
      test.validate(
        execution("Selection forwarded.", [
          call(code, code, false),
          call(code, code),
        ]),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution("Selection forwarded.", [call(code, "another request")]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("Selection forwarded.", [call(code, code, false)]),
      ).passed,
    ).toBe(false);
    const unbound =
      'import { executeOnboardingSelection } from "@workspace-skills/onboarding"; return await executeOnboardingSelection(interaction);';
    expect(
      test.validate(execution("Selection forwarded.", [call(unbound, unbound)]))
        .passed,
    ).toBe(false);
    const otherTarget = code.replace("connection.github", "connection.other");
    expect(
      test.validate(
        execution("Selection forwarded.", [call(otherTarget, otherTarget)]),
      ).passed,
    ).toBe(false);
  });

  it("rejects an onboarding card assembled after its required skill read failed", () => {
    const test = interactionSurfaceTests.find(
      (candidate) => candidate.name === "onboarding-opening-overview",
    )!;
    const inline = {
      name: "inline_ui",
      arguments: {
        path: "skills/onboarding/SetupHub.tsx",
        id: "onboarding-setup-overview",
      },
      execution: {
        status: "complete",
        isError: false,
        result: {
          details: {
            protocol: "native-channel-method-outcome.v1",
            value: { ok: true, id: "onboarding-setup-overview" },
          },
        },
      },
    };
    const failedRead = {
      name: "read",
      arguments: { path: "skills/onboarding/SKILL.md" },
      execution: {
        status: "error",
        isError: true,
        result: "VCS reference unavailable",
      },
    };
    const completedRead = {
      ...failedRead,
      execution: { status: "complete", isError: false, result: "# Onboarding" },
    };

    expect(
      test.validate(execution("ONBOARDING_OPENING_OK", [failedRead, inline]))
        .passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("The setup overview is open.", [
          completedRead,
          {
            ...inline,
            execution: {
              status: "complete",
              isError: false,
              result: { ok: true, id: "onboarding-setup-overview" },
            },
          },
          inline,
        ]),
      ),
    ).toEqual({
      passed: true,
      reason: undefined,
    });
    expect(
      test.validate(
        execution("Opened.", [
          completedRead,
          {
            ...inline,
            arguments: { ...inline.arguments, props: {} },
          },
        ]),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution("Opened.", [
          completedRead,
          {
            ...inline,
            arguments: { ...inline.arguments, props: { snapshot: {} } },
          },
        ]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("ONBOARDING_OPENING_OK", [
          completedRead,
          {
            ...inline,
            execution: {
              status: "complete",
              isError: false,
              result: { ok: true },
            },
          },
        ]),
      ).passed,
    ).toBe(false);
  });

  it("treats hyphenated prose tokens and spaced prose as equivalent", () => {
    expect(
      finalMessageHasAll(execution("Diagnosis used bounded diagnostics."), [
        "bounded-diagnostics",
      ]),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("does not loosen underscore sentinel markers into ordinary prose", () => {
    expect(
      finalMessageHasAll(execution("skill headless ok"), ["SKILL_HEADLESS_OK"])
        .passed,
    ).toBe(false);
  });

  it("validates delivered transcript messages without conflating separate messages", () => {
    const result = execution("The requested action was delivered.");
    result.messages.splice(1, 0, {
      id: "delivered-action",
      kind: "message",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      content:
        '<ActionButton message="Follow-up acknowledged">Open follow-up</ActionButton> MDX_ACTION_OK',
    });
    expect(
      agentMessageHasAll(result, ["MDX_ACTION_OK", "ActionButton"]),
    ).toEqual({
      passed: true,
      reason: undefined,
    });

    result.messages[1]!.content = "<ActionButton>Open follow-up</ActionButton>";
    expect(
      agentMessageHasAll(result, ["MDX_ACTION_OK", "ActionButton"]).passed,
    ).toBe(false);
  });

  it("validates an action-button response as the product outcome", () => {
    const test = interactionSurfaceTests.find(
      (candidate) => candidate.name === "mdx-action-button-message",
    )!;
    expect(test.validation).toBe("harness");
    expect(
      test.validate(
        execution(
          '<ActionButton message="Tell me more">Continue</ActionButton>',
        ),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });
});

describe("native chat delivery evidence", () => {
  const scenario = (name: string) =>
    interactionSurfaceTests.find((test) => test.name === name)!;
  it("accepts the applied title without a private marker and rejects a mismatched result", () => {
    const call = {
      name: "set_title",
      arguments: { title: "Conversation Title" },
      execution: {
        status: "complete",
        result: { details: { title: "Conversation Title" } },
      },
    };
    expect(
      scenario("set-title").validate(
        execution("Set the title to Conversation Title.", [call]),
      ).passed,
    ).toBe(true);
    expect(
      scenario("set-title").validate(
        execution("Set the title.", [
          {
            ...call,
            execution: {
              status: "complete",
              result: { details: { title: "Wrong title" } },
            },
          },
        ]),
      ).passed,
    ).toBe(false);
    expect(
      scenario("set-title").validate(
        execution("SET_TITLE_OK title: Conversation Title"),
      ).passed,
    ).toBe(false);
  });
  it("requires the canonical custom message and its state update rather than marker prose", () => {
    const result = execution("Published and updated the note.", [
      {
        name: "eval",
        arguments: {
          code: 'await chat.registerMessageType({typeId:"note"}); const message = await chat.publishCustomMessage({typeId:"note"}); await chat.updateCustomMessage(message.messageId, {text:"after"});',
        },
        execution: {
          status: "complete",
          result: { details: { returnValue: { messageId: "note-1" } } },
        },
      },
    ]);
    result.messages.push({
      id: "note-1",
      kind: "message",
      senderId: "agent",
      complete: true,
      content: "",
      contentType: "custom",
      custom: {
        messageId: "note-1",
        typeId: "note",
        displayMode: "inline",
        initialState: { text: "before" },
        updates: [{ update: { text: "after" }, seq: 2 }],
        lastSeq: 2,
      },
    } as TestExecutionResult["messages"][number]);
    expect(scenario("custom-message-publish").validate(result).passed).toBe(
      true,
    );
    expect(
      scenario("custom-message-update-clear").validate(result).passed,
    ).toBe(true);
    result.messages.at(-1)!.custom!.updates = [];
    expect(
      scenario("custom-message-update-clear").validate(result).passed,
    ).toBe(false);
    result.messages.pop();
    expect(scenario("custom-message-publish").validate(result).passed).toBe(
      false,
    );
  });
});

describe("inline UI publication identity", () => {
  it("joins the native method receipt to the actual transcript card without marker prose", () => {
    const test = interactionSurfaceTests.find(
      (test) => test.name === "inline-ui-transcript-event",
    )!;
    const result = execution("Here is a small useful card.", [
      {
        name: "inline_ui",
        arguments: {
          id: "card-1",
          code: "export default function Card(){return null}",
        },
        execution: {
          status: "complete",
          result: {
            details: {
              protocol: "native-channel-method-outcome.v1",
              value: { ok: true, id: "card-1" },
            },
          },
        },
      },
    ]);
    result.messages.push({
      id: "ui-1",
      kind: "message",
      senderId: "headless",
      complete: true,
      content: "",
      contentType: "inline_ui",
      inlineUi: {
        id: "card-1",
        source: {
          type: "code",
          code: "export default function Card(){return null}",
        },
        renderedAt: "2026-10-03T00:00:00Z",
      },
    } as TestExecutionResult["messages"][number]);
    expect(test.validate(result).passed).toBe(true);
    result.messages.at(-1)!.inlineUi!.id = "foreign-card";
    expect(test.validate(result).passed).toBe(false);
    result.messages.pop();
    expect(test.validate(result).passed).toBe(false);
  });
});

describe("bounded live service catalog", () => {
  it("joins a service-surface total to bounded service hits without using other surface counts", () => {
    const test = docsDiscoveryTests.find(
      (test) => test.name === "docs-list-services-bounded",
    )!;
    const calls = [
      {
        name: "docs_search",
        arguments: { query: "services", surface: "service", limit: 8 },
        execution: {
          status: "complete",
          result: {
            details: [
              {
                id: "service:docs.listSurfaces",
                qualifiedName: "docs.listSurfaces",
              },
            ],
          },
        },
      },
      {
        name: "eval",
        arguments: { code: "return await services.docs.listSurfaces();" },
        execution: {
          status: "complete",
          result: {
            details: {
              returnValue: [
                { surface: "runtime", count: 234 },
                { surface: "service", count: 450 },
              ],
            },
          },
        },
      },
    ];
    expect(
      test.validate(
        execution("450 service entries, including docs.listSurfaces.", calls),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution("234 service entries, including docs.listSurfaces.", calls),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("450 service entries, including inventedService.", calls),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "450 service entries, including docs.listSurfaces.",
          calls.slice(1),
        ),
      ).passed,
    ).toBe(false);
  });

  it.each([
    "const xs = await services.docs.listServices(); return {observedServiceEntries:xs.length, representatives:xs.slice(0,4).map(x=>({name:x.name,description:x.description}))};",
    "const xs = await rpc.call('main', 'docs.listServices', []); return {observedServiceEntries:xs.length, representatives:xs.slice(0,4).map(x=>({name:x.name,description:x.description}))};",
  ])(
    "accepts an enumeration summarized with its observed total: %s",
    (code) => {
      const test = docsDiscoveryTests.find(
        (test) => test.name === "docs-list-services-bounded",
      )!;
      const call = {
        name: "eval",
        arguments: {
          code,
        },
        execution: {
          status: "complete",
          result: {
            details: {
              returnValue: {
                observedServiceEntries: 51,
                surfaces: [{ surface: "service", count: 450 }],
                representatives: [
                  { name: "account", description: "profiles" },
                  { name: "presence", description: "active panels" },
                ],
              },
            },
          },
        },
      };
      expect(
        test.validate(
          execution(
            "I observed 51 registered services, including account and presence.",
            [call],
          ),
        ).passed,
      ).toBe(true);
      expect(
        test.validate(
          execution("I observed 51 services, including inventedService.", [
            call,
          ]),
        ).passed,
      ).toBe(false);
      expect(
        test.validate(
          execution("I observed 99 services, including account.", [call]),
        ).passed,
      ).toBe(false);
      expect(
        test.validate(
          execution("I observed 51 registered services, including account."),
        ).passed,
      ).toBe(false);
    },
  );
});

describe("automatic durable conversation title", () => {
  it("requires an applied title and relevant advice without an exact prose keyword", () => {
    const test = interactionSurfaceTests.find(
      (test) => test.name === "automatic-conversation-title",
    )!;
    const title = "Sunny Windowsill Garden";
    const call = {
      name: "set_title",
      arguments: { title },
      execution: { status: "complete", result: { details: { title } } },
    };
    const result = execution(
      "Grow basil, thyme and chives in pots with drainage; water each as its soil dries.",
      [call],
    );
    result.snapshot = { title } as TestExecutionResult["snapshot"];
    expect(test.validate(result).passed).toBe(true);
    result.snapshot!.title = "Unrelated title";
    expect(test.validate(result).passed).toBe(false);
    result.snapshot!.title = title;
    call.execution.result.details.title = "Unapplied title";
    const wrongReceipt = execution("Grow basil in sunny pots.", [call]);
    wrongReceipt.snapshot = { title } as TestExecutionResult["snapshot"];
    expect(test.validate(wrongReceipt).passed).toBe(false);
    expect(test.validate(execution("Grow basil in sunny pots.")).passed).toBe(
      false,
    );
  });
});

describe("native bounded host log observations", () => {
  const counts = { verbose: 0, info: 5, warn: 0, error: 0 };
  const tail = {
    protocol: "server-log-observation.v1",
    kind: "records",
    method: "tail",
    limit: 5,
    serverBootId: "boot-a",
    latestSeq: 25,
    firstSeq: 21,
    lastSeq: 25,
    count: 5,
    byLevel: counts,
    newestLevel: "info",
  };
  function call(
    receipts: unknown[],
    returnValue: unknown = { count: 5, newest: "info" },
  ) {
    return {
      name: "eval",
      arguments: { code: "return await summarizeLatestLogs();" },
      execution: {
        status: "complete",
        result: {
          details: {
            returnValue,
            operationJournal: {
              protocol: "workspace-operations.v1",
              truncated: false,
              entries: receipts.map((receipt) => ({
                type: "server-log.observation",
                receipt,
              })),
            },
          },
        },
      },
    };
  }
  it("uses native facts independently of destructuring, summaries and forged guest results", () => {
    const test = serverLogTests.find(
      (test) => test.name === "server-log-tail",
    )!;
    expect(
      test.validate(
        execution(
          "I observed 5 newest host-log entries; the newest severity is info.",
          [call([tail])],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "I observed 99 newest host-log entries; the newest severity is info.",
          [call([tail], { count: 99, newest: "info" })],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "I observed 5 newest host-log entries; the newest severity is error.",
          [call([tail])],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "I observed 5 newest host-log entries; the newest severity is info.",
          [call([])],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "I observed 5 newest host-log entries; the newest severity is info.",
          [call([{ ...tail, byLevel: { ...counts, info: 99 } }])],
        ),
      ).passed,
    ).toBe(false);
  });
  it("accepts grouped captured totals but rejects a later tail sequence substituted for statistics", () => {
    const test = serverLogTests.find(
      (test) => test.name === "server-log-query-stats",
    )!;
    const query = {
      ...tail,
      method: "query",
      limit: 100,
      minimumLevel: "warn",
      count: 2,
      byLevel: { verbose: 0, info: 0, warn: 2, error: 0 },
      newestLevel: "warn",
    };
    const stats = {
      protocol: "server-log-observation.v1",
      kind: "stats",
      latestSeq: 3366,
      totalCaptured: 3366,
      bufferSize: 20000,
      byLevel: { verbose: 0, info: 3324, warn: 39, error: 3 },
    };
    expect(
      test.validate(
        execution(
          "The host sample contains 2 warnings. Overall this boot captured 3,366 records.",
          [call([query, stats])],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "The host sample contains 2 warnings. Overall this boot captured 3,367 records. The stats snapshot was at sequence 3366.",
          [call([query, stats])],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "The host sample contains 99 warnings. Overall this boot captured 3,366 records.",
          [call([query, stats])],
        ),
      ).passed,
    ).toBe(false);
    const empty = {
      ...query,
      count: 0,
      firstSeq: null,
      lastSeq: null,
      newestLevel: null,
      byLevel: { verbose: 0, info: 0, warn: 0, error: 0 },
    };
    expect(
      test.validate(
        execution(
          "The host sample had no warnings or errors. Overall this boot captured 3,366 records.",
          [call([empty, stats])],
        ),
      ).passed,
    ).toBe(true);
  });
});
