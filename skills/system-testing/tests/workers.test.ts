import { durableObjectServiceFixture } from "@vibestudio/service-schemas/test-utils";
import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { workerTests } from "./workers.js";

function execution(
  finalMessage: string,
  code?: string,
  returnValue?: unknown,
  evalStatus: "complete" | "error" = "complete",
  consoleOutput?: string
): TestExecutionResult {
  const messages: TestExecutionResult["messages"] = [
    {
      id: "prompt",
      kind: "message",
      senderId: "user",
      complete: true,
      content: "prompt",
    },
  ] as TestExecutionResult["messages"];
  if (code !== undefined) {
    const details: Record<string, unknown> = {};
    if (returnValue !== undefined) details["returnValue"] = returnValue;
    if (consoleOutput !== undefined) details["console"] = consoleOutput;
    messages.push({
      id: "call-eval-message",
      kind: "message",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      content: "",
      invocation: {
        id: "call-eval",
        name: "eval",
        status: evalStatus,
        terminalOutcome: evalStatus === "complete" ? "success" : "tool_error",
        isError: evalStatus !== "complete",
        arguments: { code },
        result: Object.keys(details).length === 0 ? undefined : { details },
      },
    } as unknown as TestExecutionResult["messages"][number]);
  }
  messages.push({
    id: "final",
    kind: "message",
    senderId: "agent",
    senderMetadata: { type: "agent" },
    complete: true,
    content: finalMessage,
  } as TestExecutionResult["messages"][number]);
  return {
    messages,
    duration: 0,
    diagnostics: {
      fixtureRuntimeEntities: { source: "workers/probe", entities: [] },
    },
  };
}

