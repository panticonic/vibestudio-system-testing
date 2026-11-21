import { prepareSystemRelease } from "../../skills/system-testing/open-goal-system-release-managed.js";
import { seedSystemRelease } from "../../skills/system-testing/open-goal-system-release-records.js";
import { openSystemReleaseWorlds, type SystemReleaseWorld } from "../../skills/system-testing/open-goal-system-release-worlds.js";
import { describe, expect, it, vi } from "vitest";
import { panelTeacherInputSchema } from "@vibestudio/service-schemas/systemTestRunner";
import { schemaRpcMock } from "@vibestudio/rpc/test-utils";
import { wireCallerFor } from "@vibestudio/rpc/internal";
import { createMainRpcCaller } from "@vibestudio/service-schemas/mainRpc";
import { createTestDO } from "@vibestudio/durable/test-utils";
import { evalRuntimeId } from "@vibestudio/shared/evalRuntimeIdentity";
import { rpcMethodAuthority } from "@vibestudio/rpc";
import {
  failedSystemTestRunRecord,
  type SystemTestRunRecord,
} from "../../skills/system-testing/cli.js";
import {
  assembleSystemTestRecord,
  splitSystemTestRecord,
  readSystemTestRecordBlob,
  systemTestUtilityKeys,
  SystemTestRunnerDO,
} from "./index.js";

class TestSystemTestRunnerDO extends SystemTestRunnerDO {
  wireCallerForTest() {
    return wireCallerFor(this.rpc);
  }
}

function runRecord(
  status: SystemTestRunRecord["status"],
  updatedAt: string,
): SystemTestRunRecord {
  const runId = "st_checkpoint";
  return {
    schemaVersion: 1,
    runId,
    status,
    startedAt: "2026-09-28T00:00:00.000Z",
    updatedAt,
    config: {
      contextId: "ctx:checkpoint",
      names: ["large-evidence"],
      all: false,
      concurrency: 1,
      modelPolicy: {
        primaryModel: "openai-codex:gpt-6-luna",
        activeModel: "openai-codex:gpt-6-luna",
        fallbackModel: null,
        fallbackThinkingLevel: null,
        fallbackOn: null,
        fallbackScope: null,
        activations: [],
      },
    },
    provenance: {},
    summary: {
      runId,
      status,
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      toolFailureCount: 0,
      testsWithToolFailures: 0,
      skipped: 0,
      notInstalled: [],
      durationMs: 1,
      failedTests: [],
      testsWithUnexpectedToolFailures: [],
    },
    suite: {
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      skipped: 0,
      duration: 1,
      results: [
        {
          test: {
            name: "large-evidence",
            category: "smoke",
            description: "Retained evidence",
            prompt: "Check persistence",
          },
          result: { passed: true },
          execution: {
            duration: 1,
            messages: [
              {
                kind: "message",
                id: "message:large-evidence",
                senderId: "agent",
                complete: true,
                content: "🧪é".repeat(50000),
              },
            ],
          },
        },
      ],
    },
  };
}

it("requires operator authority and an assigned finite Eval for native activation", async () => {
  const owner = await createTestDO(TestSystemTestRunnerDO, {
    WORKER_SOURCE: "workers/system-test-runner",
    WORKER_CLASS_NAME: "SystemTestRunnerDO",
    __objectKey: "activation",
  });
  try {
    const callerId = evalRuntimeId("do:workers/system-test-runner:SystemTestRunnerDO:activation", "other-scope");
    await expect(owner.callAs(
      { callerId, callerKind: "do", userId: "test-owner" },
      "launchAssignedOpenAutomation",
    )).rejects.toThrow(/relationship workspace-role not satisfied/);
    await expect(owner.call("launchAssignedOpenAutomation"))
      .rejects.toThrow(/No native activation is assigned to this finite Eval/);
  } finally {
    owner.db.close();
  }
});

