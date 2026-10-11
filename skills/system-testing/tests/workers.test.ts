import { durableObjectServiceFixture } from "@vibestudio/service-schemas/test-utils";
import { fingerprintEvalRpcValue } from "@vibestudio/service-schemas/eval";
import { describe, expect, it } from "vitest";
import type { TestExecutionResult } from "../types.js";
import { workerTests } from "./workers.js";

function execution(
  finalMessage: string,
  code?: string,
  returnValue?: unknown,
  evalStatus: "complete" | "error" = "complete",
  consoleOutput?: string,
  operationJournal?: unknown,
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
    if (operationJournal !== undefined)
      details["operationJournal"] = operationJournal;
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

const sqlOwnerId = "eval-owner-sql-probe";
const sqlOwnerGeneration = "00000000-0000-4000-8000-000000000001";

function attachJournal(
  result: TestExecutionResult,
  entries: Array<Record<string, unknown>>,
): TestExecutionResult {
  const message = result.messages.find(
    (candidate) =>
      candidate.contentType === "invocation" &&
      candidate.invocation?.name === "eval",
  );
  if (!message?.invocation)
    throw new Error("Expected an eval invocation to attach evidence");
  const invocation = message.invocation as unknown as { result?: unknown };
  const current = invocation.result;
  const details =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)["details"]
      : undefined;
  const nextDetails =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  nextDetails["operationJournal"] = {
    protocol: "workspace-operations.v1",
    truncated: false,
    entries,
  };
  invocation.result = { details: nextDetails };
  result.diagnostics = {
    ...result.diagnostics,
    workspaceRepoFixture: { repoName: "probe" },
  };
  return result;
}

function editJournal(
  result: TestExecutionResult,
  edit: (entries: Array<Record<string, unknown>>) => void,
): void {
  const message = result.messages.find(
    (candidate) =>
      candidate.contentType === "invocation" &&
      candidate.invocation?.name === "eval",
  );
  if (!message?.invocation)
    throw new Error("Expected an eval invocation to edit evidence");
  const invocation = message.invocation as unknown as {
    result?: { details?: Record<string, unknown> };
  };
  const journal = invocation.result?.details?.["operationJournal"] as
    | { entries?: Array<Record<string, unknown>> }
    | undefined;
  if (!journal?.entries) throw new Error("Expected operation journal entries");
  edit(journal.entries);
}

function doCallEntries(
  observed: unknown,
  options: {
    targetId?: string;
    method?: string;
    retiredEntityId?: string;
    entityId?: string;
    source?: string;
    kind?: "worker" | "do";
  } = {},
): Array<Record<string, unknown>> {
  const kind = options.kind ?? "do";
  const source = options.source ?? "workers/probe";
  const targetId =
    options.targetId ??
    (kind === "do"
      ? "do:workers/probe:FixtureWorkerDO:probe"
      : "worker:workers/probe:installed-probe");
  const entityId = options.entityId ?? "worker-entity-probe";
  return [
    {
      type: "rpc.call",
      receipt: {
        protocol: "rpc-call-observation.v1",
        ownerId: sqlOwnerId,
        ownerGeneration: sqlOwnerGeneration,
        callId: 0,
        admissionOrder: 0,
        settlementOrder: 1,
        targetId: "main",
        method: "runtime.createEntity",
        outcome: "fulfilled",
      },
    },
    {
      type: "worker.lifecycle",
      receipt: {
        protocol: "worker-lifecycle-observation.v1",
        callId: 0,
        operation: "create",
        entityId,
        targetId,
        kind,
        source,
        ...(kind === "do"
          ? { className: "FixtureWorkerDO", objectKey: "probe" }
          : {}),
      },
    },
    {
      type: "rpc.call",
      receipt: {
        protocol: "rpc-call-observation.v1",
        ownerId: sqlOwnerId,
        ownerGeneration: sqlOwnerGeneration,
        callId: 1,
        admissionOrder: 2,
        settlementOrder: 3,
        targetId,
        method: options.method ?? "inspectProbe",
        outcome: "fulfilled",
        result: fingerprintEvalRpcValue(observed),
      },
    },
    {
      type: "rpc.call",
      receipt: {
        protocol: "rpc-call-observation.v1",
        ownerId: sqlOwnerId,
        ownerGeneration: sqlOwnerGeneration,
        callId: 2,
        admissionOrder: 4,
        settlementOrder: 5,
        targetId: "main",
        method: "runtime.retireEntity",
        outcome: "fulfilled",
      },
    },
    {
      type: "worker.lifecycle",
      receipt: {
        protocol: "worker-lifecycle-observation.v1",
        callId: 2,
        operation: "retire",
        entityId: options.retiredEntityId ?? entityId,
      },
    },
  ];
}

function doCallExecution(
  code: string,
  value: unknown,
  options: Parameters<typeof doCallEntries>[1] = {},
): TestExecutionResult {
  return attachJournal(
    execution("The object reported its probe value.", code, value),
    doCallEntries(
      value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "observed" in value
        ? (value as Record<string, unknown>)["observed"]
        : value,
      options,
    ),
  );
}

