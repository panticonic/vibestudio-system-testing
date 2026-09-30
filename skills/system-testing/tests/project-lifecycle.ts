import {
  BUILDABLE_PANEL_WITH_DERIVED_WORKSPACE_REPO_FIXTURE,
  CREATED_PACKAGE_WORKSPACE_REPO_FIXTURE,
  CREATED_PANEL_STORE_WORKSPACE_REPO_FIXTURE,
  CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
  CREATED_WORKER_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
} from "../types.js";
import {
  systemTestFailure,
  type SystemTestFailure,
} from "../structured-error.js";
import {
  panelControlAuthorityPolicy,
  PANEL_AUTOMATION_RESOURCE,
} from "../panel-authority.js";
import {
  findLastAgentMessage,
  getToolCalls,
  type InvocationCardPayloadLike,
} from "./_helpers.js";
import {
  preparedProject,
  publishedPreparation,
  publishedCommits,
  committedPreparation,
} from "./_project-evidence.js";
import {
  completedScenarioEvidence,
  invocationReturnValue,
  walkRecords,
} from "./_scenario-evidence.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function details(
  call: InvocationCardPayloadLike,
): Record<string, unknown> | null {
  if (
    call.execution?.status !== "complete" ||
    call.execution.isError === true ||
    !isRecord(call.execution.result)
  ) {
    return null;
  }
  return isRecord(call.execution.result["details"])
    ? call.execution.result["details"]
    : call.execution.result;
}

function successfulEvalCalls(result: TestExecutionResult) {
  return getToolCalls(result).filter(
    (call) =>
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true,
  );
}

function createdProject(
  record: Record<string, unknown>,
  section: "panels" | "packages" | "workers",
) {
  return preparedProject(
    record,
    section === "panels"
      ? "panel"
      : section === "workers"
        ? "worker"
        : "package",
  );
}

function hasBootReadyPanelEvidence(values: readonly unknown[]): boolean {
  const records = walkRecords(values);
  const observations = records.filter(
    (record) =>
      record["phase"] === "ready" &&
      typeof record["panelId"] === "string" &&
      typeof record["attemptId"] === "string" &&
      typeof record["runtimeEntityId"] === "string" &&
      typeof record["buildKey"] === "string" &&
      record["buildKey"].length > 0,
  );
  return observations.some((observation) =>
    records.some((record) => {
      const sameAttempt =
        record["panelId"] === observation["panelId"] &&
        record["attemptId"] === observation["attemptId"] &&
        record["buildKey"] === observation["buildKey"] &&
        (record["runtimeEntityId"] === observation["runtimeEntityId"] ||
          record["attemptId"] ===
            `${String(observation["runtimeEntityId"])}@${String(observation["buildKey"])}`);
      if (!sameAttempt) return false;
      const document = record["document"];
      const completeSnapshot =
        typeof record["capturedAt"] === "number" &&
        isRecord(document) &&
        document["kind"] === "synth" &&
        isRecord(document["structure"]);
      const renderedProjection =
        typeof record["text"] === "string" && record["text"].trim().length > 0;
      return completeSnapshot || renderedProjection;
    }),
  );
}

/** A native capture is rendered-content inspection, not an agent assertion.
 * Join it to a ready observation in call order, invalidating readiness across
 * lifecycle changes rather than requiring an arbitrary snapshot return shape. */
function hasReadyCapturedPanel(
  calls: readonly InvocationCardPayloadLike[],
  source: string,
): boolean {
  const ready = new Set<string>();
  for (const call of calls) {
    if (call.name !== "eval" || !details(call)) continue;
    const observations = returnedRecords(call).filter(
      (record) =>
        record["phase"] === "ready" &&
        record["source"] === source &&
        typeof record["panelId"] === "string" &&
        typeof record["runtimeEntityId"] === "string" &&
        typeof record["attemptId"] === "string" &&
        typeof record["buildKey"] === "string" &&
        record["buildKey"].length > 0,
    );
    for (const entry of nativePanelOperations(call)) {
      const id = entry["id"];
      if (typeof id !== "string") continue;
      if (["open", "reload", "close"].includes(String(entry["type"])))
        ready.delete(id);
      if (
        ready.has(id) &&
        renderedCaptureObservation(entry) &&
        (entry["type"] !== "screenshot" || isSuccessfulImageRead(call))
      )
        return true;
    }
    for (const observation of observations)
      ready.add(observation["panelId"] as string);
  }
  return false;
}

function validatePanelCreate(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const prepared = walkRecords(base.evidence.evalValues).find((record) =>
    createdProject(record, "panels"),
  );
  if (!prepared || !publishedPreparation(result, prepared))
    return {
      passed: false,
      reason:
        "No prepared panel application was joined to an exact committed and published event",
    };
  return hasBootReadyPanelEvidence(base.evidence.evalValues) ||
    hasReadyCapturedPanel(base.evidence.calls, String(prepared["created"]))
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The opened panel returned no matching boot-ready observation and provenance-bearing snapshot",
      };
}

