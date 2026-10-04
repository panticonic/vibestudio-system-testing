import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { vcsTests } from "./vcs.js";

function invocation(
  id: string,
  name: string,
  args: Record<string, unknown>,
  details: Record<string, unknown>,
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
      arguments: args,
      execution: {
        status: "complete",
        isError: false,
        result: { protocolContent: [], details },
      },
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

function mutation(applicationId: string, changeId: string) {
  return {
    storage: "vcs",
    vcsResult: {
      contextId: "context:test",
      workUnitId: `work:${applicationId}`,
      applicationId,
      changeCount: 1,
      changeIds: [changeId],
      incorporatedChangeCount: 0,
      incorporatedChangeIds: [],
      workingHead: { kind: "application", applicationId },
    },
  };
}

function commit(
  eventId: string,
  applicationIds: string[],
  sourceEventId: string | null = null,
) {
  return {
    operation: "commit",
    result: {
      contextId: "context:test",
      event: { kind: "event", eventId },
      committedApplicationIds: applicationIds,
      integrationSourceEventIds: [sourceEventId],
    },
    status: status(eventId).result,
  };
}

function status(eventId: string) {
  return {
    operation: "status",
    result: {
      contextId: "context:test",
      committed: { kind: "event", eventId },
      workingHead: { kind: "event", eventId },
      clean: true,
      mainEventId: "event:main",
      mainRelation: "ahead",
      workingCounts: { applications: 0, workUnits: 0, changes: 0 },
      integrating: [],
    },
  };
}

describe("joined VCS scenario validators", () => {
  it("accepts explicitly abbreviated event presentation and rejects mismatching prefixes or suffixes", () => {
    const test = vcsTests.find(
      ({ name }) => name === "vcs-status-orientation",
    )!;
    const hash = "5a6956bb" + "a".repeat(51) + "f554a";
    const eventId = `workspace-event:${hash}`;
    const value = status(eventId);
    value.result.mainEventId = eventId;
    value.result.mainRelation = "at";
    const call = invocation("status", "vcs", { operation: "status" }, value);
    expect(
      test.validate(
        execution(
          "Working and committed are on main, clean, at workspace-event:5a6956bb…f554a.",
          [call],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(
          "Working and committed are on main, clean, at workspace-event:ffffffff…f554a.",
          [call],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          "Working and committed are on main, clean, at workspace-event:5a6956bb…fffff.",
          [call],
        ),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution("Working and committed are on main, dirty.", [call]),
      ).passed,
    ).toBe(false);
    expect(
      test.validate(
        execution(
          `There are no local changes. The working state and protected main both point to ${eventId}; the workspace is clean and matches the version shared with the team.`,
          [call],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(
        execution(`Clean, but ahead of main at ${eventId}.`, [call]),
      ).passed,
    ).toBe(false);
  });
  it("accepts natural status reporting only when backed by a canonical read-only status", () => {
    const test = vcsTests.find(
      ({ name }) => name === "vcs-status-orientation",
    )!;
    const call = invocation(
      "status",
      "vcs",
      { operation: "status" },
      status("event:current"),
    );
    const report =
      "The context is clean and ahead of protected main event:main; both its committed and working identity are event:current.";

    expect(test.prompt).not.toMatch(
      /VCS_STATUS_OK|clean:|committed:|working:|relation:/u,
    );
    expect(test.validate(execution(report, [call]))).toEqual({ passed: true });

    const mutating = invocation(
      "write",
      "write",
      { path: "projects/demo/a.ts" },
      mutation("application:unexpected", "change:unexpected"),
    );
    expect(test.validate(execution(report, [call, mutating])).passed).toBe(
      false,
    );
  });

  it("requires a true working-application comparison without an intervening commit", () => {
    const test = vcsTests.find(
      ({ name }) => name === "vcs-local-working-compare",
    )!;
    const compared = invocation(
      "compare:local",
      "vcs",
      { operation: "compare", view: "local" },
      {
        operation: "compare",
        result: {
          page: 1,
          resolution: {
            complete: false,
            remainingCoordinateCount: 1,
            concluded: false,
          },
          counts: {
            adopt: 1,
            convergent: 0,
            composed: 0,
            conflict: 0,
            resolved: 0,
          },
          intentCounts: { pending: 1 },
          coordinateCount: 1,
          intentsTruncated: false,
          continuation: null,
        },
      },
    );

    expect(
      test.validate(
        execution("The local comparison found the intended file update.", [
          compared,
        ]),
      ),
    ).toEqual({ passed: true });
    const incomplete = invocation(
      "compare:partial",
      "vcs",
      { operation: "compare", view: "local" },
      {
        operation: "compare",
        result: {
          ...(compared.invocation.execution.result.details["result"] as Record<
            string,
            unknown
          >),
          continuation: { operation: "compare", ref: "@next" },
        },
      },
    );
    expect(
      test.validate(execution("Compared the local state.", [incomplete]))
        .passed,
    ).toBe(false);
    const committed = invocation(
      "commit",
      "vcs",
      { operation: "commit", message: "Too early" },
      commit("event:committed", ["application:working"]),
    );
    expect(
      test.validate(
        execution("The local comparison found the intended file update.", [
          committed,
          compared,
        ]),
      ).passed,
    ).toBe(false);
  });

  it("joins two application results through the whole-chain commit and final clean status", () => {
    const test = vcsTests.find(
      ({ name }) => name === "vcs-edit-whole-chain-commit",
    )!;
    const eventId = "event:whole-chain";
    const calls = [
      invocation(
        "edit:1",
        "edit",
        { path: "projects/demo/a.ts" },
        mutation("application:1", "change:1"),
      ),
      invocation(
        "edit:2",
        "edit",
        { path: "projects/demo/a.ts" },
        mutation("application:2", "change:2"),
      ),
      invocation(
        "commit",
        "vcs",
        { operation: "commit", message: "Two steps" },
        commit(eventId, ["application:1", "application:2"]),
      ),
    ];
    const final = `Both related edits are now one clean milestone at ${eventId}.`;
    expect(test.validate(execution(final, calls))).toEqual({
      passed: true,
      reason: undefined,
    });
    expect(
      test.validate(
        execution(
          "Both edits are committed as one clean local milestone.",
          calls,
        ),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(execution("Committed at event:unrelated.", calls)).passed,
    ).toBe(false);

    // The clean state is canonical tool evidence, not a prose claim. A model
    // may summarize it naturally while the commit's atomic post-status still
    // proves the exact committed event is clean.
    const naturalFinal = `The complete two-step chain is committed at ${eventId}; the working tree is clean.`;
    expect(test.validate(execution(naturalFinal, calls))).toEqual({
      passed: true,
      reason: undefined,
    });

    const dirtyCalls = [...calls];
    dirtyCalls[2] = invocation(
      "commit",
      "vcs",
      { operation: "commit", message: "Two steps" },
      {
        ...commit(eventId, ["application:1", "application:2"]),
        status: {
          ...status(eventId).result,
          clean: false,
          workingCounts: { applications: 1, workUnits: 1, changes: 1 },
          integrating: [],
        },
      },
    );
    expect(test.validate(execution(naturalFinal, dirtyCalls)).passed).toBe(
      false,
    );

    const fabricated = [...calls];
    fabricated[2] = invocation(
      "commit",
      "vcs",
      { operation: "commit", message: "Two steps" },
      commit(eventId, ["application:1", "application:unrelated"]),
    );
    expect(test.validate(execution(final, fabricated)).passed).toBe(false);
  });

  it("rejects publication evidence whose protected-main identity is not the committed event", () => {
    const test = vcsTests.find(({ name }) => name === "vcs-push")!;
    const eventId = "event:published";
    const calls = [
      invocation(
        "edit",
        "write",
        { path: "projects/demo/a.ts" },
        mutation("application:push", "change:push"),
      ),
      invocation(
        "commit",
        "vcs",
        { operation: "commit", message: "Publish" },
        commit(eventId, ["application:push"]),
      ),
      invocation(
        "push",
        "vcs",
        { operation: "push" },
        {
          operation: "push",
          result: { eventId, mainEventId: eventId },
        },
      ),
    ];
    const final = `The committed milestone ${eventId} is now protected main.`;
    expect(test.validate(execution(final, calls))).toEqual({
      passed: true,
      reason: undefined,
    });
    expect(
      test.validate(
        execution("The change was accepted and published for the team.", calls),
      ).passed,
    ).toBe(true);
    expect(
      test.validate(execution("Published event:unrelated.", calls)).passed,
    ).toBe(false);

    const unjoined = [...calls];
    unjoined[2] = invocation(
      "push",
      "vcs",
      { operation: "push" },
      {
        operation: "push",
        result: { eventId, mainEventId: "event:other" },
      },
    );
    expect(test.validate(execution(final, unjoined)).passed).toBe(false);
  });

  it("joins complete public merge and publication receipts with both retained file origins", () => {
    const test = vcsTests.find(({ name }) => name === "vcs-incremental-integration")!;
    const source = "event:source", integrated = "event:integrated", local = "event:local";
    const calls = [
      invocation("local", "vcs", { operation: "commit" }, commit(local, ["application:local"])),
      invocation("source", "vcs", { operation: "push" }, { result: { eventId: source, mainEventId: source } }),
      invocation("compare", "vcs", { operation: "compare", base: source }, { result: { files: [] } }),
      invocation("merge", "vcs", { operation: "merge", source }, { result: {
        status: "working", resolution: { complete: true, concluded: true, remainingCoordinateCount: 0 },
      } }),
      invocation("integrated", "vcs", { operation: "commit" }, commit(integrated, ["application:integration"], source)),
      invocation("status", "vcs", { operation: "status" }, status(integrated)),
      invocation("push", "vcs", { operation: "push" }, { result: { eventId: integrated, mainEventId: integrated } }),
      ...[local, source].map((origin, index) => invocation(`read-${index}`, "read", { path: `projects/demo/note-${index}.md` }, {
        provenance: { status: "attached", state: { kind: "event", eventId: integrated }, episodes: [{
          commit: { event: { kind: "event", eventId: origin } },
          arrival: index === 1 ? { mode: "arrived", decision: { decisionId: "decision:composed" }, parentIntents: [{ role: "source", intent: { tier: "stated", text: "Add collaborator note" } }] } : null,
        }] },
      })),
    ];
    const final = "Both compatible notes are present in the clean published result.";
    expect(test.validate(execution(final, calls)).passed).toBe(true);
    for (const index of [0, 1, 2, 3, 4, 6, 7, 8]) {
      expect(test.validate(execution(final, calls.filter((_, i) => i !== index))).passed).toBe(false);
    }
    const dirty = structuredClone(calls);
    dirty[5]!.invocation.execution.result.details = status(integrated);
    (dirty[5]!.invocation.execution.result.details as ReturnType<typeof status>).result.clean = false;
    expect(test.validate(execution(final, dirty)).passed).toBe(false);
    const wrong = structuredClone(calls);
    wrong[3]!.invocation.arguments = { operation: "merge", source: "event:unrelated" };
    expect(test.validate(execution(final, wrong)).passed).toBe(false);
    const stale = structuredClone(calls);
    (stale[7]!.invocation.execution.result.details as { provenance: { state: { eventId: string } } }).provenance.state.eventId = local;
    expect(test.validate(execution(final, stale)).passed).toBe(false);
  });

});
