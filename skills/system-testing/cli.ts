import { rpc, workers } from "@workspace/runtime";
import { logIdForChannel } from "@vibestudio/trajectory-identity";
import { HeadlessRunner } from "./runner.js";
import { allTests } from "./stages.js";
import { TestRunner } from "./test-runner.js";
import type { TestCase, TestSuiteResult, TestSuiteResultEntry } from "./types.js";
import { isUnexpectedToolFailure } from "./tool-failure-classification.js";
import {
  failedSystemTestNames,
  inspectSystemTestRun,
  systemTestTrajectory,
} from "./record-analysis.js";

export { failedSystemTestNames, inspectSystemTestRun, systemTestTrajectory };
import {
  SYSTEM_TEST_AGENT_MODEL,
  systemTestModelRoute,
  type SystemTestThinkingLevel,
} from "./config.js";

export const SYSTEM_TEST_RUN_SCHEMA_VERSION = 1 as const;

export interface SystemTestDescriptor {
  name: string;
  category: string;
  description: string;
  orchestrated: boolean;
  /** Workspace units the case needs; empty when it runs in any workspace. */
  requiresUnits: string[];
  /**
   * Whether this workspace carries those units. Absent when the caller did
   * not say which units are installed, which is the pure-catalog listing.
   */
  installed?: boolean;
}

export interface SystemTestRunOptions {
  runId: string;
  contextId: string;
  names?: string[];
  category?: string;
  all?: boolean;
  /**
   * Repo paths this workspace carries, as the caller observed them. A case
   * whose `requiresUnits` are not all present is skipped rather than run:
   * it belongs to a workspace built from different templates.
   */
  installedUnits?: readonly string[];
  model?: string;
  thinkingLevel?: SystemTestThinkingLevel;
  concurrency?: number;
  testTimeoutMs?: number;
  /** Durable orchestration heartbeat supplied by CLI/UI hosts. */
  onProgress?: (progress: SystemTestRunProgress) => void | Promise<void>;
  /** EvalDO cancellation hook; lets a cancelled orchestration retire children before RPC abort. */
  registerCancellationCleanup?: (cleanup: () => Promise<SystemTestRunRecord | void>) => void;
  /** Periodic, non-blocking record used by the CLI to inspect a running case. */
  onInspectionUpdate?: (record: SystemTestRunRecord) => void | Promise<void>;
}

export interface SystemTestRunProgress {
  runId: string;
  status: "running" | "completed" | "cancelled" | "errored";
  startedAt: string;
  updatedAt: string;
  total: number;
  queued: string[];
  running: Array<{
    name: string;
    category: string;
    startedAt: string;
    phase: string;
    phaseStartedAt: string;
  }>;
  completed: Array<{
    name: string;
    category: string;
    outcome: "passed" | "failed" | "errored";
    durationMs: number;
    reason?: string;
    channelId?: string;
  }>;
  error?: string;
}

export interface SystemTestRunSummary {
  runId: string;
  status: "running" | "completed" | "cancelled";
  total: number;
  passed: number;
  failed: number;
  errored: number;
  toolFailureCount: number;
  testsWithToolFailures: number;
  skipped: number;
  /**
   * Cases excluded because this workspace does not carry the units they name.
   * They are not failures and not ordinary skips: another workspace covers
   * them.
   */
  notInstalled: Array<{ name: string; missingUnits: string[] }>;
  durationMs: number;
  failedTests: string[];
  testsWithUnexpectedToolFailures: string[];
}

export interface SystemTestRunRecord {
  schemaVersion: typeof SYSTEM_TEST_RUN_SCHEMA_VERSION;
  runId: string;
  status: "running" | "completed" | "cancelled";
  startedAt: string;
  /** Last durable observation/checkpoint time for every run state. */
  updatedAt: string;
  /** Present only after the run reaches a terminal state. */
  completedAt?: string;
  config: {
    contextId: string;
    names: string[];
    category?: string;
    all: boolean;
    model?: string;
    thinkingLevel?: SystemTestThinkingLevel;
    modelPolicy: ReturnType<HeadlessRunner["modelPolicySnapshot"]>;
    concurrency: number;
    testTimeoutMs?: number;
  };
  provenance: {
    connection?: unknown;
    connectionError?: string;
    systemTestingBuild?: unknown;
    buildError?: string;
  };
  summary: SystemTestRunSummary;
  suite: TestSuiteResult;
}