function dynamicServiceExecution(
  result: TestExecutionResult,
  phase: "combined" | "resolve" | "invoke",
  value: unknown,
): TestExecutionResult {
  const targetId = "do:workers/probe:FixtureWorkerDO:task";
  const entries: Array<Record<string, unknown>> = [];
  if (phase !== "invoke") {
    entries.push(
      {
        type: "rpc.call",
        receipt: {
          protocol: "rpc-call-observation.v1",
          ownerId: sqlOwnerId,
          ownerGeneration: sqlOwnerGeneration,
          callId: 0,
          admissionOrder: 0,
          settlementOrder: 1,
          targetId: "main",
          method: "workers.resolveService",
          outcome: "fulfilled",
        },
      },
      {
        type: "worker.lifecycle",
        receipt: {
          protocol: "worker-lifecycle-observation.v1",
          callId: 0,
          operation: "resolve-service",
          query: "test.probe.v1",
          serviceName: "test.probe.v1",
          targetId,
          source: "workers/probe",
          className: "FixtureWorkerDO",
          objectKey: "task",
        },
      },
    );
  }
  if (phase !== "resolve") {
    const callId = phase === "combined" ? 1 : 0;
    const admissionOrder = phase === "combined" ? 2 : 2;
    entries.push({
      type: "rpc.call",
      receipt: {
        protocol: "rpc-call-observation.v1",
        ownerId: sqlOwnerId,
        ownerGeneration: sqlOwnerGeneration,
        callId,
        admissionOrder,
        settlementOrder: admissionOrder + 1,
        targetId,
        method: "report",
        outcome: "fulfilled",
        result: fingerprintEvalRpcValue(value),
      },
    });
  }
  return attachJournal(result, entries);
}

const mainMethodsImport =
  'import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";';
const probeMethodsImport =
  'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract";';
const regularWorkerMethodsImport = probeMethodsImport;
const runtimeRetire =
  'await rpc.call("main", mainRpcMethods["runtime.retireEntity"], [{ id: handle.id }]);';
function sqlExecution(
  finalMessage: string,
  code: string,
  returnValue?: unknown,
  consoleOutput?: string,
  options: {
    source?: string;
    className?: string;
    targetId?: string;
    readTargetId?: string;
    writeMethod?: string;
    readMethod?: string;
    writeOrder?: number;
    readOrder?: number;
    writeSettlementOrder?: number;
    readSettlementOrder?: number;
    retiredEntityId?: string;
    ownerId?: string;
    ownerGeneration?: string;
    omitWrite?: boolean;
    omitRead?: boolean;
    omitResolve?: boolean;
    omitCallerReturn?: boolean;
  } = {},
) {
  const record =
    returnValue &&
    typeof returnValue === "object" &&
    !Array.isArray(returnValue)
      ? (returnValue as Record<string, unknown>)
      : {};
  const writeRows =
    record["before"] ??
    record["written"] ??
    record["accepted"] ??
    record["rows"];
  const readRows =
    record["after"] ??
    record["persisted"] ??
    record["observed"] ??
    record["rows"];
  const source = options.source ?? "workers/probe";
  const className = options.className ?? "FixtureWorkerDO";
  const targetId = options.targetId ?? `do:${source}:${className}:sql-probe`;
  const entityId = "worker-entity-sql-probe";
  const ownerId = options.ownerId ?? "eval-owner-sql-probe";
  const ownerGeneration =
    options.ownerGeneration ?? "00000000-0000-4000-8000-000000000001";
  const operationJournal = {
    protocol: "workspace-operations.v1",
    truncated: false,
    entries: [
      {
        type: "rpc.call",
        receipt: {
          protocol: "rpc-call-observation.v1",
          ownerId,
          ownerGeneration,
          callId: 0,
          admissionOrder: 0,
          settlementOrder: 1,
          targetId: "main",
          method: "runtime.createEntity",
          outcome: "fulfilled",
        },
      },
      {
        type: "worker.lifecycle",
        receipt: {
          protocol: "worker-lifecycle-observation.v1",
          callId: 0,
          operation: "create",
          entityId,
          targetId,
          kind: "do",
          source,
          className,
          objectKey: "sql-probe",
        },
      },
      ...(!options.omitWrite
        ? [
            {
              type: "rpc.call",
              receipt: {
                protocol: "rpc-call-observation.v1",
                ownerId,
                ownerGeneration,
                callId: 1,
                admissionOrder: options.writeOrder ?? 2,
                settlementOrder: options.writeSettlementOrder ?? 3,
                targetId,
                method: options.writeMethod ?? "writeRows",
                outcome: "fulfilled",
                result: fingerprintEvalRpcValue(writeRows),
              },
            },
          ]
        : []),
      ...(!options.omitResolve
        ? [
            {
              type: "rpc.call",
              receipt: {
                protocol: "rpc-call-observation.v1",
                ownerId,
                ownerGeneration,
                callId: 2,
                admissionOrder: 4,
                settlementOrder: 5,
                targetId: "main",
                method: "workers.resolveDurableObject",
                outcome: "fulfilled",
              },
            },
            {
              type: "worker.lifecycle",
              receipt: {
                protocol: "worker-lifecycle-observation.v1",
                callId: 2,
                operation: "resolve",
                targetId,
                source,
                className,
                objectKey: "sql-probe",
              },
            },
          ]
        : []),
      ...(!options.omitRead
        ? [
            {
              type: "rpc.call",
              receipt: {
                protocol: "rpc-call-observation.v1",
                ownerId,
                ownerGeneration,
                callId: 3,
                admissionOrder: options.readOrder ?? 6,
                settlementOrder: options.readSettlementOrder ?? 7,
                targetId: options.readTargetId ?? targetId,
                method: options.readMethod ?? "readRows",
                outcome: "fulfilled",
                result: fingerprintEvalRpcValue(readRows),
              },
            },
          ]
        : []),
      {
        type: "rpc.call",
        receipt: {
          protocol: "rpc-call-observation.v1",
          ownerId,
          ownerGeneration,
          callId: 4,
          admissionOrder: 8,
          settlementOrder: 9,
          targetId: "main",
          method: "runtime.retireEntity",
          outcome: "fulfilled",
        },
      },
      {
        type: "worker.lifecycle",
        receipt: {
          protocol: "worker-lifecycle-observation.v1",
          callId: 4,
          operation: "retire",
          entityId: options.retiredEntityId ?? entityId,
        },
      },
    ],
  };
  const result = execution(
    finalMessage,
    code,
    options.omitCallerReturn ? undefined : returnValue,
    "complete",
    consoleOutput,
    operationJournal,
  );
  result.diagnostics = {
    ...result.diagnostics,
    workspaceRepoFixture: { repoName: "probe" },
  };
  return result;
}