function validateCuratedIconPanelCreate(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["eval", "verify"]);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const catalogIndex = calls.findIndex(
    (call) =>
      call.name === "eval" &&
      call.execution?.isError !== true &&
      (returnedRecords(call).some(
        (record) =>
          record["protocol"] === "workspace-dev-catalog.v1" &&
          record["resource"] === "icon" &&
          Array.isArray(record["entries"]) &&
          record["entries"].some(
            (entry) => isRecord(entry) && entry["id"] === "lucide:database",
          ),
      ) ||
        (String(call.arguments?.["code"] ?? "").includes("listProjectIcons") &&
          Array.isArray(details(call)?.["returnValue"]) &&
          (details(call)?.["returnValue"] as unknown[]).includes(
            "lucide:database",
          ))),
  );
  const createIndex = calls.findIndex(
    (call) =>
      call.name === "eval" &&
      call.execution?.isError !== true &&
      String(call.arguments?.["code"] ?? "").includes("prepareProjects"),
  );
  if (catalogIndex < 0 || createIndex < 0 || catalogIndex > createIndex) {
    return {
      passed: false,
      reason:
        "The panel was created before the exact curated icon catalog was discovered",
    };
  }
  const buildIndex = calls.findIndex((call) => {
    if (call.name !== "verify" || call.execution?.isError === true)
      return false;
    const resultDetails = details(call);
    return (
      resultDetails?.["operation"] === "build" &&
      resultDetails["status"] === "ok"
    );
  });
  if (buildIndex < createIndex) {
    return {
      passed: false,
      reason: "No successful structured panel build was returned",
    };
  }
  const prepared = walkRecords(base.evidence.evalValues).find(
    (record) =>
      createdProject(record, "panels") && publishedPreparation(result, record),
  );
  if (!prepared)
    return {
      passed: false,
      reason: "No published generated panel scaffold was returned",
    };
  const openIndex = calls.findIndex(
    (call, index) =>
      index > buildIndex &&
      call.name === "eval" &&
      call.execution?.isError !== true &&
      nativePanelOperations(call).some(
        (entry) =>
          entry["type"] === "open" && entry["source"] === prepared["created"],
      ),
  );
  if (
    openIndex < 0 ||
    !(
      hasBootReadyPanelEvidence(base.evidence.evalValues) ||
      hasReadyCapturedPanel(base.evidence.calls, String(prepared["created"]))
    )
  ) {
    return {
      passed: false,
      reason:
        "The clean build was not followed by boot-ready rendered-panel inspection",
    };
  }
  return { passed: true, reason: undefined };
}

function validateWorkerCreate(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  return walkRecords(base.evidence.evalValues).some(
    (record) =>
      createdProject(record, "workers") && publishedPreparation(result, record),
  )
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "No prepared worker application was joined to an exact committed and published event",
      };
}

function validatePanelFork(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const records = walkRecords(base.evidence.evalValues);
  const fork = records.find(
    (record) =>
      createdProject(record, "panels") &&
      record["dryRun"] === false &&
      typeof record["source"] === "string",
  );
  if (!fork || !committedPreparation(result, fork))
    return {
      passed: false,
      reason:
        "No prepared panel-fork application was joined to its exact local commit",
    };
  // The task asks for a saved, working copy, not a particular planning sequence.
  // Preparation and its exact commit prove delivery; a dry run is optional.
  return hasBootReadyPanelEvidence(base.evidence.evalValues) ||
    hasReadyCapturedPanel(base.evidence.calls, String(fork["created"]))
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The committed fork returned no matching boot-ready rendered-panel inspection",
      };
}

function validateWorkerForkPlan(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const call = successfulEvalCalls(result).find((candidate) => {
    const code = String(candidate.arguments?.["code"] ?? "");
    if (
      !/\bfork(?:Project|Worker)\s*\(/u.test(code) ||
      !/dryRun\s*:\s*true/u.test(code)
    ) {
      return false;
    }
    const returned = invocationReturnValue(candidate);
    return (
      returned.present &&
      walkRecords([returned.value]).some((record) => {
        const preflight = record["preflight"];
        const hasPreflight =
          (isRecord(preflight) &&
            preflight["ok"] === true &&
            preflight["projectType"] === "worker") ||
          record["preflightOk"] === true;
        const hasFiles =
          (Array.isArray(record["files"]) && record["files"].length > 0) ||
          (typeof record["files"] === "number" &&
            Number.isInteger(record["files"]) &&
            record["files"] > 0) ||
          (typeof record["fileCount"] === "number" &&
            Number.isInteger(record["fileCount"]) &&
            record["fileCount"] > 0);
        return Boolean(
          typeof record["source"] === "string" &&
          record["source"].startsWith("workers/") &&
          typeof record["created"] === "string" &&
          record["created"].startsWith("workers/") &&
          record["source"] !== record["created"] &&
          record["dryRun"] === true &&
          record["preparation"] === null &&
          hasPreflight &&
          hasFiles,
        );
      })
    );
  });
  return call &&
    /dryRun\s*:\s*true/u.test(String(call.arguments?.["code"] ?? ""))
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: "No completed eval returned a non-mutating worker fork plan",
      };
}

function mutationResult(
  call: InvocationCardPayloadLike,
): Record<string, unknown> | null {
  if (call.name !== "edit" && call.name !== "write") return null;
  const value = details(call);
  return value?.["storage"] === "vcs" && isRecord(value["vcsResult"])
    ? value["vcsResult"]
    : null;
}

function commitResult(
  call: InvocationCardPayloadLike,
): Record<string, unknown> | null {
  if (call.name !== "vcs" || call.arguments?.["operation"] !== "commit")
    return null;
  const value = details(call);
  return value && isRecord(value["result"]) ? value["result"] : value;
}

function validateProjectCommit(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, []);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const creationIndex = calls.findIndex((call) => {
    if (call.name !== "eval") return false;
    const returned = invocationReturnValue(call);
    return (
      call.execution?.status === "complete" &&
      call.execution.isError !== true &&
      String(call.arguments?.["code"] ?? "").includes("prepareProjects") &&
      returned.present &&
      walkRecords([returned.value]).some((record) =>
        createdProject(record, "packages"),
      )
    );
  });
  if (creationIndex < 0) {
    return {
      passed: false,
      reason: "No completed eval returned the created package identity",
    };
  }
  for (
    let mutationIndex = creationIndex + 1;
    mutationIndex < calls.length;
    mutationIndex += 1
  ) {
    const mutationCall = calls[mutationIndex]!;
    const mutation = mutationResult(mutationCall);
    if (!mutation) continue;
    const applicationId = mutation["applicationId"];
    const changeIds = mutation["changeIds"];
    if (
      typeof applicationId !== "string" ||
      !Array.isArray(changeIds) ||
      changeIds.length < 1 ||
      !changeIds.every((changeId) => typeof changeId === "string") ||
      !isRecord(mutation["workingHead"]) ||
      mutation["workingHead"]["kind"] !== "application" ||
      mutation["workingHead"]["applicationId"] !== applicationId
    ) {
      continue;
    }
    const path = mutationCall.arguments?.["path"];
    if (typeof path !== "string" || !path.startsWith("packages/")) continue;
    for (const call of calls.slice(mutationIndex + 1)) {
      const committed = commitResult(call);
      const event = committed?.["event"];
      if (
        Array.isArray(committed?.["committedApplicationIds"]) &&
        committed["committedApplicationIds"].includes(applicationId) &&
        isRecord(event) &&
        event["kind"] === "event" &&
        typeof event["eventId"] === "string"
      ) {
        return { passed: true, reason: undefined };
      }
    }
  }
  return {
    passed: false,
    reason:
      "The package creation was not followed by an identity-joined managed change and commit",
  };
}

