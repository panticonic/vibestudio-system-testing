import {
  preparation,
  publicationMessages,
} from "./_project-evidence-fixtures.js";
import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import type { ChatMessage } from "@workspace/agentic-core";

import { docsProbeTests } from "./docs-probes.js";
import { projectLifecycleTests } from "./project-lifecycle.js";

function invocation(
  id: string,
  name: string,
  args: Record<string, unknown>,
  details: Record<string, unknown>,
) {
  return {
    id: `message:${id}`,
    content: "",
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
        status: "complete" as NonNullable<
          ChatMessage["invocation"]
        >["execution"]["status"],
        description: "",
        isError: false as boolean,
        result: { protocolContent: [] as Record<string, unknown>[], details },
      },
    },
  } satisfies ChatMessage;
}

function nativeUiEvidence(
  source: string,
  options: { capture?: "snapshot"; errors?: number } = {},
) {
  const id = "panel:todo";
  return {
    protocol: "workspace-operations.v1",
    truncated: false,
    entries: [
      { type: "open", id, source, kind: "workspace" },
      { type: "reload", id },
      ...[
        { action: "fill", role: "textbox", accessibleName: "Task title" },
        { action: "click", role: "button", accessibleName: "Create task" },
        { action: "fill", role: "textbox", accessibleName: "Search tasks" },
        { action: "click", role: "button", accessibleName: "Delete task" },
      ].map(({ action, ...target }) => ({
        type: "interaction",
        id,
        receipt: {
          protocol: "cdp-interaction-outcome.v1",
          action,
          delivery: "dispatched",
          target,
          effect: { status: "not-asserted" },
        },
      })),
      {
        type: "interaction",
        id,
        receipt: {
          protocol: "cdp-interaction-outcome.v1",
          action: "click",
          delivery: "dispatched",
          target: { selector: "button", accessibleName: "Complete" },
          effect: { status: "not-asserted" },
        },
      },
      options.capture === "snapshot"
        ? {
            type: "snapshot",
            id,
            receipt: {
              panelId: id,
              attemptId: "attempt:final",
              runtimeEntityId: "runtime:final",
              buildKey: "build:final",
              capturedAt: 1,
              documentKind: "synth",
            },
          }
        : {
            type: "screenshot",
            id,
            receipt: {
              capturedAt: 1,
              byteSize: 4096,
              mimeType: "image/png",
              width: 800,
              height: 600,
            },
          },
      {
        type: "consoleHistory",
        id,
        receipt: {
          capturedAt: 2,
          errorCount: options.errors ?? 0,
          droppedErrors: 0,
          errorCoverage: "full",
        },
      },
    ],
  };
}
const liveFlowCode =
  "field.fill('task'); button.click(); row.innerText(); filter.click(); active.click(); completed.click(); remove.click();";

function todoExecution(
  calls: ReturnType<typeof invocation>[],
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      { kind: "message", senderId: "user", complete: true, content: "prompt" },
      ...calls,
      ...publicationMessages(calls),
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content:
          "I observed and repaired the compiler defect, then fixed the UX and verified add, complete, filter, and delete behavior.",
      },
    ],
  } as TestExecutionResult;
}

function mutation(applicationId: string) {
  return {
    storage: "vcs",
    vcsResult: {
      applicationId,
      workingHead: { kind: "application", applicationId },
    },
  };
}

