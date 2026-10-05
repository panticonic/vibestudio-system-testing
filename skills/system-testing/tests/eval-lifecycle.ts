import type {
  TestCase,
  TestExecutionResult,
  TestOrchestrationContext,
} from "../types.js";
import {
  systemTestFailure,
  type SystemTestFailure,
} from "../structured-error.js";
import { getToolCalls, getToolExecutions } from "./_helpers.js";
import {
  completedScenarioEvidence,
  invocationReturnValue,
  walkArrays,
  walkRecords,
} from "./_scenario-evidence.js";

function successfulEvalCalls(result: TestExecutionResult) {
  return getToolCalls(result).filter(
    (call) =>
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
}

function invocationKernelIncarnation(
  call: ReturnType<typeof getToolCalls>[number],
): string | null {
  const result = call.execution?.result;
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  const details = (result as Record<string, unknown>)["details"];
  if (!details || typeof details !== "object" || Array.isArray(details))
    return null;
  const kernel = (details as Record<string, unknown>)["kernel"];
  if (!kernel || typeof kernel !== "object" || Array.isArray(kernel))
    return null;
  const incarnationId = (kernel as Record<string, unknown>)["incarnationId"];
  return typeof incarnationId === "string" && incarnationId.length > 0
    ? incarnationId
    : null;
}

function validateDbPersistence(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const calls = successfulEvalCalls(result);
  if (calls.length < 2) {
    return {
      passed: false,
      reason:
        "Database persistence was not exercised across separate eval calls",
    };
  }
  const writer = calls.findIndex((call) => {
    const code = String(call.arguments?.["code"] ?? "");
    return (
      /\bCREATE\b/iu.test(code) &&
      /\bINSERT\b/iu.test(code) &&
      /\bdb\.(?:run|exec)\b/u.test(code)
    );
  });
  const reader = calls.findIndex((call, index) => {
    const code = String(call.arguments?.["code"] ?? "");
    return (
      index > writer && /\bSELECT\b/iu.test(code) && /\bdb\.exec\b/u.test(code)
    );
  });
  const readerCall = calls[reader];
  if (writer < 0 || reader < 0 || !readerCall) {
    return {
      passed: false,
      reason:
        "Separate eval calls did not write and later read the local database",
    };
  }
  const readValue = invocationReturnValue(readerCall);
  return readValue.present &&
    walkArrays([readValue.value]).some((rows) => rows.length >= 1)
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: "The later database read did not return the persisted rows",
      };
}

async function orchestrateDbPersistence(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let failure: SystemTestFailure | undefined;
  try {
    await context.sendAndWait(
      session,
      "Save the value DB_PERSISTENCE_OK under the row name probe in a sandbox database table called system_test_eval_db, then tell me what you stored.",
      "write eval database row",
    );
    await context.sendAndWait(
      session,
      "In a separate check, read back that row from system_test_eval_db and tell me what you find. Do not recreate it.",
      "read eval database row",
    );
  } catch (cause) {
    failure = systemTestFailure("eval-db-persistence", cause);
    error = failure.error.message;
  }
  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    ...(error ? { error } : {}),
    ...(failure ? { failure } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [`close: ${formatError(cause)}`];
    execution.cleanupFailures = [
      systemTestFailure("eval-db-persistence-close", cause),
    ];
  }
  return execution;
}

function resetResultProvesFresh(
  result: TestExecutionResult,
  resetCallIndex: number,
): boolean {
  const resetCall = successfulEvalCalls(result)[resetCallIndex];
  if (!resetCall) return false;
  const returned = invocationReturnValue(resetCall);
  const values = returned.present ? [returned.value] : [];
  return (
    values.some((value) => value === false || value === null) ||
    walkArrays(values).some((value) => value.length === 0) ||
    walkRecords(values).some(
      (record) =>
        record["fresh"] === true ||
        record["present"] === false ||
        record["exists"] === false ||
        record["oldValue"] === null,
    )
  );
}

