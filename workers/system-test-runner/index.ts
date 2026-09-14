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
  failedSystemTestNames,
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

interface PagedSystemTestRecord {
  kind: "paged-system-test-record-v1";
  length: number;
  pageCount: number;
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
  for (
    let offset = 0;
    offset < text.length;
    offset += SYSTEM_TEST_RECORD_PAGE_CODE_UNITS
  ) {
    pages.push(text.slice(offset, offset + SYSTEM_TEST_RECORD_PAGE_CODE_UNITS));
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

function parsePagedSystemTestRecord(
  value: string,
): PagedSystemTestRecord | null {
  try {
    const parsed = JSON.parse(value) as Partial<PagedSystemTestRecord>;
    return parsed.kind === "paged-system-test-record-v1" &&
      Number.isSafeInteger(parsed.length) &&
      Number(parsed.length) >= 0 &&
      Number.isSafeInteger(parsed.pageCount) &&
      Number(parsed.pageCount) >= 1
      ? (parsed as PagedSystemTestRecord)
      : null;
  } catch {
    return null;
  }
}

function systemTestEvalCode(options: SystemTestRunConfig): string {
  return `
    import {
      inspectSystemTestRun,
      installedWorkspaceUnits,
      runSystemTests,
      systemTestTrajectory,
    } from "@workspace-skills/system-testing/cli";
    const options = ${JSON.stringify(options)};
    // Which units this workspace carries is a property of the workspace, not
    // of the catalog: templates are independent repositories and Personal and
    // System install different ones. Read it here, once, from inside the
    // workspace that will run the cases.
    const installedUnits = await installedWorkspaceUnits();
    const progressKey = options.runId;
    const recordScopeKey = "$systemTestRecord:" + progressKey;
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
      const record = await runSystemTests({
        ...options,
        installedUnits,
        contextId: ctx.contextId,
        onProgress: publishProgress,
        onInspectionUpdate: (liveRecord) => {
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
            const serializedRecord = JSON.stringify(cancelledRecord);
            scope[recordScopeKey] = serializedRecord;
          }
        }),
      });
      const serializedRecord = JSON.stringify(record);
      scope[recordScopeKey] = serializedRecord;
      return {
        kind: "system-test-record-v1",
        scopeKey: recordScopeKey,
        length: serializedRecord.length,
      };
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
    this.createRecordPagesTable();
  }

  private createRecordPagesTable(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS system_test_record_pages (
      run_id TEXT NOT NULL,
      page_index INTEGER NOT NULL,
      page_text TEXT NOT NULL,
      PRIMARY KEY (run_id, page_index)
    )`);
  }

