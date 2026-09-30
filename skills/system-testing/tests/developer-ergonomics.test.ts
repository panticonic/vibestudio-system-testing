import {
  preparation,
  publicationMessages,
} from "./_project-evidence-fixtures.js";
import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { developerErgonomicsTests } from "./developer-ergonomics.js";

function call<T extends Record<string, unknown>>(
  id: string,
  name: string,
  args: Record<string, unknown>,
  details: T,
  failed = false,
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
        status: failed ? ("error" as const) : ("complete" as const),
        isError: failed,
        ...(failed
          ? { failureKind: "user-code", failureCode: "guest_execution_failed" }
          : {}),
        result: { protocolContent: [], details },
      },
    },
  };
}

function execution(calls: ReturnType<typeof call>[]): TestExecutionResult {
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
          "The requested recovery and final verification completed successfully.",
      },
    ],
  } as TestExecutionResult;
}

function failure(code: string, data: Record<string, unknown>) {
  return {
    failure: {
      protocol: "agent-tool-failure.v1",
      code,
      kind: "conflict",
      message: code,
      operation: "tool.execute",
      stage: "execute",
      retry: {
        policy: "reobserve",
        commandIdPolicy: "use-new-after-reobserve",
      },
      recovery: data["recovery"],
      causes: [{ role: "primary", code, message: code }],
      data,
    },
  };
}

function receipt(target: string, status: "ok" | "failed") {
  return {
    protocol: "unit-verification-receipt.v1",
    operation: "build",
    stateHash: `state:${"a".repeat(64)}`,
    target,
    contextId: "context:test",
    ref: "ctx:context:test",
    reportDigest: "a".repeat(64),
    unit: { repoPath: target, kind: "package" },
    status,
    builds: [{ target: "library:panel", buildKey: "b".repeat(64) }],
    diagnostics: {
      total: status === "failed" ? 60 : 0,
      retained: status === "failed" ? 40 : 0,
      truncated: status === "failed" ? 20 : 0,
    },
  };
}

function scenario(name: string) {
  return developerErgonomicsTests.find((test) => test.name === name)!;
}