function sqlExecutionAcrossCells(
  cells: Array<{
    code: string;
    callIds: number[];
    returnValue?: unknown;
    ownerId?: string;
    ownerGeneration?: string;
  }>,
  options: {
    retiredEntityId?: string;
    eventOrders?: Partial<
      Record<number, { admissionOrder: number; settlementOrder: number }>
    >;
  } = {},
): TestExecutionResult {
  const rows = [
    { id: "row-1", value: "alpha" },
    { id: "row-2", value: "beta" },
  ];
  const fullCode = cells.map((cell) => cell.code).join("\n");
  const whole = sqlExecution(
    "Rows persisted across eval cells.",
    fullCode,
    {
      before: rows,
      after: rows,
    },
    undefined,
    {
      ...(options.retiredEntityId
        ? { retiredEntityId: options.retiredEntityId }
        : {}),
    },
  );
  const original = whole.messages.find(
    (message) =>
      message.contentType === "invocation" &&
      message.invocation?.name === "eval",
  );
  if (!original?.invocation)
    throw new Error("SQL fixture did not create an eval invocation");
  const originalPayload = original.invocation as unknown as Record<
    string,
    unknown
  >;
  const invocationResult = originalPayload["result"];
  const details =
    invocationResult && typeof invocationResult === "object"
      ? (invocationResult as Record<string, unknown>)["details"]
      : undefined;
  if (!details || typeof details !== "object" || Array.isArray(details))
    throw new Error("SQL fixture did not create eval details");
  const journal = (details as Record<string, unknown>)["operationJournal"];
  if (!journal || typeof journal !== "object" || Array.isArray(journal))
    throw new Error("SQL fixture did not create an operation journal");
  const entries = (journal as Record<string, unknown>)["entries"];
  if (!Array.isArray(entries))
    throw new Error("SQL fixture journal entries were unavailable");
  const prompt = whole.messages[0]!;
  const final = whole.messages[whole.messages.length - 1]!;
  const calls = cells.map((cell, index) => {
    const selected = entries.filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return false;
      const receipt = (entry as Record<string, unknown>)["receipt"];
      return (
        receipt !== null &&
        typeof receipt === "object" &&
        !Array.isArray(receipt) &&
        cell.callIds.includes(
          Number((receipt as Record<string, unknown>)["callId"]),
        )
      );
    });
    const localCallIds = [
      ...new Set(
        selected.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry))
            return [];
          const receipt = (entry as Record<string, unknown>)["receipt"];
          return receipt !== null &&
            typeof receipt === "object" &&
            !Array.isArray(receipt) &&
            typeof (receipt as Record<string, unknown>)["callId"] === "number"
            ? [(receipt as Record<string, unknown>)["callId"] as number]
            : [];
        }),
      ),
    ].sort((left, right) => left - right);
    const localEntries = selected.map((entry) => {
      const record = entry as Record<string, unknown>;
      const receipt = record["receipt"] as Record<string, unknown>;
      const sourceCallId = receipt["callId"] as number;
      const eventOverride = options.eventOrders?.[sourceCallId];
      return {
        ...record,
        receipt: {
          ...receipt,
          callId: localCallIds.indexOf(sourceCallId),
          ...(record["type"] === "rpc.call" && eventOverride
            ? eventOverride
            : {}),
          ...(record["type"] === "rpc.call" && cell.ownerId
            ? { ownerId: cell.ownerId }
            : {}),
          ...(record["type"] === "rpc.call" && cell.ownerGeneration
            ? { ownerGeneration: cell.ownerGeneration }
            : {}),
        },
      };
    });
    const operationJournal = {
      protocol: "workspace-operations.v1",
      truncated: false,
      entries: localEntries,
    };
    const callId = `eval-cell-${index + 1}`;
    const resultDetails: Record<string, unknown> = { operationJournal };
    if (cell.returnValue !== undefined)
      resultDetails["returnValue"] = cell.returnValue;
    return {
      ...original,
      id: `${callId}-message`,
      invocation: {
        ...original.invocation,
        id: callId,
        arguments: { code: cell.code },
        status: "complete",
        terminalOutcome: "success",
        isError: false,
        result: { details: resultDetails },
      },
    } as unknown as TestExecutionResult["messages"][number];
  });
  return { ...whole, messages: [prompt, ...calls, final] };
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
    expect(test("list-sources").prompt).not.toMatch(
      /listSources|eval|runtime/u,
    );
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
    expect(
      test("installed-workspace-service-consumer").workspaceRepoFixture,
    ).toEqual({
      kind: "buildable-regular-worker",
      section: "workers",
    });
  });

  it("derives service authority from the randomized worker fixture and its dynamic object keys", () => {
    const authorityPolicy = test("dynamic-workspace-service").authorityPolicy;
    expect(authorityPolicy).toBeTypeOf("function");
    if (typeof authorityPolicy !== "function")
      throw new Error("expected authority policy factory");
    expect(
      authorityPolicy({
        testName: "dynamic-workspace-service",
        workspaceRepoFixture: {
          kind: "buildable-worker",
          section: "workers",
          repoName: "system-test-dynamic-workspace-service-abcd1234",
        },
      }),
    ).toEqual({
      authority: [
        {
          ruleId: "consume-authored-fixture-service",
          capability: { kind: "prefix", prefix: "workspace-service:" },
          resource: {
            kind: "prefix",
            prefix:
              "do:workers/system-test-dynamic-workspace-service-abcd1234:FixtureWorkerDO:",
          },
          tier: "gated",
          decision: "once",
        },
      ],
    });
  });

  it("pre-approves the exact small installed service used by the consumer fixture", () => {
    expect(
      test("installed-workspace-service-consumer").authorityPolicy,
    ).toEqual({
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
        execution(
          "Two launchable worker sources are available.",
          "return workers.listSources();",
          [{ source: "workers/a" }, { source: "workers/b" }],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test("list-sources").validate(
        execution(
          "Two worker sources are available to start.",
          "const units = await build.listUnits(); return units.filter((unit) => unit.kind === 'worker' && unit.status === 'available');",
          [
            { source: "workers/a", kind: "worker", status: "available" },
            { source: "workers/b", kind: "worker", status: "available" },
          ],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test("list-workers").validate(
        execution(
          "There is one running worker instance.",
          "return workers.list();",
          [{ id: "worker-1" }],
        ),
      ).passed,
    ).toBe(true);
    expect(
      test("list-workers").validate(
        execution("There are no running workers.", "return workers.list();"),
      ).passed,
    ).toBe(false);
    expect(
      test("list-workers").validate(
        execution(
          "No worker unit currently has a running instance.",
          "return runtime.supervision.list();",
          [],
        ),
      ).passed,
    ).toBe(true);

    expect(
      test("list-sources").validate(
        execution(
          "Twelve launchable workers are available.",
          "const sources = await workers.listSources(); console.log(sources);",
          undefined,
          "complete",
          'sourcesCount 12\n{"source":"workers/agent-worker"}',
        ),
      ).passed,
    ).toBe(true);
  });

  it("requires an observable Durable Object method result", () => {
    const code = [
      'const handle = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "probe", stateArgs: { probe: "ready" } });',
      probeMethodsImport,
      "const observed = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.inspectProbe, []);",
      "await workers.destroy(handle);",
      "return { observed, createdId: handle.id, destroyedId: handle.id };",
    ].join("\n");
    const valid = doCallExecution(code, {
      observed: { probe: "ready" },
      createdId: "worker-1",
      destroyedId: "worker-1",
    });
    expect(test("call-do-method").validate(valid).passed).toBe(true);
    const unrelatedReceiver = structuredClone(valid);
    editJournal(unrelatedReceiver, (entries) => {
      const receiver = entries.find(
        (entry) =>
          entry["type"] === "rpc.call" &&
          (entry["receipt"] as Record<string, unknown>)?.["method"] ===
            "inspectProbe",
      );
      if (receiver) {
        const receipt = receiver["receipt"] as Record<string, unknown>;
        receipt["targetId"] = "do:workers/probe:FixtureWorkerDO:unrelated";
      }
    });
    expect(test("call-do-method").validate(unrelatedReceiver)).toMatchObject({
      passed: false,
      reason: expect.stringContaining("not on the created do's target"),
    });
    expect(
      test("call-do-method").validate(
        execution(
          "The call worked.",
          'return rpc.call(handle.targetId, "version", []);',
        ),
      ).passed,
    ).toBe(false);
  });

  it("requires actual owner lifecycle and RPC receipts for persisted rows", () => {
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
        sqlExecution(
          "Both rows were present on the later read, and the object was retired.",
          code,
          {
            before: rows,
            after: rows,
            createdId: "worker-1",
            retiredId: "worker-1",
          },
        ),
      ).passed,
    ).toBe(true);

    const wrongOwnerCode = code.replace(
      "@workspace-workers/probe/contract",
      "@workspace-workers/another-worker/contract",
    );
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution(
          "Rows persisted.",
          wrongOwnerCode,
          { before: rows, after: rows },
          undefined,
          { source: "workers/another-worker" },
        ),
      ).passed,
    ).toBe(false);

    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution(
          "Rows persisted.",
          code,
          { before: rows, after: rows },
          undefined,
          { readMethod: "report" },
        ),
      ).passed,
    ).toBe(false);

    for (const invalid of [
      {
        before: rows,
        after: [{ id: "row-1", value: "alpha" }],
        createdId: "worker-1",
        retiredId: "worker-1",
      },
      {
        before: [
          { id: "row-1", value: "alpha" },
          { id: "row-2", value: "beta" },
        ],
        after: [
          { id: "row-1", value: "alpha" },
          { id: "row-2", value: "wrong" },
        ],
        createdId: "worker-1",
        retiredId: "worker-1",
      },
      {
        before: rows,
        after: rows,
        persisted: false,
        createdId: "worker-1",
        retiredId: "worker-1",
      },
      {
        before: rows,
        after: [
          { id: "row-1", value: "wrong" },
          { id: "row-2", value: "beta" },
        ],
        createdId: "worker-1",
        retiredId: "worker-1",
      },
    ]) {
      expect(
        test("worker-do-sql-persistence").validate(
          sqlExecution("Rows persisted.", code, invalid),
        ).passed,
      ).toBe(false);
    }

    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution(
          "Rows persisted.",
          code,
          { before: rows, after: rows },
          undefined,
          { retiredEntityId: "different-entity" },
        ),
      ).passed,
    ).toBe(false);

    const mismatch = test("worker-do-sql-persistence").validate(
      sqlExecution("Rows persisted.", code, {
        before: rows,
        after: [
          { id: "row-1", value: "alpha" },
          { id: "row-2", value: "changed" },
        ],
      }),
    );
    expect(mismatch).toMatchObject({
      passed: false,
      reason: expect.stringContaining(
        "did not match the rows accepted by writeRows",
      ),
    });

    const missingReturn = sqlExecution(
      "Rows persisted.",
      code,
      { before: rows, after: rows },
      undefined,
      { omitCallerReturn: true },
    );
    expect(
      test("worker-do-sql-persistence").validate(missingReturn),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("no caller-visible return value"),
    });

    const missingRetirement = sqlExecution("Rows persisted.", code, {
      before: rows,
      after: rows,
    });
    editJournal(missingRetirement, (entries) => {
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!;
        const receipt = entry["receipt"] as Record<string, unknown> | undefined;
        if (
          receipt?.["operation"] === "retire" ||
          (entry["type"] === "rpc.call" &&
            receipt?.["method"] === "runtime.retireEntity")
        )
          entries.splice(index, 1);
      }
    });
    expect(
      test("worker-do-sql-persistence").validate(missingRetirement),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("no recorded retirement receipt"),
    });
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
        sqlExecution(
          "The disposable object persisted both rows and was retired.",
          code,
          {
            before: [
              { id: "row-1", value: "alpha" },
              { id: "row-2", value: "beta" },
            ],
            after: [
              { id: "row-1", value: "alpha" },
              { id: "row-2", value: "beta" },
            ],
          },
        ),
      ).passed,
    ).toBe(true);
  });

  it("accepts property-name-independent write and read observations on a scoped handle", () => {
    const code = [
      probeMethodsImport,
      'const scope = { handle: await workers.createDurableObject("workers/probe", "FixtureWorkerDO") };',
      'const acceptedRows = await rpc.call(scope.handle.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);',
      "const rows = await rpc.call(scope.handle.targetId, fixtureWorkerRpcMethods.readRows, []);",
      "await workers.destroy(scope.handle);",
      "return { accepted: acceptedRows, observed: rows };",
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
        }),
      ).passed,
    ).toBe(true);
  });

  it("requires a read receipt matching returned rows, not just a fabricated row value", () => {
    const code = [
      probeMethodsImport,
      'const target = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "temporary" });',
      'await rpc.call(target.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);',
      "await rpc.call(target.targetId, fixtureWorkerRpcMethods.readRows, []);",
      "await workers.destroy(target);",
      'return { rows: [{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }] };',
    ].join("\n");
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution(
          "Rows persisted.",
          code,
          {
            before: [
              { id: "row-1", value: "alpha" },
              { id: "row-2", value: "beta" },
            ],
            after: [
              { id: "row-1", value: "alpha" },
              { id: "row-2", value: "beta" },
            ],
          },
          undefined,
          { omitRead: true },
        ),
      ).passed,
    ).toBe(false);
  });

  it("requires the exact retired identity or an identical before/after inventory", () => {
    const prose =
      "The temporary worker started successfully and was fully removed.";
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, {
          createdId: "worker-7",
          retiredId: "worker-7",
        }),
      ).passed,
    ).toBe(true);
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, {
          createdId: "worker-7",
          retiredId: "worker-8",
        }),
      ).passed,
    ).toBe(false);
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, {
          before: [
            { id: "worker-existing", source: "workers/probe", state: "before" },
          ],
          after: [
            { id: "worker-existing", source: "workers/probe", state: "after" },
          ],
        }),
      ).passed,
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
        }),
      ).passed,
    ).toBe(true);
    expect(
      test("create-destroy").validate(
        execution("The temporary worker remained live.", code, {
          existsAfterCreate: true,
          existsAfterDestroy: true,
        }),
      ).passed,
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
        }),
      ).passed,
    ).toBe(true);
  });

  it("accepts a live-instance count returning to its exact baseline", () => {
    expect(
      test("create-destroy").validate(
        execution(
          "The temporary worker was observed and removed.",
          lifecycleCode,
          {
            beforeCount: 2,
            afterCreateCount: 3,
            afterDestroyCount: 2,
          },
        ),
      ).passed,
    ).toBe(true);
    expect(
      test("create-destroy").validate(
        execution(
          "The temporary worker was not fully removed.",
          lifecycleCode,
          {
            beforeCount: 2,
            afterCreateCount: 3,
            afterDestroyCount: 3,
          },
        ),
      ).passed,
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
          { ok: true },
        ),
      ).passed,
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
          { ok: true },
        ),
      ).passed,
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
          },
        ),
      ).passed,
    ).toBe(true);
  });

  it("rejects fabricated prose, failed calls, and missing lifecycle operations", () => {
    const prose =
      "I confirmed that the worker was created and destroyed cleanly.";
    expect(test("create-destroy").validate(execution(prose)).passed).toBe(
      false,
    );
    expect(
      test("create-destroy").validate(
        execution(prose, lifecycleCode, { before: [], after: [] }, "error"),
      ).passed,
    ).toBe(false);
    expect(
      test("create-destroy").validate(
        execution(prose, "return true", { before: [], after: [] }),
      ).passed,
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
        execution(
          "The worker observed x and was removed.",
          acceptedOnly,
          proof,
        ),
      ).passed,
    ).toBe(false);

    const observed = acceptedOnly.replace(
      'await rpc.call("main", mainRpcMethods["runtime.retireEntity"]',
      'const result = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []);\nawait rpc.call("main", mainRpcMethods["runtime.retireEntity"]',
    );
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          `${observed}\nreturn result;`,
          proof,
        ),
      ).passed,
    ).toBe(true);
    const directlyReturned = acceptedOnly.replace(
      runtimeRetire,
      'try { return await scope.runtime.rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); } finally { await rpc.call("main", mainRpcMethods["runtime.retireEntity"], [{ id: handle.id }]); }',
    );
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          directlyReturned,
          proof,
        ),
      ).passed,
    ).toBe(true);
    const fakeRpcText = acceptedOnly.replace(
      runtimeRetire,
      'const note = "return await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, [])"; return { observed: "x" };',
    );
    expect(
      test("worker-env").validate(
        execution("The worker observed x and was removed.", fakeRpcText, proof),
      ).passed,
    ).toBe(false);
    const uncalledFunction = acceptedOnly.replace(
      runtimeRetire,
      'function inspectLater() { return rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); } return { observed: "x" };',
    );
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          uncalledFunction,
          proof,
        ),
      ).passed,
    ).toBe(false);
    const shadowedProbe = acceptedOnly.replace(
      runtimeRetire,
      "let result: unknown; { const result = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); } return result;",
    );
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          shadowedProbe,
          proof,
        ),
      ).passed,
    ).toBe(false);
    const discardedProbe = acceptedOnly.replace(
      runtimeRetire,
      'await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); try { return { observed: "x" }; } finally { await rpc.call("main", mainRpcMethods["runtime.retireEntity"], [{ id: handle.id }]); }',
    );
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          discardedProbe,
          proof,
        ),
      ).passed,
    ).toBe(false);
    const reassignedProbe = acceptedOnly.replace(
      runtimeRetire,
      'let result: unknown; result = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []); result = { observed: "x" }; return result;',
    );
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          reassignedProbe,
          proof,
        ),
      ).passed,
    ).toBe(false);
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          `${acceptedOnly.replace(
            'await rpc.call("main", mainRpcMethods["runtime.retireEntity"]',
            'let result: unknown = null;\nresult = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.observeConfiguredValue, []);\nawait rpc.call("main", mainRpcMethods["runtime.retireEntity"]',
          )}\nreturn { result };`,
          proof,
        ),
      ).passed,
    ).toBe(true);
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          `${observed}\nconsole.log({ result });`,
          undefined,
          "complete",
          '{ "result": "x" }',
        ),
      ).passed,
    ).toBe(true);
    expect(
      test("worker-env").validate(
        execution(
          "The worker observed x and was removed.",
          `${observed}\nconst summary = { probe: result };\nconsole.log(JSON.stringify(summary));`,
          undefined,
          "complete",
          '{ "summary": { "probe": "x" } }',
        ),
      ).passed,
    ).toBe(true);

    expect(
      test("worker-env").validate(
        execution(
          "The worker was called and removed, but its observation was discarded.",
          observed,
          proof,
        ),
      ).passed,
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
    const dynamic = dynamicServiceExecution(
      execution(
        "The context-local probe answered with its value.",
        'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
        { answer: "context-local" },
      ),
      "combined",
      { answer: "context-local" },
    );
    dynamic.messages.splice(1, 0, docs, authored);
    expect(test("dynamic-workspace-service").validate(dynamic).passed).toBe(
      true,
    );
    const unrelatedServiceTarget = structuredClone(dynamic);
    editJournal(unrelatedServiceTarget, (entries) => {
      const receiver = entries.find(
        (entry) =>
          entry["type"] === "rpc.call" &&
          (entry["receipt"] as Record<string, unknown>)?.["method"] ===
            "report",
      );
      if (receiver) {
        const receipt = receiver["receipt"] as Record<string, unknown>;
        receipt["targetId"] = "do:workers/probe:FixtureWorkerDO:unrelated";
      }
    });
    expect(
      test("dynamic-workspace-service").validate(unrelatedServiceTarget),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("different target"),
    });

    const typedAuthored = {
      ...authored,
      invocation: {
        ...((authored as unknown as { invocation: object })
          .invocation as object),
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
    const typed = dynamicServiceExecution(
      execution(
        "The context-local probe answered with its value.",
        'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
        { answer: "context-local" },
      ),
      "combined",
      { answer: "context-local" },
    );
    typed.messages.splice(1, 0, docs, typedAuthored);
    expect(test("dynamic-workspace-service").validate(typed).passed).toBe(true);

    const split = dynamicServiceExecution(
      execution(
        "The context-local probe answered with its value.",
        'scope.service = await workers.resolveService("test.probe.v1"); return scope.service;',
        durableObjectServiceFixture("do:workers/probe:FixtureWorkerDO:task"),
      ),
      "resolve",
      { targetId: "do:workers/probe:FixtureWorkerDO:task" },
    );
    split.messages.splice(1, 0, docs, typedAuthored);
    const invoke = dynamicServiceExecution(
      execution(
        "The context-local probe answered with its value.",
        'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; return rpc.call(scope.service.targetId, fixtureWorkerRpcMethods.report, []);',
        { answer: "context-local" },
      ),
      "invoke",
      { answer: "context-local" },
    ).messages[1]!;
    invoke.id = "split-invoke-message";
    (invoke as unknown as { invocation: { id: string } }).invocation.id =
      "split-invoke";
    split.messages.splice(-1, 0, invoke);
    expect(test("dynamic-workspace-service").validate(split).passed).toBe(true);

    const missingResolution = structuredClone(split);
    missingResolution.messages = missingResolution.messages.filter(
      (message) => message.id !== "call-eval-message",
    );
    expect(
      test("dynamic-workspace-service").validate(missingResolution).passed,
    ).toBe(false);
    const missingInvocation = structuredClone(split);
    missingInvocation.messages = missingInvocation.messages.filter(
      (message) => message.id !== "split-invoke-message",
    );
    expect(
      test("dynamic-workspace-service").validate(missingInvocation).passed,
    ).toBe(false);

    const noDocs = dynamicServiceExecution(
      execution(
        "The context-local probe answered with its value.",
        'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
        { answer: "context-local" },
      ),
      "combined",
      { answer: "context-local" },
    );
    noDocs.messages.splice(1, 0, authored);
    expect(test("dynamic-workspace-service").validate(noDocs).passed).toBe(
      false,
    );

    const catalog = dynamicServiceExecution(
      execution(
        "The context-local probe answered with its value.",
        'import { fixtureWorkerRpcMethods } from "@workspace-workers/probe/contract"; const service = await workers.resolveService("test.probe.v1"); return rpc.call(service.targetId, fixtureWorkerRpcMethods.report, []);',
        { answer: "context-local" },
      ),
      "combined",
      { answer: "context-local" },
    );
    catalog.messages.splice(1, 0, docs, authored, {
      ...authored,
      invocation: {
        ...((authored as unknown as { invocation: object })
          .invocation as object),
        id: "catalog-call",
        arguments: { path: "generated/productAuthorityGrantCatalog.ts" },
      },
    } as unknown as TestExecutionResult["messages"][number]);
    expect(test("dynamic-workspace-service").validate(catalog).passed).toBe(
      false,
    );
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
        }) as unknown as TestExecutionResult["messages"][number],
    );
    const result = doCallExecution(
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
      },
      { kind: "worker", method: "consumeTestkitService", entityId: "worker-1" },
    );
    result.messages.splice(1, 0, ...calls);
    expect(
      test("installed-workspace-service-consumer").validate(result).passed,
    ).toBe(true);

    const wrongWorkerTarget = structuredClone(result);
    editJournal(wrongWorkerTarget, (entries) => {
      const receiver = entries.find(
        (entry) =>
          entry["type"] === "rpc.call" &&
          (entry["receipt"] as Record<string, unknown>)?.["method"] ===
            "consumeTestkitService",
      );
      if (receiver) {
        const receipt = receiver["receipt"] as Record<string, unknown>;
        receipt["targetId"] = "worker:workers/probe:unrelated";
      }
    });
    expect(
      test("installed-workspace-service-consumer").validate(wrongWorkerTarget),
    ).toMatchObject({
      passed: false,
      reason: expect.stringContaining("not on the created worker's target"),
    });

    const publicId = structuredClone(result);
    const evalMessage = publicId.messages.find(
      (message) =>
        message.kind === "message" && message.invocation?.id === "call-eval",
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
    expect(
      test("installed-workspace-service-consumer").validate(publicId).passed,
    ).toBe(true);

    const unrelatedTarget = structuredClone(result);
    const unrelatedEval = unrelatedTarget.messages.find(
      (message) =>
        message.kind === "message" && message.invocation?.id === "call-eval",
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
    expect(
      test("installed-workspace-service-consumer").validate(unrelatedTarget)
        .passed,
    ).toBe(false);

    const wildcard = structuredClone(result);
    const manifest = wildcard.messages.find(
      (message) =>
        message.kind === "message" && message.invocation?.id === "manifest",
    );
    if (manifest?.kind === "message" && manifest.invocation) {
      manifest.invocation.arguments = {
        path: "workers/probe/package.json",
        patch: '"capability": "workspace-service:*"',
      };
    }
    expect(
      test("installed-workspace-service-consumer").validate(wildcard).passed,
    ).toBe(false);
  });
});