export interface SystemTestDoctorResult {
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    detail: string;
    data?: unknown;
  }>;
}

const DEFAULT_CONCURRENCY = 1;
const LIVE_COMPLETED_PROBLEM_LIMIT = 4;
const LIVE_MESSAGE_LIMIT = 20;
const LIVE_INVOCATION_LIMIT = 30;
const LIVE_DEBUG_EVENT_LIMIT = 40;
export function listSystemTests(
  options: { installedUnits?: readonly string[] } = {}
): SystemTestDescriptor[] {
  const installed = options.installedUnits ? new Set(options.installedUnits) : null;
  return allTests().map((test) => ({
    name: test.name,
    category: test.category,
    description: test.description,
    orchestrated: typeof test.orchestrate === "function",
    requiresUnits: [...(test.requiresUnits ?? [])],
    ...(installed
      ? { installed: (test.requiresUnits ?? []).every((unit) => installed.has(unit)) }
      : {}),
  }));
}

/**
 * The repo paths this workspace installs.
 *
 * Templates are independent repositories, so this is the workspace answering
 * for itself rather than the catalog assuming. `source` is the repo path a
 * case names in `requiresUnits`.
 */
export async function installedWorkspaceUnits(): Promise<string[]> {
  const units = (await rpc.call("main", "build.listUnits", [])) as Array<{ source?: unknown }>;
  return units
    .map((unit) => unit.source)
    .filter((source): source is string => typeof source === "string" && source.length > 0);
}

/** Units a case needs that this workspace does not carry. */
export function missingUnitsFor(
  test: Pick<TestCase, "requiresUnits">,
  installedUnits: readonly string[] | undefined
): string[] {
  if (!installedUnits) return [];
  const installed = new Set(installedUnits);
  return [...(test.requiresUnits ?? [])].filter((unit) => !installed.has(unit));
}

