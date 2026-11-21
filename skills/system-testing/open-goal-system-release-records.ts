import { isUnexpectedToolFailure } from "./tool-failure-classification.js";
import type { SystemTestRunRecord } from "./cli.js";
import type { TestSuiteResultEntry } from "./types.js";
import type { SystemReleaseWorld } from "./open-goal-system-release-worlds.js";

type Variant = SystemReleaseWorld["current"];
type Check = NonNullable<Variant["checks"]>[number];
type Candidate = { id: string; contextId: string; buildKey: string; effectiveVersion: string };
type StoredEntry = { testName: string; digest: string; size: number };
export type SeededRelease = { caseId: string; contextId: string; current: string; earlier: string; buildKey: string; effectiveVersion: string };
export type CheckpointWriter = {
  put(text: string): Promise<{ digest: string; size: number }>;
  persist(runId: string, header: SystemTestRunRecord, entries: StoredEntry[]): Promise<void>;
};

function entry(candidate: Candidate, name: string, check: Check, subject: string): TestSuiteResultEntry {
  const workflow = !["runtime", "runtime-cleanup", "validator", "assertion", "delivery"].includes(check);
  const runtime = check === "runtime" || check === "runtime-cleanup";
  const cleanup = check === "runtime-cleanup" || check === "cleanup";
  const error = (errorName: string, code: string, message: string) => ({ name: errorName, code, message });
  const deliveryEvidence = { expected: "acknowledged", actual: "late-terminal", sequence: "ordered:" + name };
  const witness = { runId: candidate.id, contextId: check === "foreign-witness" ? "st-foreign-context" : candidate.contextId,
    buildKey: check === "cross-build-witness" ? "foreign-build" : candidate.buildKey, test: name, operationId: crypto.randomUUID(), terminal: "acknowledged" };
  const toolFailure = (expected: boolean) => ({ name: expected ? "owned-denial-check" : "store-readback", expected,
    failureKind: expected ? "user-code" as const : "infrastructure" as const, terminalOutcome: "failed", source: "snapshot" as const,
    failureCode: expected ? "EXPECTED_SCOPE_DENIED" : "RECEIPT_TRANSPORT_FAILED", error: expected ? "The out-of-scope operation was correctly rejected." : "Readback transport closed before it acknowledged the receipt." });
  const faults = runtime ? { phase: "orchestration", error: error("RuntimeUnavailable", "RUN_TIME_BUDGET_EXCEEDED", "The owned receiver timed out before returning an exact result.") } :
    check === "validator" ? { phase: "validation", error: error("ValidatorException", "VALIDATOR_THROW", "The validator threw before it could evaluate observed state.") } :
    undefined;
  return {
    test: { name, category: "release-readiness", description: subject + " retained release evidence", prompt: "Verify the release condition " + name },
    result: {
      passed: workflow,
      ...(workflow ? {} : { reason: check === "assertion" ? "The native comparison found divergent resulting state." :
        check === "delivery" ? "The original operation terminated without the required timely acknowledgment." : "The acceptance condition could not be evaluated." }),
      details: { ...(workflow && check !== "missing-witness" ? { releaseWitness: witness } : {}),
        ...(check === "giant" ? { boundedRetainedNote: "precondition confirmed; ".repeat(540) } : {}) },
    },
    execution: {
      duration: 12, messages: [],
      provenance: { contextId: candidate.contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      ...(runtime ? { error: faults?.error.message } : {}),
      ...(faults ? { failure: faults } : {}),
      ...(check === "validator" ? { validationFailure: { testName: name, validator: "harness", phase: "validation", inputProjection: { name } } } : {}),
      ...(check === "delivery" ? { diagnostics: { channelDeliveryLatency: { violations: ["Terminal acknowledgment exceeded its retained delivery budget."] }, nativeDelivery: deliveryEvidence } } : {}),
      ...(cleanup ? { cleanupErrors: ["The owned test-session close receipt was never observed."],
        cleanupFailures: [{ phase: "cleanup", error: error("CleanupUnconfirmed", "SESSION_CLOSE_UNCONFIRMED", "The owned test-session close receipt was never observed.") }] } : {}),
      ...(check === "expected-denial" || check === "unexpected-tool" ? { toolFailures: [toolFailure(check === "expected-denial")] } : {}),
    },
  };
}

function makeRecord(candidate: Candidate, variant: Variant, world: SystemReleaseWorld, tick: number): SystemTestRunRecord {
  const status = variant.status ?? "completed";
  const resultEntries: TestSuiteResultEntry[] = [];
  const notInstalled: SystemTestRunRecord["summary"]["notInstalled"] = [];
  const declared = [...world.required];
  let skipped = 0;
  for (const [i, name] of world.required.entries()) {
    const check = variant.checks?.[i] ?? "clean";
    if (check === "not-installed") notInstalled.push({ name, missingUnits: ["workers/owned-release-action"] });
    else if (check === "skipped") { skipped++; declared.splice(declared.indexOf(name), 1); }
    else if (check !== "missing") resultEntries.push(entry(candidate, name, check, world.subject));
  }
  if (variant.extra) {
    const name = "out-of-review-smoke";
    declared.push(name);
    resultEntries.push(entry(candidate, name, "clean", world.subject));
  }
  const failedTests = resultEntries.filter(item => !item.result.passed || item.execution.error).map(item => item.test.name);
  const testsWithUnexpectedToolFailures = resultEntries.filter(item => item.execution.toolFailures?.some(isUnexpectedToolFailure)).map(item => item.test.name);
  const toolFailureCount = resultEntries.flatMap(item => item.execution.toolFailures ?? []).filter(isUnexpectedToolFailure).length;
  const errored = resultEntries.filter(item => item.execution.error).length;
  const total = resultEntries.length;
  const failed = failedTests.length - errored;
  const passed = total - failed - errored;
  const startedAt = new Date(Date.UTC(2026, 10, 21, 0, 0, tick)).toISOString();
  const updatedAt = new Date(Date.UTC(2026, 10, 21, 0, 0, tick + 1)).toISOString();
  return {
    schemaVersion: 1, runId: candidate.id, status, startedAt, updatedAt,
    ...(status === "running" ? {} : { completedAt: updatedAt }),
    config: { contextId: candidate.contextId, names: declared, all: false, concurrency: 1,
      modelPolicy: { primaryModel: "retained-source-fixture", activeModel: "retained-source-fixture",
        fallbackModel: null, fallbackThinkingLevel: null, fallbackOn: null, fallbackScope: null, activations: [] } },
    provenance: variant.noBuild ? { buildError: "The execution did not retain build provenance." } : {
      systemTestingBuild: { source: "@workspace-skills/system-testing", found: true, workspaceRoot: "/workspace",
        effectiveVersion: candidate.effectiveVersion, buildKeys: { sourcemap: null, production: candidate.buildKey } },
    },
    summary: { runId: candidate.id, status, total, passed, failed, errored, skipped, notInstalled, toolFailureCount,
      testsWithToolFailures: testsWithUnexpectedToolFailures.length, durationMs: 12, failedTests, testsWithUnexpectedToolFailures },
    suite: { total, passed, failed, errored, skipped, duration: 12, toolFailureCount, testsWithToolFailures: testsWithUnexpectedToolFailures.length,
      results: resultEntries },
  };
}

export async function seedSystemRelease(contextId: string, world: SystemReleaseWorld, writer: CheckpointWriter): Promise<SeededRelease> {
  const token = crypto.randomUUID();
  const buildKey = "local-acceptance-build:" + token, effectiveVersion = "effective:" + token;
  const current = "st-release-" + token + "-current", earlier = "st-release-" + token + "-earlier";
  for (const [runId, variant, tick] of [[earlier, world.earlier, 1], [current, world.current, 5]] as const) {
    if (variant.missingRun) continue;
    const candidate = {
      id: runId,
      contextId: variant.foreign ? "fixture-foreign-context:" + token : contextId,
      buildKey: variant.oldBuild ? "prior-" + buildKey : buildKey,
      effectiveVersion: variant.wrongVersion || variant.oldBuild ? "prior-" + effectiveVersion : effectiveVersion,
    };
    const record = makeRecord(candidate, variant, world, tick);
    const refs = [];
    for (const result of record.suite.results) {
      const stored = await writer.put(JSON.stringify(result));
      refs.push({ testName: result.test.name, ...stored });
    }
    await writer.persist(runId, { ...record, suite: { ...record.suite, results: [] } }, refs);
  }
  return { caseId: world.id, contextId, current, earlier, buildKey, effectiveVersion };
}