describe("independent runtime retirement observation", () => {
  it("accepts cross-eval cleanup only when the real fixture inventory is empty", () => {
    const first = attachJournal(
      execution(
        "Created.",
        'scope.handle = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "probe", stateArgs: { probe: "ready" } }); return { createdId: scope.handle.id };',
        { createdId: "worker-entity-probe" },
      ),
      doCallEntries({ probe: "ready" }).slice(0, 2),
    );
    const secondEntries = doCallEntries({ probe: "ready" })
      .slice(2)
      .map((entry) => {
        const receipt = entry["receipt"] as Record<string, unknown>;
        return {
          ...entry,
          receipt: { ...receipt, callId: Number(receipt["callId"]) - 1 },
        };
      });
    const second = attachJournal(
      execution(
        "The probe was ready and its instance was retired.",
        `${probeMethodsImport} const observed = await rpc.call(scope.handle.targetId, fixtureWorkerRpcMethods.inspectProbe, []); await workers.destroy(scope.handle); return { observed, destroyedId: scope.handle.id };`,
        { observed: { probe: "ready" }, destroyedId: "worker-entity-probe" },
      ),
      secondEntries,
    );
    const firstCall = first.messages.find(
      (message) =>
        message.contentType === "invocation" &&
        message.invocation?.name === "eval",
    );
    if (firstCall?.kind === "message" && firstCall.invocation) {
      firstCall.invocation.id = "create-call";
      second.messages.splice(1, 0, firstCall);
    }
    expect(test("call-do-method").validate(second).passed).toBe(true);
    const missingStateArgs = structuredClone(second);
    const diagnosis = missingStateArgs.messages.find(
      (message) =>
        message.contentType === "invocation" &&
        message.invocation?.name === "eval",
    );
    if (
      diagnosis?.kind === "message" &&
      typeof diagnosis.invocation?.arguments?.["code"] === "string"
    ) {
      diagnosis.invocation.arguments["code"] = diagnosis.invocation.arguments[
        "code"
      ].replace(', stateArgs: { probe: "ready" }', "");
    }
    expect(test("call-do-method").validate(missingStateArgs)).toMatchObject({
      passed: false,
      reason: expect.stringContaining(
        "not created with a non-null probe value in stateArgs",
      ),
    });
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
    const result = doCallExecution(
      `${probeMethodsImport} const handle = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "probe", stateArgs: { probe: "ready" } }); const observed = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.inspectProbe, []); await workers.destroy(handle); return { observed, createdId: handle.id, destroyedId: handle.id };`,
      {
        observed: { probe: null },
        createdId: "worker-1",
        destroyedId: "worker-1",
      },
    );
    expect(test("call-do-method").validate(result)).toMatchObject({
      passed: false,
      reason: expect.stringContaining(
        "returned null for its creation stateArgs value",
      ),
    });
  });
});

