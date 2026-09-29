import { describe, expect, it } from "vitest";

import type { TestExecutionResult } from "../types.js";
import { cdpGadDiagnosticTests } from "./cdp-gad-diagnostics.js";

function executionWithFinal(
  content: string,
  extra: Partial<TestExecutionResult> = {}
): TestExecutionResult {
  return {
    duration: 0,
    messages: [
      {
        kind: "message",
        senderId: "user",
        complete: true,
        content: "prompt",
      },
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        content,
      },
    ],
    ...extra,
  } as TestExecutionResult;
}

function executionWithInvocation(
  content: string,
  invocation: Record<string, unknown>,
  extra: Partial<TestExecutionResult> = {}
): TestExecutionResult {
  const base = executionWithFinal(content, extra);
  return {
    ...base,
    messages: [
      base.messages[0]!,
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation",
        content: JSON.stringify(invocation),
      },
      base.messages[1]!,
    ],
  } as TestExecutionResult;
}

function withSuccessfulImageRead(result: TestExecutionResult): TestExecutionResult {
  const final = result.messages.at(-1)!;
  return {
    ...result,
    messages: [
      ...result.messages.slice(0, -1),
      {
        kind: "message",
        senderId: "agent",
        senderMetadata: { type: "agent" },
        complete: true,
        contentType: "invocation",
        content: JSON.stringify({
          id: "call-read-image",
          name: "read",
          arguments: { target: "file:cdp-capture", kind: "file" },
          execution: {
            status: "complete",
            terminalOutcome: "success",
            result: { details: { mimeType: "image/png", size: 4096 } },
          },
        }),
      },
      final,
    ],
  } as TestExecutionResult;
}

function nativeClickInvocation(status = "State: clicked") {
  return {
    id: "call-native-click",
    name: "eval",
    arguments: { code: "return compactProjection;" },
    execution: {
      status: "complete",
      terminalOutcome: "success",
      result: {
        details: {
          returnValue: { status },
          operationJournal: {
            protocol: "workspace-operations.v1",
            truncated: false,
            entries: [
              {
                type: "open",
                id: "panel:click",
                kind: "browser",
                source: "data:text/html,test",
              },
              {
                type: "interaction",
                id: "panel:click",
                receipt: {
                  protocol: "cdp-interaction-outcome.v1",
                  action: "click",
                  delivery: "dispatched",
                },
              },
              {
                type: "screenshot",
                id: "panel:click",
                receipt: {
                  capturedAt: 1,
                  mimeType: "image/png",
                  byteSize: 128,
                },
              },
              {
                type: "evaluation",
                id: "panel:click",
                receipt: {
                  protocol: "cdp-evaluation-outcome.v1",
                  capturedAt: 2,
                  value: { status },
                  truncated: false,
                },
              },
            ],
          },
        },
      },
    },
  };
}

const clickTest = cdpGadDiagnosticTests.find(
  (test) => test.name === "cdp-page-click-type-evaluate"
)!;
const profileTest = cdpGadDiagnosticTests.find(
  (test) => test.name === "cdp-page-performance-profile"
)!;
const reloadProfileTest = cdpGadDiagnosticTests.find(
  (test) => test.name === "workspace-panel-reload-performance-profile"
)!;
const stateArgsTest = cdpGadDiagnosticTests.find(
  (test) => test.name === "panel-stateargs-cdp-roundtrip"
)!;
const integrityTest = cdpGadDiagnosticTests.find(
  (test) => test.name === "gad-integrity-diagnostics"
)!;
const branchTest = cdpGadDiagnosticTests.find(
  (test) => test.name === "gad-branch-file-diff-probe"
)!;
const CLICK_FINAL =
  "I clicked the disposable page control, evaluated the requested value, and captured a screenshot successfully. The visible status text was State: clicked.";
const INTEGRITY_FINAL =
  "The GAD assessment covered storage, publication, the current turn and invocation, hashes, and integrity.";
const BRANCH_FINAL =
  "The branch files and state probe completed, and the invalid requests produced the expected controlled rejections.";
const STATE_FINAL =
  "The panel state was visible in the inspected automation snapshot after the change.";