function test(name: string) {
  const found = workerTests.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing worker test ${name}`);
  return found;
}

const mainMethodsImport = 'import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";';
const probeMethodsImport =
  'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract";';
const regularWorkerMethodsImport = probeMethodsImport;
const runtimeRetire =
  'await rpc.call("main", mainRpcMethods["runtime.retireEntity"], [{ id: handle.id }]);';
function sqlExecution(
  finalMessage: string,
  code: string,
  returnValue?: unknown,
  consoleOutput?: string
) {
  const result = execution(finalMessage, code, returnValue, "complete", consoleOutput);
  result.diagnostics = {
    ...result.diagnostics,
    workspaceRepoFixture: { repoName: "probe" },
  };
  return result;
}
const lifecycleCode = [
  mainMethodsImport,
  'const before = await rpc.call("main", mainRpcMethods["runtime.listEntities"], [{ kind: "worker" }]);',
  'const handle = await rpc.call("main", mainRpcMethods["runtime.createEntity"], [{}]);',
  'const afterCreate = await rpc.call("main", mainRpcMethods["runtime.listEntities"], [{ kind: "worker" }]);',
  runtimeRetire,
  'const after = await rpc.call("main", mainRpcMethods["runtime.listEntities"], [{ kind: "worker" }]);',
].join("\n");

describe("worker test validators", () => {
  it("keeps launchable-worker discovery vague and independent of API names", () => {
    expect(test("list-sources").prompt).toBe("Which workers can I start here?");
    expect(test("list-sources").prompt).not.toMatch(/listSources|eval|runtime/u);
  });

  it("keeps authored worker probes in an isolated buildable fixture", () => {
    expect(test("create-worker").workspaceRepoFixture).toEqual({
      kind: "buildable-regular-worker",
      section: "workers",
    });
    expect(test("create-destroy").workspaceRepoFixture).toEqual({
      kind: "buildable-regular-worker",
      section: "workers",
    });
    expect(test("worker-do-sql-persistence").workspaceRepoFixture).toEqual({
      kind: "buildable-worker",
      section: "workers",
    });
    expect(test("worker-env").workspaceRepoFixture).toEqual({
      kind: "buildable-regular-worker",
      section: "workers",
    });
    expect(test("dynamic-workspace-service").workspaceRepoFixture).toEqual({
      kind: "buildable-worker",
      section: "workers",
    });
    expect(test("installed-workspace-service-consumer").workspaceRepoFixture).toEqual({
      kind: "buildable-regular-worker",
      section: "workers",
    });
  });

  it("derives service authority from the randomized worker fixture and its dynamic object keys", () => {
    const authorityPolicy = test("dynamic-workspace-service").authorityPolicy;
    expect(authorityPolicy).toBeTypeOf("function");
    if (typeof authorityPolicy !== "function") throw new Error("expected authority policy factory");
    expect(
      authorityPolicy({
        testName: "dynamic-workspace-service",
        workspaceRepoFixture: {
          kind: "buildable-worker",
          section: "workers",
          repoName: "system-test-dynamic-workspace-service-abcd1234",
        },
      })
    ).toEqual({
      authority: [
        {
          ruleId: "consume-authored-fixture-service",
          capability: { kind: "prefix", prefix: "workspace-service:" },
          resource: {
            kind: "prefix",
            prefix: "do:workers/system-test-dynamic-workspace-service-abcd1234:FixtureWorkerDO:",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    });
  });

  it("pre-approves the exact small installed service used by the consumer fixture", () => {
    expect(test("installed-workspace-service-consumer").authorityPolicy).toEqual({
      authority: [
        {
          ruleId: "consume-installed-testkit-service",
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
      ],
    });
  });

  it("requires returned rows for source and live-instance discovery", () => {
    expect(
      test("list-sources").validate(
        execution("Two launchable worker sources are available.", "return workers.listSources();", [
          { source: "workers/a" },
          { source: "workers/b" },
        ])
      ).passed
    ).toBe(true);
    expect(
      test("list-sources").validate(
        execution(
          "Two worker sources are available to start.",
          "const units = await build.listUnits(); return units.filter((unit) => unit.kind === 'worker' && unit.status === 'available');",
          [
            { source: "workers/a", kind: "worker", status: "available" },
            { source: "workers/b", kind: "worker", status: "available" },
          ]
        )
      ).passed
    ).toBe(true);
    expect(
      test("list-workers").validate(
        execution("There is one running worker instance.", "return workers.list();", [
          { id: "worker-1" },
        ])
      ).passed
    ).toBe(true);
    expect(
      test("list-workers").validate(
        execution("There are no running workers.", "return workers.list();")
      ).passed
    ).toBe(false);
    expect(
      test("list-workers").validate(
        execution(
          "No worker unit currently has a running instance.",
          "return runtime.supervision.list();",
          []
        )
      ).passed
    ).toBe(true);

    expect(
      test("list-sources").validate(
        execution(
          "Twelve launchable workers are available.",
          "const sources = await workers.listSources(); console.log(sources);",
          undefined,
          "complete",
          'sourcesCount 12\n{"source":"workers/agent-worker"}'
        )
      ).passed
    ).toBe(true);
  });

  it("requires an observable Durable Object method result", () => {
    expect(
      test("call-do-method").validate(
        execution(
          "The object reported its current version.",
          [
            "const handle = await workers.createDurableObject(source, className, key, { PROBE: 'ready' });",
            probeMethodsImport,
            "const observed = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.inspectProbe, []);",
            "await workers.destroy(handle);",
            "return { observed, createdId: handle.id, destroyedId: handle.id };",
          ].join("\n"),
          { probe: "ready", createdId: "worker-1", destroyedId: "worker-1" }
        )
      ).passed
    ).toBe(true);
    expect(
      test("call-do-method").validate(
        execution("The call worked.", 'return rpc.call(handle.targetId, "version", []);')
      ).passed
    ).toBe(false);
  });

  it("accepts the seeded owner contract only when separate write/read calls return rows and cleanup agrees", () => {
    const code = [
      probeMethodsImport,
      'const handle = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "sql-probe" });',
      'const written = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);',
      "const rows = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.readRows, []);",
      "await workers.destroy(handle);",
      "return { before: written, after: rows };",
    ].join("\n");
    const rows = [
      { id: "row-1", value: "alpha" },
      { id: "row-2", value: "beta" },
    ];
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Both rows were present on the later read, and the object was retired.", code, {
          before: rows,
          after: rows,
          createdId: "worker-1",
          retiredId: "worker-1",
        })
      ).passed
    ).toBe(true);

    const fakeResultCode = code.replace(
      'const rows = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.readRows, []);',
      'await rpc.call(handle.targetId, fixtureWorkerRpcMethods.readRows, []); const rows = unrelatedRows;'
    );
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Rows persisted.", fakeResultCode, { before: rows, after: rows })
      ).passed
    ).toBe(false);

    const unrelatedContractCode = code.replaceAll(
      "fixtureWorkerRpcMethods",
      "otherMethods"
    );
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Rows persisted.", unrelatedContractCode, { before: rows, after: rows })
      ).passed
    ).toBe(false);

    const wrongOwnerCode = code.replace("@workspace-workers/probe/contract", "@workspace-workers/another-worker/contract");
    expect(
      test("worker-do-sql-persistence").validate(sqlExecution("Rows persisted.", wrongOwnerCode, { before: rows, after: rows }))
        .passed
    ).toBe(false);

    for (const invalid of [
      { before: rows, after: [{ id: "row-1", value: "alpha" }], createdId: "worker-1", retiredId: "worker-1" },
      { before: [{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }], after: [{ id: "row-1", value: "alpha" }, { id: "row-2", value: "wrong" }], createdId: "worker-1", retiredId: "worker-1" },
      { before: rows, after: rows, persisted: false, createdId: "worker-1", retiredId: "worker-1" },
      { before: rows, after: [{ id: "row-1", value: "wrong" }, { id: "row-2", value: "beta" }], createdId: "worker-1", retiredId: "worker-1" },
      { before: rows, after: rows, createdId: "worker-1", retiredId: "worker-2" },
    ]) {
      expect(
        test("worker-do-sql-persistence").validate(sqlExecution("Rows persisted.", code, invalid))
          .passed
      ).toBe(false);
    }
  });

  it("accepts the documented disposable Durable Object lifecycle", () => {
    const code = [
      probeMethodsImport,
      'const target = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "temporary" });',
      'const expected = [{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }];',
      "const written = await rpc.call(target.targetId, fixtureWorkerRpcMethods.writeRows, [expected]);",
      "const rows = await rpc.call(target.targetId, fixtureWorkerRpcMethods.readRows, []);",
      "await workers.destroy(target);",
      "return { before: written, after: rows };",
    ].join("\n");
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("The disposable object persisted both rows and was retired.", code, {
          before: [
            { id: "row-1", value: "alpha" },
            { id: "row-2", value: "beta" },
          ],
          after: [
            { id: "row-1", value: "alpha" },
            { id: "row-2", value: "beta" },
          ],
        })
      ).passed
    ).toBe(true);
  });

  it("accepts property-name-independent write and read observations on a scoped handle", () => {
    const code = [
      probeMethodsImport,
      'const scope = { handle: await workers.createDurableObject("workers/probe", "FixtureWorkerDO") };',
      'const acceptedRows = await rpc.call(scope.handle.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);',
      'const rows = await rpc.call(scope.handle.targetId, fixtureWorkerRpcMethods.readRows, []);',
      'await workers.destroy(scope.handle);',
      'return { accepted: acceptedRows, observed: rows };',
    ].join("\n");
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Both rows persisted.", code, {
          accepted: [
            { id: "row-1", value: "alpha" },
            { id: "row-2", value: "beta" },
          ],
          observed: [
            { id: "row-1", value: "alpha" },
            { id: "row-2", value: "beta" },
          ],
        })
      ).passed
    ).toBe(true);
  });

  it("requires the actual read call result, not just two owner calls", () => {
    const code = [
      probeMethodsImport,
      'const target = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "temporary" });',
      'await rpc.call(target.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);',
      'await rpc.call(target.targetId, fixtureWorkerRpcMethods.readRows, []);',
      "await workers.destroy(target);",
      'return { rows: [{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }] };',
    ].join("\n");
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Rows persisted.", code, {
          before: [
            { id: "row-1", value: "alpha" },
            { id: "row-2", value: "beta" },
          ],
          after: [
            { id: "row-1", value: "alpha" },
            { id: "row-2", value: "beta" },
          ],
        })
      ).passed
    ).toBe(false);
  });

  it("requires the exact retired identity or an identical before/after inventory", () => {
    const prose = "The temporary worker started successfully and was fully removed.";
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, {
          createdId: "worker-7",
          retiredId: "worker-7",
        })
      ).passed
    ).toBe(true);
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, {
          createdId: "worker-7",
          retiredId: "worker-8",
        })
      ).passed
    ).toBe(false);
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, {
          before: [{ id: "worker-existing", source: "workers/probe", state: "before" }],
          after: [{ id: "worker-existing", source: "workers/probe", state: "after" }],
        })
      ).passed
    ).toBe(true);
  });

  it("accepts direct lifecycle observation and the documented id form of destroy", () => {
    const code = [
      'const handle = await workers.create("workers/probe", { key: "probe" });',
      "const afterCreate = await workers.list();",
      "await workers.destroy(handle.id);",
      "const after = await workers.list();",
      "return {",
      "  existsAfterCreate: afterCreate.some((entry) => entry.id === handle.id),",
      "  existsAfterDestroy: after.some((entry) => entry.id === handle.id),",
      "};",
    ].join("\n");
    expect(
      test("create-destroy").validate(
        execution("The temporary worker was observed and removed.", code, {
          existsAfterCreate: true,
          existsAfterDestroy: false,
        })
      ).passed
    ).toBe(true);
    expect(
      test("create-destroy").validate(
        execution("The temporary worker remained live.", code, {
          existsAfterCreate: true,
          existsAfterDestroy: true,
        })
      ).passed
    ).toBe(false);
  });

  it("recognizes cleanup when the created handle carries a TypeScript assertion", () => {
    const code = [
      'const started = await workers.create("workers/probe", { key: "probe" });',
      "const afterCreate = await workers.list();",
      "await workers.destroy(started as any);",
      "const afterDestroy = await workers.list();",
      "return {",
      "  foundAfterCreate: afterCreate.some((entry) => entry.id === started.id),",
      "  stillExists: afterDestroy.some((entry) => entry.id === started.id),",
      "};",
    ].join("\n");
    expect(
      test("create-worker").validate(
        execution("The temporary worker was observed and removed.", code, {
          foundAfterCreate: true,
          stillExists: false,
        })
      ).passed
    ).toBe(true);
  });

  it("accepts a live-instance count returning to its exact baseline", () => {
    expect(
      test("create-destroy").validate(
        execution("The temporary worker was observed and removed.", lifecycleCode, {
          beforeCount: 2,
          afterCreateCount: 3,
          afterDestroyCount: 2,
        })
      ).passed
    ).toBe(true);
    expect(
      test("create-destroy").validate(
        execution("The temporary worker was not fully removed.", lifecycleCode, {
          beforeCount: 2,
          afterCreateCount: 3,
          afterDestroyCount: 3,
        })
      ).passed
    ).toBe(false);
  });

  it("accepts an awaited same-eval lifecycle when no redundant cleanup ids are returned", () => {
    expect(
      test("create-destroy").validate(
        execution(
          "The temporary worker was exercised and retired.",
          [
            'const handle = await workers.create("workers/probe", { key: "probe" });',
            "await workers.list();",
            "try { await workers.list(); } finally { await workers.destroy(handle); }",
          ].join("\n"),
          { ok: true }
        )
      ).passed
    ).toBe(true);
  });

  it("recognizes an owned handle assigned inside try and retired in finally", () => {
    expect(
      test("create-destroy").validate(
        execution(
          "The temporary worker was exercised and retired.",
          [
            "await workers.list();",
            "let handle = null;",
            "try {",
            '  handle = await workers.create("workers/probe", { key: "probe" });',
            "} finally {",
            "  if (handle) await workers.destroy(handle);",
            "}",
            "await workers.list();",
          ].join("\n"),
          { ok: true }
        )
      ).passed
    ).toBe(true);
  });

  it("uses a completed same-eval lifecycle when returned observations are incomplete", () => {
    expect(
      test("create-destroy").validate(
        execution(
          "The temporary worker was observed and retired.",
          [
            'const handle = await workers.create("workers/probe", { key: "probe" });',
            "const afterCreate = await workers.list();",
            "await workers.destroy(handle);",
            "const afterRetire = await workers.list();",
            "return {",
            "  beforeCount: 0,",
            "  afterCreateCount: afterCreate.length,",
            "  afterRetireCount: afterRetire.length,",
            "  stillThere: afterRetire.some((entry) => entry.id === handle.id),",
            "};",
          ].join("\n"),
          {
            beforeCount: 0,
            afterCreateCount: 1,
            afterRetireCount: 0,
            stillThere: false,
          }
        )
      ).passed
    ).toBe(true);
  });

  it("rejects fabricated prose, failed calls, and missing lifecycle operations", () => {
    const prose = "I confirmed that the worker was created and destroyed cleanly.";
    expect(test("create-destroy").validate(execution(prose)).passed).toBe(false);
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, { before: [], after: [] }, "error")
      ).passed
    ).toBe(false);
    expect(
      test("create-destroy").validate(execution(prose, "return true", { before: [], after: [] }))
        .passed
    ).toBe(false);
  });

  it("requires worker-side observation and matching cleanup identity for environment probes", () => {
    const acceptedOnly = [
      mainMethodsImport,
      regularWorkerMethodsImport,
      'const handle = await rpc.call("main", mainRpcMethods["runtime.createEntity"], [{ env: { PROBE: "x" } }]);',
      runtimeRetire,
    ].join("\n");
    const proof = {
      observed: "x",
      createdId: "worker-1",
      retiredId: "worker-1",
    };
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", acceptedOnly, proof)
      ).passed
    ).toBe(false);

    const observed = acceptedOnly.replace(
      'await rpc.call("main", mainRpcMethods["runtime.retireEntity"]',
      'const result = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []);\nawait rpc.call("main", mainRpcMethods["runtime.retireEntity"]'
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", `${observed}\nreturn result;`, proof)
      ).passed
    ).toBe(true);
    const directlyReturned = acceptedOnly.replace(
      runtimeRetire,
      'try { return await scope.runtime.rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); } finally { await rpc.call("main", mainRpcMethods["runtime.retireEntity"], [{ id: handle.id }]); }'
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", directlyReturned, proof)
      ).passed
    ).toBe(true);
    const fakeRpcText = acceptedOnly.replace(
      runtimeRetire,
      'const note = "return await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, [])"; return { observed: "x" };'
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", fakeRpcText, proof)
      ).passed
    ).toBe(false);
    const uncalledFunction = acceptedOnly.replace(
      runtimeRetire,
      'function inspectLater() { return rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); } return { observed: "x" };'
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", uncalledFunction, proof)
      ).passed
    ).toBe(false);
    const shadowedProbe = acceptedOnly.replace(
      runtimeRetire,
      "let result: unknown; { const result = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); } return result;"
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", shadowedProbe, proof)
      ).passed
    ).toBe(false);
    const discardedProbe = acceptedOnly.replace(
      runtimeRetire,
      'await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); try { return { observed: "x" }; } finally { await rpc.call("main", mainRpcMethods["runtime.retireEntity"], [{ id: handle.id }]); }'
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", discardedProbe, proof)
      ).passed
    ).toBe(false);
    const reassignedProbe = acceptedOnly.replace(
      runtimeRetire,
      'let result: unknown; result = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); result = { observed: "x" }; return result;'
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", reassignedProbe, proof)
      ).passed
    ).toBe(false);
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          `${acceptedOnly.replace(
            'await rpc.call("main", mainRpcMethods["runtime.retireEntity"]',
            'let result: unknown = null;\nresult = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []);\nawait rpc.call("main", mainRpcMethods["runtime.retireEntity"]'
          )}\nreturn { result };`,
          proof
        )
      ).passed
    ).toBe(true);
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          `${observed}\nconsole.log({ result });`,
          undefined,
          "complete",
          '{ "result": "x" }'
        )
      ).passed
    ).toBe(true);
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          `${observed}\nconst summary = { probe: result };\nconsole.log(JSON.stringify(summary));`,
          undefined,
          "complete",
          '{ "summary": { "probe": "x" } }'
        )
      ).passed
    ).toBe(true);

    expect(
      test("worker-env").validate(
        execution(
          "The worker was called and removed, but its observation was discarded.",
          observed,
          proof
        )
      ).passed
    ).toBe(false);
  });

  it("requires live discovery, a semantic service declaration, and dynamic invocation", () => {
    const docs = {
      id: "docs-call",
      kind: "message",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      content: "",
      invocation: {
        id: "docs-call",
        name: "docs_search",
        status: "complete",
        arguments: { query: "workspace service discovery" },
        result: { details: [{ id: "service:workers.resolveService" }] },
      },
    } as unknown as TestExecutionResult["messages"][number];
    const authored = {
      id: "author-call",
      kind: "message",
      senderId: "agent",
      senderMetadata: { type: "agent" },
      complete: true,
      contentType: "invocation",
      content: "",
      invocation: {
        id: "author-call",
        name: "vcs",
        status: "complete",
        arguments: {
          path: "meta/vibestudio.yml",
          patch:
            "services:\n  - source: workers/probe\nsingletonObjects:\n  - source: workers/probe",
        },
        result: { details: { ok: true } },
      },
    } as unknown as TestExecutionResult["messages"][number];
    const dynamic = execution(
      "The context-local probe answered with its value.",
      'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
      { answer: "context-local" }
    );
    dynamic.messages.splice(1, 0, docs, authored);
    expect(test("dynamic-workspace-service").validate(dynamic).passed).toBe(true);

    const typedAuthored = {
      ...authored,
      invocation: {
        ...((authored as unknown as { invocation: object }).invocation as object),
        id: "workspace-service-call",
        name: "workspace_service",
        arguments: {
          operation: "upsert",
          name: "probe",
          source: "workers/probe",
          protocols: ["test.probe.v1"],
        },
      },
    } as unknown as TestExecutionResult["messages"][number];
    const typed = execution(
      "The context-local probe answered with its value.",
      'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
      { answer: "context-local" }
    );
    typed.messages.splice(1, 0, docs, typedAuthored);
    expect(test("dynamic-workspace-service").validate(typed).passed).toBe(true);

    const split = execution(
      "The context-local probe answered with its value.",
      'scope.service = await workers.resolveService("test.probe.v1"); return scope.service;',
      durableObjectServiceFixture("do:workers/probe:ProbeDO:task")
    );
    split.messages.splice(1, 0, docs, typedAuthored);
    const invoke = execution(
      "The context-local probe answered with its value.",
      'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; return rpc.call(scope.service.targetId, fixtureWorkerRpcMethods.report, []);',
      { answer: "context-local" }
    ).messages[1]!;
    invoke.id = "split-invoke-message";
    (invoke as unknown as { invocation: { id: string } }).invocation.id = "split-invoke";
    split.messages.splice(-1, 0, invoke);
    expect(test("dynamic-workspace-service").validate(split).passed).toBe(true);

    const missingResolution = structuredClone(split);
    missingResolution.messages = missingResolution.messages.filter(
      (message) => message.id !== "call-eval-message"
    );
    expect(test("dynamic-workspace-service").validate(missingResolution).passed).toBe(false);
    const missingInvocation = structuredClone(split);
    missingInvocation.messages = missingInvocation.messages.filter(
      (message) => message.id !== "split-invoke-message"
    );
    expect(test("dynamic-workspace-service").validate(missingInvocation).passed).toBe(false);

    const noDocs = execution(
      "The context-local probe answered with its value.",
      'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
      { answer: "context-local" }
    );
    noDocs.messages.splice(1, 0, authored);
    expect(test("dynamic-workspace-service").validate(noDocs).passed).toBe(false);

    const catalog = execution(
      "The context-local probe answered with its value.",
      'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
      { answer: "context-local" }
    );
    catalog.messages.splice(1, 0, docs, authored, {
      ...authored,
      invocation: {
        ...((authored as unknown as { invocation: object }).invocation as object),
        id: "catalog-call",
        arguments: { path: "generated/productAuthorityGrantCatalog.ts" },
      },
    } as unknown as TestExecutionResult["messages"][number]);
    expect(test("dynamic-workspace-service").validate(catalog).passed).toBe(false);
  });

  it("requires installed consumers to request an exact dynamic service and execute it", () => {
    const calls = [
      {
        id: "docs",
        name: "docs_search",
        status: "complete",
        arguments: { query: "workspace services" },
        result: { details: [{ id: "service:workers.resolveService" }] },
      },
      {
        id: "manifest",
        name: "edit",
        status: "complete",
        arguments: {
          path: "workers/probe/package.json",
          patch:
            '"authority": { "requests": [{ "capability": "workspace-service:testkit-driver", "resource": { "kind": "exact", "key": "do:workers/testkit-driver:TestkitDriverDO:workspace-testkit-driver" }, "tier": "gated" }], "serviceRequests": [{ "protocol": "vibestudio.testkit-driver.v1", "availability": "required" }] }',
        },
        result: { details: { ok: true } },
      },
      {
        id: "consumer",
        name: "edit",
        status: "complete",
        arguments: {
          path: "workers/probe/index.ts",
          patch:
            'async consumeTestkitService() { const service = await this.runtime.workers.resolveService("vibestudio.testkit-driver.v1"); return this.runtime.rpc.call(service.targetId, driverRpcMethods.ping, []); }',
        },
        result: { details: { ok: true } },
      },
    ].map(
      (invocation) =>
        ({
          id: invocation.id,
          kind: "message",
          senderId: "agent",
          senderMetadata: { type: "agent" },
          complete: true,
          contentType: "invocation",
          content: "",
          invocation,
        }) as unknown as TestExecutionResult["messages"][number]
    );
    const result = execution(
      "The installed consumer observed the local service and was retired.",
      [
        probeMethodsImport,
        'const handle = await workers.create("workers/probe", { key: "installed-probe" });',
        "const observed = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.consumeTestkitService, []);",
        "await workers.destroy(handle);",
      ].join("\n"),
      {
        observed: { ok: true, sessions: 0 },
        createdId: "worker-1",
        retiredId: "worker-1",
      }
    );
    result.messages.splice(1, 0, ...calls);
    expect(test("installed-workspace-service-consumer").validate(result).passed).toBe(true);

    const publicId = structuredClone(result);
    const evalMessage = publicId.messages.find(
      (message) => message.kind === "message" && message.invocation?.id === "call-eval"
    );
    if (evalMessage?.kind === "message" && evalMessage.invocation) {
      evalMessage.invocation.arguments = {
        code: [
          probeMethodsImport,
          'const worker = await workers.create("workers/probe", { key: "installed-probe" });',
          "const observed = await rpc.call(worker.id, fixtureWorkerRpcMethods.consumeTestkitService, []);",
          "await workers.destroy(worker);",
        ].join("\n"),
      };
    }
    expect(test("installed-workspace-service-consumer").validate(publicId).passed).toBe(true);

    const unrelatedTarget = structuredClone(result);
    const unrelatedEval = unrelatedTarget.messages.find(
      (message) => message.kind === "message" && message.invocation?.id === "call-eval"
    );
    if (unrelatedEval?.kind === "message" && unrelatedEval.invocation) {
      unrelatedEval.invocation.arguments = {
        code: [
          probeMethodsImport,
          'const handle = await workers.create("workers/probe", { key: "installed-probe" });',
          "const observed = await rpc.call(other.id, fixtureWorkerRpcMethods.consumeTestkitService, []);",
          "await workers.destroy(handle);",
        ].join("\n"),
      };
    }
    expect(test("installed-workspace-service-consumer").validate(unrelatedTarget).passed).toBe(
      false
    );

    const wildcard = structuredClone(result);
    const manifest = wildcard.messages.find(
      (message) => message.kind === "message" && message.invocation?.id === "manifest"
    );
    if (manifest?.kind === "message" && manifest.invocation) {
      manifest.invocation.arguments = {
        path: "workers/probe/package.json",
        patch: '"capability": "workspace-service:*"',
      };
    }
    expect(test("installed-workspace-service-consumer").validate(wildcard).passed).toBe(false);
  });
});

describe("independent runtime retirement observation", () => {
  it("accepts cross-eval cleanup only when the real fixture inventory is empty", () => {
    const first = execution(
      "Created.",
      'scope.handle = await workers.createDurableObject("workers/probe", "ProbeDO", { stateArgs: { probe: "ready" } }); return { id: scope.handle.id };',
      { id: "do:probe" }
    );
    const second = execution(
      "The probe was ready and its instance was retired.",
      `${probeMethodsImport} try { return await rpc.call(scope.handle.targetId, fixtureWorkerRpcMethods.inspectProbe, []); } finally { await workers.destroy(scope.handle); }`,
      { probe: "ready" }
    );
    second.messages.splice(1, 0, first.messages[1]!);
    expect(test("call-do-method").validate(second).passed).toBe(true);
    second.diagnostics = {
      fixtureRuntimeEntities: {
        source: "workers/probe",
        entities: [{ id: "do:probe" }],
      },
    };
    expect(test("call-do-method").validate(second).passed).toBe(false);
    delete second.diagnostics;
    expect(test("call-do-method").validate(second).passed).toBe(false);
  });
  it("rejects a null probe wrapped in a nonempty result object", () => {
    const result = execution(
      "The probe worked.",
      `${probeMethodsImport} const handle = await workers.createDurableObject("workers/probe", "FixtureWorkerDO"); try { return await rpc.call(handle.targetId, fixtureWorkerRpcMethods.inspectProbe, []); } finally { await workers.destroy(handle); }`,
      { result: null }
    );
    expect(test("call-do-method").validate(result).passed).toBe(false);
  });
});

describe("bounded persistence observations", () => {
  it("requires write and read calls on the same object and returned rows derived from the read", () => {
    const prefix = `${probeMethodsImport} const handle = await workers.createDurableObject("workers/probe", "FixtureWorkerDO");`;
    const writes = 'const written = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);';
    const read = 'const rows = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.readRows, []);';
    const suffix = "await workers.destroy(handle); return { written, rows };";
    const rows = [
      { id: "row-1", value: "alpha" },
      { id: "row-2", value: "beta" },
    ];
    const accepted = `${prefix} ${writes} ${read} ${suffix}`;
    expect(
      test("worker-do-sql-persistence").validate(sqlExecution("Rows persisted.", accepted, { written: rows, rows }))
        .passed
    ).toBe(true);

    for (const code of [
      `${prefix} ${read} ${writes} ${suffix}`,
      `${prefix} ${writes} const other = await workers.createDurableObject("workers/probe", "FixtureWorkerDO"); const rows = await rpc.call(other.targetId, fixtureWorkerRpcMethods.readRows, []); await workers.destroy(handle); await workers.destroy(other); return { written, rows };`,
      `${prefix} ${writes} await rpc.call(handle.targetId, fixtureWorkerRpcMethods.readRows, []); ${suffix.replace("return { written, rows };", 'return { written: [{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }], rows: [{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }] };')}`,
    ]) {
      expect(
        test("worker-do-sql-persistence").validate(sqlExecution("Rows persisted.", code, { written: rows, rows }))
          .passed
      ).toBe(false);
    }
  });
});