function validateScopeReset(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const calls = successfulEvalCalls(result);
  const resetIndex = calls.findIndex(
    (call, index) => index >= 2 && call.arguments?.["reset"] === true,
  );
  if (resetIndex < 2) {
    return {
      passed: false,
      reason:
        "A successful atomic reset did not follow separate scope write and confirmation calls",
    };
  }
  const priorCode = calls
    .slice(0, resetIndex)
    .map((call) => String(call.arguments?.["code"] ?? ""));
  if (
    !priorCode.some((code) => /scope\s*(?:\.|\[)/u.test(code)) ||
    !priorCode.slice(1).some((code) => /scope\s*(?:\.|\[)/u.test(code))
  ) {
    return {
      passed: false,
      reason: "Persistent scope was not written and observed in separate calls",
    };
  }
  return resetResultProvesFresh(result, resetIndex)
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The reset call did not return evidence that the old scope value is absent",
      };
}

function validateCancellation(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const probe = result.diagnostics?.["evalCancellation"];
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    return {
      passed: false,
      reason: "The harness did not record eval cancellation evidence",
    };
  }
  const record = probe as {
    runId?: unknown;
    cancel?: { ok?: unknown; forcedReset?: unknown };
    terminal?: { status?: unknown };
  };
  if (
    typeof record.runId !== "string" ||
    record.cancel?.ok !== true ||
    record.cancel.forcedReset !== false ||
    record.terminal?.status !== "cancelled"
  ) {
    return {
      passed: false,
      reason: `Expected one cooperative cancelled terminal without a forced reset; observed ${JSON.stringify(
        probe,
      )}`,
    };
  }
  return { passed: true, reason: undefined };
}

function validateAgentReplay(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const probe = result.diagnostics?.["evalAgentReplay"];
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    return {
      passed: false,
      reason: "The harness did not record the exact vessel crash",
    };
  }
  const record = probe as {
    targetId?: unknown;
    invocationId?: unknown;
    statusBeforeAbort?: unknown;
    aborted?: unknown;
  };
  if (
    typeof record.targetId !== "string" ||
    typeof record.invocationId !== "string" ||
    (record.statusBeforeAbort !== "pending" &&
      record.statusBeforeAbort !== "running") ||
    record.aborted !== true
  ) {
    return {
      passed: false,
      reason: `The vessel was not fault-aborted while its eval invocation was live: ${JSON.stringify(
        probe,
      )}`,
    };
  }

  const allEvalCalls = getToolCalls(result).filter(
    (call) => call.name === "eval",
  );
  const uniqueEvalCalls = new Map(allEvalCalls.map((call) => [call.id, call]));
  if (uniqueEvalCalls.size !== 1 || allEvalCalls.length !== 1) {
    return {
      passed: false,
      reason: `Expected one durable eval invocation across replay; observed ${allEvalCalls.length} cards and ${uniqueEvalCalls.size} ids`,
    };
  }
  const [call] = [...uniqueEvalCalls.values()];
  if (
    !call ||
    call.id !== record.invocationId ||
    call.execution?.status !== "complete" ||
    call.execution.isError === true
  ) {
    return {
      passed: false,
      reason:
        "The original eval invocation did not settle successfully after vessel recovery",
    };
  }
  const returned = invocationReturnValue(call);
  const records = returned.present ? walkRecords([returned.value]) : [];
  return records.some(
    (value) =>
      value["marker"] === "EVAL_AGENT_REPLAY_OK" &&
      value["completionCount"] === 1,
  )
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The recovered invocation lost its result or executed the eval more than once",
      };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authorityFrom(
  call: ReturnType<typeof getToolCalls>[number],
): Record<string, unknown> | null {
  const authority = call.arguments?.["authority"];
  return authority && typeof authority === "object" && !Array.isArray(authority)
    ? (authority as Record<string, unknown>)
    : null;
}

function exactPermissionsListIntent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const intent = value as Record<string, unknown>;
  return (
    intent["service"] === "permissions" &&
    intent["method"] === "list" &&
    Array.isArray(intent["args"]) &&
    intent["args"].length === 0
  );
}