async function recordOwner() {
  const owner = await createTestDO(TestSystemTestRunnerDO, {
    WORKER_SOURCE: "workers/system-test-runner",
    WORKER_CLASS_NAME: "SystemTestRunnerDO",
    __objectKey: "records",
  });
  const blobs = new Map<string, Uint8Array>();
  const rpcCall = vi.fn(
    async (_target: string, method: string, args: unknown[]) => {
      if (method === "eval.dispose") return { ok: true };
      const bytes = blobs.get(args[0] as string);
      if (!bytes) throw new Error("Missing test blob");
      if (method === "blobstore.stat") return { size: bytes.length, mtime: 0 };
      if (method === "blobstore.getRangeBytes") {
        const offset = args[1] as number,
          length = args[2] as number;
        return {
          bytesBase64: btoa(
            String.fromCharCode(...bytes.slice(offset, offset + length)),
          ),
        };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    },
  );
  vi.spyOn(owner.instance.wireCallerForTest(), "call").mockImplementation(
    rpcCall,
  );
  const put = async (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const digest = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    blobs.set(digest, bytes);
    return { digest, size: bytes.length };
  };
  const persist = async (runId: string, record: SystemTestRunRecord, references: { testName: string; digest: string; size: number }[]) => {
    await owner.call("storeSystemTestRunCheckpoint", runId, record, references);
  };
  const store = async (record: SystemTestRunRecord) => {
    const references = await Promise.all(record.suite.results.map(async entry => ({
      testName: entry.test.name, ...await put(JSON.stringify(entry)),
    })));
    await persist(record.runId, { ...record, suite: { ...record.suite, results: [] } }, references);
  };
  return { ...owner, rpcCall, store, put, persist };
}

describe("system-test durable execution ownership", () => {
  it("keeps a large checkpoint inspectable and retains terminal evidence after disposal and a late update", async () => {
    const owner = await recordOwner();
    const running = runRecord("running", "2026-09-28T00:00:01.000Z");
    await owner.store(running);
    const header = owner.sql
      .exec("SELECT record_json FROM system_test_records")
      .toArray()[0]!;
    expect(String(header["record_json"]).length).toBeLessThan(4096);
    await expect(
      owner.call("releaseSystemTestRunExecution", running.runId),
    ).rejects.toThrow("still active");
    expect(
      owner.rpcCall.mock.calls.some(([, method]) => method === "eval.dispose"),
    ).toBe(false);
    const terminal = runRecord("completed", "2026-09-28T00:00:02.000Z");
    await owner.store(terminal);
    expect(
      owner.rpcCall.mock.calls.filter(
        ([, method]) => method === "blobstore.stat",
      ),
    ).toHaveLength(1);
    await expect(
      owner.call("releaseSystemTestRunExecution", terminal.runId),
    ).resolves.toEqual({ released: true });
    const late = runRecord("running", "2026-09-28T00:00:03.000Z");
    late.suite.results = [];
    await owner.store(late);
    await expect(
      owner.call("getSystemTestRunSnapshot", terminal.runId),
    ).resolves.toEqual({ status: "done", result: { success: true } });
    await expect(
      owner.call("getSystemTestRunResult", terminal.runId),
    ).resolves.toEqual({ summary: terminal.summary });
    let text = "",
      length = Infinity;
    while (text.length < length) {
      const page = await owner.call(
        "readSystemTestTrajectoryPage",
        terminal.runId,
        "large-evidence",
        true,
        text.length,
        32768,
      );
      expect(page.chunk.length).toBeGreaterThan(0);
      length = page.length;
      text += page.chunk;
    }
    expect(JSON.parse(text).execution.messages).toEqual(
      terminal.suite.results[0]!.execution.messages,
    );
  });

  it("seals completed proof without turning an in-flight snapshot into a completed failure", () => {
    const record = runRecord("running", "2026-09-28T00:00:01.000Z");
    record.suite.results.push({
      ...record.suite.results[0]!,
      test: { ...record.suite.results[0]!.test, name: "still-running" },
      result: { passed: false, reason: "System test is still running" },
    });
    const failed = failedSystemTestRunRecord(
      record,
      ["large-evidence"],
      "connection lost",
    );
    expect(failed.status).toBe("errored");
    expect(failed.error).toBe("connection lost");
    expect(failed.suite.results.map((entry) => entry.test.name)).toEqual([
      "large-evidence",
    ]);
    expect(failed.summary).toMatchObject({
      status: "errored",
      passed: 1,
      failed: 0,
      errored: 0,
      error: "connection lost",
    });
  });

  it("retains orchestration failure independently of completed passing cases", async () => {
    const owner = await recordOwner();
    const record = runRecord("errored", "2026-09-28T00:00:02.000Z");
    record.error = "checkpoint acknowledgement connection lost";
    record.summary.error = record.error;
    await owner.store(record);
    await expect(
      owner.call("getSystemTestRunResult", record.runId),
    ).resolves.toEqual({ summary: record.summary });
    await expect(
      owner.call("getSystemTestRunSnapshot", record.runId),
    ).resolves.toEqual({ status: "done", result: { success: true } });
    await expect(
      owner.call("releaseSystemTestRunExecution", record.runId),
    ).resolves.toEqual({ released: true });
    await expect(
      owner.call("inspectSystemTestRun", record.runId),
    ).resolves.toMatchObject({
      status: "errored",
      error: record.error,
      passed: 1,
    });
  });

  it("does not expose a partial checkpoint when a later evidence read fails", async () => {
    const owner = await recordOwner();
    const initial = runRecord("running", "2026-09-28T00:00:01.000Z");
    initial.suite.results = [];
    await owner.store(initial);
    const checkpoint = runRecord("running", "2026-09-28T00:00:02.000Z");
    checkpoint.suite.results.push({
      ...checkpoint.suite.results[0]!,
      test: { ...checkpoint.suite.results[0]!.test, name: "second-case" },
    });
    const implementation = owner.rpcCall.getMockImplementation()!;
    let reads = 0;
    owner.rpcCall.mockImplementation(async (target, method, args) => {
      if (method === "blobstore.stat" && ++reads === 2)
        throw new Error("evidence connection lost");
      return implementation(target, method, args);
    });
    await expect(owner.store(checkpoint)).rejects.toThrow(
      "evidence connection lost",
    );
    expect(
      owner.sql.exec("SELECT test_name FROM system_test_entries").toArray(),
    ).toEqual([]);
    expect(
      owner.sql
        .exec("SELECT page_index FROM system_test_entry_pages")
        .toArray(),
    ).toEqual([]);
    const header = JSON.parse(
      String(
        owner.sql
          .exec("SELECT record_json FROM system_test_records")
          .toArray()[0]!["record_json"],
      ),
    );
    expect(header.record.updatedAt).toBe(initial.updatedAt);
    expect(header.entryNames).toEqual([]);
    owner.rpcCall.mockImplementation(implementation);
    await owner.store(checkpoint);
    const committed = JSON.parse(
      String(
        owner.sql
          .exec("SELECT record_json FROM system_test_records")
          .toArray()[0]!["record_json"],
      ),
    );
    expect(committed.record.updatedAt).toBe(checkpoint.updatedAt);
    expect(committed.entryNames).toEqual(["large-evidence", "second-case"]);
  });

  it("does not allow a later checkpoint to forget a completed case", async () => {
    const owner = await recordOwner();
    const record = runRecord("running", "2026-09-28T00:00:01.000Z");
    await owner.store(record);
    const later = runRecord("running", "2026-09-28T00:00:02.000Z");
    later.suite.results = [];
    await expect(owner.store(later)).rejects.toThrow(
      "cannot forget completed entries",
    );
    await expect(
      owner.call("inspectSystemTestRun", record.runId),
    ).resolves.toMatchObject({ passed: 1 });
  });

  it("rejects a mismatched record identity without overwriting its existing pages", async () => {
    const owner = await recordOwner();
    const record = runRecord("completed", "2026-09-28T00:00:01.000Z");
    await owner.store(record);
    await expect(
      owner.call(
        "storeSystemTestRunCheckpoint",
        "st_another",
        { ...record, suite: { ...record.suite, results: [] } },
        [],
      ),
    ).rejects.toThrow("invalid identity");
    await expect(
      owner.call("getSystemTestRunResult", record.runId),
    ).resolves.toEqual({ summary: record.summary });
  });
});

describe("owned panel teacher input", () => {
  it("requires a pinned model and one panel source inside the seeded world", () => {
    const input = {contextId:"owned-context",panelId:"panel-id",panelSource:"panels/seeded-world",executorModel:"openai-codex:gpt-6-luna",goal:"Repair the assigned panel"};
    expect(panelTeacherInputSchema.parse(input)).toEqual(input);
    for (const panelSource of ["panels/..", "panels/../other", "panels/seeded/child", "panels/\\other"])
      expect(panelTeacherInputSchema.safeParse({...input,panelSource}).success).toBe(false);
    expect(panelTeacherInputSchema.safeParse({...input,executorModel:"executor"}).success).toBe(false);
    expect(panelTeacherInputSchema.safeParse({...input,programPath:"other.nl"}).success).toBe(false);
  });
});

describe("system-test utility scope ownership", () => {
  it("gives concurrent utility calls distinct finite scope identities", () => {
    const first = systemTestUtilityKeys("doctor", "call-a");
    const second = systemTestUtilityKeys("doctor", "call-b");

    expect(first).not.toEqual(second);
    expect(first.subKey).toBe("system-test-doctor-call-a");
    expect(first.scopeKey).toBe("$systemTestUtility:doctor:call-a");
    expect(second.subKey).toBe("system-test-doctor-call-b");
    expect(second.scopeKey).toBe("$systemTestUtility:doctor:call-b");
  });
});

describe("system-test durable record paging", () => {
  it("preserves a large record exactly in code-unit and UTF-8-bounded SQLite values", () => {
    const text = "🧪abcdefghij".repeat(40_000);
    const pages = splitSystemTestRecord(text);

    expect(pages.length).toBeGreaterThan(1);
    expect(Math.max(...pages.map((page) => page.length))).toBeLessThanOrEqual(
      64 * 1024,
    );
    expect(
      Math.max(
        ...pages.map((page) => new TextEncoder().encode(page).byteLength),
      ),
    ).toBeLessThanOrEqual(256 * 1024);
    expect(pages.join("")).toBe(text);
    expect(
      pages
        .map((page) => new TextDecoder().decode(new TextEncoder().encode(page)))
        .join(""),
    ).toBe(text);
  });

  it("represents an empty record with one durable page", () => {
    expect(splitSystemTestRecord("")).toEqual([""]);
  });

  it("rejects missing or stale pages instead of returning mixed replacement data", () => {
    expect(() =>
      assembleSystemTestRecord(6, 2, [{ page_index: 0, page_text: "abc" }]),
    ).toThrow("incomplete durable pages");
    expect(() =>
      assembleSystemTestRecord(6, 2, [
        { page_index: 0, page_text: "abc" },
        { page_index: 2, page_text: "def" },
      ]),
    ).toThrow("incomplete durable pages");
  });
});

describe("system-test immutable record transfer", () => {
  const digest = "a".repeat(64);
  it("preserves non-ASCII content across byte page boundaries", async () => {
    const record = { text: "x".repeat(65526) + "🧪" + "é".repeat(40000) };
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    const rpc = schemaRpcMock({
      call: async (_target: string, method: string, args: unknown[]) => {
        if (method === "blobstore.stat")
          return { size: bytes.length, mtime: 0 };
        const offset = args[1] as number;
        const length = args[2] as number;
        expect(length).toBeLessThanOrEqual(64 * 1024);
        return {
          bytesBase64: btoa(
            String.fromCharCode(...bytes.slice(offset, offset + length)),
          ),
        };
      },
    });
    expect(
      await readSystemTestRecordBlob(
        createMainRpcCaller(rpc),
        digest,
        bytes.length,
      ),
    ).toEqual(record);
  });

  it("refuses a mismatched byte size before reading a record", async () => {
    const rpc = schemaRpcMock({ call: async () => ({ size: 4, mtime: 0 }) });
    await expect(
      readSystemTestRecordBlob(createMainRpcCaller(rpc), digest, 5),
    ).rejects.toThrow("size does not match");
  });

  it("refuses a truncated byte page rather than parsing partial evidence", async () => {
    const rpc = schemaRpcMock({
      call: async (_target: string, method: string) =>
        method === "blobstore.stat"
          ? { size: 5, mtime: 0 }
          : { bytesBase64: btoa("{}") },
    });
    await expect(
      readSystemTestRecordBlob(createMainRpcCaller(rpc), digest, 5),
    ).rejects.toThrow("truncated");
  });
});

describe("system-test inspection authority", () => {
  // The Base natlang panel's authority test relies on this: a natlang program's `systemTests.inspect` calls this method
  // from a panel eval, and the panel's manifest requests no capability for it because the method has none. It is open
  // and admits only the host or a workspace root, which no manifest request can supply. If it gains a gated capability,
  // that panel must request it.
  it("keeps inspectSystemTestRun open, with no capability of its own", async () => {
    const { instance } = await createTestDO(TestSystemTestRunnerDO, {} as never);
    expect(rpcMethodAuthority(instance, "inspectSystemTestRun")).toMatchObject({
      effect: { kind: "open" },
      tier: "open",
      sensitivity: "read",
    });
  });
});

async function releaseReview(world: SystemReleaseWorld) {
  const owner = await recordOwner();
  const contextId = "owned-system-release";
  const seed = await seedSystemRelease(contextId, world, owner);
  const evidence = new Map<string, string>();
  const calls: { runId: string; name: string; offset: number }[] = [];
  const directory = "/.tmp/owned-release";
  const ports: NonNullable<Parameters<typeof prepareSystemRelease>[4]> = {
    contextId,
    inspect: runId => owner.call("inspectSystemTestRun", runId),
    read: async (runId, name, offset, limit) => {
      calls.push({ runId, name, offset });
      return owner.call("readSystemTestTrajectoryPage", runId, name, true, offset, limit) as ReturnType<typeof ports.read>;
    },
    artifact: {
      directory: async () => directory,
      write: async (path, text) => { evidence.set(path, text); },
      read: async (path, limit) => {
        const bytes = new TextEncoder().encode(evidence.get(path));
        if (!evidence.has(path) || bytes.length > limit) throw new Error("Missing bounded archive");
        return bytes;
      },
      entries: async root => [...evidence.keys()].filter(path => path.startsWith(root + "/")).map(path => path.slice(root.length + 1)),
    },
  };
  return { seed, ports, calls, evidence, prepare: (override = ports) =>
    prepareSystemRelease({ contextId, caseId: world.id }, world, seed, "system-test-runner", override) };
}

describe("retained System release handoff reference", () => {
  for (const world of openSystemReleaseWorlds) {
    it(world.id, async () => {
      const fixture = await releaseReview(world);
      const result = await (await fixture.prepare()).qualify();
      expect(result.checks, JSON.stringify(result.checks)).toEqual(
        Object.fromEntries(Object.keys(result.checks).map(key => [key, true])),
      );
      expect(result.passed).toBe(true);
      const runId = world.expected.selection ? fixture.seed[world.expected.selection] : null;
      expect(result.choice.runId).toBe(runId);
      expect(result.assessment?.disposition).toBe(world.expected.outcome);
      expect(fixture.calls.every(call => call.runId === runId && world.required.includes(call.name))).toBe(true);
      if (world.id.includes("multi-page")) expect(fixture.calls.some(call => call.offset > 4096)).toBe(true);
      if (world.id.includes("runtime-and-secondary")) {
        expect(result.cases[0].primary?.kind).toBe("runtime");
        expect(result.cases[0].cleanup).toHaveLength(1);
      }
      if (world.id.includes("expected-negative-and-runtime")) {
        expect(result.cases[0].expectedToolFailures).toEqual(["EXPECTED_SCOPE_DENIED"]);
        expect(result.cases[0].primary).toBeNull();
        expect(result.cases[1].primary?.kind).toBe("runtime");
      }
      if (result.handoff) {
        const artifact = JSON.parse(fixture.evidence.get(result.handoff.path)!);
        expect(artifact).toMatchObject({ runId, buildKey: fixture.seed.buildKey, cases: result.cases });
      } else expect(fixture.evidence.size).toBe(0);
    });
  }

  it("rejects arbitrary runs, cases, evidence mutation, and premature staging", async () => {
    const world = openSystemReleaseWorlds[0];
    const fixture = await releaseReview(world);
    const { services } = await fixture.prepare();
    const assignment = await services.systemReleaseEvidence.discover();
    await expect(services.systemReleaseEvidence.compare("foreign-assignment")).rejects.toThrow(/assigned checkpoint/);
    await services.systemReleaseEvidence.compare(assignment.id);
    await expect(services.systemReleaseEvidence.inspectCase(assignment.id, fixture.seed.earlier, world.required[0])).rejects.toThrow(/selected exact/);
    await expect(services.systemReleaseEvidence.inspectCase(assignment.id, fixture.seed.current, "extra-check")).rejects.toThrow(/selected exact/);
    const stage = (cases: Parameters<typeof services.systemReleaseHandoff.stage>[3]) =>
      services.systemReleaseHandoff.stage(assignment.id, fixture.seed.current, "stage-acceptance", cases);
    await expect(stage([])).rejects.toThrow(/complete exact/);
    const cases = [];
    for (const name of world.required)
      cases.push(await services.systemReleaseEvidence.inspectCase(assignment.id, fixture.seed.current, name));
    await expect(stage([{ ...cases[0], digest: "tampered" }, ...cases.slice(1)])).rejects.toThrow(/complete exact/);
    expect(fixture.evidence.size).toBe(0);
  });

  it("holds a previously permitted earlier handoff if the nominated run settles before staging", async () => {
    const world = openSystemReleaseWorlds.find(item => item.id.includes("reuse-exact-previous"))!;
    const fixture = await releaseReview(world);
    let first = true;
    const { services } = await fixture.prepare({ ...fixture.ports, inspect: async id => {
      const record = await fixture.ports.inspect(id) as Record<string, unknown>;
      if (id !== fixture.seed.current) return record;
      if (first) { first = false; return record; }
      return { ...record, status: "cancelled", completedAt: "2026-11-22T00:00:00Z" };
    } });
    const assignment = await services.systemReleaseEvidence.discover();
    await services.systemReleaseEvidence.compare(assignment.id);
    const cases = [];
    for (const name of world.required)
      cases.push(await services.systemReleaseEvidence.inspectCase(assignment.id, fixture.seed.earlier, name));
    await expect(services.systemReleaseHandoff.stage(assignment.id, fixture.seed.earlier, "stage-acceptance", cases))
      .rejects.toThrow(/changed before the local handoff/);
    expect(fixture.evidence.size).toBe(0);
  });

  it("rejects an unstable native page and writes no local handoff", async () => {
    const world = openSystemReleaseWorlds.find(item => item.id.includes("multi-page"))!;
    const fixture = await releaseReview(world);
    const { services } = await fixture.prepare({ ...fixture.ports, read: async (id, name, offset, limit) => {
      const page = await fixture.ports.read(id, name, offset, limit);
      return offset ? { ...page, length: page.length + 1 } : page;
    } });
    const assignment = await services.systemReleaseEvidence.discover();
    await services.systemReleaseEvidence.compare(assignment.id);
    await expect(services.systemReleaseEvidence.inspectCase(assignment.id, fixture.seed.current, world.required[0]))
      .rejects.toThrow(/unstable retained/);
    expect(fixture.evidence.size).toBe(0);
  });
});