  private persistedRecord(runId: string): SystemTestRunRecord | null {
    const row = this.sql
      .exec<{
        record_json: string;
      }>(`SELECT record_json FROM system_test_records WHERE run_id = ?`, runId)
      .toArray()[0];
    if (!row) return null;
    const paged = parsePagedSystemTestRecord(row.record_json);
    if (!paged) return JSON.parse(row.record_json) as SystemTestRunRecord;
    this.createRecordPagesTable();
    const pages = this.sql
      .exec<{ page_index: number; page_text: string }>(
        `SELECT page_index, page_text
         FROM system_test_record_pages
         WHERE run_id = ?
         ORDER BY page_index`,
        runId,
      )
      .toArray();
    let text: string;
    try {
      text = assembleSystemTestRecord(paged.length, paged.pageCount, pages);
    } catch (error) {
      throw new Error(
        `system-test record ${runId} is incomplete: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    return JSON.parse(text) as SystemTestRunRecord;
  }

  private persistRecord(runId: string, value: unknown): SystemTestRunRecord {
    const record = value as SystemTestRunRecord;
    if (record?.runId !== runId || record.schemaVersion !== 1) {
      throw new Error(`system-test record ${runId} has an invalid identity`);
    }
    const serialized = JSON.stringify(record);
    const pages = splitSystemTestRecord(serialized);
    this.createRecordPagesTable();
    const envelope: PagedSystemTestRecord = {
      kind: "paged-system-test-record-v1",
      length: serialized.length,
      pageCount: pages.length,
    };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `DELETE FROM system_test_record_pages WHERE run_id = ?`,
        runId,
      );
      for (const [pageIndex, pageText] of pages.entries()) {
        this.sql.exec(
          `INSERT INTO system_test_record_pages (run_id, page_index, page_text)
           VALUES (?, ?, ?)`,
          runId,
          pageIndex,
          pageText,
        );
      }
      this.sql.exec(
        `INSERT INTO system_test_records (run_id, record_json, completed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           record_json = excluded.record_json,
           completed_at = excluded.completed_at`,
        runId,
        JSON.stringify(envelope),
        Date.now(),
      );
    });
    return record;
  }

  private requirePersistedRecord(runId: string): SystemTestRunRecord {
    const record = this.persistedRecord(runId);
    if (!record)
      throw new Error(`No durable system-test record exists for ${runId}`);
    return record;
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

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
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

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
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

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
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
          code: systemTestEvalCode(options),
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

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getSystemTestRunSnapshot(
    runId: string,
  ): Promise<SystemTestRunnerSnapshot> {
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

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getSystemTestRunResult(
    runId: string,
  ): Promise<SystemTestRunCompletion> {
    const persisted = this.persistedRecord(runId);
    if (persisted) return { summary: persisted.summary };
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
    const record = this.persistRecord(
      runId,
      await this.readStoredSystemTestRecord(
        runId,
        parseStoredSystemTestRecord(status.result.returnValue),
      ),
    );
    return { summary: record.summary };
  }

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async releaseSystemTestRunExecution(
    runId: string,
  ): Promise<{ released: boolean }> {
    const released = await this.rpc.call<{ ok: boolean; existed: boolean }>(
      "main",
      "eval.deleteScopeValue",
      [{ scopeKey: runId, key: systemTestRecordScopeKey(runId) }],
    );
    await this.rpc.call("main", "eval.dispose", [{ scopeKey: runId }]);
    return { released: released.existed };
  }

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
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
    // The inner eval's registered cleanup serializes the complete terminal
    // record under the same durable key as ordinary completion. Read that
    // finite scope directly: starting another eval would incorrectly treat the
    // lookup as a request to reuse the scope as a persistent notebook.
    const scopeKey = systemTestRecordScopeKey(runId);
    let recovered: { length: number };
    try {
      recovered = await this.rpc.call<{ length: number }>(
        "main",
        "eval.readScopeTextPage",
        [
          {
            scopeKey: runId,
            key: scopeKey,
            offset: 0,
            limit: 1,
          },
        ],
      );
    } catch (error) {
      throw new Error(
        `System-test run ${runId} settled, but its terminal cleanup record could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    const record = this.persistRecord(
      runId,
      await this.readStoredSystemTestRecord(runId, {
        kind: "system-test-record-v1",
        scopeKey,
        length: recovered.length,
      }),
    );
    return { summary: record.summary };
  }

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
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
      this.requirePersistedRecord(runId),
      testName ? { testName } : undefined,
    );
  }

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
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
      systemTestTrajectory(this.requirePersistedRecord(runId), testName, {
        full,
      }),
      null,
      2,
    );
    return {
      length: text.length,
      encoding: "plain-string",
      chunk: text.slice(offset, offset + Math.min(limit, 128 * 1024)),
    };
  }

  @rpc({ website: {"kind":"closed","reason":"This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation."},
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getFailedSystemTestRun(runId: string): Promise<{
    config: SystemTestRunRecord["config"];
    names: string[];
  }> {
    const record = this.requirePersistedRecord(runId);
    return { config: record.config, names: failedSystemTestNames(record) };
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

function systemTestRecordScopeKey(runId: string): string {
  return `$systemTestRecord:${runId}`;
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