function permissionsListResult(
  call: ReturnType<typeof getToolCalls>[number],
): boolean {
  const code = String(call.arguments?.["code"] ?? "");
  if (
    !/\bservices\.permissions\.list\s*\(|\brpc\.call\s*\(\s*["']main["']\s*,\s*["']permissions\.list["']/u.test(
      code,
    )
  )
    return false;
  const returned = invocationReturnValue(call);
  if (!returned.present) return false;
  if (Array.isArray(returned.value)) return true;
  // Large permission inventories use the ordinary bounded-result contract.
  // Requiring an unbounded array would reject the production transport itself.
  return walkRecords([returned.value]).some(
    (value) =>
      value["truncated"] === true &&
      value["scopeKey"] === "$lastLargeReturn" &&
      value["scopeValueType"] === "string" &&
      typeof value["originalChars"] === "number" &&
      typeof value["limitChars"] === "number" &&
      value["originalChars"] > value["limitChars"] &&
      typeof value["preview"] === "string" &&
      value["preview"].trimStart().startsWith("["),
  );
}

function exactPermissionDenial(
  call: ReturnType<typeof getToolCalls>[number],
): boolean {
  const authority = authorityFrom(call);
  if (
    call.name !== "eval" ||
    authority?.["effects"] !== "read-only" ||
    authority["approvals"] !== "pregranted-only" ||
    !Array.isArray(authority["requests"]) ||
    authority["requests"].length !== 0
  )
    return false;
  return walkRecords([call.execution?.result]).some((value) => {
    const failure = value["authorityFailure"];
    if (
      value["denied"] !== true ||
      !failure ||
      typeof failure !== "object" ||
      Array.isArray(failure)
    )
      return false;
    const denial = failure as Record<string, unknown>;
    return (
      denial["reasonCode"] === "run-manifest-denied" &&
      denial["capability"] === "permissions.read" &&
      denial["resourceKey"] === "permissions.read"
    );
  });
}

function validateExactAuthority(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  // Attenuation belongs to an admitted eval run. Discovering the contract and
  // processing an already-returned inventory are separate calls; this probe
  // checks every run that actually performs the protected permissions read.
  const reads = successfulEvalCalls(result).filter(permissionsListResult);
  const exact =
    reads.length > 0 &&
    reads.every((call) => {
      const authority = authorityFrom(call);
      const requests = authority?.["requests"];
      if (
        authority?.["effects"] !== "read-only" ||
        !Array.isArray(requests) ||
        requests.length !== 1
      )
        return false;
      const request = requests[0];
      return (
        request?.capability === "permissions.read" &&
        request?.resource?.kind === "exact" &&
        request?.resource?.key === "permissions.read"
      );
    });
  return exact
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "Protected permissions reads did not carry the exact read-only request allowlist and structured result",
      };
}

function validatePregrantedOnly(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, [], {
    allowFailed: exactPermissionDenial,
  });
  if (!base.passed) return base;
  const denials = getToolCalls(result).filter(exactPermissionDenial);
  return denials.length === 1
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "Expected one exact permissions.read denial under the empty read-only pregranted-only allowlist",
      };
}

function validatePreauthorization(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const calls = successfulEvalCalls(result);
  const call = calls.find((candidate) => {
    const preauthorize = authorityFrom(candidate)?.["preauthorize"];
    return (
      Array.isArray(preauthorize) &&
      preauthorize.some(exactPermissionsListIntent)
    );
  });
  const authority = call && authorityFrom(call);
  const preauthorize = authority?.["preauthorize"];
  if (
    !call ||
    (authority?.["approvals"] !== undefined &&
      authority["approvals"] !== "prompt") ||
    !Array.isArray(preauthorize) ||
    preauthorize.length !== 1 ||
    !exactPermissionsListIntent(preauthorize[0])
  ) {
    return {
      passed: false,
      reason: "Eval did not preauthorize the exact permissions.list invocation",
    };
  }
  // Authorization can prepare its own cell without executing the operation.
  // The actual read must follow it, or occur in that same authorized cell.
  const read = calls.slice(calls.indexOf(call)).find(permissionsListResult);
  const earlierRead = calls
    .slice(0, calls.indexOf(call))
    .some(permissionsListResult);
  return read && !earlierRead
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "Preauthorized eval did not return the structured permissions result",
      };
}