export async function runSystemTests(options: SystemTestRunOptions): Promise<SystemTestRunRecord> {
  const startedAt = new Date().toISOString();
  const { selected, notInstalled } = selectTests(options);
  const concurrency = normalizePositiveInt(options.concurrency, DEFAULT_CONCURRENCY);
  const testTimeoutMs =
    options.testTimeoutMs === undefined
      ? undefined
      : normalizePositiveInt(options.testTimeoutMs, options.testTimeoutMs);
  const provenance: SystemTestRunRecord["provenance"] = {};
  const queued = new Set(selected.map((test) => test.name));
  const running = new Map<
    string,
    {
      name: string;
      category: string;
      startedAt: string;
      phase: string;
      phaseStartedAt: string;
    }
  >();
  const completed: SystemTestRunProgress["completed"] = [];
  const completedEntries: TestSuiteResultEntry[] = [];
  const publishProgress = async (status: SystemTestRunProgress["status"]): Promise<void> => {
    if (!options.onProgress) return;
    await options.onProgress({
      runId: options.runId,
      status,
      startedAt,
      updatedAt: new Date().toISOString(),
      total: selected.length,
      queued: [...queued],
      running: [...running.values()],
      completed: [...completed],
    });
  };
  const publishInBackground = (label: string, task: Promise<void>): void => {
    void task.catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: `system-test ${label} publication failed`,
          runId: options.runId,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    });
  };
  await publishProgress("running");

  try {
    provenance.connection = await rpc.call("main", "auth.getConnectionInfo", []);
  } catch (error) {
    provenance.connectionError = error instanceof Error ? error.message : String(error);
  }
  try {
    provenance.systemTestingBuild = await rpc.call("main", "build.inspectBuildProvenance", [
      "@workspace-skills/system-testing",
    ]);
  } catch (error) {
    provenance.buildError = error instanceof Error ? error.message : String(error);
  }

  const model = options.model ?? SYSTEM_TEST_AGENT_MODEL;
  const runner = new HeadlessRunner(options.contextId, {
    ...(options.model ? { model } : {}),
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
  });
  const tester = new TestRunner(runner, {
    testTimeoutMs,
    onTestStart: (test) => {
      const now = new Date().toISOString();
      queued.delete(test.name);
      running.set(test.name, {
        name: test.name,
        category: test.category,
        startedAt: now,
        phase: "starting",
        phaseStartedAt: now,
      });
      publishInBackground("progress", publishProgress("running"));
    },
    onTestPhase: (test, phase) => {
      const active = running.get(test.name);
      if (!active || active.phase === phase) return;
      running.set(test.name, {
        ...active,
        phase,
        phaseStartedAt: new Date().toISOString(),
      });
      publishInBackground("progress", publishProgress("running"));
    },
    onTestResult: (entry) => {
      completedEntries.push(entry);
      running.delete(entry.test.name);
      completed.push({
        name: entry.test.name,
        category: entry.test.category,
        outcome: entry.execution.error ? "errored" : entry.result.passed ? "passed" : "failed",
        durationMs: entry.execution.duration,
        ...(entry.result.reason ? { reason: entry.result.reason } : {}),
        ...(entry.execution.provenance?.channelId
          ? { channelId: entry.execution.provenance.channelId }
          : {}),
      });
      // Progress is observability, not execution ownership. A malformed or
      // temporarily unavailable inspector must never abort the remaining
      // suite after the test itself has already reached a terminal state.
      publishInBackground("progress", publishProgress("running"));
    },
  });
  let inspectionPublishing = false;
  const publishInspection = async (): Promise<void> => {
    if (!options.onInspectionUpdate || inspectionPublishing) return;
    inspectionPublishing = true;
    try {
      // Keep completed successes out of the heartbeat, but retain a bounded tail
      // of failures and unexpected tool failures. This makes an active suite's
      // first failure immediately inspectable without letting every heartbeat
      // grow with the total suite size.
      const results: TestSuiteResultEntry[] = completedEntries
        .filter(
          (entry) =>
            entry.execution.error != null ||
            !entry.result.passed ||
            (entry.execution.toolFailures?.length ?? 0) > 0
        )
        .slice(-LIVE_COMPLETED_PROBLEM_LIMIT)
        .map(boundedLiveEntry);
      const snapshots = runner.snapshotAll();
      for (const active of running.values()) {
        const test = selected.find((candidate) => candidate.name === active.name);
        const snapshot = snapshots.filter((row) => row.testName === active.name).at(-1)?.snapshot;
        if (!test || !snapshot) continue;
        results.push({
          test: {
            name: test.name,
            category: test.category,
            description: test.description,
            prompt: test.prompt,
          },
          result: { passed: false, reason: "System test is still running" },
          execution: {
            messages: [...snapshot.messages],
            duration: Math.max(0, Date.now() - Date.parse(active.startedAt)),
            snapshot,
            modelExecutionEvidence: snapshot.modelExecutionEvidence,
            provenance: snapshotProvenance(snapshot),
            toolFailures: snapshot.invocations
              .filter((invocation) => /failed|error|cancel/i.test(invocation.status))
              .map((invocation) => ({
                id: invocation.id,
                name: invocation.name,
                status: invocation.status,
                ...(invocation.error ? { error: invocation.error } : {}),
                source: "snapshot" as const,
              })),
          },
        });
      }
      const suite = suiteFromEntries(
        results,
        Math.max(0, listSystemTests().length - selected.length),
        Date.now() - Date.parse(startedAt)
      );
      await options.onInspectionUpdate({
        schemaVersion: SYSTEM_TEST_RUN_SCHEMA_VERSION,
        runId: options.runId,
        status: "running",
        startedAt,
        updatedAt: new Date().toISOString(),
        config: runConfig(options, selected, model, concurrency, testTimeoutMs, runner),
        provenance,
        summary: summarizeRun(options.runId, suite, "running", notInstalled),
        suite,
      });
    } finally {
      inspectionPublishing = false;
    }
  };
  const inspectionTimer = options.onInspectionUpdate
    ? setInterval(() => publishInBackground("inspection", publishInspection()), 5_000)
    : undefined;
  let resolveTerminalRecord!: (record: SystemTestRunRecord | void) => void;
  const terminalRecord = new Promise<SystemTestRunRecord | void>((resolve) => {
    resolveTerminalRecord = resolve;
  });
  options.registerCancellationCleanup?.(async () => {
    tester.cancel(new Error(`System-test run ${options.runId} cancelled`));
    return await terminalRecord;
  });
  let suite: TestSuiteResult;
  try {
    suite = await runSelectedTests(tester, selected, concurrency);
  } catch (error) {
    resolveTerminalRecord();
    throw error;
  } finally {
    if (inspectionTimer !== undefined) clearInterval(inspectionTimer);
  }
  suite.skipped = Math.max(0, listSystemTests().length - selected.length - notInstalled.length);
  const status = tester.cancelled ? "cancelled" : "completed";
  const summary = summarizeRun(options.runId, suite, status, notInstalled);
  if (tester.cancelled) queued.clear();
  try {
    await publishProgress(status);
  } catch (error) {
    resolveTerminalRecord();
    throw error;
  }

  const completedAt = new Date().toISOString();
  const record: SystemTestRunRecord = {
    schemaVersion: SYSTEM_TEST_RUN_SCHEMA_VERSION,
    runId: options.runId,
    status,
    startedAt,
    updatedAt: completedAt,
    completedAt,
    config: runConfig(options, selected, model, concurrency, testTimeoutMs, runner),
    provenance,
    summary,
    suite,
  };
  resolveTerminalRecord(record);
  return record;
}