describe("cdp-gad diagnostics validators", () => {
  it("accepts a profiled workspace reload with lifecycle and host evidence", () => {
    const result = reloadProfileTest.validate(
      executionWithInvocation(
        "The workspace panel reload was profiled across runtime replacement with host CPU and memory evidence.",
        {
          id: "call-reload-profile",
          name: "eval",
          arguments: {
            code: `
              const handle = await openPanel("about/testbench", { focus: false });
              const result = await profilePanelReload(handle);
              return { beforeAttemptId: result.beforeAttemptId, afterAttemptId: result.afterAttemptId, ...result.report.summary };
            `,
          },
          execution: {
            status: "complete",
            terminalOutcome: "success",
            result: {
              details: {
                returnValue: {
                  beforeAttemptId: "attempt-1",
                  afterAttemptId: "attempt-2",
                  elapsedMs: 232,
                  server: { userCpuMs: 50, rssDeltaBytes: 1024 },
                },
              },
            },
          },
        }
      )
    );

    expect(result).toEqual({ passed: true });
  });

  it("rejects a workspace reload claim based only on the old CDP incarnation", () => {
    const result = reloadProfileTest.validate(
      executionWithInvocation("The workspace panel reload was profiled and had network requests.", {
        id: "call-reload-profile",
        name: "eval",
        arguments: {
          code: `
              const handle = await openPanel("about/testbench", { focus: false });
              const beforeAttemptId = (await handle.snapshot()).attemptId;
              const page = await handle.cdp.page();
              const report = await page.profile(async () => { await handle.reload(); });
              const afterAttemptId = (await handle.snapshot()).attemptId;
              return { beforeAttemptId, afterAttemptId, requestCount: report.network.requestCount, longTasks: report.page.longTasks.count };
            `,
        },
        execution: { status: "complete", terminalOutcome: "success" },
      })
    );

    expect(result).toMatchObject({ passed: false });
  });

  it("accepts a bounded profile only when the eval evidence contains every requested layer", () => {
    const result = profileTest.validate(
      executionWithInvocation(
        "The profiled click reached State: clicked. Elapsed time, runtime task work, and network activity were measured in the bounded report.",
        {
          id: "call-profile",
          name: "eval",
          arguments: {
            code: "return await page.profile(async () => { await button.click(); await page.getByText('State: clicked').waitFor(); });",
          },
          execution: {
            status: "complete",
            terminalOutcome: "success",
            result: {
              details: {
                returnValue: {
                  status: "State: clicked",
                  version: 1,
                  elapsedMs: 18,
                  runtime: { taskDurationMs: 5 },
                  network: { requestCount: 0 },
                  page: { longTasks: { count: 0 } },
                },
              },
            },
          },
        }
      )
    );

    expect(result).toEqual({ passed: true });
  });

  it("rejects a profile claim without the bounded network evidence", () => {
    const result = profileTest.validate(
      executionWithInvocation(
        "The profiled click reached State: clicked. Elapsed time and runtime task work were measured; network profiling succeeded.",
        {
          id: "call-profile",
          name: "eval",
          arguments: {
            code: "return await page.profile(async () => { await button.click(); await page.getByText('State: clicked').waitFor(); });",
          },
          execution: {
            status: "complete",
            terminalOutcome: "success",
            result: {
              details: {
                returnValue: {
                  status: "State: clicked",
                  version: 1,
                  elapsedMs: 18,
                  runtime: { taskDurationMs: 5 },
                  page: { longTasks: { count: 0 } },
                },
              },
            },
          },
        }
      )
    );

    expect(result).toMatchObject({
      passed: false,
      reason: expect.stringContaining("omitted requested diagnostic evidence"),
    });
  });

  it("accepts native action evidence after image inspection with arbitrary observed status wording", () => {
    expect(
      clickTest.validate(
        withSuccessfulImageRead(
          executionWithInvocation(
            "I clicked the page, captured and inspected its pixels, and evaluated the visible status: Clicked successfully.",
            nativeClickInvocation("Clicked successfully"),
          ),
        ),
      ),
    ).toEqual({ passed: true });
  });

  it("rejects a successful screenshot call when the image was not read", () => {
    expect(
      clickTest.validate(
        executionWithInvocation(CLICK_FINAL, nativeClickInvocation()),
      ),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("read it as image content"),
    });
  });

  it("requires the reported fact to agree with the actual native evaluation", () => {
    expect(
      clickTest.validate(
        withSuccessfulImageRead(
          executionWithInvocation(
            "I clicked, evaluated, and captured a screenshot. State: clicked.",
            nativeClickInvocation("Still ready"),
          ),
        ),
      ),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("page value reported"),
    });
  });

  it("rejects guest claims without each native observation and mismatched panels", () => {
    for (const removed of ["interaction", "screenshot", "evaluation"]) {
      const invocation = nativeClickInvocation();
      invocation.execution.result.details.operationJournal.entries =
        invocation.execution.result.details.operationJournal.entries.filter(
          (entry) => entry.type !== removed,
        );
      expect(
        clickTest.validate(
          withSuccessfulImageRead(
            executionWithInvocation(CLICK_FINAL, invocation),
          ),
        ),
      ).toMatchObject({ passed: false });
    }
    const invocation = nativeClickInvocation();
    invocation.execution.result.details.operationJournal.entries.at(-1)!.id =
      "panel:other";
    expect(
      clickTest.validate(
        withSuccessfulImageRead(
          executionWithInvocation(CLICK_FINAL, invocation),
        ),
      ),
    ).toMatchObject({ passed: false });
  });

  it("rejects observation before the click and truncated native values", () => {
    const invocation = nativeClickInvocation();
    const entries =
      invocation.execution.result.details.operationJournal.entries;
    entries.push(entries.splice(1, 1)[0]!);
    expect(
      clickTest.validate(
        withSuccessfulImageRead(
          executionWithInvocation(CLICK_FINAL, invocation),
        ),
      ),
    ).toMatchObject({ passed: false });
    const truncated = nativeClickInvocation();
    truncated.execution.result.details.operationJournal.entries.at(
      -1,
    )!.receipt!.truncated = true;
    expect(
      clickTest.validate(
        withSuccessfulImageRead(
          executionWithInvocation(CLICK_FINAL, truncated),
        ),
      ),
    ).toMatchObject({ passed: false });
  });

  it("rejects a final success marker when an invocation failed", () => {
    const result = clickTest.validate(
      executionWithInvocation(CLICK_FINAL, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "error",
          isError: true,
          result: { error: "data URL DOM was not reachable" },
        },
      })
    );

    expect(result).toMatchObject({
      passed: false,
    });
    expect(result.reason).toContain("Expected no failed tool calls");
  });

  it("rejects terminal failure outcomes even when invocation status is complete", () => {
    const result = clickTest.validate(
      executionWithInvocation(CLICK_FINAL, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          terminalOutcome: "tool_error",
          result: "snapshot target not reachable",
        },
      })
    );

    expect(result).toMatchObject({
      passed: false,
    });
    expect(result.reason).toContain("Expected no failed tool calls");
  });

  it("does not accept inspected source as a substitute for executed diagnostic evidence", () => {
    const result = clickTest.validate(
      executionWithInvocation(CLICK_FINAL, {
        id: "call-read",
        name: "read",
        execution: {
          status: "complete",
          result: {
            protocolContent: [{ type: "text", text: "if (result.ok === false) throw err;" }],
          },
        },
      })
    );

    expect(result).toMatchObject({ passed: false });
  });

  it("accepts an ok:false diagnostic finding behind an execution-success marker", () => {
    const result = integrityTest.validate(
      executionWithInvocation(INTEGRITY_FINAL, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          result: {
            storage: {},
            publication: {},
            turn: {},
            invocation: {},
            hashes: {},
            integrity: {},
            summary: { ok: false, problem: "publication mismatch" },
          },
        },
      })
    );

    expect(result).toEqual({ passed: true });
  });

  it("accepts a stringified ok:false diagnostic finding", () => {
    const result = integrityTest.validate(
      executionWithInvocation(INTEGRITY_FINAL, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          result:
            '{"storage":{},"publication":{},"turn":{},"invocation":{},"hashes":{},"integrity":{},"summary":{"ok":false}}',
        },
      })
    );

    expect(result).toEqual({ passed: true });
  });

  it("accepts a live-turn-only GAD health report without forcing the OK marker", () => {
    const result = integrityTest.validate(
      executionWithInvocation(
        "GAD health check reported storage publication turn invocation hashes integrity; no storage, publication, hash, or integrity issues, only the current open turn and nonterminal invocation",
        {
          id: "call-1",
          name: "eval",
          execution: {
            status: "complete",
            result: {
              health: {
                summary: {
                  ok: false,
                  publicationIssues: 0,
                  openTurns: 1,
                  nonterminalInvocations: 1,
                  storageIssues: 0,
                },
              },
              hashes: { ok: true },
              integrity: { ok: true },
            },
          },
        }
      )
    );

    expect(result).toEqual({ passed: true });
  });

  it("rejects health prose without canonical diagnostic evidence", () => {
    const result = integrityTest.validate(
      executionWithFinal(
        "The GAD assessment covered storage, publication, the current turn and invocation, hashes, and integrity, but overall ok is false only because the current turn is open."
      )
    );

    expect(result).toMatchObject({ passed: false });
  });

  it("rejects impossible success wording in the final message", () => {
    const result = stateArgsTest.validate(
      executionWithInvocation(`${STATE_FINAL} However, the snapshot target was not reachable.`, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          result: { snapshot: { stateArgs: { value: 2 } } },
        },
      })
    );

    expect(result).toMatchObject({
      passed: false,
    });
    expect(result.reason).toContain("not reachable");
  });

  it("accepts controlled branch probe rejections returned as data", () => {
    const result = branchTest.validate(
      executionWithInvocation(BRANCH_FINAL, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          result: {
            checks: [{ name: "branch-files", ok: true }],
            stateProbe: { ok: true },
            controlledErrors: [
              { name: "write CTE", ok: false, error: "rawSql writes are disabled" },
            ],
          },
        },
      })
    );

    expect(result).toEqual({ passed: true });
  });

  it("accepts unrelated in-flight agent health during a branch probe", () => {
    const result = branchTest.validate(
      executionWithInvocation(BRANCH_FINAL, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          result: {
            priorHealth: {
              summary: {
                ok: false,
                publicationIssues: 0,
                storageIssues: 0,
                openTurns: 1,
                nonterminalInvocations: 1,
              },
            },
            branchFiles: [],
            stateProbe: null,
            controlledErrors: [{ rejected: true, error: "rawSql writes are disabled" }],
          },
        },
      })
    );

    expect(result).toEqual({ passed: true });
  });

  it("accepts in-flight health repeated through a bounded eval preview and final prose", () => {
    const result = branchTest.validate(
      executionWithInvocation(
        `${BRANCH_FINAL} Current health is false because openTurns=1 and nonterminalInvocations=1, with publicationIssues=0 and storageIssues=0.`,
        {
          id: "call-1",
          name: "eval",
          execution: {
            status: "complete",
            result: {
              protocolContent: [
                {
                  type: "text",
                  text: {
                    preview:
                      '[eval] Return value:\n{"health":{"summary":{"ok":false,"publicationIssues":0,"storageIssues":0,"openTurns":1,"nonterminalInvocations":1}}}',
                  },
                },
              ],
              branchFiles: [],
              stateProbe: null,
              controlledErrors: [{ rejected: true, error: "rawSql writes are disabled" }],
            },
          },
        }
      )
    );

    expect(result).toEqual({ passed: true });
  });

  it("still rejects a nonzero integrity issue alongside in-flight health", () => {
    const result = branchTest.validate(
      executionWithInvocation(`${BRANCH_FINAL} Current health is false.`, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          result: {
            health: {
              summary: {
                ok: false,
                openTurns: 1,
                nonterminalInvocations: 1,
                publicationIssues: 1,
                storageIssues: 0,
              },
            },
          },
        },
      })
    );

    expect(result).toMatchObject({ passed: false });
  });

  it("accepts stringified controlled branch probe rejections returned as data", () => {
    const result = branchTest.validate(
      executionWithInvocation(BRANCH_FINAL, {
        id: "call-1",
        name: "eval",
        execution: {
          status: "complete",
          result:
            '[eval] Return value:\n{"checks":[{"name":"branch-files","ok":true}],"stateProbe":{"ok":true},"controlledErrors":[{"name":"write CTE","ok":false,"error":"rawSql writes are disabled"}]}',
        },
      })
    );

    expect(result).toEqual({ passed: true });
  });

  it("rejects explicit success prose when no diagnostic tool ran", () => {
    const result = clickTest.validate(
      executionWithFinal(`${CLICK_FINAL} No tool failures occurred.`)
    );

    expect(result).toMatchObject({ passed: false });
  });

  it("rejects fabricated natural prose without canonical browser evidence", () => {
    const result = clickTest.validate(executionWithFinal(CLICK_FINAL));

    expect(result).toMatchObject({
      passed: false,
    });
    expect(result.reason).toContain("Native click");
  });
});

describe("cdp-gad diagnostics prompts", () => {
  it("stay goal-level instead of encoding implementation details", () => {
    const brittleDetails = [
      "about/testbench",
      "Unknown build unit",
      "Do not use a data: URL",
      "page.evaluate",
      "gad.inspectAgentHealth",
      "{ rows }",
      "result.rows",
      "trajectory_branches",
      "branch_id",
      "ok:false",
      "bounded APIs",
      "bounded diagnostic APIs",
      "expected:true",
      "rejected:true",
      "do not substitute",
    ];

    for (const test of cdpGadDiagnosticTests) {
      for (const detail of brittleDetails) {
        expect(test.prompt, `${test.name} prompt should not include ${detail}`).not.toContain(
          detail
        );
      }
    }

    expect(stateArgsTest.prompt).toContain("Open a workspace panel");
    expect(integrityTest.prompt).toContain("health assessment");
    expect(branchTest.prompt).toContain("branch files and state inspection");
    for (const test of cdpGadDiagnosticTests) {
      expect(test.prompt).not.toMatch(/Finish with|[A-Z][A-Z0-9_]{3,}_OK|\w+:<count>/u);
    }
  });
});