describe("developer ergonomics scenarios", () => {
  it("registers the focused regression names and induced failure policy", () => {
    expect(developerErgonomicsTests.map((test) => test.name)).toEqual([
      "recoverable-infrastructure-failure-continues-turn",
      "invalid-icon-discover-recover-create",
      "failed-build-bounded-diagnostics",
      "extensionless-screenshot-resource-read",
      "panel-rebuild-reacquire-and-interact",
      "write-edit-unified-matching-provenance",
      "stale-edit-reobserve-and-apply",
    ]);
    expect(
      developerErgonomicsTests.every((test) => test.validation !== "harness"),
    ).toBe(true);
    expect(
      scenario("failed-build-bounded-diagnostics").expectedToolFailures,
    ).toEqual([{ name: "verify", failureCode: "build_verification_failed" }]);
    expect(
      scenario("recoverable-infrastructure-failure-continues-turn")
        .expectedToolFailures,
    ).toEqual([{ name: "eval", failureCode: "recoverable_infrastructure_probe" }]);
    expect(
      scenario("invalid-icon-discover-recover-create").expectedToolFailures,
    ).toEqual([{ name: "eval", failureCode: "project_icon_invalid" }]);
    expect(
      scenario("stale-edit-reobserve-and-apply").expectedToolFailures,
    ).toBeUndefined();
  });

  it("requires a recoverable infrastructure failure followed by same-turn completion", () => {
    const recoverable = call(
      "recoverable-infrastructure",
      "eval",
      { code: "throw recoverable;" },
      failure("recoverable_infrastructure_probe", {
        kind: "infrastructure",
        recovery: {
          action: "reobserve",
          instruction: "Continue this same turn.",
        },
      }),
      true,
    );
    (
      recoverable.invocation
        .execution as typeof recoverable.invocation.execution & {
        terminalOutcome?: string;
      }
    ).terminalOutcome = "infrastructure_error";

    const result = execution([recoverable]);
    const final = result.messages.at(-1) as { content?: string };
    final.content = "RECOVERED_IN_SAME_TURN";

    expect(
      scenario("recoverable-infrastructure-failure-continues-turn").validate(
        result,
      ),
    ).toEqual({
      passed: true,
      reason: undefined,
    });
  });

  it("accepts the eval transport's direct typed error data", () => {
    const recoverable = call(
      "recoverable-infrastructure",
      "eval",
      { code: "throw recoverable;" },
      {
        success: false,
        failureCode: "recoverable_infrastructure_probe",
        failureKind: "infrastructure",
        errorData: {
          code: "recoverable_infrastructure_probe",
          failureKind: "infrastructure",
          recovery: {
            action: "reobserve",
            instruction: "Continue this same turn.",
          },
        },
      },
      true,
    );
    Object.assign(recoverable.invocation.execution, {
      terminalOutcome: "infrastructure_error",
      failureCode: "recoverable_infrastructure_probe",
      failureKind: "infrastructure",
    });

    const result = execution([recoverable]);
    const final = result.messages.at(-1) as { content?: string };
    final.content = "RECOVERED_IN_SAME_TURN";

    expect(
      scenario("recoverable-infrastructure-failure-continues-turn").validate(
        result,
      ),
    ).toEqual({
      passed: true,
      reason: undefined,
    });
  });

  it("accepts typed invalid-icon correction followed by bounded discovery and creation", () => {
    const catalog = {
      protocol: "workspace-dev-catalog.v1",
      resource: "icon",
      query: "columns-3x",
      total: 39,
      entries: [
        { id: "lucide:columns-3", family: "lucide", name: "columns-3" },
      ],
      truncated: 38,
    };
    const rejected = call(
      "invalid-icon",
      "eval",
      { code: "return prepareProjects(requested);" },
      failure("project_icon_invalid", {
        recovery: {
          action: "correct-request",
          instruction: "Choose from the catalog",
        },
        catalog,
      }),
      true,
    );
    const discovered = call(
      "catalog",
      "eval",
      { code: "return searchProjectCatalog(query);" },
      { returnValue: catalog },
    );
    const created = call(
      "created",
      "eval",
      { code: "return prepareProjects(corrected);" },
      {
        returnValue: {
          created: "panels/columns-board",
          preflight: { ok: true, projectType: "panel" },
          preparation: preparation(),
        },
      },
    );

    expect(
      scenario("invalid-icon-discover-recover-create").validate(
        execution([rejected, discovered, created]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts proactive bounded discovery that avoids the invalid-icon failure", () => {
    const catalog = {
      protocol: "workspace-dev-catalog.v1",
      resource: "icon",
      query: "columns-3x",
      total: 39,
      entries: [
        { id: "lucide:columns-3", family: "lucide", name: "columns-3" },
      ],
      truncated: 38,
    };
    const discovered = call(
      "catalog",
      "eval",
      { code: "return searchProjectCatalog(query);" },
      { returnValue: catalog },
    );
    const created = call(
      "created",
      "eval",
      { code: "return prepareProjects(corrected);" },
      {
        returnValue: {
          created: "panels/columns-board",
          preflight: { ok: true, projectType: "panel" },
          preparation: preparation(),
        },
      },
    );

    expect(
      scenario("invalid-icon-discover-recover-create").validate(
        execution([discovered, created]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts bounded discovery and protected publication in one completed eval", () => {
    const catalog = {
      protocol: "workspace-dev-catalog.v1",
      resource: "icon",
      entries: [{ id: "lucide:compass" }],
    };
    const published = {
      created: "panels/layout",
      preflight: { ok: true, projectType: "panel" },
      preparation: preparation(),
    };
    const batched = call(
      "discover-and-create",
      "eval",
      {
        code: "const catalog = await searchProjectCatalog(query); return { catalog, result: await prepareProjects(corrected) };",
      },
      { returnValue: { catalog, result: [published] } },
    );
    expect(
      scenario("invalid-icon-discover-recover-create").validate(
        execution([batched]),
      ),
    ).toEqual({ passed: true, reason: undefined });
    const missingCatalog = call(
      "create-only",
      "eval",
      { code: "return prepareProjects(corrected);" },
      { returnValue: published },
    );
    expect(
      scenario("invalid-icon-discover-recover-create").validate(
        execution([missingCatalog]),
      ).passed,
    ).toBe(false);
    const missingPublication = call(
      "discover-only",
      "eval",
      { code: "return searchProjectCatalog(query);" },
      { returnValue: catalog },
    );
    expect(
      scenario("invalid-icon-discover-recover-create").validate(
        execution([missingPublication]),
      ).passed,
    ).toBe(false);
    expect(
      scenario("invalid-icon-discover-recover-create").validate(
        execution([missingCatalog, missingPublication]),
      ).passed,
    ).toBe(false);
  });

  it("accepts a truncated failed build only when a later receipt is clean", () => {
    const target = "packages/fixture";
    const diagnostics = Array.from({ length: 40 }, (_, index) => ({
      source: "tsc",
      severity: "error",
      file: `${target}/index.ts`,
      line: index + 1,
      column: 1,
      message: `failure ${index + 1}`,
    }));
    const failed = call(
      "failed-build",
      "verify",
      { operation: "build", target },
      {
        operation: "build",
        target,
        status: "failed",
        report: { diagnostics },
        receipt: receipt(target, "failed"),
        truncatedDiagnostics: 20,
      },
      true,
    );
    const clean = call(
      "clean-build",
      "verify",
      { operation: "build", target },
      {
        operation: "build",
        target,
        status: "ok",
        report: { diagnostics: [] },
        receipt: receipt(target, "ok"),
        truncatedDiagnostics: 0,
      },
    );

    expect(
      scenario("failed-build-bounded-diagnostics").validate(
        execution([failed, clean]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("requires native image evidence from the same extensionless scratch capture", () => {
    const capture = call(
      "capture",
      "eval",
      {
        code: "const bytes = await page.screenshot(); const path = await fs.mktemp('capture'); await fs.writeFile(path, bytes); return path;",
      },
      { returnValue: "file:/.tmp/capture-123" },
    );
    const read = call(
      "read",
      "read",
      { target: "file:/.tmp/capture-123" },
      { mimeType: "image/png", size: 4096 },
    );

    expect(
      scenario("extensionless-screenshot-resource-read").validate(
        execution([capture, read]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("accepts a named extensionless scratch path when capture and image read identities match", () => {
    const capture = call(
      "capture",
      "eval",
      {
        code: "const bytes = await page.screenshot(); const path = 'scratch/capture'; await fs.writeFile(path, bytes); return { screenshotPath: path };",
      },
      { returnValue: { screenshotPath: "scratch/capture" } },
    );
    const read = call(
      "read",
      "read",
      { path: "scratch/capture" },
      { mimeType: "image/png", size: 4096 },
    );

    expect(
      scenario("extensionless-screenshot-resource-read").validate(
        execution([capture, read]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });

  it("does not count base64 screenshot text as native image inspection", () => {
    const capture = call(
      "capture",
      "eval",
      {
        code: "const bytes = await page.screenshot(); const path = await fs.mktemp('capture'); await fs.writeFile(path, bytes); return path;",
      },
      {
        returnValue: "file:/.tmp/capture-123",
        mimeType: "image/png",
        size: 4096,
      },
    );
    const read = call(
      "read",
      "read",
      { target: "file:/.tmp/capture-123", encoding: "base64", limit: 512 },
      { encoding: "base64", size: 512, originalSize: 4096 },
    );

    expect(
      scenario("extensionless-screenshot-resource-read").validate(
        execution([capture, read]),
      ).passed,
    ).toBe(false);
  });

  it("requires a replaced session and an observed postcondition after rebuild", () => {
    const open = call(
      "open",
      "eval",
      { code: "scope.session = await scope.panel.cdp.session();" },
      {
        returnValue: {
          session: { protocol: "panel-cdp-session.v1" },
          observation: {
            panelId: "panel:counter",
            runtimeEntityId: "runtime:old",
            attemptId: "attempt:old",
            buildKey: "a".repeat(64),
          },
          interaction: {
            protocol: "cdp-interaction-outcome.v1",
            delivery: "dispatched",
            effect: { status: "observed", state: "visible" },
          },
        },
      },
    );
    const verify = call(
      "verify",
      "verify",
      { operation: "build", target: "panels/counter" },
      { status: "ok" },
    );
    const edit = call(
      "edit",
      "apply_patch",
      { operations: [{ path: "panels/counter/index.tsx" }] },
      { applicationId: "application:counter" },
    );
    const rebuild = call(
      "rebuild",
      "eval",
      {
        code: "await scope.panel.rebuild(); const refreshed = await scope.session.refresh();",
      },
      {
        returnValue: {
          status: "replaced",
          generation: {
            protocol: "panel-cdp-generation.v1",
            panelId: "panel:counter",
            runtimeEntityId: "runtime:new",
            attemptId: "attempt:new",
            buildKey: "b".repeat(64),
          },
          interaction: {
            protocol: "cdp-interaction-outcome.v1",
            delivery: "dispatched",
            effect: { status: "observed", state: "visible" },
          },
        },
      },
    );

    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([open, verify, edit, rebuild]),
      ),
    ).toEqual({ passed: true, reason: undefined });

    const targetedEdit = call(
      "targeted-edit",
      "edit",
      { path: "panels/counter/index.tsx" },
      { applicationId: "application:counter-edit" },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([open, verify, targetedEdit, rebuild]),
      ),
    ).toEqual({ passed: true, reason: undefined });

    const buildReport = call(
      "build-report",
      "eval",
      {
        code: "const report = await services.build.getBuildReport(scope.panelSource, `ctx:${ctx.contextId}`); return { status: report.status, diagnostics: report.diagnostics };",
      },
      { returnValue: { status: "ok", diagnostics: [] } },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([open, buildReport, targetedEdit, rebuild]),
      ),
    ).toEqual({ passed: true, reason: undefined });
    const failedReport = call(
      "failed-build-report",
      "eval",
      buildReport.invocation.arguments,
      {
        returnValue: {
          status: "failed",
          diagnostics: [{ message: "Compiler error" }],
        },
      },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([open, failedReport, targetedEdit, rebuild]),
      ).passed,
    ).toBe(false);

    const readmeOnly = call(
      "readme-only",
      "write",
      { path: "panels/counter/README.md", content: "Usage note" },
      { applicationId: "application:readme" },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([open, buildReport, readmeOnly, rebuild]),
      ).passed,
    ).toBe(false);

    // Summary wording does not establish a new executable incarnation.
    const summaryOnly = call(
      "summary-only",
      "eval",
      rebuild.invocation.arguments,
      {
        returnValue: {
          status: "replaced",
          before: "Count: 0",
          after: "Count: 1",
          clickStatus: "observed",
        },
      },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([open, verify, targetedEdit, summaryOnly]),
      ).passed,
    ).toBe(false);
    const canonical = rebuild.invocation.execution.result.details.returnValue;
    const renamedSummary = call(
      "renamed-summary",
      "eval",
      rebuild.invocation.arguments,
      {
        returnValue: {
          ...canonical,
          status: undefined,
          refreshStatus: "replaced",
        },
      },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([open, verify, targetedEdit, renamedSummary]),
      ).passed,
    ).toBe(true);
    const rebuildOnly = call(
      "rebuild-only",
      "eval",
      {
        code: "scope.observation = await scope.panel.rebuild(); return scope.observation;",
      },
      { returnValue: { phase: "ready" } },
    );
    const refreshOnly = call(
      "refresh-only",
      "eval",
      {
        code: "scope.refreshed = await scope.session.refresh(); return scope.refreshed.session.generation;",
      },
      { returnValue: canonical.generation },
    );
    const interactionOnly = call(
      "interaction-only",
      "eval",
      {
        code: "return await scope.refreshed.session.page.getByRole('button').click({expect});",
      },
      { returnValue: canonical.interaction },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([
          open,
          verify,
          targetedEdit,
          rebuildOnly,
          refreshOnly,
          interactionOnly,
        ]),
      ).passed,
    ).toBe(true);
    const refreshBeforeFailure = call(
      "refresh-before-failure",
      "eval",
      rebuild.invocation.arguments,
      {
        operationJournal: {
          protocol: "workspace-operations.v1",
          truncated: false,
          entries: [
            {
              type: "cdp.session",
              id: "panel:counter",
              receipt: {
                status: "replaced",
                generation: canonical.generation,
                previousGeneration: {
                  panelId: "panel:counter",
                  runtimeEntityId: "runtime:old",
                  attemptId: "attempt:old",
                  buildKey: "a".repeat(64),
                },
              },
            },
          ],
        },
      },
      true,
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([
          open,
          verify,
          targetedEdit,
          refreshBeforeFailure,
          interactionOnly,
        ]),
      ).passed,
    ).toBe(true);
    for (const generation of [
      { ...canonical.generation, buildKey: "a".repeat(64) },
      { ...canonical.generation, panelId: "panel:unrelated" },
      { ...canonical.generation, runtimeEntityId: "runtime:old" },
      { ...canonical.generation, attemptId: "attempt:old" },
    ]) {
      const stale = call("stale", "eval", rebuild.invocation.arguments, {
        returnValue: { ...canonical, generation },
      });
      expect(
        scenario("panel-rebuild-reacquire-and-interact").validate(
          execution([open, verify, targetedEdit, stale]),
        ).passed,
      ).toBe(false);
    }

    const sessionOnly = call(
      "session-only",
      "eval",
      { code: "scope.session = await scope.panel.cdp.session();" },
      { returnValue: { protocol: "panel-cdp-session.v1" } },
    );
    expect(
      scenario("panel-rebuild-reacquire-and-interact").validate(
        execution([sessionOnly, verify, targetedEdit, rebuild]),
      ).passed,
    ).toBe(false);
  });

  it("requires a real stale observation, reobservation, and preservation of concurrent content", () => {
    const path = "projects/fixture/README.md";
    const read = call("read", "read", { path }, { path });
    const collaborator = call(
      "collaborator",
      "edit",
      { path },
      {
        protocol: "file-mutation.v1",
        status: "applied",
      },
    );
    const stale = call(
      "stale",
      "edit",
      { path },
      {
        protocol: "file-mutation.v1",
        status: "conflict",
        storage: "vcs",
        conflicts: [
          { reason: "content-changed", recovery: { action: "reobserve" } },
        ],
      },
    );
    const reobserve = call("reobserve", "read", { path }, { path });
    const corrected = call(
      "corrected",
      "edit",
      { path },
      {
        protocol: "file-mutation.v1",
        status: "applied",
      },
    );
    const readback = call(
      "readback",
      "read",
      { path },
      {
        text: "# Recovered note\nCollaborator note: preserve this concurrent addition.",
      },
    );
    const validate = scenario("stale-edit-reobserve-and-apply").validate;
    const calls = [read, collaborator, stale, reobserve, corrected, readback];
    expect(validate(execution(calls))).toEqual({
      passed: true,
      reason: undefined,
    });
    expect(
      validate(execution(calls.filter((value) => value !== reobserve))).passed,
    ).toBe(false);
    expect(
      validate(
        execution([
          read,
          collaborator,
          stale,
          reobserve,
          corrected,
          call("lost-update", "read", { path }, { text: "# Recovered note" }),
        ]),
      ).passed,
    ).toBe(false);
    expect(
      validate(
        execution([
          read,
          collaborator,
          call(
            "wrong-conflict",
            "edit",
            { path },
            {
              protocol: "file-mutation.v1",
              status: "conflict",
              conflicts: [
                { reason: "not-found", recovery: { action: "reobserve" } },
              ],
            },
          ),
          reobserve,
          corrected,
          readback,
        ]),
      ).passed,
    ).toBe(false);
  });

  it("requires write/edit semantic intent evidence and a normalized match before readback", () => {
    const path = "projects/fixture/notes/ergonomics.txt";
    const vcsResult = {
      workUnitId: "work:1",
      applicationId: "application:1",
      changeIds: ["change:1"],
    };
    const write = call(
      "write",
      "write",
      { path, content: "Status: “before”\n", intent: "Create the status note" },
      {
        protocol: "file-mutation.v1",
        status: "applied",
        storage: "vcs",
        intent: "Create the status note",
        operations: [{ kind: "write", status: "created", path }],
        conflicts: [],
        vcsResult,
      },
    );
    const edit = call(
      "edit",
      "edit",
      {
        path,
        oldText: 'Status: "before"',
        newText: 'Status: "unified-agentic-ergonomics"',
        intent: "Advance the status note",
      },
      {
        protocol: "file-mutation.v1",
        status: "applied",
        storage: "vcs",
        intent: "Advance the status note",
        operations: [
          {
            kind: "replace",
            status: "changed",
            path,
            matches: [{ replacement: 0, mode: "normalized", line: 1 }],
          },
        ],
        conflicts: [],
        vcsResult: {
          ...vcsResult,
          workUnitId: "work:2",
          changeIds: ["change:2"],
        },
      },
    );
    const read = call(
      "read",
      "read",
      { path },
      { text: 'Status: "unified-agentic-ergonomics"' },
    );

    expect(
      scenario("write-edit-unified-matching-provenance").validate(
        execution([write, edit, read]),
      ),
    ).toEqual({ passed: true, reason: undefined });
  });
});