describe("project lifecycle prompts", () => {
  it("retains bounded structured diagnostics when atomic publication is rejected", async () => {
    const test = projectLifecycleTests.find(
      ({ name }) => name === "atomic-panel-store-install-clearance",
    )!;
    const error = Object.assign(new Error("Candidate build failed"), {
      name: "RemoteRpcError",
      code: "BuildGateFailed",
      errorData: {
        code: "BuildGateFailed",
        candidateState: "failed",
        affectedUnits: ["apps/mobile"],
        diagnostics: [
          { message: "Type checking failed", diagnosticHandle: "diag:mobile" },
        ],
        credentialToken: "must-not-leak",
      },
    });

    const result = await test.orchestrate!({
      runner: {
        publishAtomicPanelStoreFixture: async () => {
          throw error;
        },
      } as never,
      remainingTimeMs: () => 10_000,
      sendAndWait: async () => {
        throw new Error("Agent turn must not be used");
      },
    });

    expect(result.error).toBe("Candidate build failed");
    expect(result.failure).toEqual({
      phase: "atomic-panel-store",
      error: {
        name: "RemoteRpcError",
        message: "Candidate build failed",
        code: "BuildGateFailed",
        errorData: {
          code: "BuildGateFailed",
          candidateState: "failed",
          affectedUnits: ["apps/mobile"],
          diagnostics: [
            {
              message: "Type checking failed",
              diagnosticHandle: "diag:mobile",
            },
          ],
          credentialToken: "[redacted]",
        },
        diagnosticHandles: ["diag:mobile"],
      },
    });
  });

  it("keep panel lifecycle prompts goal-level", () => {
    const panelPrompts = projectLifecycleTests
      .filter((test) => test.name.startsWith("panel-"))
      .map((test) => test.prompt);

    expect(panelPrompts).toEqual([
      "Create a brand-new isolated panel project and open it for use.",
      "Create a brand-new isolated panel with a supported built-in database-style icon selected from this workspace's available icon catalog. Verify that it builds cleanly, then open the panel for use.",
      "Create a separate panel based on the provided panel project, leave the original unchanged, and open the new panel to confirm it works.",
      "Build a simple, polished To-Do list as a brand-new isolated panel. Begin with two small deliberate defects—one compiler error and one obvious usability problem—so the development loop has real failures to find. Observe the compiler defect through a structured compile or build check, then diagnose and repair only that failure while leaving the usability defect intact. Launch the compile-clean but visibly flawed panel, capture and visually inspect a screenshot so your UX repair is based on the rendered pixels rather than DOM text alone. Repair the usability defect in a separate source edit. Refresh the same running panel with the repaired source, capture and visually inspect a second screenshot, exercise the add, complete, filter, and delete flows in the live UI, and publish the finished result. Make the final experience keyboard-friendly, responsive, visually polished, and free of runtime or console errors. Report the defects you observed and concrete final verification.",
    ]);

    for (const prompt of panelPrompts) {
      expect(prompt).not.toMatch(
        /finish with|respond with|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/iu,
      );
      expect(prompt).not.toMatch(
        /prepareProjects|forkProject|openPanel|dryRun/iu,
      );
    }
  });

  it("declares repository creation scopes that match each lifecycle task", () => {
    const fixtureFor = (name: string) =>
      projectLifecycleTests.find((test) => test.name === name)
        ?.workspaceRepoFixture;

    expect(fixtureFor("panel-create-commit-open")).toEqual({
      kind: "created-repository",
      section: "panels",
    });
    expect(fixtureFor("panel-curated-icon-build-open")).toEqual({
      kind: "created-repository",
      section: "panels",
    });
    expect(fixtureFor("panel-fork-dry-run-and-commit")).toEqual({
      kind: "buildable-panel-with-derived",
      section: "panels",
    });
    expect(fixtureFor("commit-existing-project")).toEqual({
      kind: "created-repository",
      section: "packages",
    });
    expect(fixtureFor("worker-create-commit-publish")).toEqual({
      kind: "created-repository",
      section: "workers",
    });
    expect(fixtureFor("panel-todo-debug-polish")).toEqual({
      kind: "created-repository",
      section: "panels",
    });
    expect(fixtureFor("task-management-build-launch-debug")).toEqual({
      kind: "created-repositories",
      section: "panels",
      expectedSections: ["panels", "workers"],
    });
    expect(fixtureFor("atomic-panel-store-install-clearance")).toEqual({
      kind: "created-repositories",
      section: "panels",
      expectedSections: ["panels", "workers"],
    });
  });

  it("requires an install grant before the generated panel-store UI round trip", () => {
    const test = projectLifecycleTests.find(
      ({ name }) => name === "atomic-panel-store-install-clearance",
    )!;
    const panelPath = "panels/atomic-notes";
    const result = todoExecution([
      invocation(
        "publication",
        "eval",
        { code: "prepareProjects(); publish();" },
        {
          returnValue: [
            { created: panelPath },
            { created: "workers/atomic-notes-store" },
          ],
        },
      ),
    ]);
    result.diagnostics = {
      atomicPanelStore: {
        source: "system-test-harness",
        panelPath,
        storePath: "workers/atomic-notes-store",
        installedBeforeOpen: {
          units: [
            {
              source: panelPath,
              kind: "panel",
              effectiveVersion: "exact-version",
              authorityRows: [
                {
                  capability: "workspace-service:atomic-notes-store",
                  resourceScope: {
                    kind: "exact",
                    key: "do:workers/atomic-notes-store:NotesStore:workspace",
                  },
                  statement: "declared",
                },
              ],
            },
            {
              source: "workers/atomic-notes-store",
              kind: "worker",
              effectiveVersion: "store-version",
            },
          ],
          config: {
            services: [
              {
                source: "workers/atomic-notes-store",
                name: "atomic-notes-store",
                authority: { binding: { declaredFor: [panelPath] } },
              },
            ],
            singletonObjects: [
              {
                source: "workers/atomic-notes-store",
                className: "NotesStore",
                key: "workspace",
              },
            ],
          },
        },
        permissionsBeforeOpen: [
          {
            kind: "capability",
            repoPath: panelPath,
            effectiveVersion: "exact-version",
            authority: {
              effect: "allow",
              provenance: "install",
              scope: "version",
              decisionSurface: "publication",
              subject: `code:${panelPath}@exact-version`,
              capability: "workspace-service:atomic-notes-store",
              resource: {
                kind: "exact",
                key: "do:workers/atomic-notes-store:NotesStore:workspace",
              },
            },
          },
        ],
        permissionsAfterReload: [],
        written: "unique-note",
        afterReload: "unique-note",
        afterRebuild: "unique-note",
        before: { panelId: "panel:atomic", source: panelPath, phase: "ready" },
        after: { panelId: "panel:atomic", source: panelPath, phase: "ready" },
        rebuilt: { panelId: "panel:atomic", source: panelPath, phase: "ready" },
        rebuiltSnapshot: { panelId: "panel:atomic", phase: "ready" },
      },
    };

    expect(test.validate(result)).toEqual({ passed: true, reason: undefined });

    const withoutGrant = structuredClone(result);
    const diagnostic = withoutGrant.diagnostics?.["atomicPanelStore"] as Record<
      string,
      unknown
    >;
    diagnostic["permissionsBeforeOpen"] = [];
    expect(test.validate(withoutGrant)).toMatchObject({ passed: false });
    const withConflatedDeclarationAndGrant = structuredClone(result);
    (
      withConflatedDeclarationAndGrant.diagnostics?.["atomicPanelStore"] as {
        installedBeforeOpen: {
          units: Array<{ authorityRows?: Array<Record<string, unknown>> }>;
        };
      }
    ).installedBeforeOpen.units[0]!.authorityRows![0]!["statement"] = "allowed";
    expect(test.validate(withConflatedDeclarationAndGrant)).toMatchObject({
      passed: false,
    });
    const withRuntimeAcquisition = structuredClone(result);
    (
      withRuntimeAcquisition.diagnostics?.["atomicPanelStore"] as {
        permissionsAfterReload: unknown[];
      }
    ).permissionsAfterReload = [
      {
        authority: {
          capability: "workspace-service:atomic-notes-store",
          provenance: "acquisition",
        },
      },
    ];
    expect(test.validate(withRuntimeAcquisition)).toEqual({
      passed: false,
      reason:
        "The first panel use acquired a runtime grant after publication clearance",
    });
    for (const mutation of [
      { effectiveVersion: "wrong-version" },
      { authority: { effect: "deny" } },
      { authority: { provenance: "acquisition", scope: "session" } },
      {
        authority: {
          resource: {
            kind: "exact",
            key: "do:workers/atomic-notes-store-similar:NotesStore:workspace",
          },
        },
      },
    ]) {
      const invalid = structuredClone(result);
      const row = (
        invalid.diagnostics?.["atomicPanelStore"] as {
          permissionsBeforeOpen: Array<Record<string, unknown>>;
        }
      ).permissionsBeforeOpen[0]!;
      const originalAuthority = row["authority"] as Record<string, unknown>;
      const { authority: authorityMutation, ...rowMutation } = mutation;
      Object.assign(row, rowMutation);
      if (authorityMutation) {
        row["authority"] = {
          ...originalAuthority,
          ...authorityMutation,
        };
      }
      expect(test.validate(invalid)).toMatchObject({ passed: false });
    }
    expect(typeof test.authorityPolicy).not.toBe("function");
    const authority =
      typeof test.authorityPolicy === "function"
        ? []
        : test.authorityPolicy?.authority;
    expect(authority).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: {
            kind: "exact",
            key: "workspace-service:atomic-notes-store",
          },
        }),
      ]),
    );
  });

  it("keeps the task-management app request natural while independently validating the result", () => {
    const test = projectLifecycleTests.find(
      ({ name }) => name === "task-management-build-launch-debug",
    )!;

    expect(test.prompt).toBe(
      "Build me a full-featured task management app, then launch and debug it.",
    );
    expect(test.timeoutMs).toBe(45 * 60_000);
    expect(test.validation).toBeUndefined();
    expect(test.authorityPolicy).toEqual({
      authority: [
        {
          ruleId: "manage-panel-state",
          capability: { kind: "exact", key: "workspace.runtime-state.manage" },
          resource: { kind: "exact", key: "workspace.runtime-state.manage" },
          tier: "gated",
          decision: "once",
        },
        {
          ruleId: "manage-panel-context-boundary",
          capability: { kind: "exact", key: "context.boundary" },
          resource: { kind: "prefix", prefix: "context/" },
          tier: "critical",
          decision: "once",
        },
        {
          ruleId: "manage-panel-context-boundary-gated",
          capability: { kind: "exact", key: "context.boundary" },
          resource: { kind: "prefix", prefix: "context/" },
          tier: "gated",
          decision: "once",
        },
        {
          ruleId: "use-testkit-driver",
          capability: {
            kind: "exact",
            key: "workspace-service:testkit-driver",
          },
          resource: {
            kind: "exact",
            key: "do:workers/testkit-driver:TestkitDriverDO:workspace-testkit-driver",
          },
          tier: "gated",
          decision: "once",
        },
        {
          ruleId: "inspect-task-management-panel",
          capability: { kind: "exact", key: "panel.inspect" },
          resource: { kind: "prefix", prefix: "panel:" },
          tier: "gated",
          decision: "once",
        },
      ],
    });

    const source = "panels/task-manager";
    const result = todoExecution([
      invocation(
        "create",
        "eval",
        { code: "prepareProjects()" },
        {
          returnValue: [
            {
              created: source,
              files: ["package.json", "index.tsx"],
              preflight: {
                ok: true,
                projectType: "panel",
                checked: ["identity"],
              },
              preparation: preparation(),
            },
          ],
        },
      ),
      invocation(
        "build",
        "verify",
        { operation: "build", target: source },
        {
          receipt: {
            protocol: "unit-verification-receipt.v1",
            operation: "build",
            contextId: preparation().contextId,
            stateHash: `state:${"a".repeat(64)}`,
            status: "ok",
            target: source,
            unit: { repoPath: source, kind: "panel" },
          },
        },
      ),
      invocation(
        "runtime",
        "eval",
        {
          code:
            liveFlowCode +
            "const session = await panel.cdp.session(); await session.page.screenshot(); await panel.reload(); await session.refresh(); " +
            "const history = await panel.cdp.consoleHistory(); return { history };",
        },
        {
          operationJournal: nativeUiEvidence(source),
          returnValue: {
            storageLen: 1,
            titles: ["Manual Task"],
            hasError: false,
            completeResult: { done: "1/1" },
            clearCompleted: { remaining: 0 },
            storageCount: 0,
            afterSearch: { matches: 1 },
            afterStatus: { matches: 0 },
            history: { errors: [] },
          },
        },
      ),
    ]);
    const final = result.messages[result.messages.length - 1] as {
      content?: string;
    };
    final.content =
      "Built, launched, and debugged the task project with a clean build.";
    expect(test.validate(result)).toEqual({ passed: true, reason: undefined });
    const projected = structuredClone(result);
    const created = projected.messages.find(
      (message) => message.invocation?.id === "create",
    ) as ReturnType<typeof invocation>;
    created.invocation.execution.result.details["returnValue"] = {
      panel: source,
      worker: "workers/task-manager-store",
      preparation: preparation(),
    };
    expect(test.validate(projected)).toEqual({
      passed: true,
      reason: undefined,
    });
    const partial = structuredClone(result);
    const completedRuntime = partial.messages.find(
      (message) => message.invocation?.id === "runtime",
    ) as ReturnType<typeof invocation>;
    completedRuntime.invocation.execution.status = "error";
    completedRuntime.invocation.execution.isError = true;
    completedRuntime.invocation.execution.result.details["failureKind"] =
      "user-code";
    completedRuntime.invocation.execution.result.details["error"] =
      "Later guest expression failed";
    partial.messages.splice(
      partial.messages.length - 1,
      0,
      invocation(
        "reset-filter",
        "eval",
        {},
        {
          operationJournal: {
            protocol: "workspace-operations.v1",
            truncated: false,
            entries: [
              {
                type: "interaction",
                id: "panel:todo",
                receipt: {
                  protocol: "cdp-interaction-outcome.v1",
                  action: "fill",
                  delivery: "dispatched",
                  target: { role: "textbox", accessibleName: "Search tasks" },
                  effect: { status: "not-asserted" },
                },
              },
              {
                type: "consoleHistory",
                id: "panel:todo",
                receipt: {
                  capturedAt: 200,
                  errorCoverage: "full",
                  errorCount: 0,
                  droppedErrors: 0,
                },
              },
            ],
          },
        },
      ),
    );
    expect(test.validate(partial)).toEqual({ passed: true, reason: undefined });
    for (const count of [0, 1]) {
      const logged = structuredClone(result);
      const runtime = logged.messages.find(
        (message) => message.invocation?.id === "runtime",
      ) as ReturnType<typeof invocation>;
      runtime.invocation.arguments["code"] =
        liveFlowCode +
        "const session = await panel.cdp.session(); await session.page.screenshot(); await panel.reload(); await session.refresh(); " +
        "const history = await panel.cdp.consoleHistory(); console.log({ errors: history.errors.length });";
      const details = runtime.invocation.execution.result.details;
      const returned = details["returnValue"] as Record<string, unknown>;
      delete returned["history"];
      details["console"] = JSON.stringify({ errors: count });
      details["operationJournal"] = nativeUiEvidence(source, { errors: count });
      expect(test.validate(logged).passed).toBe(count === 0);
    }
  });

  it("joins native preflight and publication without a redundant file listing", () => {
    const test = projectLifecycleTests.find(
      ({ name }) => name === "worker-create-commit-publish",
    )!;
    const result = {
      duration: 0,
      messages: [
        {
          kind: "message",
          senderId: "user",
          complete: true,
          content: "prompt",
        },
        invocation(
          "create-worker-project",
          "eval",
          {
            code: `return prepareProjects([{ projectType: "worker", name: "isolated-worker" }]);`,
          },
          {
            returnValue: {
              created: "workers/isolated-worker",
              files: ["index.ts", "package.json"],
              preflight: {
                ok: true,
                projectType: "worker",
                checked: ["index.ts", "package.json"],
              },
              preparation: preparation(),
            },
          },
        ),
        {
          kind: "message",
          senderId: "agent",
          senderMetadata: { type: "agent" },
          complete: true,
          content: "Created.",
        },
      ],
    } as TestExecutionResult;

    result.messages.push(...publicationMessages(result.messages));
    expect(test.validate(result)).toEqual({ passed: true, reason: undefined });
    const creation = result.messages[1]! as ReturnType<typeof invocation>;
    const returned = creation.invocation.execution.result.details[
      "returnValue"
    ] as Record<string, unknown>;
    delete returned["files"];
    expect(test.validate(result)).toEqual({ passed: true, reason: undefined });
    returned["preflightOk"] = true;
    delete returned["preflight"];
    expect(test.validate(result)).toMatchObject({ passed: false });
  });

  it("accepts curated icon discovery followed by a clean build and boot-ready panel", () => {
    const test = projectLifecycleTests.find(
      ({ name }) => name === "panel-curated-icon-build-open",
    )!;
    const source = "panels/catalog-board";
    const result = {
      duration: 0,
      messages: [
        {
          kind: "message",
          senderId: "user",
          complete: true,
          content: "prompt",
        },
        invocation(
          "catalog",
          "eval",
          { code: "return listProjectIcons();" },
          { returnValue: ["lucide:database"] },
        ),
        invocation(
          "create",
          "eval",
          {
            code: "return prepareProjects([{ projectType: 'panel', icon: 'lucide:database' }]);",
          },
          {
            returnValue: {
              created: source,
              files: ["index.tsx", "package.json"],
              preflight: {
                ok: true,
                projectType: "panel",
                checked: ["index.tsx", "package.json"],
              },
              preparation: preparation(),
            },
          },
        ),
        invocation(
          "build",
          "verify",
          { operation: "build", target: source },
          {
            operation: "build",
            target: source,
            status: "ok",
            report: { diagnostics: [] },
          },
        ),
        invocation(
          "open",
          "eval",
          {
            code: "const panel = await openPanel(source); return [await panel.observe(), await panel.snapshot()];",
          },
          {
            operationJournal: {
              protocol: "workspace-operations.v1",
              truncated: false,
              entries: [
                {
                  type: "open",
                  source,
                  id: "panel:catalog",
                  kind: "workspace",
                },
              ],
            },
            returnValue: [
              {
                source,
                panelId: "panel:catalog",
                phase: "ready",
                attemptId: "attempt:catalog",
                runtimeEntityId: "runtime:catalog",
                buildKey: "build:catalog",
              },
              {
                panelId: "panel:catalog",
                attemptId: "attempt:catalog",
                runtimeEntityId: "runtime:catalog",
                buildKey: "build:catalog",
                capturedAt: 1,
                document: { kind: "synth", structure: {} },
              },
            ],
          },
        ),
        {
          kind: "message",
          senderId: "agent",
          senderMetadata: { type: "agent" },
          complete: true,
          content:
            "Created the catalog-backed panel; its build is clean and it opened successfully.",
        },
      ],
    } as TestExecutionResult;

    result.messages.push(...publicationMessages(result.messages));
    expect(test.validate(result)).toEqual({ passed: true, reason: undefined });
    const captured = structuredClone(result);
    const opened = captured.messages[4]! as ReturnType<typeof invocation>;
    const returned = opened.invocation.execution.result.details[
      "returnValue"
    ] as unknown[];
    opened.invocation.execution.result.details["returnValue"] = returned[0];
    const capture = invocation(
      "capture",
      "eval",
      { code: "return panel.cdp.screenshot();" },
      {
        operationJournal: {
          protocol: "workspace-operations.v1",
          truncated: false,
          entries: [
            {
              type: "screenshot",
              id: "panel:catalog",
              receipt: {
                capturedAt: 2,
                mimeType: "image/png",
                byteSize: 42,
              },
            },
          ],
        },
      },
    );
    capture.invocation.execution.result.protocolContent = [
      { type: "image", data: "native-image", mimeType: "image/png" },
    ];
    captured.messages.splice(5, 0, capture);
    expect(test.validate(captured).passed).toBe(true);
    capture.invocation.execution.result.protocolContent = [];
    expect(test.validate(captured).passed).toBe(false);
    capture.invocation.execution.result.protocolContent = [
      { type: "image", data: "native-image", mimeType: "image/png" },
    ];
    capture.invocation.execution.result.details["operationJournal"] = {
      protocol: "workspace-operations.v1",
      truncated: false,
      entries: [
        {
          type: "screenshot",
          id: "panel:unrelated",
          receipt: {
            capturedAt: 2,
            mimeType: "image/png",
            byteSize: 42,
          },
        },
      ],
    };
    expect(test.validate(captured).passed).toBe(false);
    const searched = structuredClone(result);
    const catalog = searched.messages[1]! as ReturnType<typeof invocation>;
    catalog.invocation.arguments = {
      code: "return searchProjectCatalog({resource:'icon',query:'database'});",
    };
    catalog.invocation.execution.result.details["returnValue"] = {
      protocol: "workspace-dev-catalog.v1",
      resource: "icon",
      entries: [{ id: "lucide:database", family: "lucide", name: "database" }],
    };
    expect(test.validate(searched)).toEqual({
      passed: true,
      reason: undefined,
    });
    catalog.invocation.execution.result.details["returnValue"] = {
      protocol: "workspace-dev-catalog.v1",
      resource: "icon",
      entries: [],
    };
    expect(test.validate(searched)).toMatchObject({ passed: false });
  });

  it("grants only panel and dependency inspection to the To-Do loop", () => {
    const test = projectLifecycleTests.find(
      ({ name }) => name === "panel-todo-debug-polish",
    )!;

    expect(test.expectedToolFailures).toEqual([
      { name: "verify", failureCode: "build_verification_failed" },
    ]);
    expect(test.authorityPolicy).toEqual({
      authority: [
        {
          ruleId: "manage-panel-state",
          capability: { kind: "exact", key: "workspace.runtime-state.manage" },
          resource: { kind: "exact", key: "workspace.runtime-state.manage" },
          tier: "gated",
          decision: "once",
        },
        {
          ruleId: "manage-panel-context-boundary",
          capability: { kind: "exact", key: "context.boundary" },
          resource: { kind: "prefix", prefix: "context/" },
          tier: "critical",
          decision: "once",
        },
        {
          ruleId: "manage-panel-context-boundary-gated",
          capability: { kind: "exact", key: "context.boundary" },
          resource: { kind: "prefix", prefix: "context/" },
          tier: "gated",
          decision: "once",
        },
        {
          ruleId: "use-testkit-driver",
          capability: {
            kind: "exact",
            key: "workspace-service:testkit-driver",
          },
          resource: {
            kind: "exact",
            key: "do:workers/testkit-driver:TestkitDriverDO:workspace-testkit-driver",
          },
          tier: "gated",
          decision: "once",
        },
        {
          ruleId: "inspect-created-panel",
          capability: { kind: "exact", key: "panel.inspect" },
          resource: { kind: "prefix", prefix: "panel:" },
          tier: "gated",
          decision: "once",
        },
        {
          ruleId: "inspect-screenshot-analysis-dependency",
          capability: { kind: "exact", key: "workspace.dependencies.inspect" },
          resource: { kind: "exact", key: "workspace.dependencies.inspect" },
          tier: "gated",
          decision: "once",
        },
      ],
    });
  });

  it("accepts canonical panel operations that combine build and browser evidence", () => {
    const test = projectLifecycleTests.find(
      ({ name }) => name === "panel-todo-debug-polish",
    )!;
    const source = "panels/todo";
    const uxApplicationId = "application:ux";
    const calls = [
      invocation(
        "create",
        "eval",
        { code: "prepareProjects()" },
        {
          returnValue: {
            created: source,
            files: 2,
            preflight: {
              ok: true,
              projectType: "panel",
              checked: ["package.json"],
            },
            preparation: preparation(),
          },
        },
      ),
      invocation(
        "broken-edit",
        "write",
        { path: `${source}/src.tsx` },
        mutation("application:broken"),
      ),
      invocation(
        "broken-build",
        "eval",
        { code: `getBuildReport("${source}")` },
        {
          returnValue: {
            status: "failed",
            diagnostics: [
              { severity: "error", source: "tsc", message: "Expected token" },
            ],
            builds: [{ target: "runtime", diagnostics: 1 }],
          },
        },
      ),
      invocation(
        "compiler-repair",
        "write",
        { path: `${source}/src.tsx` },
        mutation("application:compiler"),
      ),
      invocation(
        "clean-launch-and-inspect",
        "eval",
        { code: "openPanel(); handle.cdp.page(); handle.snapshot();" },
        {
          operationJournal: {
            protocol: "workspace-operations.v1",
            truncated: false,
            entries: [
              { type: "open", id: "panel:todo", source, kind: "workspace" },
              {
                type: "snapshot",
                id: "panel:todo",
                receipt: {
                  panelId: "panel:todo",
                  runtimeEntityId: "runtime:initial",
                  buildKey: "build:initial",
                  capturedAt: 1,
                  documentKind: "synth",
                },
              },
            ],
          },
          returnValue: [
            {
              source,
              phase: "ready",
              runtimeEntityId: "runtime:initial",
              buildKey: "build:initial",
            },
            {
              panelId: "panel:todo",
              runtimeEntityId: "runtime:initial",
              buildKey: "build:initial",
              capturedAt: 1,
              document: { kind: "synth", text: "Flawed todo" },
            },
          ],
        },
      ),
      invocation(
        "read-flawed-screenshot",
        "read",
        { target: "file:/.tmp/todo-flawed-123", kind: "file" },
        {
          path: "/.tmp/todo-flawed-123",
          mimeType: "image/png",
          size: 4096,
          dimensions: { width: 800, height: 600 },
        },
      ),
      invocation(
        "ux-repair",
        "write",
        { path: `${source}/src.tsx` },
        mutation(uxApplicationId),
      ),
      invocation(
        "rebuild-and-verify",
        "eval",
        {
          code: "handle.rebuild(); handle.cdp.page(); screenshot(); field.fill('task'); button.click(); row.evaluate(() => true); filter.click(); active.click(); completed.click(); remove.click(); const consoleHistory = await handle.cdp.consoleHistory(); return { consoleErrors: consoleHistory.errors.length };",
        },
        {
          operationJournal: nativeUiEvidence(source),
          returnValue: [
            {
              source,
              phase: "ready",
              runtimeEntityId: "runtime:final",
              buildKey: "build:final",
            },
            { consoleErrors: 0 },
          ],
        },
      ),
      invocation(
        "read-repaired-screenshot",
        "read",
        { target: "file:/.tmp/todo-repaired-456", kind: "file" },
        {
          path: "/.tmp/todo-repaired-456",
          mimeType: "image/png",
          size: 6144,
          dimensions: { width: 800, height: 600 },
        },
      ),
      invocation(
        "commit",
        "vcs",
        { operation: "commit", message: "Polish To-Do UX" },
        {
          operation: "commit",
          result: {
            committedApplicationIds: [uxApplicationId],
            event: { kind: "event", eventId: "event:ux" },
          },
        },
      ),
      invocation(
        "push",
        "push",
        {},
        {
          result: { eventId: "event:ux", mainEventId: "event:ux" },
        },
      ),
    ];

    expect(test.validate(todoExecution(calls))).toEqual({
      passed: true,
      reason: undefined,
    });

    // The native receipts are the evidence; eval spelling does not define a
    // browser verification protocol.
    const renamed = structuredClone(calls);
    const renamedCall = renamed.find(
      (entry) => entry.invocation.id === "rebuild-and-verify",
    )!;
    renamedCall.invocation.arguments["code"] =
      "handle.rebuild(); return finalRenderedState;";
    expect(test.validate(todoExecution(renamed))).toEqual({
      passed: true,
      reason: undefined,
    });
    const splitInspection = calls.flatMap((call) => {
      if (call.invocation.id !== "clean-launch-and-inspect") return [call];
      const journal = call.invocation.execution.result.details[
        "operationJournal"
      ] as {
        protocol: string;
        truncated: boolean;
        entries: Array<Record<string, unknown>>;
      };
      return [
        invocation(
          "open-initial",
          "eval",
          { code: "scope.handle = await openPanel(source);" },
          {
            returnValue:
              call.invocation.execution.result.details["returnValue"],
            operationJournal: {
              ...journal,
              entries: journal.entries.filter((e) => e["type"] === "open"),
            },
          },
        ),
        invocation(
          "inspect-initial",
          "eval",
          { code: "return await scope.handle.snapshot();" },
          {
            operationJournal: {
              ...journal,
              entries: journal.entries.filter((e) => e["type"] === "snapshot"),
            },
          },
        ),
      ];
    });
    expect(test.validate(todoExecution(splitInspection))).toEqual({
      passed: true,
      reason: undefined,
    });
    const structuredVerify = calls.map((call) =>
      call.invocation.id === "broken-build"
        ? invocation(
            "broken-build",
            "verify",
            { operation: "build", target: source },
            {
              receipt: {
                protocol: "unit-verification-receipt.v1",
                operation: "build",
                target: source,
                stateHash: "state:broken",
                unit: { repoPath: source, kind: "panel" },
                status: "failed",
              },
              report: {
                repoPath: source,
                kind: "panel",
                stateHash: "state:broken",
                status: "failed",
                builds: [{ target: "runtime" }],
                diagnostics: [
                  {
                    severity: "error",
                    source: "tsc",
                    message: "Expected token",
                  },
                ],
              },
            },
          )
        : call,
    );
    const failedVerify = structuredVerify.find(
      (call) => call.invocation.id === "broken-build",
    )!;
    failedVerify.invocation.execution.status = "error";
    failedVerify.invocation.execution.isError = true;
    failedVerify.invocation.execution.result.details["failureKind"] =
      "user-code";
    failedVerify.invocation.execution.result.details["failureCode"] =
      "build_verification_failed";
    expect(test.validate(todoExecution(structuredVerify))).toEqual({
      passed: true,
      reason: undefined,
    });
    const wrongVerify = structuredClone(structuredVerify);
    wrongVerify.find(
      (call) => call.invocation.id === "broken-build",
    )!.invocation.execution.result.details["report"] = {
      repoPath: "panels/other",
      kind: "panel",
      stateHash: "state:broken",
      status: "failed",
      diagnostics: [
        { severity: "error", source: "tsc", message: "Expected token" },
      ],
    };
    expect(test.validate(todoExecution(wrongVerify)).passed).toBe(false);
    for (const missingName of [
      "Task title",
      "Create task",
      "Complete",
      "Search tasks",
      "Delete task",
    ]) {
      const incomplete = structuredClone(calls);
      const verification = incomplete.find(
        (entry) => entry.invocation.id === "rebuild-and-verify",
      )!;
      const native = verification.invocation.execution.result.details[
        "operationJournal"
      ] as {
        entries: Array<{ receipt?: { target?: { accessibleName?: string } } }>;
      };
      native.entries = native.entries.filter(
        (entry) => entry.receipt?.target?.accessibleName !== missingName,
      );
      expect(
        test.validate(todoExecution(incomplete)).passed,
        `missing native ${missingName}`,
      ).toBe(false);
    }

    for (const variant of [
      "truncated",
      "wrong-panel",
      "filtered",
      "dropped",
      "stale-console",
      "stale-capture",
      "later-error",
    ]) {
      const altered = structuredClone(calls);
      const call = altered.find(
        (entry) => entry.invocation.id === "rebuild-and-verify",
      )!;
      const journal = call.invocation.execution.result.details[
        "operationJournal"
      ] as { truncated: boolean; entries: Array<Record<string, unknown>> };
      const consoleEntry = journal.entries.find(
        (entry) => entry["type"] === "consoleHistory",
      )!;
      const receipt = consoleEntry["receipt"] as Record<string, unknown>;
      if (variant === "truncated") journal.truncated = true;
      if (variant === "wrong-panel") consoleEntry["id"] = "panel:unrelated";
      if (variant === "filtered") receipt["errorCoverage"] = "filtered";
      if (variant === "dropped") receipt["droppedErrors"] = 1;
      if (variant === "stale-console")
        journal.entries.unshift(journal.entries.pop()!);
      if (variant === "stale-capture") {
        const captureIndex = journal.entries.findIndex(
          (entry) => entry["type"] === "screenshot",
        );
        journal.entries.unshift(journal.entries.splice(captureIndex, 1)[0]!);
      }
      if (variant === "later-error")
        journal.entries.push({
          ...consoleEntry,
          receipt: { ...receipt, errorCount: 1 },
        });
      expect(test.validate(todoExecution(altered)).passed, variant).toBe(false);
    }

    const typedGuestFailure = {
      kind: "message" as const,
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation" as const,
      invocation: {
        id: "expected-guest-failure",
        name: "eval",
        arguments: { code: "throw new Error('deliberate development probe')" },
        execution: {
          status: "error",
          terminalOutcome: "tool_error",
          terminalReasonCode: "guest_execution_failed",
          failureKind: "user-code",
          isError: true,
          result: {
            protocolContent: [],
            details: {
              success: false,
              failureKind: "user-code",
              failureCode: "guest_execution_failed",
            },
          },
        },
      },
    };
    expect(
      test.validate(
        todoExecution([typedGuestFailure, ...calls] as typeof calls),
      ),
    ).toEqual({
      passed: true,
      reason: undefined,
    });

    const screenshotWithoutModelVision = calls.filter(
      (call) => !call.invocation.id.startsWith("read-"),
    );
    expect(test.validate(todoExecution(screenshotWithoutModelVision))).toEqual({
      passed: false,
      reason:
        "The agent did not read the compile-clean flawed panel screenshot as image content before choosing the UX repair",
    });

    const nativeImages = screenshotWithoutModelVision.map((call) => {
      if (
        !["clean-launch-and-inspect", "rebuild-and-verify"].includes(
          call.invocation.id,
        )
      )
        return call;
      const result = call.invocation.execution.result;
      return {
        ...call,
        invocation: {
          ...call.invocation,
          execution: {
            ...call.invocation.execution,
            result: {
              ...result,
              protocolContent: [
                {
                  type: "image",
                  mimeType: "image/png",
                  data: "rendered-pixels",
                },
              ],
              details: {
                ...result.details,
                operationJournal: nativeUiEvidence(source),
              },
            },
          },
        },
      };
    });
    expect(test.validate(todoExecution(nativeImages))).toEqual({
      passed: true,
      reason: undefined,
    });

    const wrongBuildIdentity = calls.map((call) =>
      call.invocation.id === "broken-build"
        ? invocation("broken-build", "eval", call.invocation.arguments, {
            returnValue: {
              repoPath: "panels/unrelated",
              kind: "panel",
              status: "failed",
              diagnostics: [
                { severity: "error", source: "tsc", message: "Expected token" },
              ],
              builds: [],
            },
          })
        : call,
    );
    expect(test.validate(todoExecution(wrongBuildIdentity)).passed).toBe(false);

    const pageAcquisitionWithoutInspection = calls.map((call) =>
      call.invocation.id === "clean-launch-and-inspect"
        ? invocation(
            "clean-launch-and-inspect",
            "eval",
            { code: "openPanel(); handle.cdp.page();" },
            {
              ...call.invocation.execution.result.details,
              operationJournal: {
                protocol: "workspace-operations.v1",
                truncated: false,
                entries: [
                  { type: "open", id: "panel:todo", source, kind: "workspace" },
                ],
              },
            },
          )
        : call,
    );
    expect(
      test.validate(todoExecution(pageAcquisitionWithoutInspection)).passed,
    ).toBe(false);

    const canonicalSnapshotEvidence = calls.map((call) =>
      call.invocation.id === "rebuild-and-verify"
        ? invocation(
            "rebuild-and-verify",
            "eval",
            {
              code: "handle.rebuild(); handle.cdp.page(); field.fill('task'); button.click(); row.evaluate(() => true); filter.click(); active.click(); completed.click(); remove.click(); const before = await handle.cdp.consoleHistory(); const snapshot = await handle.snapshot(); const after = await handle.cdp.consoleHistory(); return { beforeErrors: before.errors, afterErrors: after.errors, snapshot };",
            },
            {
              operationJournal: nativeUiEvidence(source, {
                capture: "snapshot",
              }),
              returnValue: [
                {
                  source,
                  phase: "ready",
                  runtimeEntityId: "runtime:final",
                  buildKey: "build:final",
                },
                {
                  beforeErrors: [],
                  afterErrors: [],
                  snapshot: {
                    panelId: "panel:todo",
                    runtimeEntityId: "runtime:final",
                    buildKey: "build:final",
                    capturedAt: 1,
                    document: { kind: "synth", text: "Todo" },
                  },
                },
              ],
            },
          )
        : call,
    );
    expect(test.validate(todoExecution(canonicalSnapshotEvidence))).toEqual({
      passed: true,
      reason: undefined,
    });

    const dirtyPostInteractionConsole = canonicalSnapshotEvidence.map((call) =>
      call.invocation.id === "rebuild-and-verify"
        ? invocation("rebuild-and-verify", "eval", call.invocation.arguments, {
            operationJournal: nativeUiEvidence(source, {
              capture: "snapshot",
              errors: 1,
            }),
            returnValue: [
              {
                source,
                phase: "ready",
                runtimeEntityId: "runtime:final",
                buildKey: "build:final",
              },
              {
                beforeErrors: [],
                afterErrors: [{ level: "error", text: "interaction failed" }],
                snapshot: {
                  panelId: "panel:todo",
                  runtimeEntityId: "runtime:final",
                  buildKey: "build:final",
                  capturedAt: 1,
                  document: { kind: "synth", text: "Todo" },
                },
              },
            ],
          })
        : call,
    );
    expect(
      test.validate(todoExecution(dirtyPostInteractionConsole)).passed,
    ).toBe(false);

    const fabricatedConsoleEvidence = calls.map((call) =>
      call.invocation.id === "rebuild-and-verify"
        ? invocation(
            "rebuild-and-verify",
            "eval",
            {
              code: "handle.rebuild(); handle.cdp.page(); screenshot(); field.fill('task'); button.click(); row.evaluate(() => true); filter.click(); active.click(); completed.click(); remove.click(); await handle.cdp.consoleHistory(); return { consoleErrors: 0 };",
            },
            {
              returnValue:
                call.invocation.execution.result.details["returnValue"],
            },
          )
        : call,
    );
    expect(test.validate(todoExecution(fabricatedConsoleEvidence))).toEqual({
      passed: false,
      reason:
        "No final live-panel verification rebuilt the same panel, exercised add/complete/filter/delete behavior, captured the UI, and returned an empty console error list",
    });
  });

  it("asks the worker case to execute the dry run its validator observes", () => {
    const worker = projectLifecycleTests.find(
      (test) => test.name === "worker-fork-classmap-dry-run",
    );

    expect(worker?.prompt).toBe(
      "Preview a separate copy of the existing worker and confirm the original remains unchanged.",
    );
    expect(worker?.prompt).not.toMatch(/forkProject|dryRun\s*:/u);
  });

  it("keeps docs workspace-dev probe broad", () => {
    const probe = docsProbeTests.find(
      (test) => test.name === "docs-workspace-dev-change-loop",
    );
    expect(probe?.workspaceRepoFixture).toEqual({
      kind: "created-repository",
      section: "panels",
    });
    expect(probe?.resources).toContain("workerd:panel-automation");

    expect(probe?.prompt).toContain(
      "Create, publish, and inspect a tiny isolated panel project.",
    );
    expect(probe?.prompt).not.toContain("Unknown build unit");
    expect(probe?.prompt).not.toContain("do not emit the success markers");
    expect(probe?.prompt).not.toContain(
      "Close any temporary opened panel handle",
    );
  });
});