function validateEventPages(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const probe = result.diagnostics?.["evalEventPages"];
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    return {
      passed: false,
      reason: "The harness did not record durable eval event-page evidence",
    };
  }
  const value = probe as {
    terminal?: { status?: unknown; result?: { success?: unknown } };
    firstPage?: {
      events?: Array<{ sequence?: unknown }>;
      next?: unknown;
      hasMore?: unknown;
    };
    repeatedFirstPage?: unknown;
    pages?: Array<{
      events?: Array<{ sequence?: unknown }>;
      next?: unknown;
      hasMore?: unknown;
    }>;
  };
  if (
    value.terminal?.status !== "done" ||
    value.terminal.result?.success !== true
  ) {
    return {
      passed: false,
      reason: "The event probe did not settle a successful eval run",
    };
  }
  if (
    JSON.stringify(value.firstPage) !== JSON.stringify(value.repeatedFirstPage)
  ) {
    return {
      passed: false,
      reason: "The same durable event cursor returned different pages",
    };
  }
  if (
    !Array.isArray(value.pages) ||
    value.pages.length < 2 ||
    value.pages.at(-1)?.hasMore !== false
  ) {
    return {
      passed: false,
      reason: "The event probe did not exhaust bounded durable cursor pages",
    };
  }
  const sequences = value.pages
    .flatMap((page) => page.events ?? [])
    .map((event) => event.sequence)
    .filter((sequence): sequence is number => typeof sequence === "number");
  if (
    sequences.length < 2 ||
    value.pages.flatMap((page) => page.events ?? []).length !==
      sequences.length ||
    sequences.some(
      (sequence, index) => index > 0 && sequence <= sequences[index - 1]!,
    )
  ) {
    return {
      passed: false,
      reason:
        "Durable eval event pages were not strictly ordered by cursor sequence",
    };
  }
  return { passed: true, reason: undefined };
}

async function orchestrateEventPages(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  try {
    const probe = await context.runner.probeEvalEventPages();
    return {
      messages: [],
      duration: Date.now() - startedAt,
      diagnostics: { evalEventPages: probe },
    };
  } catch (cause) {
    const failure = systemTestFailure("eval-event-pages", cause);
    return {
      messages: [],
      duration: Date.now() - startedAt,
      error: failure.error.message,
      failure,
    };
  }
}

async function orchestrateCancellation(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  try {
    const probe = await context.runner.probeEvalCancellation();
    return {
      messages: [],
      duration: Date.now() - startedAt,
      diagnostics: { evalCancellation: probe },
    };
  } catch (cause) {
    const failure = systemTestFailure("eval-cancellation", cause);
    return {
      messages: [],
      duration: Date.now() - startedAt,
      error: failure.error.message,
      failure,
    };
  }
}

