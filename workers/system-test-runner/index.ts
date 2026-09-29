/**
 * Sealed authority conduit for the headless system-test harness.
 *
 * System-test source is intentionally evaluated in the normal EvalDO runtime,
 * where its portable APIs actually live. EvalDO recognizes this exact sealed
 * runner build and issues the explicit test policy for its nested runs. No
 * session, shell, or arbitrary eval can impersonate that execution identity.
 */
import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import {
  anyOf,
  methodCapability,
  relationship,
} from "@vibestudio/shared/authorization";
import {
  createEvalExecutor,
  createEvalRunHandle,
  createEvalRunObserver,
} from "@vibestudio/service-schemas/eval";
import {
  inspectSystemTestRun,
  systemTestTrajectory,
} from "@workspace-skills/system-testing/record-analysis";
import type { SystemTestRunRecord } from "@workspace-skills/system-testing/cli";
import { readEvalStatusWithRetry } from "./eval-status-retry.js";

interface SystemTestRunConfig {
  runId: string;
  contextId: string;
  names?: string[];
  category?: string;
  all?: boolean;
  model?: string;
  thinkingLevel?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  concurrency?: number;
  testTimeoutMs?: number;
}

interface EvalRunStatus {
  status:
    | "pending"
    | "running"
    | "cancelling"
    | "done"
    | "cancelled"
    | "approval-route-lost"
    | "unknown";
  progress?: unknown;
  result?: { success: boolean; returnValue?: unknown; error?: string };
}

interface EvalCancelResult {
  ok: true;
  forcedReset: boolean;
}

interface StoredSystemTestRecord {
  kind: "system-test-record-v1";
  scopeKey: string;
  length: number;
}

export interface SystemTestRunCompletion {
  summary: SystemTestRunRecord["summary"];
}

export interface SystemTestRunnerSnapshot {
  status: EvalRunStatus["status"];
  progress?: unknown;
  result?: {
    success: boolean;
    error?: string;
  };
}

const SYSTEM_TEST_OPERATOR = anyOf(
  methodCapability("host"),
  relationship("workspace-role", "root"),
);

// JavaScript slices by UTF-16 code unit. A page is therefore at most 64K code
// units and at most 256KiB once SQLite encodes it as UTF-8.
const SYSTEM_TEST_RECORD_PAGE_CODE_UNITS = 64 * 1024;

export function splitSystemTestRecord(text: string): string[] {
  if (text.length === 0) return [""];
  const pages: string[] = [];
  for (let offset = 0; offset < text.length; ) {
    let end = Math.min(
      text.length,
      offset + SYSTEM_TEST_RECORD_PAGE_CODE_UNITS,
    );
    const last = text.charCodeAt(end - 1),
      next = text.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end -= 1;
    pages.push(text.slice(offset, end));
    offset = end;
  }
  return pages;
}

export function assembleSystemTestRecord(
  expectedLength: number,
  expectedPageCount: number,
  pages: ReadonlyArray<{ page_index: number; page_text: string }>,
): string {
  if (
    pages.length !== expectedPageCount ||
    pages.some((page, index) => page.page_index !== index)
  ) {
    throw new Error("system-test record has incomplete durable pages");
  }
  const text = pages.map((page) => page.page_text).join("");
  if (text.length !== expectedLength) {
    throw new Error(
      `system-test record has invalid durable length (${text.length}/${expectedLength})`,
    );
  }
  return text;
}