function boundedLiveEntry(entry: TestSuiteResultEntry): TestSuiteResultEntry {
  const snapshot = entry.execution.snapshot;
  return {
    ...entry,
    execution: {
      ...entry.execution,
      messages: entry.execution.messages.slice(-LIVE_MESSAGE_LIMIT),
      ...(snapshot
        ? {
            snapshot: {
              ...snapshot,
              messages: snapshot.messages.slice(-LIVE_MESSAGE_LIMIT),
              invocations: snapshot.invocations.slice(-LIVE_INVOCATION_LIMIT),
              debugEvents: snapshot.debugEvents.slice(-LIVE_DEBUG_EVENT_LIMIT),
            },
          }
        : {}),
    },
  };
}

export function getSystemTestRun(runs: unknown, runId: string): SystemTestRunRecord | null {
  if (!runs || typeof runs !== "object" || Array.isArray(runs)) return null;
  const record = (runs as Record<string, unknown>)[runId];
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const candidate = record as Partial<SystemTestRunRecord>;
  return candidate.schemaVersion === SYSTEM_TEST_RUN_SCHEMA_VERSION && candidate.runId === runId
    ? (candidate as SystemTestRunRecord)
    : null;
}

/**
 * Say what to do about an unusable agent model, not only that it is unusable.
 *
 * A missing provider credential is the one doctor failure an operator is
 * expected to resolve themselves, and it is reached before any test can run —
 * so the check has to name the exact command rather than leave the remedy to
 * be rediscovered in the host's source.
 */
export function unusableModelDetail(unusable: {
  model: string;
  availability: string;
  detail?: string;
}): string {
  const provider = unusable.model.split(":")[0] ?? unusable.model;
  const connect =
    `connect it from the host CLI with \`vibestudio model connect ${provider}\`` +
    " (add `--manual` to print the authorization URL when this host has no browser)";
  if (unusable.detail === "no-credential") {
    return `model ${unusable.model} has no connected credential for provider "${provider}": ${connect}`;
  }
  if (unusable.detail === "credential-expired") {
    return `model ${unusable.model} has an expired credential for provider "${provider}" that cannot refresh: ${connect}`;
  }
  if (unusable.detail === "not-installed") {
    return `model ${unusable.model} is not installed on this host`;
  }
  return `model ${unusable.model} is not usable (${unusable.availability}${
    unusable.detail ? `: ${unusable.detail}` : ""
  })`;
}