async function orchestrateAgentReplay(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let failure: SystemTestFailure | undefined;
  let replayEvidence: Record<string, unknown> | undefined;
  try {
    const targetId = session.agentTargetId;
    if (!targetId)
      throw new Error("Spawned system-test agent has no exact runtime target");

    const inputMessageId = await session.send(
      [
        "Using exactly one eval call, run the following logic with timeoutMs 60000:",
        "await new Promise(resolve => setTimeout(resolve, 15000));",
        "scope.__evalAgentReplayCompletionCount = (scope.__evalAgentReplayCompletionCount ?? 0) + 1;",
        'return { marker: "EVAL_AGENT_REPLAY_OK", completionCount: scope.__evalAgentReplayCompletionCount };',
        "Return the eval result. Do not make any other tool call.",
      ].join("\n"),
    );

    const liveDeadline = Date.now() + 20_000;
    let live: { id: string; status: "pending" | "running" } | undefined;
    while (Date.now() < liveDeadline) {
      const invocation = session
        .snapshot()
        .invocations.find(
          (candidate) =>
            candidate.name === "eval" &&
            (candidate.status === "pending" || candidate.status === "running"),
        );
      if (invocation) {
        live = {
          id: invocation.id,
          status: invocation.status as "pending" | "running",
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!live)
      throw new Error(
        "Eval invocation did not become live before the fault deadline",
      );

    const fault =
      await context.runner.faultAbortAgentVesselForReplayProbe(targetId);
    replayEvidence = {
      targetId,
      invocationId: live.id,
      inputMessageId,
      statusBeforeAbort: live.status,
      aborted: fault.aborted,
    };

    // The injected activation loss invalidates its live RPCs, not the admitted
    // input. Observe that exact input from the replacement activation.
    await session.waitForInput(inputMessageId, {
      timeoutMs: context.remainingTimeMs(),
    });
  } catch (cause) {
    failure = systemTestFailure("eval-agent-replay", cause);
    error = failure.error.message;
  }

  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    diagnostics: {
      ...(replayEvidence ? { evalAgentReplay: replayEvidence } : {}),
    },
    ...(error ? { error } : {}),
    ...(failure ? { failure } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [`close: ${formatError(cause)}`];
    execution.cleanupFailures = [
      systemTestFailure("eval-agent-replay-close", cause),
    ];
  }
  return execution;
}

async function orchestrateLiveKernelContinuity(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let error: string | undefined;
  let failure: SystemTestFailure | undefined;
  try {
    await context.sendAndWait(
      session,
      "Using exactly one eval call, assign scope.__kernelContinuityProbe to a live object with a ping method that returns the string LIVE_KERNEL_OK. Return its method type and result. Do not use db or a second eval.",
      "create live notebook object",
    );
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    await context.sendAndWait(
      session,
      "Without assigning, recreating, or replacing scope.__kernelContinuityProbe, use exactly one eval call to invoke its existing ping method and return { methodType, value }. If it is missing, report that failure rather than reconstructing it.",
      "invoke live notebook object after idle",
    );
  } catch (cause) {
    failure = systemTestFailure("eval-live-kernel-continuity", cause);
    error = failure.error.message;
  }

  const execution: TestExecutionResult = {
    messages: [...session.messages],
    duration: Date.now() - startedAt,
    snapshot: session.snapshot(),
    ...(error ? { error } : {}),
    ...(failure ? { failure } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupErrors = [`close: ${formatError(cause)}`];
    execution.cleanupFailures = [
      systemTestFailure("eval-live-kernel-continuity-close", cause),
    ];
  }
  const cleanupErrors = session
    .snapshot()
    .cleanupErrors.map((entry) => `${entry.phase}: ${entry.message}`);
  if (cleanupErrors.length > 0) {
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      ...cleanupErrors,
    ];
    execution.error ??= `Headless cleanup failed: ${cleanupErrors.join("; ")}`;
  }
  return execution;
}

function validateLiveKernelContinuity(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const calls = successfulEvalCalls(result);
  const writer = calls.findIndex((call) => {
    const code = String(call.arguments?.["code"] ?? "");
    return (
      /scope\.__kernelContinuityProbe\s*=/u.test(code) && /\bping\b/u.test(code)
    );
  });
  const reader = calls.findIndex((call, index) => {
    const code = String(call.arguments?.["code"] ?? "");
    return (
      index > writer &&
      /scope\.__kernelContinuityProbe\b/u.test(code) &&
      !/scope\.__kernelContinuityProbe\s*=/u.test(code)
    );
  });
  const writerCall = calls[writer];
  const readerCall = calls[reader];
  if (writer < 0 || reader < 0 || !writerCall || !readerCall) {
    return {
      passed: false,
      reason:
        "The agent did not create and later invoke one unchanged live scope object",
    };
  }
  const writerIncarnation = invocationKernelIncarnation(writerCall);
  const readerIncarnation = invocationKernelIncarnation(readerCall);
  if (
    !writerIncarnation ||
    !readerIncarnation ||
    writerIncarnation !== readerIncarnation
  ) {
    return {
      passed: false,
      reason:
        "The eval kernel incarnation changed across the inter-cell idle boundary",
    };
  }
  const returned = invocationReturnValue(readerCall);
  const records = returned.present ? walkRecords([returned.value]) : [];
  return records.some(
    (record) =>
      record["methodType"] === "function" &&
      record["value"] === "LIVE_KERNEL_OK",
  )
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The live scope object's method did not survive the 15-second inter-cell idle",
      };
}

/** Model turns exercise the real notebook; only native receipts establish continuity. */
async function orchestrateNotebookCells(
  context: TestOrchestrationContext,
  name: string,
  prompts: readonly string[],
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const session = await context.runner.spawn();
  let failure: SystemTestFailure | undefined;
  try {
    for (const [index, prompt] of prompts.entries()) {
      await context.sendAndWait(session, prompt, `${name} cell ${index + 1}`);
    }
  } catch (cause) {
    failure = systemTestFailure(name, cause);
  }
  const execution: TestExecutionResult = {
    duration: Date.now() - startedAt,
    messages: [...session.messages],
    snapshot: session.snapshot(),
    ...(failure ? { failure, error: failure.error.message } : {}),
  };
  try {
    await session.close();
  } catch (cause) {
    execution.cleanupFailures = [systemTestFailure(`${name}-close`, cause)];
    execution.cleanupErrors = [formatError(cause)];
  }
  const cleanupErrors = session
    .snapshot()
    .cleanupErrors.map((entry) => `${entry.phase}: ${entry.message}`);
  if (cleanupErrors.length)
    execution.cleanupErrors = [
      ...(execution.cleanupErrors ?? []),
      ...cleanupErrors,
    ];
  if (execution.cleanupErrors?.length)
    execution.error ??= `Headless cleanup failed: ${execution.cleanupErrors.join("; ")}`;
  return execution;
}

function notebookCells(
  result: TestExecutionResult,
  expectedFailure?: (call: ReturnType<typeof getToolCalls>[number]) => boolean,
) {
  const base = completedScenarioEvidence(result, ["eval"], {
    ...(expectedFailure ? { allowFailed: expectedFailure } : {}),
  });
  if (!base.passed) return base;
  const calls = getToolExecutions(result).filter(
    (call) => call.name === "eval",
  );
  if (calls.length !== 3)
    return {
      passed: false as const,
      reason: `Expected three distinct eval cells; observed ${calls.length}`,
    };
  const incarnations = calls.map(invocationKernelIncarnation);
  if (
    !incarnations[0] ||
    incarnations.some((value) => value !== incarnations[0])
  )
    return {
      passed: false as const,
      reason:
        "Native receipts did not prove one unchanged kernel across all cells",
    };
  return { passed: true as const, calls };
}

function returnedRecordMatches(
  call: ReturnType<typeof getToolCalls>[number],
  expected: Record<string, unknown>,
): boolean {
  const returned = invocationReturnValue(call);
  return (
    returned.present &&
    walkRecords([returned.value]).some((record) =>
      Object.entries(expected).every(([key, value]) => record[key] === value),
    )
  );
}

function validateCellLocalImports(result: TestExecutionResult) {
  const cells = notebookCells(result);
  if (!cells.passed) return cells;
  const [first, second, third] = cells.calls;
  const code = cells.calls.map((call) =>
    String(call.arguments?.["code"] ?? ""),
  );
  const importsBinding = (value: string) =>
    /import\s*\{[^}]*basename\s+as\s+notebookBasename[^}]*\}\s*from\s*["']node:path["']/u.test(
      value,
    );
  if (
    !first ||
    !second ||
    !third ||
    !importsBinding(code[0]!) ||
    !importsBinding(code[2]!) ||
    /\bimport\b/u.test(code[1]!) ||
    !/scope\.__cellImportProbe\s*=/u.test(code[0]!) ||
    /scope\.__cellImportProbe\s*=|(?:const|let|var)\s+notebookBasename/u.test(
      code[1]!,
    )
  )
    return {
      passed: false,
      reason:
        "Cells did not import locally, retain the function explicitly, and later read it without reconstruction",
    };
  return returnedRecordMatches(first, {
    bindingType: "function",
    value: "first.txt",
  }) &&
    returnedRecordMatches(second, {
      bindingType: "undefined",
      retainedType: "function",
      value: "second.txt",
    }) &&
    returnedRecordMatches(third, {
      bindingType: "function",
      value: "third.txt",
    })
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "Captured returns did not prove cell-local imports and the retained callable",
      };
}