describe("bounded persistence observations", () => {
  it("requires ordered write/read receipts on the created object and matching returned rows", () => {
    const prefix = `${probeMethodsImport} const handle = await workers.createDurableObject("workers/probe", "FixtureWorkerDO");`;
    const writes =
      'const written = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);';
    const read =
      "const rows = await rpc.call(handle.targetId, fixtureWorkerRpcMethods.readRows, []);";
    const suffix = "await workers.destroy(handle); return { written, rows };";
    const rows = [
      { id: "row-1", value: "alpha" },
      { id: "row-2", value: "beta" },
    ];
    const accepted = `${prefix} ${writes} ${read} ${suffix}`;
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Rows persisted.", accepted, { written: rows, rows }),
      ).passed,
    ).toBe(true);
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution(
          "Rows persisted.",
          accepted,
          { written: rows, rows },
          undefined,
          { omitResolve: true },
        ),
      ).passed,
    ).toBe(true);

    const valid = { written: rows, rows };
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Rows persisted.", accepted, valid, undefined, {
          readOrder: 1,
          writeOrder: 2,
        }),
      ).passed,
    ).toBe(false);
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Rows persisted.", accepted, valid, undefined, {
          readTargetId: "do:workers/probe:FixtureWorkerDO:other",
        }),
      ).passed,
    ).toBe(false);
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecution("Rows persisted.", accepted, valid, undefined, {
          omitRead: true,
        }),
      ).passed,
    ).toBe(false);
  });

  it("joins trusted lifecycle and RPC receipts across completed eval cells", () => {
    const createAndWrite = [
      probeMethodsImport,
      'const target = await workers.createDurableObject("workers/probe", "FixtureWorkerDO", { key: "sql-probe" });',
      'const written = await rpc.call(target.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]);',
      "return written;",
    ].join("\n");
    const resolveAndRead = [
      'const resolved = await workers.resolveDurableObject("workers/probe", "FixtureWorkerDO", "sql-probe");',
      "const persisted = await rpc.call(resolved.targetId, fixtureWorkerRpcMethods.readRows, []);",
      "return persisted;",
    ].join("\n");
    const retire = "await workers.destroy(target);";
    const rows = [
      { id: "row-1", value: "alpha" },
      { id: "row-2", value: "beta" },
    ];
    const validCells = [
      { code: createAndWrite, callIds: [0, 1], returnValue: rows },
      { code: resolveAndRead, callIds: [2, 3], returnValue: rows },
      { code: retire, callIds: [4] },
    ];
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecutionAcrossCells([...validCells].reverse()),
      ).passed,
    ).toBe(true);

    const readBeforeWrite = [
      {
        code: createAndWrite.replace(
          /const written = [^\n]+\nreturn written;/u,
          "",
        ),
        callIds: [0],
      },
      { code: resolveAndRead, callIds: [2, 3], returnValue: rows },
      {
        code: 'const written = await rpc.call(target.targetId, fixtureWorkerRpcMethods.writeRows, [[{ id: "row-1", value: "alpha" }, { id: "row-2", value: "beta" }]]); return written;',
        callIds: [1],
        returnValue: rows,
      },
      { code: retire, callIds: [4] },
    ];
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecutionAcrossCells(readBeforeWrite, {
          eventOrders: {
            0: { admissionOrder: 0, settlementOrder: 1 },
            2: { admissionOrder: 2, settlementOrder: 3 },
            3: { admissionOrder: 4, settlementOrder: 5 },
            1: { admissionOrder: 6, settlementOrder: 7 },
            4: { admissionOrder: 8, settlementOrder: 9 },
          },
        }),
      ).passed,
    ).toBe(false);

    const retiredBeforeRead = [
      { code: createAndWrite, callIds: [0, 1], returnValue: rows },
      {
        code: 'const resolved = await workers.resolveDurableObject("workers/probe", "FixtureWorkerDO", "sql-probe");',
        callIds: [2],
      },
      { code: retire, callIds: [4] },
      {
        code: "const persisted = await rpc.call(resolved.targetId, fixtureWorkerRpcMethods.readRows, []); return persisted;",
        callIds: [3],
        returnValue: rows,
      },
    ];
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecutionAcrossCells(retiredBeforeRead, {
          eventOrders: {
            0: { admissionOrder: 0, settlementOrder: 1 },
            1: { admissionOrder: 2, settlementOrder: 3 },
            2: { admissionOrder: 4, settlementOrder: 5 },
            4: { admissionOrder: 6, settlementOrder: 7 },
            3: { admissionOrder: 8, settlementOrder: 9 },
          },
        }),
      ).passed,
    ).toBe(false);

    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecutionAcrossCells([
          validCells[0]!,
          {
            ...validCells[1]!,
            ownerGeneration: "00000000-0000-4000-8000-000000000002",
          },
          validCells[2]!,
        ]),
      ).passed,
    ).toBe(false);
    expect(
      test("worker-do-sql-persistence").validate(
        sqlExecutionAcrossCells([
          validCells[0]!,
          { ...validCells[1]!, ownerId: "different-eval-owner" },
          validCells[2]!,
        ]),
      ).passed,
    ).toBe(false);
  });
});