export async function systemTestDoctor(
  expectedModel: string | null | undefined,
  readWorkspaceText: (path: string) => Promise<string>
): Promise<SystemTestDoctorResult> {
  const primaryModel = expectedModel ?? SYSTEM_TEST_AGENT_MODEL;
  const checks: SystemTestDoctorResult["checks"] = [];
  const capture = async (name: string, operation: () => Promise<unknown>, detail: string) => {
    try {
      const data = await operation();
      checks.push({ name, ok: true, detail, data });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  checks.push({
    name: "test-catalog",
    ok: listSystemTests().length > 0,
    detail: `${listSystemTests().length} tests discovered`,
  });
  await capture(
    "server",
    () => rpc.call("main", "auth.getConnectionInfo", []),
    "server identity and workspace are reachable"
  );
  await capture(
    "system-testing-build",
    () => rpc.call("main", "build.inspectBuildProvenance", ["@workspace-skills/system-testing"]),
    "system-testing package is importable"
  );
  await capture(
    "agent-worker",
    async () => {
      const units = (await rpc.call("main", "build.listUnits", [])) as Array<{
        name: string;
        status: "available" | "building" | "ready" | "approval-required" | "error";
        lastError?: string | null;
      }>;
      const agentUnit = units.find(
        (unit) => unit.name === "workers/agent-worker" || unit.name.includes("agent-worker")
      );
      if (!agentUnit) throw new Error("workers/agent-worker is not declared");
      if (agentUnit.status === "approval-required") {
        throw new Error("workers/agent-worker is awaiting source approval");
      }
      if (agentUnit.status === "error") {
        throw new Error(agentUnit.lastError || "workers/agent-worker is in error state");
      }
      return agentUnit;
    },
    "agent worker source is declared and approved for on-demand activation"
  );
  await capture(
    "required-extensions",
    async () => {
      const [units, config] = await Promise.all([
        rpc.call("main", "build.listUnits", []) as Promise<
          Array<{
            name: string;
            kind: string;
            source: string;
            status: "available" | "building" | "ready" | "approval-required" | "error";
            lastError: string | null;
          }>
        >,
        rpc.call("main", "workspace.getConfig", []) as Promise<{
          extensions?: Array<{ source: string }>;
        }>,
      ]);
      const declared = (config.extensions ?? []).map(({ source }) => ({
        source,
        unit: units.find(
          (candidate) => candidate.kind === "extension" && candidate.source === source
        ),
      }));
      const unready = declared.flatMap(({ source, unit }) => {
        if (!unit) return [`${source}=missing`];
        return unit.status !== "approval-required" && unit.status !== "error"
          ? []
          : [`${unit.name}=${unit.status}${unit.lastError ? ` (${unit.lastError})` : ""}`];
      });
      if (unready.length > 0) {
        throw new Error(
          `declared workspace extensions are not ready: ${unready.join(
            ", "
          )}. Complete the startup unit review before running agentic tests.`
        );
      }
      return declared.map(({ source, unit }) => ({
        source,
        name: unit?.name,
        status: unit?.status,
      }));
    },
    "declared workspace extensions are approved and build-ready"
  );
  await capture(
    "workspace-configuration",
    async () => {
      const source = await readWorkspaceText("meta/vibestudio.yml");
      return rpc.call("main", "workspace.validateConfig", [source]);
    },
    "the workspace has a valid standalone runtime configuration"
  );
  await capture(
    "claude-code-extension",
    () =>
      rpc.call("main", "extensions.invokeProvider", [
        "claudeCode",
        "resolvePrimaryChannel",
        [{ contextId: "system-test-doctor-probe" }],
      ]),
    "Claude Code provider is registered and activatable"
  );
  await capture(
    "model",
    async () => {
      const modelRoute = systemTestModelRoute(primaryModel, typeof expectedModel !== "string");
      const service = await workers.resolveService("vibestudio.models.v1", null);
      if (service.kind !== "durable-object" || !service.methods["inspectModels"]) {
        throw new Error("vibestudio.models.v1 did not resolve to a Durable Object");
      }
      const required = [
        modelRoute.primaryModel,
        ...(modelRoute.fallbackModel ? [modelRoute.fallbackModel] : []),
      ];
      const inspected = (await service.methods["inspectModels"](required)) as {
        models?: Array<{ ref?: string; availability?: { state?: string; detail?: string } }>;
      };
      const availability = required.map((modelRef) => {
        const found = inspected.models?.find((model) => model.ref === modelRef)?.availability;
        return {
          model: modelRef,
          availability: found?.state ?? "unknown",
          ...(found?.detail ? { detail: found.detail } : {}),
        };
      });
      const unusable = availability.find(
        (entry) => entry.availability !== "ready" && entry.availability !== "startable"
      );
      if (unusable) {
        throw new Error(unusableModelDetail(unusable));
      }
      return {
        primary: availability[0],
        usageLimitFallback:
          modelRoute.fallbackModel === null
            ? null
            : {
                ...availability[1],
                thinkingLevel: modelRoute.fallbackThinkingLevel,
                scope: modelRoute.fallbackScope,
              },
      };
    },
    "system-test agent models are configured and credentialed"
  );

  return { ok: checks.every((check) => check.ok), checks };
}

function selectTests(options: SystemTestRunOptions): {
  selected: TestCase[];
  notInstalled: Array<{ name: string; missingUnits: string[] }>;
} {
  const tests = allTests();
  const names = [...new Set((options.names ?? []).filter(Boolean))];
  const known = new Map(tests.map((test) => [test.name, test]));
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`Unknown system test(s): ${unknown.join(", ")}`);

  let selected = options.all === true ? tests : names.map((name) => known.get(name)!);
  if (options.category) {
    selected = (options.all === true || names.length === 0 ? tests : selected).filter(
      (test) => test.category === options.category
    );
  }
  const notInstalled: Array<{ name: string; missingUnits: string[] }> = [];
  selected = selected.filter((test) => {
    const missingUnits = missingUnitsFor(test, options.installedUnits);
    if (missingUnits.length === 0) return true;
    notInstalled.push({ name: test.name, missingUnits });
    return false;
  });
  if (selected.length === 0) {
    if (notInstalled.length > 0) {
      throw new Error(
        `Every selected system test needs units this workspace does not carry: ${notInstalled
          .map((entry) => `${entry.name} (${entry.missingUnits.join(", ")})`)
          .join("; ")}`
      );
    }
    throw new Error("No system tests selected; pass exact names, a category, or all=true");
  }
  return { selected, notInstalled };
}

function summarizeRun(
  runId: string,
  suite: TestSuiteResult,
  status: SystemTestRunSummary["status"],
  notInstalled: SystemTestRunSummary["notInstalled"] = []
): SystemTestRunSummary {
  const failedTests = suite.results
    .filter(
      (entry) =>
        !isLiveRunningEntry(entry) && (!entry.result.passed || Boolean(entry.execution.error))
    )
    .map((entry) => entry.test.name);
  const testsWithUnexpectedToolFailures = suite.results
    .filter((entry) => (entry.execution.toolFailures ?? []).some(isUnexpectedToolFailure))
    .map((entry) => entry.test.name);
  return {
    runId,
    status,
    total: suite.total,
    passed: suite.passed,
    failed: suite.failed,
    errored: suite.errored,
    toolFailureCount: suite.toolFailureCount ?? 0,
    testsWithToolFailures: suite.testsWithToolFailures ?? 0,
    skipped: suite.skipped,
    notInstalled,
    durationMs: suite.duration,
    failedTests,
    testsWithUnexpectedToolFailures,
  };
}

function runConfig(
  options: SystemTestRunOptions,
  selected: TestCase[],
  model: string,
  concurrency: number,
  testTimeoutMs: number | undefined,
  runner: HeadlessRunner
): SystemTestRunRecord["config"] {
  return {
    contextId: options.contextId,
    names: selected.map((test) => test.name),
    ...(options.category ? { category: options.category } : {}),
    all: options.all === true,
    model,
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    modelPolicy: runner.modelPolicySnapshot(),
    concurrency,
    testTimeoutMs,
  };
}

function snapshotProvenance(snapshot: import("@workspace/agentic-session").SessionSnapshot) {
  return {
    channelId: snapshot.channelId,
    branchId: snapshot.channelId ? logIdForChannel(snapshot.channelId) : null,
    agentEntityId: snapshot.agentEntityId,
    agentTargetId: snapshot.agentTargetId,
    contextId: snapshot.agentContextId,
  };
}

function suiteFromEntries(
  results: TestSuiteResultEntry[],
  skipped: number,
  duration: number
): TestSuiteResult {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let toolFailureCount = 0;
  let testsWithToolFailures = 0;
  for (const entry of results) {
    if (!isLiveRunningEntry(entry)) {
      if (entry.execution.error) errored++;
      else if (entry.result.passed) passed++;
      else failed++;
    }
    const failures = (entry.execution.toolFailures ?? []).filter(isUnexpectedToolFailure).length;
    toolFailureCount += failures;
    if (failures > 0) testsWithToolFailures++;
  }
  return {
    total: passed + failed + errored,
    passed,
    failed,
    errored,
    toolFailureCount,
    testsWithToolFailures,
    skipped,
    duration,
    results,
  };
}

function isLiveRunningEntry(entry: TestSuiteResultEntry): boolean {
  return entry.result.reason === "System test is still running" && !entry.execution.error;
}

async function runSelectedTests(
  tester: TestRunner,
  selected: TestCase[],
  concurrency: number
): Promise<TestSuiteResult> {
  return tester.runSuite(selected, { concurrency });
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}