function expectedLiveScopeThrow(call: ReturnType<typeof getToolCalls>[number]) {
  return (
    call.name === "eval" &&
    call.execution?.isError === true &&
    /throw\s+new\s+Error/u.test(String(call.arguments?.["code"] ?? "")) &&
    JSON.stringify(call.execution).includes("LIVE_SCOPE_DELIBERATE_FAILURE")
  );
}

function validateRejectedCellScope(result: TestExecutionResult) {
  const cells = notebookCells(result, expectedLiveScopeThrow);
  if (!cells.passed) return cells;
  const [first, rejected, recovered] = cells.calls;
  if (
    !first ||
    !rejected ||
    !recovered ||
    !expectedLiveScopeThrow(rejected) ||
    !/scope\.__rejectedCellProbe\s*=/u.test(
      String(first.arguments?.["code"] ?? ""),
    ) ||
    /scope\.__rejectedCellProbe\s*=/u.test(
      String(recovered.arguments?.["code"] ?? ""),
    )
  )
    return {
      passed: false,
      reason:
        "The deliberate failed cell was not followed by use of the original live object",
    };
  return returnedRecordMatches(first, { methodType: "function", count: 1 }) &&
    returnedRecordMatches(recovered, { methodType: "function", count: 2 })
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The original callable and its live counter did not survive the rejected cell",
      };
}