/** Read immutable record bytes with bounded RPC pages and one streaming decoder. */
export async function readSystemTestRecordBlob(
  call: <T>(method: string, args: unknown[]) => Promise<T>,
  digest: string,
  size: number,
): Promise<unknown> {
  if (
    !/^[a-f0-9]{64}$/u.test(digest) ||
    !Number.isSafeInteger(size) ||
    size <= 0
  ) {
    throw new Error("Invalid system-test record blob reference");
  }
  const stat = await call<{ size: number } | null>("blobstore.stat", [digest]);
  if (!stat || stat.size !== size)
    throw new Error(
      "System-test record blob size does not match its reference",
    );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let serialized = "";
  const pageBytes = 64 * 1024;
  for (let offset = 0; offset < size; offset += pageBytes) {
    const length = Math.min(pageBytes, size - offset);
    const page = await call<{ bytesBase64: string } | null>(
      "blobstore.getRangeBytes",
      [digest, offset, length],
    );
    if (!page)
      throw new Error(`System-test record blob ${digest} is unavailable`);
    const bytes = Uint8Array.from(atob(page.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    if (bytes.length !== length)
      throw new Error("System-test record blob was truncated");
    serialized += decoder.decode(bytes, { stream: true });
  }
  serialized += decoder.decode();
  return JSON.parse(serialized);
}

function systemTestEvalCode(
  options: SystemTestRunConfig,
  recordOwner: string,
): string {
  return `
    import {
      inspectSystemTestRun,
      failedSystemTestRunRecord,
      failedSystemTestPreparationRecord,
      installedWorkspaceUnits,
      runSystemTests,
      systemTestTrajectory,
    } from "@workspace-skills/system-testing/cli";
    const { blobstore, rpc } = await import("@workspace/runtime");
    const recordOwner = ${JSON.stringify(recordOwner)};
    const options = ${JSON.stringify(options)};
    // Which units this workspace carries is a property of the workspace, not
    // of the catalog: templates are independent repositories and Personal and
    // System install different ones. Read it here, once, from inside the
    // workspace that will run the cases.
    const startedAt = new Date().toISOString();
    const progressKey = options.runId;
    let checkpointCompletedCount = -1;
    let lastRunRecord = null;
    const retainedEntries = new Map();
    const persistRunRecord = async (record) => {
      const completedNames = new Set((lastProgress?.completed || []).map(entry => entry.name));
      const entries = record.suite.results.filter(entry => record.status !== "running" || completedNames.has(entry.test.name));
      for (const entry of entries) {
        if (retainedEntries.has(entry.test.name)) continue;
        const stored = await blobstore.putText(JSON.stringify(entry));
        retainedEntries.set(entry.test.name, { testName: entry.test.name, digest: stored.digest, size: stored.size });
      }
      const header = { ...record, suite: { ...record.suite, results: [] } };
      await rpc.call(recordOwner, "storeSystemTestRunCheckpoint", [progressKey, header, entries.map(entry => retainedEntries.get(entry.test.name))]);
    };
    // EvalDO durably stores each progress payload with a 64 KiB ceiling. Leave
    // room for its event envelope and encoded strings instead of measuring
    // against the larger transient RPC transport limit.
    const durableHeartbeatLimit = 48 * 1024;
    let lastProgress = null;
    const publishProgress = (progress) => {
      let durable = { ...progress, updatedAt: new Date().toISOString() };
      if (JSON.stringify(durable).length > durableHeartbeatLimit && durable.liveInspection) {
        durable = {
          ...durable,
          liveInspection: { inspect: durable.liveInspection.inspect, trajectories: {} },
        };
      }
      if (JSON.stringify(durable).length > durableHeartbeatLimit) {
        const { liveInspection: _omitted, ...withoutInspection } = durable;
        durable = withoutInspection;
      }
      lastProgress = durable;
      ctx.reportProgress(durable);
    };
    try {
      const installedUnits = await installedWorkspaceUnits();
      const record = await runSystemTests({
        ...options,
        installedUnits,
        contextId: ctx.contextId,
        onProgress: publishProgress,
        onInspectionUpdate: async (liveRecord) => {
          lastRunRecord = liveRecord;
          const completedCount = lastProgress?.completed?.length ?? 0;
          if (completedCount !== checkpointCompletedCount) {
            await persistRunRecord(liveRecord);
            checkpointCompletedCount = completedCount;
          }
          const limits = { failures: 2, messages: 4, invocations: 6, debugEvents: 6, text: 300 };
          const inspect = inspectSystemTestRun(liveRecord, { limits });
          const base = { ...(lastProgress || {}) };
          const trajectories = {};
          for (const entry of liveRecord.suite.results) {
            const name = entry.test.name;
            const candidate = {
              ...trajectories,
              [name]: { bounded: systemTestTrajectory(liveRecord, name, { limits }) },
            };
            const heartbeat = { ...base, liveInspection: { inspect, trajectories: candidate } };
            if (JSON.stringify(heartbeat).length <= durableHeartbeatLimit) {
              Object.assign(trajectories, candidate);
            }
          }
          publishProgress({ ...base, liveInspection: { inspect, trajectories } });
        },
        registerCancellationCleanup: (cleanup) => ctx.onCancel(async () => {
          const cancelledRecord = await cleanup();
          if (cancelledRecord) {
            await persistRunRecord(cancelledRecord);
          }
        }),
      });
      lastRunRecord = record;
      await persistRunRecord(record);
      return { runId: record.runId };
    } catch (error) {
      const prior = lastProgress && typeof lastProgress === "object"
        ? lastProgress
        : { runId: progressKey, startedAt: new Date().toISOString(), total: 0, queued: [], running: [], completed: [] };
      publishProgress({
        ...prior,
        status: "errored",
        updatedAt: new Date().toISOString(),
        running: [],
        error: error instanceof Error ? error.message : String(error),
      });
      const failure = error instanceof Error ? error.message : String(error);
      await persistRunRecord(lastRunRecord ? failedSystemTestRunRecord(
          lastRunRecord,
          (lastProgress?.completed || []).map(entry => entry.name),
          failure,
        ) : failedSystemTestPreparationRecord(
          { ...options, contextId: ctx.contextId }, failure, startedAt,
        )).catch(checkpointError => {
          throw new Error(failure + "; terminal checkpoint could not be retained: " + String(checkpointError), { cause: error });
        });
      throw error;
    }
  `;
}

export class SystemTestRunnerDO extends DurableObjectBase {
  protected createTables(): void {
    this.sql.exec(`CREATE TABLE system_test_records (
      run_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL,
      completed_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE system_test_entries (
      run_id TEXT NOT NULL, test_name TEXT NOT NULL, digest TEXT NOT NULL,
      length INTEGER NOT NULL, page_count INTEGER NOT NULL,
      PRIMARY KEY (run_id, test_name)
    )`);
    this.sql.exec(`CREATE TABLE system_test_entry_pages (
      run_id TEXT NOT NULL, test_name TEXT NOT NULL, page_index INTEGER NOT NULL,
      page_text TEXT NOT NULL, PRIMARY KEY (run_id, test_name, page_index)
    )`);
  }

  private persistedHeader(
    runId: string,
  ): { record: SystemTestRunRecord; entryNames: string[] } | null {
    const row = this.sql
      .exec<{
        record_json: string;
      }>(`SELECT record_json FROM system_test_records WHERE run_id = ?`, runId)
      .toArray()[0];
    return row ? JSON.parse(row.record_json) : null;
  }

  private requirePersistedHeader(runId: string) {
    const header = this.persistedHeader(runId);
    if (!header)
      throw new Error(`No durable system-test record exists for ${runId}`);
    return header;
  }

  private requirePersistedRecord(
    runId: string,
    testName?: string,
  ): SystemTestRunRecord {
    const { record, entryNames } = this.requirePersistedHeader(runId);
    const names = testName
      ? entryNames.filter((name) => name === testName)
      : entryNames;
    const results = names.map((name) => {
      const entry = this.sql
        .exec<{
          length: number;
          page_count: number;
        }>(
          `SELECT length, page_count FROM system_test_entries WHERE run_id = ? AND test_name = ?`,
          runId,
          name,
        )
        .toArray()[0];
      if (!entry)
        throw new Error(`Missing retained system-test entry ${runId}/${name}`);
      const pages = this.sql
        .exec<{
          page_index: number;
          page_text: string;
        }>(
          `SELECT page_index, page_text FROM system_test_entry_pages WHERE run_id = ? AND test_name = ? ORDER BY page_index`,
          runId,
          name,
        )
        .toArray();
      return JSON.parse(
        assembleSystemTestRecord(entry.length, entry.page_count, pages),
      );
    });
    return { ...record, suite: { ...record.suite, results } };
  }

  @rpc({
    website: {
      kind: "closed",
      reason: "Only the workspace test operator may retain a run checkpoint.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async storeSystemTestRunCheckpoint(
    runId: string,
    record: SystemTestRunRecord,
    entries: { testName: string; digest: string; size: number }[],
  ): Promise<void> {
    if (
      record?.runId !== runId ||
      record.schemaVersion !== 1 ||
      record.suite.results.length !== 0 ||
      new Set(entries.map((entry) => entry.testName)).size !== entries.length
    )
      throw new Error(`System-test record ${runId} has an invalid identity`);
    const stale = () => {
      const prior = this.persistedHeader(runId);
      return (
        prior &&
        (prior.record.status !== "running" ||
          prior.record.updatedAt > record.updatedAt)
      );
    };
    if (stale()) return;
    const ensureCompletedEntriesRetained = () => {
      const prior = this.persistedHeader(runId);
      const names = new Set(entries.map((entry) => entry.testName));
      if (prior?.entryNames.some((name) => !names.has(name)))
        throw new Error(
          `System-test checkpoint ${runId} cannot forget completed entries`,
        );
    };
    ensureCompletedEntriesRetained();
    const prepared: {
      testName: string;
      digest: string;
      size: number;
      length: number;
      pages: string[];
    }[] = [];
    for (const reference of entries) {
      const prior = this.sql
        .exec<{
          digest: string;
        }>(
          "SELECT digest FROM system_test_entries WHERE run_id = ? AND test_name = ?",
          runId,
          reference.testName,
        )
        .toArray()[0];
      if (prior) {
        if (prior.digest !== reference.digest)
          throw new Error(
            `Completed system-test entry ${runId}/${reference.testName} cannot be replaced`,
          );
        continue;
      }
      const entry = (await readSystemTestRecordBlob(
        <T>(method: string, args: unknown[]) =>
          this.rpc.call<T>("main", method, args),
        reference.digest,
        reference.size,
      )) as SystemTestRunRecord["suite"]["results"][number];
      if (
        entry?.test?.name !== reference.testName ||
        !entry.execution ||
        !entry.result
      )
        throw new Error(
          `System-test entry ${runId}/${reference.testName} has an invalid identity`,
        );
      const serialized = JSON.stringify(entry);
      prepared.push({
        ...reference,
        length: serialized.length,
        pages: splitSystemTestRecord(serialized),
      });
    }
    // All immutable bytes arrive before the storage transaction. Either the
    // checkpoint's entries and header become visible together, or none do.
    // Recheck after external reads so a late writer cannot replace terminal proof.
    this.ctx.storage.transactionSync(() => {
      if (stale()) return;
      ensureCompletedEntriesRetained();
      for (const entry of prepared) {
        const prior = this.sql
          .exec<{
            digest: string;
          }>(
            "SELECT digest FROM system_test_entries WHERE run_id = ? AND test_name = ?",
            runId,
            entry.testName,
          )
          .toArray()[0];
        if (prior) {
          if (prior.digest !== entry.digest)
            throw new Error(
              `Completed system-test entry ${runId}/${entry.testName} cannot be replaced`,
            );
          continue;
        }
        for (const [index, text] of entry.pages.entries())
          this.sql.exec(
            "INSERT INTO system_test_entry_pages (run_id, test_name, page_index, page_text) VALUES (?, ?, ?, ?)",
            runId,
            entry.testName,
            index,
            text,
          );
        this.sql.exec(
          "INSERT INTO system_test_entries (run_id, test_name, digest, length, page_count) VALUES (?, ?, ?, ?, ?)",
          runId,
          entry.testName,
          entry.digest,
          entry.length,
          entry.pages.length,
        );
      }
      this.sql.exec(
        `INSERT INTO system_test_records (run_id, record_json, completed_at) VALUES (?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET record_json = excluded.record_json, completed_at = excluded.completed_at`,
        runId,
        JSON.stringify({
          record,
          entryNames: entries.map((entry) => entry.testName),
        }),
        Date.now(),
      );
    });
  }

  private async runHarnessUtility(
    kind: "doctor" | "list",
    code: string,
  ): Promise<unknown> {
    const runId = `system-test-runner:${kind}:${crypto.randomUUID()}`;
    // A utility call owns a finite EvalDO for exactly one invocation. Startup
    // approval can call doctor while the CLI issues its next doctor/list
    // request, so a kind-only scope would let one invocation dispose or
    // overwrite another invocation's result before it was read.
    const { subKey, scopeKey } = systemTestUtilityKeys(
      kind,
      crypto.randomUUID(),
    );
    try {
      const execute = createEvalExecutor(<T>(method: string, args: unknown[]) =>
        this.rpc.call<T>("main", method, args),
      );
      const result = await execute({
        runId,
        scope: { key: subKey, lifecycle: "finite" },
        source: {
          kind: "inline",
          code: `
          ${code}
          const serialized = JSON.stringify(utilityValue);
          scope[${JSON.stringify(scopeKey)}] = serialized;
          return {
            kind: "system-test-record-v1",
            scopeKey: ${JSON.stringify(scopeKey)},
            length: serialized.length,
          };
        `,
          syntax: "typescript",
        },
      });
      if (!result.success) {
        throw new Error(result.error ?? `system-test ${kind} eval failed`);
      }
      const stored = parseStoredSystemTestRecord(result.returnValue);
      try {
        return await this.readStoredSystemTestRecord(subKey, stored);
      } finally {
        await this.rpc.call("main", "eval.deleteScopeValue", [
          { scopeKey: subKey, key: stored.scopeKey },
        ]);
      }
    } finally {
      await this.rpc.call("main", "eval.dispose", [{ scopeKey: subKey }]);
    }
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async doctor(model?: string): Promise<unknown> {
    return this.runHarnessUtility(
      "doctor",
      `
        import { systemTestDoctor } from "@workspace-skills/system-testing/cli";
        const utilityValue = await systemTestDoctor(${JSON.stringify(model)});
      `,
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async listSystemTests(category?: string): Promise<unknown> {
    return this.runHarnessUtility(
      "list",
      `
        import {
          installedWorkspaceUnits,
          listSystemTests,
        } from "@workspace-skills/system-testing/cli";
        const category = ${JSON.stringify(category)};
        const installedUnits = await installedWorkspaceUnits();
        const utilityValue = listSystemTests({ installedUnits }).filter(
          (test) => !category || test.category === category
        );
      `,
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async startSystemTestRun(
    options: SystemTestRunConfig,
  ): Promise<{ runId: string }> {
    if (!this.caller?.userId || this.caller.userId === "system") {
      throw new Error("System tests require an authenticated human initiator");
    }
    const handle = createEvalRunHandle(
      <T>(method: string, args: unknown[]) =>
        this.rpc.call<T>("main", method, args),
      {
        runId: systemTestEvalRunId(options.runId),
        scope: { key: options.runId, lifecycle: "finite" },
        source: {
          kind: "inline",
          code: systemTestEvalCode(options, this.rpcSelfId),
          syntax: "typescript",
        },
      },
    );
    await handle.start();
    return { runId: options.runId };
  }

  private async readStoredSystemTestRecord(
    runId: string,
    stored: StoredSystemTestRecord,
  ): Promise<unknown> {
    const pageSize = 128 * 1024;
    let text = "";
    for (let offset = 0; offset < stored.length; offset += pageSize) {
      const page = await this.rpc.call<{
        length: number;
        encoding: "utf16le-base64";
        chunk: string;
      }>("main", "eval.readScopeTextPage", [
        {
          scopeKey: runId,
          key: stored.scopeKey,
          offset,
          limit: Math.min(pageSize, stored.length - offset),
        },
      ]);
      if (page.length !== stored.length || page.encoding !== "utf16le-base64") {
        throw new Error(
          `system-test record ${runId} changed while it was being read`,
        );
      }
      text += decodeUtf16LeBase64(page.chunk);
    }
    if (text.length !== stored.length) {
      throw new Error(
        `system-test record ${runId} was truncated (${text.length}/${stored.length} UTF-16 units)`,
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `system-test record ${runId} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getSystemTestRunSnapshot(
    runId: string,
  ): Promise<SystemTestRunnerSnapshot> {
    const record = this.persistedHeader(runId)?.record;
    if (record && record.status !== "running") {
      return { status: "done", result: { success: true } };
    }
    const status = await this.readSystemTestEvalStatus(runId);
    return {
      status: status.status,
      ...(status.progress !== undefined ? { progress: status.progress } : {}),
      ...(status.result
        ? {
            result: {
              success: status.result.success,
              ...(status.result.error ? { error: status.result.error } : {}),
            },
          }
        : {}),
    };
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getSystemTestRunResult(
    runId: string,
  ): Promise<SystemTestRunCompletion> {
    const persisted = this.persistedHeader(runId)?.record;
    if (persisted && persisted.status !== "running")
      return { summary: persisted.summary };
    const status = await this.readSystemTestEvalStatus(runId);
    if (status.status !== "done") {
      throw new Error(
        `System-test run ${runId} is ${status.status}; no terminal result is available`,
      );
    }
    if (!status.result?.success) {
      throw new Error(
        status.result?.error ?? `System-test run ${runId} failed`,
      );
    }
    throw new Error(
      `System-test run ${runId} settled without a durable terminal record`,
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async releaseSystemTestRunExecution(
    runId: string,
  ): Promise<{ released: boolean }> {
    const record = this.requirePersistedHeader(runId).record;
    if (record.status === "running")
      throw new Error(
        `System-test run ${runId} is still active; execution cannot be released`,
      );
    const released = await this.rpc.call<{ ok: boolean }>(
      "main",
      "eval.dispose",
      [{ scopeKey: runId }],
    );
    return { released: released.ok };
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async cancelSystemTestRun(runId: string): Promise<SystemTestRunCompletion> {
    let cancellation: EvalCancelResult;
    try {
      cancellation = await this.evalRunObserver(runId).cancel();
    } catch (error) {
      throw new Error(
        `System-test run ${runId} could not settle its inner eval cancellation: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    if (cancellation.forcedReset) {
      throw new Error(
        `System-test run ${runId} required a forced EvalDO scope reset after non-cooperative cancellation; ` +
          "its terminal cleanup record is unavailable. Restart from a fresh exact run.",
      );
    }
    const record = this.requirePersistedHeader(runId).record;
    if (record.status === "running")
      throw new Error(
        `System-test run ${runId} cancellation did not persist its terminal record`,
      );
    return { summary: record.summary };
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async inspectSystemTestRun(
    runId: string,
    testName?: string,
  ): Promise<unknown> {
    return inspectSystemTestRun(
      this.requirePersistedRecord(runId, testName),
      testName ? { testName } : undefined,
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async readSystemTestTrajectoryPage(
    runId: string,
    testName: string,
    full: boolean,
    offset: number,
    limit: number,
  ): Promise<{ length: number; encoding: "plain-string"; chunk: string }> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    ) {
      throw new Error("Invalid system-test trajectory page range");
    }
    const text = JSON.stringify(
      systemTestTrajectory(
        this.requirePersistedRecord(runId, testName),
        testName,
        {
          full,
        },
      ),
      null,
      2,
    );
    return {
      length: text.length,
      encoding: "plain-string",
      chunk: text.slice(offset, offset + Math.min(limit, 128 * 1024)),
    };
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getFailedSystemTestRun(runId: string): Promise<{
    config: SystemTestRunRecord["config"];
    names: string[];
  }> {
    const record = this.requirePersistedHeader(runId).record;
    return {
      config: record.config,
      names: [
        ...new Set([
          ...record.summary.failedTests,
          ...record.summary.testsWithUnexpectedToolFailures,
        ]),
      ],
    };
  }

  private readSystemTestEvalStatus(runId: string): Promise<EvalRunStatus> {
    return readEvalStatusWithRetry(() => this.evalRunObserver(runId).get());
  }

  private evalRunObserver(runId: string) {
    return createEvalRunObserver(
      <T>(method: string, args: unknown[]) =>
        this.rpc.call<T>("main", method, args),
      { runId: systemTestEvalRunId(runId), scopeKey: runId },
    );
  }
}

export function systemTestUtilityKeys(
  kind: "doctor" | "list",
  invocationId: string,
): { subKey: string; scopeKey: string } {
  return {
    subKey: `system-test-${kind}-${invocationId}`,
    scopeKey: `$systemTestUtility:${kind}:${invocationId}`,
  };
}

function systemTestEvalRunId(runId: string): string {
  return `system-test-runner:${runId}`;
}

function parseStoredSystemTestRecord(value: unknown): StoredSystemTestRecord {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<string, unknown>)["kind"] !== "system-test-record-v1" ||
    typeof (value as Record<string, unknown>)["scopeKey"] !== "string" ||
    !Number.isInteger((value as Record<string, unknown>)["length"]) ||
    Number((value as Record<string, unknown>)["length"]) < 0
  ) {
    throw new Error(
      "system-test eval completed without a stored record envelope",
    );
  }
  return value as StoredSystemTestRecord;
}

function decodeUtf16LeBase64(value: string): string {
  const binary = atob(value);
  if (binary.length % 2 !== 0) throw new Error("invalid UTF-16LE scope page");
  let result = "";
  const chunkSize = 16_384;
  for (let offset = 0; offset < binary.length; offset += chunkSize * 2) {
    const end = Math.min(binary.length, offset + chunkSize * 2);
    const units = new Uint16Array((end - offset) / 2);
    for (let index = offset; index < end; index += 2) {
      units[(index - offset) / 2] =
        binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8);
    }
    result += String.fromCharCode(...units);
  }
  return result;
}

export default {
  async fetch(): Promise<Response> {
    return new Response("System-test runner Durable Object.", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
