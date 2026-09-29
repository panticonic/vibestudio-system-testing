import { describe, expect, it, vi } from "vitest";
import { createTestDO } from "@vibestudio/durable/test-utils";
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

async function recordOwner() {
  const owner = await createTestDO(SystemTestRunnerDO, {
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
      if (method === "blobstore.stat") return { size: bytes.length };
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
  Object.defineProperty(owner.instance, "rpc", {
    value: { call: rpcCall },
    configurable: true,
  });
  const store = async (record: SystemTestRunRecord) => {
    const references = [];
    for (const entry of record.suite.results) {
      const bytes = new TextEncoder().encode(JSON.stringify(entry));
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const digest = [...hash]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      blobs.set(digest, bytes);
      references.push({
        testName: entry.test.name,
        digest,
        size: bytes.length,
      });
    }
    await owner.call(
      "storeSystemTestRunCheckpoint",
      record.runId,
      { ...record, suite: { ...record.suite, results: [] } },
      references,
    );
  };
  return { ...owner, rpcCall, store };
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
      const page = await owner.call<{ length: number; chunk: string }>(
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
    const inspected = await owner.call<Record<string, unknown>>(
      "inspectSystemTestRun",
      record.runId,
    );
    expect(inspected["status"]).toBe("errored");
    expect(inspected["error"]).toBe(record.error);
    expect(inspected["passed"]).toBe(1);
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
    const inspected = await owner.call<Record<string, unknown>>(
      "inspectSystemTestRun",
      record.runId,
    );
    expect(inspected["passed"]).toBe(1);
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
    const call = async <T>(method: string, args: unknown[]): Promise<T> => {
      if (method === "blobstore.stat") return { size: bytes.length } as T;
      const offset = args[1] as number;
      const length = args[2] as number;
      expect(length).toBeLessThanOrEqual(64 * 1024);
      return {
        bytesBase64: btoa(
          String.fromCharCode(...bytes.slice(offset, offset + length)),
        ),
      } as T;
    };
    expect(await readSystemTestRecordBlob(call, digest, bytes.length)).toEqual(
      record,
    );
  });

  it("refuses a mismatched byte size before reading a record", async () => {
    const call = async <T>(): Promise<T> => ({ size: 4 }) as T;
    await expect(readSystemTestRecordBlob(call, digest, 5)).rejects.toThrow(
      "size does not match",
    );
  });

  it("refuses a truncated byte page rather than parsing partial evidence", async () => {
    const call = async <T>(method: string): Promise<T> =>
      (method === "blobstore.stat"
        ? { size: 5 }
        : { bytesBase64: btoa("{}") }) as T;
    await expect(readSystemTestRecordBlob(call, digest, 5)).rejects.toThrow(
      "truncated",
    );
  });
});