export const evalLifecycleTests: TestCase[] = [
  {
    name: "eval-cell-local-imports-retained-handle",
    description:
      "Static imports remain cell-local while an explicitly retained imported function stays callable across model turns",
    category: "eval-lifecycle",
    validation: "harness",
    prompt:
      "Check import binding lifetime and explicit scope retention across separate notebook cells.",
    orchestrate: (context) =>
      orchestrateNotebookCells(
        context,
        "eval-cell-local-imports-retained-handle",
        [
          "Using exactly one eval, statically import { basename as notebookBasename } from 'node:path', assign that function to scope.__cellImportProbe, and return { bindingType: typeof notebookBasename, value: notebookBasename('/first/first.txt') }. Finish this turn; do not run another eval.",
          "Using exactly one eval and no imports or assignments, inspect typeof notebookBasename and the existing scope.__cellImportProbe. Return { bindingType: typeof notebookBasename, retainedType: typeof scope.__cellImportProbe, value: scope.__cellImportProbe('/second/second.txt') }. Do not recreate missing state; report failure if missing. Finish this turn.",
          "Using exactly one eval, statically import { basename as notebookBasename } from 'node:path' again and return { bindingType: typeof notebookBasename, value: notebookBasename('/third/third.txt') }. Finish this turn.",
        ],
      ),
    validate: validateCellLocalImports,
  },
  {
    name: "eval-rejected-cell-preserves-live-scope",
    description:
      "A deliberate failed cell preserves a live callable and its counter for a later model turn in the same kernel",
    category: "eval-lifecycle",
    validation: "harness",
    expectedToolFailures: [
      { name: "eval", failureCode: "guest_execution_failed" },
    ],
    prompt:
      "Check live notebook state across a deliberate failed cell and a later turn.",
    orchestrate: (context) =>
      orchestrateNotebookCells(
        context,
        "eval-rejected-cell-preserves-live-scope",
        [
          "Using exactly one eval, assign scope.__rejectedCellProbe to a live object with count initially 0 and a next method that increments and returns its count. Return { methodType: typeof scope.__rejectedCellProbe.next, count: scope.__rejectedCellProbe.next() }, with next() called only in that count field; do not call it separately. Finish this turn.",
          "Using exactly one eval, throw new Error('LIVE_SCOPE_DELIBERATE_FAILURE'). Report the original observed error and finish this turn without another eval or changing any scope state.",
          "Using exactly one eval, return { methodType: typeof scope.__rejectedCellProbe.next, count: scope.__rejectedCellProbe.next() }, with the existing next() called only in that count field; do not call it separately. Do not assign, reconstruct, or replace the object. If missing, report failure. Finish this turn.",
        ],
      ),
    validate: validateRejectedCellScope,
  },
  {
    name: "eval-exact-authority",
    description:
      "An eval request allowlist admits only its exact read-only permission request",
    category: "eval-lifecycle",
    authorityPolicy: {
      authority: [
        {
          ruleId: "eval-permissions-read",
          capability: { kind: "exact", key: "permissions.read" },
          resource: { kind: "exact", key: "permissions.read" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "Show me which permissions are granted to this workspace. Restrict this run so it can only read the permissions list: allow no other service access and no changes. Summarize what you found.",
    validate: validateExactAuthority,
  },
  {
    name: "eval-pregranted-only",
    description:
      "An operation outside an empty eval allowlist is denied without an approval prompt",
    category: "eval-lifecycle",
    expectedToolFailures: [
      {
        name: "eval",
        failureCode: "ERUNMANIFEST",
        errorIncludes: "permissions.read",
      },
    ],
    authorityPolicy: {
      authority: [
        {
          ruleId: "eval-permissions-read",
          capability: { kind: "exact", key: "permissions.read" },
          resource: { kind: "exact", key: "permissions.read" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "For this run, disable all service permissions, including any already granted to the workspace. Try a read-only check of this workspace's permissions without requesting approval or any new access. Explain the resulting limitation.",
    validate: validatePregrantedOnly,
  },
  {
    name: "eval-preauthorization",
    description:
      "A prompted eval preauthorizes one exact service invocation before executing it",
    category: "eval-lifecycle",
    authorityPolicy: {
      authority: [
        {
          ruleId: "eval-permissions-read",
          capability: { kind: "exact", key: "permissions.read" },
          resource: { kind: "exact", key: "permissions.read" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "Before running the check, have the system authorize exactly the workspace permissions-list operation, without executing it or authorizing other operations. Allow normal approval if needed. Then run that read-only check and summarize the actual result.",
    validate: validatePreauthorization,
  },
  {
    name: "eval-events",
    description:
      "A completed eval exposes stable ordered durable event cursor pages",
    category: "eval-lifecycle",
    prompt: "Harness-orchestrated durable eval event pagination check.",
    orchestrate: orchestrateEventPages,
    validation: "harness",
    validate: validateEventPages,
  },
  {
    name: "eval-agent-replay",
    description:
      "An in-flight eval result survives an exact agent-vessel crash without duplicate execution",
    category: "eval-lifecycle",
    prompt:
      "Harness-orchestrated exact agent-vessel crash and durable eval replay check.",
    orchestrate: orchestrateAgentReplay,
    validation: "harness",
    validate: validateAgentReplay,
  },
  {
    name: "eval-live-kernel-continuity",
    description:
      "A live scope object retains its methods across idle eval cells",
    category: "eval-lifecycle",
    prompt: "Harness-orchestrated live notebook continuity check.",
    orchestrate: orchestrateLiveKernelContinuity,
    validation: "harness",
    validate: validateLiveKernelContinuity,
  },
  {
    name: "eval-db-persistence",
    description:
      "The eval-local database persists rows across separate eval calls",
    category: "eval-lifecycle",
    prompt: "Harness-orchestrated eval database continuity check.",
    orchestrate: orchestrateDbPersistence,
    validation: "harness",
    validate: validateDbPersistence,
  },
  {
    name: "eval-scope-reset",
    description:
      "Resetting the sandbox produces a genuinely fresh persistent scope",
    category: "eval-lifecycle",
    prompt:
      "Put a value in persistent sandbox scope, confirm it later, reset the sandbox, and check whether the old value remains.",
    validate: validateScopeReset,
  },
  {
    name: "eval-cancel-run",
    description:
      "A long-running sandbox run can be cancelled and the cancellation is visible",
    category: "eval-lifecycle",
    prompt: "Harness-orchestrated asynchronous eval cancellation check.",
    orchestrate: orchestrateCancellation,
    validation: "harness",
    validate: validateCancellation,
  },
];