function returnedRecords(
  call: InvocationCardPayloadLike,
): Record<string, unknown>[] {
  const returned = invocationReturnValue(call);
  return returned.present ? walkRecords([returned.value]) : [];
}

function compilerCheckSummary(
  call: InvocationCardPayloadLike,
  expectedSource: string,
): Record<string, unknown> | null {
  const rawResult = call.execution?.result;
  const detail =
    isRecord(rawResult) && isRecord(rawResult["details"])
      ? rawResult["details"]
      : null;
  const receipt = detail?.["receipt"];
  const unit = isRecord(receipt) ? receipt["unit"] : null;
  const verifiedReport = detail?.["report"];
  const canonicalReport =
    call.name === "verify" &&
    isRecord(receipt) &&
    ["complete", "error"].includes(String(call.execution?.status)) &&
    receipt["protocol"] === "unit-verification-receipt.v1" &&
    receipt["operation"] === "build" &&
    receipt["target"] === expectedSource &&
    isRecord(unit) &&
    unit["repoPath"] === expectedSource &&
    unit["kind"] === "panel" &&
    isRecord(verifiedReport) &&
    verifiedReport["repoPath"] === expectedSource &&
    verifiedReport["kind"] === "panel" &&
    verifiedReport["stateHash"] === receipt["stateHash"]
      ? verifiedReport
      : null;
  if (call.name !== "eval" && !canonicalReport) return null;
  const code = String(call.arguments?.["code"] ?? "");
  const records = returnedRecords(call);
  if (code.includes("typecheck-service") && code.includes("checkPanel")) {
    return (
      records.find(
        (record) =>
          typeof record["errorCount"] === "number" &&
          Array.isArray(record["diagnostics"]),
      ) ?? null
    );
  }
  if (!canonicalReport && !code.includes("getBuildReport")) return null;
  const identityBearingReport = records.find(
    (record) =>
      record["repoPath"] === expectedSource &&
      record["kind"] === "panel" &&
      typeof record["status"] === "string" &&
      Array.isArray(record["builds"]),
  );
  // A concise projection is still source-bound evidence when the invocation
  // itself passes the exact created panel path to getBuildReport. Requiring the
  // agent to echo repoPath/kind after selecting that exact resource makes
  // validation depend on redundant presentation rather than provenance.
  const sourceBoundProjection =
    code.includes(expectedSource) &&
    records.find(
      (record) =>
        record["repoPath"] === undefined &&
        record["kind"] === undefined &&
        typeof record["status"] === "string" &&
        Array.isArray(record["diagnostics"]) &&
        Array.isArray(record["builds"]),
    );
  const report =
    canonicalReport ?? identityBearingReport ?? sourceBoundProjection;
  if (!report) return null;
  const diagnostics = [
    ...(Array.isArray(report["diagnostics"]) ? report["diagnostics"] : []),
    ...walkRecords(
      Array.isArray(report["builds"]) ? report["builds"] : [],
    ).flatMap((build) =>
      Array.isArray(build["diagnostics"]) ? build["diagnostics"] : [],
    ),
  ].filter(isRecord);
  const compilerErrors = diagnostics.filter(
    (diagnostic) =>
      diagnostic["severity"] === "error" &&
      (diagnostic["source"] === "tsc" || diagnostic["source"] === "esbuild"),
  );
  if (report["status"] !== "ok" && compilerErrors.length === 0) return null;
  return {
    diagnostics,
    errorCount: compilerErrors.length,
    warningCount: diagnostics.filter(
      (diagnostic) => diagnostic["severity"] === "warning",
    ).length,
  };
}

function successfulPanelBuildSummary(
  call: InvocationCardPayloadLike,
  expectedSource: string,
): Record<string, unknown> | null {
  if (call.name !== "eval") return null;
  const code = String(call.arguments?.["code"] ?? "");
  if (
    !code.includes("openPanel") &&
    !/\.(?:rebuild|reload|navigate)\s*\(/u.test(code)
  ) {
    return null;
  }
  const ready = returnedRecords(call).find(
    (record) =>
      record["source"] === expectedSource &&
      record["phase"] === "ready" &&
      typeof record["runtimeEntityId"] === "string" &&
      typeof record["buildKey"] === "string",
  );
  return ready ? { diagnostics: [], errorCount: 0, warningCount: 0 } : null;
}

function successfulPanelMutation(
  call: InvocationCardPayloadLike,
  source: string,
): Record<string, unknown> | null {
  const path = call.arguments?.["path"];
  if (typeof path !== "string" || !path.startsWith(`${source}/`)) return null;
  const mutation = mutationResult(call);
  return mutation &&
    typeof mutation["applicationId"] === "string" &&
    isRecord(mutation["workingHead"]) &&
    mutation["workingHead"]["kind"] === "application" &&
    mutation["workingHead"]["applicationId"] === mutation["applicationId"]
    ? mutation
    : null;
}

function operationResult(
  call: InvocationCardPayloadLike,
  operation: "push" | "status",
): Record<string, unknown> | null {
  const focused = call.name === operation;
  const generic =
    call.name === "vcs" && call.arguments?.["operation"] === operation;
  if (!focused && !generic) return null;
  const value = details(call);
  return value && isRecord(value["result"]) ? value["result"] : value;
}

function nativePanelOperations(
  call: InvocationCardPayloadLike,
): Record<string, unknown>[] {
  const journal = nativeOperationJournal(call);
  if (
    !isRecord(journal) ||
    journal["protocol"] !== "workspace-operations.v1" ||
    journal["truncated"] !== false ||
    !Array.isArray(journal["entries"])
  )
    return [];
  return journal["entries"].filter(isRecord);
}

function nativeOperationJournal(call: InvocationCardPayloadLike): unknown {
  const execution = call.execution;
  if (
    !["complete", "error"].includes(execution?.status ?? "") ||
    !isRecord(execution?.result)
  )
    return undefined;
  const result = execution.result;
  return (isRecord(result["details"]) ? result["details"] : result)[
    "operationJournal"
  ];
}

function cleanConsoleObservation(entry: Record<string, unknown>): boolean {
  const receipt = entry["receipt"];
  return (
    entry["type"] === "consoleHistory" &&
    isRecord(receipt) &&
    receipt["errorCoverage"] === "full" &&
    receipt["errorCount"] === 0 &&
    receipt["droppedErrors"] === 0 &&
    typeof receipt["capturedAt"] === "number"
  );
}

function renderedCaptureObservation(entry: Record<string, unknown>): boolean {
  const receipt = entry["receipt"];
  if (
    typeof entry["id"] !== "string" ||
    !isRecord(receipt) ||
    typeof receipt["capturedAt"] !== "number"
  )
    return false;
  if (entry["type"] === "screenshot")
    return (
      (receipt["mimeType"] === "image/png" ||
        receipt["mimeType"] === "image/jpeg") &&
      typeof receipt["byteSize"] === "number" &&
      receipt["byteSize"] > 0
    );
  return (
    entry["type"] === "snapshot" &&
    receipt["panelId"] === entry["id"] &&
    typeof receipt["runtimeEntityId"] === "string" &&
    typeof receipt["buildKey"] === "string" &&
    receipt["documentKind"] === "synth"
  );
}

function isSuccessfulImageRead(call: InvocationCardPayloadLike): boolean {
  const result = call.execution?.result;
  if (
    call.execution?.status === "complete" &&
    call.execution.isError !== true &&
    isRecord(result) &&
    Array.isArray(result["protocolContent"]) &&
    result["protocolContent"].some(
      (content) =>
        isRecord(content) &&
        content["type"] === "image" &&
        typeof content["mimeType"] === "string" &&
        content["mimeType"].startsWith("image/") &&
        typeof content["data"] === "string" &&
        content["data"].length > 0,
    ) &&
    nativePanelOperations(call).some(
      (entry) =>
        entry["type"] === "screenshot" && renderedCaptureObservation(entry),
    )
  )
    return true;
  if (call.name !== "read") return false;
  const path = call.arguments?.["path"] ?? call.arguments?.["target"];
  if (typeof path !== "string" || path.length === 0) return false;
  const value = details(call);
  return Boolean(
    value &&
    typeof value["mimeType"] === "string" &&
    value["mimeType"].startsWith("image/") &&
    typeof value["size"] === "number" &&
    value["size"] > 0,
  );
}

function completeTodoRuntimeVerificationIndex(
  calls: readonly InvocationCardPayloadLike[],
  fromIndex: number,
  expectedSource: string,
): number {
  const openedPanels = new Set(
    calls
      .flatMap(nativePanelOperations)
      .filter(
        (entry) =>
          entry["type"] === "open" &&
          entry["source"] === expectedSource &&
          typeof entry["id"] === "string",
      )
      .map((entry) => entry["id"] as string),
  );
  const states = new Map<
    string,
    {
      reload: number;
      interaction: number;
      capture: number;
      console: number;
      clean: boolean;
      index: number;
      verifiedIndex: number;
      flows: Set<string>;
    }
  >();
  let step = 0;
  for (let index = fromIndex; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (
      call.name !== "eval" ||
      !["complete", "error"].includes(call.execution?.status ?? "")
    )
      continue;
    const journal = nativeOperationJournal(call);
    if (isRecord(journal) && journal["truncated"] === true) return -1;
    for (const entry of nativePanelOperations(call)) {
      step += 1;
      const id = entry["id"];
      if (typeof id !== "string" || !openedPanels.has(id)) continue;
      const state = states.get(id) ?? {
        reload: 0,
        interaction: 0,
        capture: 0,
        console: 0,
        clean: false,
        index: -1,
        verifiedIndex: -1,
        flows: new Set<string>(),
      };
      const receipt = entry["receipt"];
      if (entry["type"] === "reload") {
        state.reload = step;
        state.clean = false;
        state.verifiedIndex = -1;
      }
      if (
        entry["type"] === "interaction" &&
        isRecord(receipt) &&
        receipt["protocol"] === "cdp-interaction-outcome.v1" &&
        receipt["delivery"] === "dispatched" &&
        isRecord(receipt["target"])
      ) {
        state.interaction = step;
        state.clean = false;
        const target = receipt["target"];
        const name = String(
          target["accessibleName"] ?? target["text"] ?? "",
        ).toLowerCase();
        const action = receipt["action"];
        if (
          ["fill", "press"].includes(String(action)) &&
          ["textbox", "searchbox"].includes(String(target["role"])) &&
          !/\b(?:search|filter)\b/u.test(name)
        )
          state.flows.add("entry");
        if (
          (action === "click" || action === "press") &&
          /\b(?:add|create|save)\b/u.test(name)
        )
          state.flows.add("create");
        if (
          action === "check" ||
          ((action === "click" || action === "press") &&
            /\b(?:complete|done|finish)\b/u.test(name))
        )
          state.flows.add("complete");
        if (
          ["fill", "press", "click", "selectOption"].includes(String(action)) &&
          /\b(?:search|filter|active|completed)\b/u.test(name)
        )
          state.flows.add("filter");
        if (
          (action === "click" || action === "press") &&
          /\b(?:delete|remove)\b/u.test(name)
        )
          state.flows.add("delete");
      }
      if (renderedCaptureObservation(entry)) state.capture = step;
      if (entry["type"] === "consoleHistory" && isRecord(receipt)) {
        state.console = step;
        state.clean = cleanConsoleObservation(entry);
        if (!state.clean) state.verifiedIndex = -1;
      }
      state.index = index;
      // Native receipts survive a later guest failure. Record a completed
      // verification when it happens, rather than requiring the agent's last
      // action to be a capture. Later reloads or bad console coverage invalidate
      // it; an ordinary follow-up interaction does not undo an observed flow.
      if (
        ["entry", "create", "complete", "filter", "delete"].every((flow) =>
          state.flows.has(flow),
        ) &&
        state.reload > 0 &&
        state.interaction > 0 &&
        state.capture > Math.max(state.reload, state.interaction) &&
        state.console > Math.max(state.reload, state.interaction) &&
        state.clean
      )
        state.verifiedIndex = index;
      states.set(id, state);
    }
  }
  const verified = [...states.values()].filter(
    (state) => state.verifiedIndex >= 0,
  );
  return verified.length
    ? Math.max(...verified.map((state) => state.verifiedIndex))
    : -1;
}

function hasCleanPanelBuild(
  call: InvocationCardPayloadLike,
  expectedSource: string,
): boolean {
  if (
    call.name === "verify" &&
    call.arguments?.["operation"] === "build" &&
    call.arguments?.["target"] === expectedSource &&
    call.execution?.status === "complete" &&
    call.execution.isError !== true
  ) {
    const receipt = details(call)?.["receipt"];
    const unit = isRecord(receipt) ? receipt["unit"] : null;
    if (
      isRecord(receipt) &&
      receipt["protocol"] === "unit-verification-receipt.v1" &&
      receipt["operation"] === "build" &&
      typeof receipt["stateHash"] === "string" &&
      receipt["status"] === "ok" &&
      receipt["target"] === expectedSource &&
      isRecord(unit) &&
      unit["repoPath"] === expectedSource
    ) {
      return true;
    }
  }
  return (
    compilerCheckSummary(call, expectedSource)?.["errorCount"] === 0 ||
    successfulPanelBuildSummary(call, expectedSource)?.["errorCount"] === 0
  );
}

function validateTaskManagementApp(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const calls = base.evidence.calls;

  let creationIndex = -1;
  let source = "";
  const commits = publishedCommits(result);
  for (const [index, call] of calls.entries()) {
    const receipt = details(call)?.["receipt"];
    const unit = isRecord(receipt) ? receipt["unit"] : null;
    if (
      isRecord(receipt) &&
      receipt["protocol"] === "unit-verification-receipt.v1" &&
      receipt["status"] === "ok" &&
      isRecord(unit) &&
      unit["kind"] === "panel" &&
      typeof unit["repoPath"] === "string" &&
      unit["repoPath"].startsWith("panels/") &&
      commits.some((commit) => commit["contextId"] === receipt["contextId"])
    ) {
      creationIndex = index;
      source = unit["repoPath"];
      break;
    }
  }
  if (creationIndex < 0) {
    return {
      passed: false,
      reason:
        "No exact verified panel candidate was joined to a committed and published context",
    };
  }

  const cleanBuildIndex = calls.findIndex(
    (call, index) => index >= creationIndex && hasCleanPanelBuild(call, source),
  );
  if (cleanBuildIndex < 0) {
    return {
      passed: false,
      reason:
        "The task-management panel never produced a clean exact build receipt",
    };
  }

  const runtimeIndex = completeTodoRuntimeVerificationIndex(
    calls,
    cleanBuildIndex,
    source,
  );
  if (runtimeIndex < 0) {
    return {
      passed: false,
      reason:
        "The clean panel was not launched, reloaded, exercised through add/complete/filter/delete flows, captured, and checked for console errors",
    };
  }

  const final = findLastAgentMessage(result);
  if (!/task|project/iu.test(final)) {
    return {
      passed: false,
      reason:
        "The final response did not report the built, launched, and debugged app evidence",
    };
  }
  return { passed: true, reason: undefined };
}

function validateAtomicPanelStore(result: TestExecutionResult) {
  if (result.error) return { passed: false, reason: result.error };
  const captured = result.diagnostics?.["atomicPanelStore"];
  if (!isRecord(captured) || captured["source"] !== "system-test-harness") {
    return {
      passed: false,
      reason: "Harness did not capture the atomic panel-store acceptance",
    };
  }
  const panelPath = captured["panelPath"];
  const storePath = captured["storePath"];
  if (
    typeof panelPath !== "string" ||
    !panelPath.startsWith("panels/") ||
    typeof storePath !== "string" ||
    !storePath.startsWith("workers/")
  ) {
    return {
      passed: false,
      reason: "Harness did not capture exact panel and worker-store paths",
    };
  }
  const permissions = Array.isArray(captured["permissionsBeforeOpen"])
    ? captured["permissionsBeforeOpen"]
    : [];
  const installed = isRecord(captured["installedBeforeOpen"])
    ? captured["installedBeforeOpen"]
    : null;
  const units = Array.isArray(installed?.["units"])
    ? installed!["units"].filter(isRecord)
    : [];
  const configValue = installed?.["config"];
  const config = isRecord(configValue) ? configValue : null;
  const panelUnit = units.find((unit) => unit["source"] === panelPath);
  const storeUnit = units.find((unit) => unit["source"] === storePath);
  const services =
    config && Array.isArray(config["services"])
      ? config["services"].filter(isRecord)
      : [];
  const service = services.find(
    (candidate) => candidate["source"] === storePath,
  );
  const serviceAuthorityValue = service?.["authority"];
  const serviceAuthority = isRecord(serviceAuthorityValue)
    ? serviceAuthorityValue
    : null;
  const binding = serviceAuthority?.["binding"];
  const singletonObjects =
    config && Array.isArray(config["singletonObjects"])
      ? config["singletonObjects"].filter(isRecord)
      : [];
  const singleton = singletonObjects.find(
    (candidate) => candidate["source"] === storePath,
  );
  const serviceName = service?.["name"];
  const expectedCapability =
    typeof serviceName === "string" ? `workspace-service:${serviceName}` : null;
  const expectedResource =
    typeof singleton?.["className"] === "string" &&
    typeof singleton["key"] === "string"
      ? `do:${storePath}:${singleton["className"]}:${singleton["key"]}`
      : null;
  const panelEffectiveVersion = panelUnit?.["effectiveVersion"];
  const authorityRows = Array.isArray(panelUnit?.["authorityRows"])
    ? panelUnit!["authorityRows"].filter(isRecord)
    : [];
  const declaredRow = authorityRows.find((row) => {
    const resourceScopeValue = row["resourceScope"];
    const resourceScope = isRecord(resourceScopeValue)
      ? resourceScopeValue
      : null;
    return (
      row["capability"] === expectedCapability &&
      resourceScope?.["kind"] === "exact" &&
      resourceScope["key"] === expectedResource &&
      row["statement"] === "declared"
    );
  });
  const grant = permissions.filter(isRecord).find((record) => {
    const authorityValue = record["authority"];
    const authority = isRecord(authorityValue) ? authorityValue : null;
    const resourceValue = authority?.["resource"];
    const resource = isRecord(resourceValue) ? resourceValue : null;
    return (
      record["kind"] === "capability" &&
      record["repoPath"] === panelPath &&
      record["effectiveVersion"] === panelEffectiveVersion &&
      authority?.["effect"] === "allow" &&
      authority["provenance"] === "install" &&
      authority["scope"] === "version" &&
      authority["decisionSurface"] === "publication" &&
      authority["subject"] ===
        `code:${panelPath}@${String(panelEffectiveVersion)}` &&
      authority["capability"] === expectedCapability &&
      resource?.["kind"] === "exact" &&
      resource["key"] === expectedResource
    );
  });
  if (!grant) {
    return {
      passed: false,
      reason:
        "No exact version-scoped install permission was independently observed before panel open",
    };
  }
  const permissionsAfterReload = Array.isArray(
    captured["permissionsAfterReload"],
  )
    ? captured["permissionsAfterReload"].filter(isRecord)
    : [];
  if (
    permissionsAfterReload.some((record) => {
      const authority = isRecord(record["authority"])
        ? record["authority"]
        : null;
      return (
        authority?.["capability"] === expectedCapability &&
        authority["provenance"] === "acquisition"
      );
    })
  ) {
    return {
      passed: false,
      reason:
        "The first panel use acquired a runtime grant after publication clearance",
    };
  }
  const declaredFor = isRecord(binding) ? binding["declaredFor"] : null;
  const declaredBinding =
    binding === "declared" ||
    (Array.isArray(declaredFor) && declaredFor.includes(panelPath));
  if (
    !panelUnit ||
    panelUnit["kind"] !== "panel" ||
    typeof panelEffectiveVersion !== "string" ||
    !storeUnit ||
    storeUnit["kind"] !== "worker" ||
    typeof storeUnit["effectiveVersion"] !== "string" ||
    !service ||
    !expectedCapability ||
    !expectedResource ||
    !declaredBinding ||
    !declaredRow
  ) {
    return {
      passed: false,
      reason:
        "Installed units and workspace config do not bind the exact panel version to the exact store service",
    };
  }
  const written = captured["written"];
  const afterReload = captured["afterReload"];
  const afterRebuild = captured["afterRebuild"];
  const before = captured["before"];
  const after = captured["after"];
  const rebuilt = captured["rebuilt"];
  const rebuiltSnapshot = captured["rebuiltSnapshot"];
  if (
    typeof written !== "string" ||
    written.length < 8 ||
    written !== afterReload ||
    written !== afterRebuild ||
    !isRecord(before) ||
    !isRecord(after) ||
    !isRecord(rebuilt) ||
    !isRecord(rebuiltSnapshot) ||
    before["panelId"] !== after["panelId"] ||
    before["panelId"] !== rebuilt["panelId"] ||
    before["source"] !== panelPath ||
    after["source"] !== panelPath ||
    rebuilt["source"] !== panelPath
  ) {
    return {
      passed: false,
      reason:
        "The harness did not write, reload, rebuild, and read the same exact panel through its rendered UI",
    };
  }
  return { passed: true, reason: undefined };
}

async function orchestrateAtomicPanelStore(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  let handle: Awaited<
    ReturnType<typeof context.runner.openPanelClient>
  > | null = null;
  let error: string | undefined;
  let failure: SystemTestFailure | undefined;
  let captured: Record<string, unknown> = { source: "system-test-harness" };
  try {
    const publication = await context.runner.publishAtomicPanelStoreFixture();
    const { panelPath, storePath } = publication;

    const installedBeforeOpen =
      await context.runner.inspectInstalledWorkspace();
    const permissionsBeforeOpen = await context.runner.listPermissions();
    handle = await context.runner.openPanelClient(panelPath, {
      parentId: null,
      focus: false,
      contextId: publication.contextId,
    });
    const beforeObservation = await handle.observe();
    const written = `atomic-note-${crypto.randomUUID()}`;
    const controlsDeadline = Date.now() + 10_000;
    let controlsReady = false;
    while (Date.now() < controlsDeadline) {
      controlsReady = await context.runner.evalInPanelClient<boolean>(
        handle,
        `document.querySelector('[data-testid="note-input"]') instanceof HTMLInputElement && document.querySelector('[data-testid="save-note"]') instanceof HTMLElement`,
      );
      if (controlsReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!controlsReady) {
      captured = {
        ...captured,
        panelPath,
        storePath,
        before: beforeObservation,
        failureObservation: await handle.observe(),
        failureDiagnosis: await handle.diagnose(),
      };
      throw new Error("Notes controls did not render before the deadline");
    }
    await context.runner.evalInPanelClient(
      handle,
      `(() => { const input = document.querySelector('[data-testid="note-input"]'); if (!(input instanceof HTMLInputElement)) throw new Error('note input missing'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(written)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input.value; })()`,
    );
    await context.runner.evalInPanelClient(
      handle,
      `(() => { const save = document.querySelector('[data-testid="save-note"]'); if (!(save instanceof HTMLElement)) throw new Error('save control missing'); save.click(); return true; })()`,
    );
    const readStored = () =>
      context.runner.evalInPanelClient<string>(
        handle!,
        `document.querySelector('[data-testid="stored-note"]')?.textContent?.trim() ?? ''`,
      );
    const waitForStored = async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const value = await readStored();
        if (value === written) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Stored note did not become visible before the deadline");
    };
    await waitForStored();
    await handle.reload();
    const afterObservation = await handle.observe();
    const afterReload = await waitForStored();
    await handle.rebuild();
    const rebuiltObservation = await handle.observe();
    const rebuiltSnapshot = await handle.snapshot();
    const afterRebuild = await waitForStored();
    const permissionsAfterReload = await context.runner.listPermissions();
    captured = {
      source: "system-test-harness",
      panelPath,
      storePath,
      installedBeforeOpen,
      permissionsBeforeOpen,
      permissionsAfterReload,
      written,
      afterReload,
      afterRebuild,
      before: beforeObservation,
      after: afterObservation,
      rebuilt: rebuiltObservation,
      rebuiltSnapshot,
    };
  } catch (cause) {
    failure = systemTestFailure("atomic-panel-store", cause);
    error = failure.error.message;
  }
  const execution: TestExecutionResult = {
    messages: [],
    duration: Date.now() - startedAt,
    diagnostics: { atomicPanelStore: captured },
    ...(error ? { error } : {}),
    ...(failure ? { failure } : {}),
  };
  try {
    await handle?.archive();
  } catch (cause) {
    execution.cleanupErrors = [
      `archive: ${cause instanceof Error ? cause.message : String(cause)}`,
    ];
    execution.cleanupFailures = [
      systemTestFailure("atomic-panel-store-archive", cause),
    ];
  }
  return execution;
}

function validateTodoDebugLoop(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const calls = base.evidence.calls;

  let creationIndex = -1;
  let source = "";
  for (const [index, call] of calls.entries()) {
    if (call.name !== "eval") continue;
    const created = returnedRecords(call).find((record) =>
      createdProject(record, "panels"),
    );
    if (created && typeof created["created"] === "string") {
      creationIndex = index;
      source = created["created"];
      break;
    }
  }
  if (creationIndex < 0) {
    return {
      passed: false,
      reason: "No completed eval returned the created To-Do panel identity",
    };
  }

  const brokenTypecheckIndex = calls.findIndex((call, index) => {
    const summary =
      index > creationIndex ? compilerCheckSummary(call, source) : null;
    return summary !== null && Number(summary["errorCount"]) > 0;
  });
  if (brokenTypecheckIndex < 0) {
    return {
      passed: false,
      reason:
        "The deliberate compiler defect was not observed through a structured panel compile/build check",
    };
  }
  const authoredBrokenPanel = calls
    .slice(creationIndex + 1, brokenTypecheckIndex)
    .some((call) => successfulPanelMutation(call, source) !== null);
  if (!authoredBrokenPanel) {
    return {
      passed: false,
      reason: "No managed panel edit preceded the failing typecheck",
    };
  }

  const firstCleanTypecheckIndex = calls.findIndex((call, index) => {
    const summary =
      index > brokenTypecheckIndex
        ? (compilerCheckSummary(call, source) ??
          successfulPanelBuildSummary(call, source))
        : null;
    return summary !== null && summary["errorCount"] === 0;
  });
  if (firstCleanTypecheckIndex < 0) {
    return {
      passed: false,
      reason:
        "No later clean compile/build result proved that the compiler defect was repaired",
    };
  }

  const openedPanels = new Set<string>();
  const firstInspectionIndex = calls.findIndex((call, index) => {
    if (index < firstCleanTypecheckIndex) return false;
    for (const entry of nativePanelOperations(call)) {
      const id = entry["id"];
      if (typeof id !== "string") continue;
      if (entry["type"] === "open" && entry["source"] === source)
        openedPanels.add(id);
      if (openedPanels.has(id) && renderedCaptureObservation(entry))
        return true;
    }
    return false;
  });
  if (firstInspectionIndex < 0) {
    return {
      passed: false,
      reason:
        "The compile-clean panel was not launched and inspected before UX repair",
    };
  }

  let uxMutationIndex = -1;
  let uxApplicationId = "";
  for (let index = firstInspectionIndex + 1; index < calls.length; index += 1) {
    const mutation = successfulPanelMutation(calls[index]!, source);
    if (mutation) {
      uxMutationIndex = index;
      uxApplicationId = String(mutation["applicationId"]);
      break;
    }
  }
  if (uxMutationIndex < 0) {
    return {
      passed: false,
      reason:
        "No managed source edit repaired the UX after inspecting the running panel",
    };
  }
  const flawedPanelImageRead = calls
    .slice(firstInspectionIndex, uxMutationIndex)
    .some(isSuccessfulImageRead);
  if (!flawedPanelImageRead) {
    return {
      passed: false,
      reason:
        "The agent did not read the compile-clean flawed panel screenshot as image content before choosing the UX repair",
    };
  }

  const finalCleanTypecheckIndex = calls.findIndex((call, index) => {
    const summary =
      index > uxMutationIndex
        ? (compilerCheckSummary(call, source) ??
          successfulPanelBuildSummary(call, source))
        : null;
    return summary !== null && summary["errorCount"] === 0;
  });
  if (finalCleanTypecheckIndex < 0) {
    return {
      passed: false,
      reason: "The UX repair was not followed by a clean compile/build result",
    };
  }

  const finalRuntimeIndex = completeTodoRuntimeVerificationIndex(
    calls,
    finalCleanTypecheckIndex,
    source,
  );
  if (finalRuntimeIndex < 0) {
    return {
      passed: false,
      reason:
        "No final live-panel verification rebuilt the same panel, exercised add/complete/filter/delete behavior, captured the UI, and returned an empty console error list",
    };
  }
  const repairedPanelImageRead = calls
    .slice(uxMutationIndex + 1)
    .some(isSuccessfulImageRead);
  if (!repairedPanelImageRead) {
    return {
      passed: false,
      reason:
        "The agent captured the repaired panel but did not read the screenshot as image content",
    };
  }

  let publishedEventId = "";
  for (let index = uxMutationIndex + 1; index < calls.length; index += 1) {
    const committed = commitResult(calls[index]!);
    const event = committed?.["event"];
    if (
      !committed ||
      !Array.isArray(committed["committedApplicationIds"]) ||
      !committed["committedApplicationIds"].includes(uxApplicationId) ||
      !isRecord(event) ||
      typeof event["eventId"] !== "string"
    ) {
      continue;
    }
    for (let pushIndex = index + 1; pushIndex < calls.length; pushIndex += 1) {
      const pushed = operationResult(calls[pushIndex]!, "push");
      if (
        pushed?.["eventId"] === event["eventId"] &&
        pushed["mainEventId"] === event["eventId"]
      ) {
        publishedEventId = event["eventId"];
        break;
      }
    }
    if (publishedEventId) break;
  }
  if (!publishedEventId) {
    return {
      passed: false,
      reason:
        "The exact UX-repair application was not joined to a committed and published event",
    };
  }

  const final = findLastAgentMessage(result);
  if (
    !/compil|type.?check/iu.test(final) ||
    !/\bux\b|usab|experience/iu.test(final) ||
    !/add|complete|filter|delete/iu.test(final)
  ) {
    return {
      passed: false,
      reason:
        "The final response did not report the observed compiler defect, UX repair, and live behavior",
    };
  }
  return { passed: true, reason: undefined };
}

export const projectLifecycleTests: TestCase[] = [
  {
    name: "panel-create-commit-open",
    description: "Create and open a new panel project",
    category: "project-lifecycle",
    workspaceRepoFixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy(
      "inspect-created-project-panel",
    ),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt: "Create a brand-new isolated panel project and open it for use.",
    validate: validatePanelCreate,
  },
  {
    name: "panel-curated-icon-build-open",
    description:
      "Discover a supported icon, then create, build, and open a panel",
    category: "project-lifecycle",
    workspaceRepoFixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy("inspect-curated-icon-panel"),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt:
      "Create and publish a brand-new isolated panel with a supported built-in database-style icon selected from this workspace's available icon catalog. Verify that it builds cleanly, then open it and inspect its rendered content for use.",
    validate: validateCuratedIconPanelCreate,
  },
  {
    name: "panel-fork-dry-run-and-commit",
    description: "Fork and open a panel project",
    category: "project-lifecycle",
    workspaceRepoFixture: BUILDABLE_PANEL_WITH_DERIVED_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy(
      "inspect-forked-project-panel",
      [
        // Forking is the capability under test, so the case policy has to carry
        // it: without the grant the fork prompts, the unattended harness has no
        // approver, and the scenario fails on its own subject.
        {
          ruleId: "fork-panel-semantic-context",
          capability: { kind: "exact", key: "context.semantic.fork" },
          resource: { kind: "prefix", prefix: "" },
          tier: "gated",
          decision: "once",
        },
      ],
    ),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt:
      "Create a separate panel based on the provided panel project, leave the original unchanged, and open the new panel to confirm it works.",
    validate: validatePanelFork,
  },
  {
    name: "worker-fork-classmap-dry-run",
    description: "Dry-run a worker fork",
    category: "project-lifecycle",
    prompt:
      "Preview a separate copy of the existing worker and confirm the original remains unchanged.",
    validate: validateWorkerForkPlan,
  },
  {
    name: "worker-create-commit-publish",
    description: "Create and publish a new stateless worker project",
    category: "project-lifecycle",
    workspaceRepoFixture: CREATED_WORKER_WORKSPACE_REPO_FIXTURE,
    prompt: "Create and publish a brand-new isolated stateless worker project.",
    validate: validateWorkerCreate,
  },
  {
    name: "commit-existing-project",
    description: "Create, change, and commit a package project",
    category: "project-lifecycle",
    workspaceRepoFixture: CREATED_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Create an isolated package project, make one follow-up change, and commit that change.",
    validate: validateProjectCommit,
  },
  {
    name: "task-management-build-launch-debug",
    description: "Build, launch, and debug a full-featured task-management app",
    category: "project-lifecycle",
    timeoutMs: 45 * 60_000,
    workspaceRepoFixture: CREATED_PANEL_STORE_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy(
      "inspect-task-management-panel",
    ),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt:
      "Build me a full-featured task management app, then launch and debug it.",

    validate: validateTaskManagementApp,
  },
  {
    name: "atomic-panel-store-install-clearance",
    description:
      "Publish a panel and its declared workspace store atomically, then prove install clearance and UI persistence",
    category: "project-lifecycle",
    timeoutMs: 45 * 60_000,
    workspaceRepoFixture: CREATED_PANEL_STORE_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy("inspect-atomic-panel-store", [
      {
        ruleId: "inspect-atomic-panel-store-install-permission",
        capability: { kind: "exact", key: "permissions.read" },
        resource: { kind: "exact", key: "permissions.read" },
        tier: "gated",
        decision: "once",
      },
    ]),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt:
      "Harness-orchestrated atomic panel/store publication and live UI persistence check.",
    orchestrate: orchestrateAtomicPanelStore,
    validation: "harness",
    validate: validateAtomicPanelStore,
  },
  {
    name: "panel-todo-debug-polish",
    description:
      "Build, debug, polish, and publish a To-Do panel through the live UI",
    category: "project-lifecycle",
    workspaceRepoFixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy("inspect-created-panel", [
      {
        ruleId: "inspect-screenshot-analysis-dependency",
        capability: { kind: "exact", key: "workspace.dependencies.inspect" },
        resource: { kind: "exact", key: "workspace.dependencies.inspect" },
        tier: "gated",
        decision: "once",
      },
    ]),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt:
      "Build a simple, polished To-Do list as a brand-new isolated panel. Begin with two small deliberate defects—one compiler error and one obvious usability problem—so the development loop has real failures to find. Observe the compiler defect through a structured compile or build check, then diagnose and repair only that failure while leaving the usability defect intact. Launch the compile-clean but visibly flawed panel, capture and visually inspect a screenshot so your UX repair is based on the rendered pixels rather than DOM text alone. Repair the usability defect in a separate source edit. Refresh the same running panel with the repaired source, capture and visually inspect a second screenshot, exercise the add, complete, filter, and delete flows in the live UI, and publish the finished result. Make the final experience keyboard-friendly, responsive, visually polished, and free of runtime or console errors. Report the defects you observed and concrete final verification.",
    validate: validateTodoDebugLoop,
  },
];
