import type { HeadlessSession } from "@workspace/agentic-session";
import {
  BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
  CONTENT_WORKSPACE_REPO_FIXTURE,
  CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
  type TestOrchestrationContext,
} from "../types.js";
import {
  panelControlAuthorityPolicy,
  PANEL_AUTOMATION_RESOURCE,
} from "../panel-authority.js";
import {
  finalMessageHasAll,
  getToolCalls,
  type InvocationCardPayloadLike,
} from "./_helpers.js";
import {
  completedScenarioEvidence,
  walkRecords,
} from "./_scenario-evidence.js";
import { orchestratePanelGoal } from "./_panel-tree-invariant.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function records(call: InvocationCardPayloadLike): Record<string, unknown>[] {
  return walkRecords([call.execution?.result]);
}

function isFailed(call: InvocationCardPayloadLike): boolean {
  return (
    call.execution?.isError === true ||
    call.execution?.status === "error" ||
    call.execution?.status === "failed"
  );
}

function isComplete(call: InvocationCardPayloadLike): boolean {
  return (
    call.execution?.status === "complete" && call.execution.isError !== true
  );
}

function failure(
  call: InvocationCardPayloadLike,
  code: string,
): Record<string, unknown> | null {
  const protocolFailure = records(call).find(
    (record) =>
      record["protocol"] === "agent-tool-failure.v1" && record["code"] === code,
  );
  if (protocolFailure) return protocolFailure;

  const result = call.execution?.result;
  const details =
    isRecord(result) && isRecord(result["details"]) ? result["details"] : null;
  const errorData =
    details && isRecord(details["errorData"]) ? details["errorData"] : null;
  const failureCode =
    call.execution?.failureCode ?? call.failureCode ?? details?.["failureCode"];
  return failureCode === code && errorData?.["code"] === code
    ? errorData
    : null;
}

function createdPublishedPanel(call: InvocationCardPayloadLike): boolean {
  return records(call).some((record) => {
    const preflight = record["preflight"];
    const publication = record["publication"];
    return (
      typeof record["created"] === "string" &&
      record["created"].startsWith("panels/") &&
      isRecord(preflight) &&
      preflight["ok"] === true &&
      preflight["projectType"] === "panel" &&
      isRecord(publication) &&
      publication["published"] === true
    );
  });
}

function validateInvalidIconRecovery(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["eval"]);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const rejectedIndex = calls.findIndex((call) => {
    if (call.name !== "eval" || !isFailed(call)) return false;
    const typed = failure(call, "project_icon_invalid");
    const recovery = typed?.["recovery"];
    return (
      isRecord(recovery) &&
      recovery["action"] === "correct-request" &&
      records(call).some(
        (record) => record["protocol"] === "workspace-dev-catalog.v1",
      )
    );
  });
  const discoveredIndex = calls.findIndex(
    (call, index) =>
      index > rejectedIndex &&
      call.name === "eval" &&
      isComplete(call) &&
      records(call).some(
        (record) =>
          record["protocol"] === "workspace-dev-catalog.v1" &&
          Array.isArray(record["entries"]) &&
          record["entries"].length > 0,
      ),
  );
  // Proactive discovery is the best outcome and must not be penalized for
  // avoiding a predictable failure. When the unsupported icon is attempted,
  // the typed failure's embedded bounded catalog is already sufficient
  // correction evidence; an extra catalog round trip is optional.
  const catalogIndex =
    discoveredIndex >= 0
      ? discoveredIndex
      : rejectedIndex >= 0
        ? rejectedIndex
        : -1;
  const createIndex = calls.findIndex(
    (call, index) =>
      index >= catalogIndex &&
      call.name === "eval" &&
      createdPublishedPanel(call),
  );
  return catalogIndex >= 0 && createIndex >= catalogIndex
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The agent did not discover the bounded catalog and create the corrected panel",
      };
}

function validateRecoverableInfrastructureContinuation(
  result: TestExecutionResult,
) {
  const base = completedScenarioEvidence(result, [], {
    allowFailed: (call) =>
      call.name === "eval" &&
      failure(call, "recoverable_infrastructure_probe") !== null,
  });
  if (!base.passed) return base;
  const failed = getToolCalls(result).find((call) => {
    const typed =
      call.name === "eval"
        ? failure(call, "recoverable_infrastructure_probe")
        : null;
    const recovery = typed?.["recovery"];
    return (
      isFailed(call) &&
      call.execution?.terminalOutcome === "infrastructure_error" &&
      isRecord(recovery) &&
      recovery["action"] === "reobserve"
    );
  });
  if (!failed) {
    return {
      passed: false,
      reason:
        "The eval failure did not retain its infrastructure origin and typed recovery",
    };
  }
  return finalMessageHasAll(result, ["RECOVERED_IN_SAME_TURN"]);
}

function buildReceipt(
  record: Record<string, unknown>,
  status: "ok" | "failed",
) {
  const receipt = record["receipt"];
  return isRecord(receipt) &&
    receipt["protocol"] === "unit-verification-receipt.v1" &&
    receipt["operation"] === "build" &&
    typeof receipt["stateHash"] === "string" &&
    receipt["status"] === status
    ? receipt
    : null;
}

function validateBoundedBuildDiagnostics(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["verify"], {
    allowFailed: (call) => call.name === "verify",
  });
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const failedIndex = calls.findIndex((call) => {
    if (call.name !== "verify" || !isFailed(call)) return false;
    return records(call).some((record) => {
      const receipt = buildReceipt(record, "failed");
      const report = record["report"];
      return (
        receipt !== null &&
        isRecord(report) &&
        Array.isArray(report["diagnostics"]) &&
        report["diagnostics"].length <= 40 &&
        typeof record["truncatedDiagnostics"] === "number" &&
        record["truncatedDiagnostics"] > 0
      );
    });
  });
  if (failedIndex < 0) {
    return {
      passed: false,
      reason:
        "No failed build returned a bounded report and exact failed-build receipt",
    };
  }
  const cleanIndex = calls.findIndex(
    (call, index) =>
      index > failedIndex &&
      call.name === "verify" &&
      isComplete(call) &&
      records(call).some((record) => buildReceipt(record, "ok") !== null),
  );
  return cleanIndex > failedIndex
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: "The bounded failed build was not repaired and rebuilt cleanly",
      };
}

function extensionlessTarget(call: InvocationCardPayloadLike): boolean {
  const target = call.arguments?.["target"] ?? call.arguments?.["path"];
  if (typeof target !== "string") return false;
  const path = target.replace(/^file:/u, "");
  const basename = path.split("/").at(-1) ?? "";
  return basename.length > 0 && !/\.[A-Za-z0-9]{1,8}$/u.test(basename);
}

function normalizedFilePath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0
    ? value.replace(/^file:(?:\/\/)?/iu, "")
    : null;
}

function screenshotPaths(call: InvocationCardPayloadLike): Set<string> {
  const paths = new Set<string>();
  for (const record of records(call)) {
    for (const [key, value] of Object.entries(record)) {
      if (!/(?:path|file|screenshot)$/iu.test(key)) continue;
      const candidate = normalizedFilePath(value);
      if (candidate) paths.add(candidate);
    }
    const returned = record["returnValue"];
    const returnedPath = normalizedFilePath(returned);
    if (returnedPath) paths.add(returnedPath);
  }
  return paths;
}

function isNativeImageRead(call: InvocationCardPayloadLike): boolean {
  return records(call).some(
    (record) =>
      typeof record["mimeType"] === "string" &&
      record["mimeType"].startsWith("image/") &&
      typeof record["size"] === "number" &&
      record["size"] > 0,
  );
}

function validateExtensionlessScreenshot(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["eval", "read"]);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const capturedPaths = new Set(
    calls.flatMap((call) =>
      call.name === "eval" &&
      isComplete(call) &&
      /\.screenshot\s*\(/u.test(String(call.arguments?.["code"] ?? "")) &&
      /fs\.writeFile\s*\(/u.test(String(call.arguments?.["code"] ?? ""))
        ? [...screenshotPaths(call)]
        : [],
    ),
  );
  const imageRead = calls.some(
    (call) =>
      call.name === "read" &&
      isComplete(call) &&
      extensionlessTarget(call) &&
      isNativeImageRead(call) &&
      capturedPaths.has(
        normalizedFilePath(
          call.arguments?.["target"] ?? call.arguments?.["path"],
        ) ?? "",
      ),
  );
  return capturedPaths.size > 0 && imageRead
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The extensionless screenshot was not returned through read as native image content",
      };
}

function validatePanelGenerationRecovery(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["eval"]);
  if (!base.passed) return base;
  const buildVerified = base.evidence.calls.some((call) => {
    if (!isComplete(call)) return false;
    const requestedBuild =
      (call.name === "verify" && call.arguments?.["operation"] === "build") ||
      (call.name === "eval" &&
        /\bbuild\.getBuildReport\s*\(/u.test(
          String(call.arguments?.["code"] ?? ""),
        ));
    return (
      requestedBuild &&
      records(call).some(
        (record) =>
          record["status"] === "ok" &&
          (call.name === "verify" || Array.isArray(record["diagnostics"])),
      )
    );
  });
  if (!buildVerified) {
    return {
      passed: false,
      reason: "No successful structured panel build evidence was observed",
    };
  }
  const evalCalls = base.evidence.calls.filter(
    (call) => call.name === "eval" && isComplete(call),
  );
  const hasObservedInteraction = (call: InvocationCardPayloadLike): boolean =>
    records(call).some((record) => {
      const effect = record["effect"];
      return (
        record["protocol"] === "cdp-interaction-outcome.v1" &&
        record["delivery"] === "dispatched" &&
        isRecord(effect) &&
        effect["status"] === "observed"
      );
    });
  const initial = evalCalls.findIndex(hasObservedInteraction);
  // Generation identity is the public lifecycle evidence. Arbitrary summary
  // keys (refreshStatus, sessionStatus, etc.) are not part of that contract.
  const initialGenerations = evalCalls
    .slice(0, initial + 1)
    .flatMap(records)
    .filter(
      (record) =>
        typeof record["panelId"] === "string" &&
        typeof record["runtimeEntityId"] === "string" &&
        typeof record["attemptId"] === "string" &&
        typeof record["buildKey"] === "string",
    );
  const refresh = evalCalls.findIndex((call, index) => {
    if (index <= initial) return false;
    const code = String(call.arguments?.["code"] ?? "");
    const rebuilt = evalCalls
      .slice(initial + 1, index + 1)
      .some((earlier) =>
        String(earlier.arguments?.["code"] ?? "").includes(".rebuild("),
      );
    return (
      rebuilt &&
      code.includes(".refresh(") &&
      records(call).some(
        (generation) =>
          generation["protocol"] === "panel-cdp-generation.v1" &&
          typeof generation["runtimeEntityId"] === "string" &&
          typeof generation["attemptId"] === "string" &&
          typeof generation["buildKey"] === "string" &&
          initialGenerations.some(
            (previous) =>
              generation["panelId"] === previous["panelId"] &&
              generation["runtimeEntityId"] !== previous["runtimeEntityId"] &&
              generation["attemptId"] !== previous["attemptId"] &&
              generation["buildKey"] !== previous["buildKey"],
          ),
      )
    );
  });
  if (initial < 0 || refresh < 0) {
    return {
      passed: false,
      reason:
        "No initial interaction and replacement panel generation with a changed build were observed",
    };
  }
  const initialIndex = base.evidence.calls.indexOf(evalCalls[initial]!);
  const refreshIndex = base.evidence.calls.indexOf(evalCalls[refresh]!);
  const sourceImproved = base.evidence.calls.some((call, index) => {
    if (index <= initialIndex || index >= refreshIndex || !isComplete(call))
      return false;
    if (!["apply_patch", "edit", "write"].includes(call.name)) return false;
    const paths = [call.arguments?.["path"]];
    const operations = call.arguments?.["operations"];
    if (Array.isArray(operations)) {
      paths.push(
        ...operations.filter(isRecord).map((operation) => operation["path"]),
      );
    }
    return paths.some(
      (path) =>
        typeof path === "string" &&
        /^panels\/[^/]+\/.+\.(?:[cm]?[jt]sx?|css|html|svelte)$/u.test(path),
    );
  });
  if (!sourceImproved) {
    return {
      passed: false,
      reason:
        "No rendered panel source changed between the initial interaction and rebuild",
    };
  }
  const observedInteraction = evalCalls
    .slice(refresh)
    .some(hasObservedInteraction);
  return initial >= 0 && refresh > initial && observedInteraction
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The panel was not rebuilt through a replaced generation and verified by a semantic interaction outcome",
      };
}

const COLLABORATOR_NOTE =
  "Collaborator note: preserve this concurrent addition.";
const RECOVERED_HEADING = "# Recovered note";

async function orchestrateStaleEditRecovery(
  context: TestOrchestrationContext,
): Promise<TestExecutionResult> {
  const startedAt = Date.now();
  const repoName = context.runner.workspaceRepoName;
  if (!repoName)
    throw new Error("stale edit recovery requires a repository fixture");
  const path = `projects/${repoName}/README.md`;
  const sessions: HeadlessSession[] = [];
  let initialMessages: TestExecutionResult["messages"] = [];
  let error: string | undefined;
  try {
    const editor = await context.runner.spawn({ context: "task" });
    sessions.push(editor);
    await context.sendAndWait(
      editor,
      `Please check the current heading in ${path}; I will ask you to update it shortly.`,
      "editor observes the original note",
    );
    initialMessages = [...editor.messages];
    const collaborator = await context.runner.spawn({ context: "task" });
    sessions.push(collaborator);
    await context.sendAndWait(
      collaborator,
      `Add this note to ${path} without changing its existing text: ${COLLABORATOR_NOTE} Leave it unpublished.`,
      "independent collaborator updates the same note",
    );
    await context.sendAndWait(
      editor,
      `Update the heading in ${path} to ${RECOVERED_HEADING}. Preserve the rest of the file, check the finished note, and leave it unpublished.`,
      "editor recovers without losing the concurrent addition",
    );
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const [editor, collaborator] = sessions;
  const execution: TestExecutionResult = {
    messages: [
      ...initialMessages,
      ...(collaborator ? [...collaborator.messages] : []),
      ...(editor ? [...editor.messages].slice(initialMessages.length) : []),
    ],
    duration: Date.now() - startedAt,
    ...(editor ? { snapshot: editor.snapshot() } : {}),
    ...(error ? { error } : {}),
  };
  const cleanupErrors: string[] = [];
  for (const session of sessions.reverse()) {
    try {
      await session.close();
      cleanupErrors.push(
        ...session
          .snapshot()
          .cleanupErrors.map((entry) => `${entry.phase}: ${entry.message}`),
      );
    } catch (cause) {
      cleanupErrors.push(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  if (cleanupErrors.length) {
    execution.cleanupErrors = cleanupErrors;
    execution.error ??= `Headless cleanup failed: ${cleanupErrors.join("; ")}`;
  }
  return execution;
}

function validateStaleEditRecovery(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["read", "edit"]);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const readIndex = calls.findIndex(
    (call) =>
      call.name === "read" &&
      isComplete(call) &&
      typeof call.arguments?.["path"] === "string" &&
      call.arguments["path"].startsWith("projects/") &&
      call.arguments["path"].endsWith("/README.md"),
  );
  const path = calls[readIndex]?.arguments?.["path"];
  const sameFile = (call: InvocationCardPayloadLike) =>
    call.arguments?.["path"] === path;
  const staleIndex = calls.findIndex(
    (call, index) =>
      index > readIndex &&
      call.name === "edit" &&
      sameFile(call) &&
      isComplete(call) &&
      records(call).some(
        (record) =>
          record["protocol"] === "file-mutation.v1" &&
          record["status"] === "conflict" &&
          Array.isArray(record["conflicts"]) &&
          record["conflicts"].some(
            (conflict) =>
              isRecord(conflict) &&
              conflict["reason"] === "content-changed" &&
              isRecord(conflict["recovery"]) &&
              conflict["recovery"]["action"] === "reobserve",
          ),
      ),
  );
  const reobserveIndex = calls.findIndex(
    (call, index) =>
      index > staleIndex &&
      call.name === "read" &&
      sameFile(call) &&
      isComplete(call),
  );
  const correctedIndex = calls.findIndex(
    (call, index) =>
      index > reobserveIndex &&
      call.name === "edit" &&
      sameFile(call) &&
      isComplete(call) &&
      records(call).some(
        (record) =>
          record["protocol"] === "file-mutation.v1" &&
          record["status"] === "applied",
      ),
  );
  const verified = calls.some(
    (call, index) =>
      index > correctedIndex &&
      call.name === "read" &&
      sameFile(call) &&
      isComplete(call) &&
      records(call).some(
        (record) =>
          typeof record["text"] === "string" &&
          record["text"].includes(COLLABORATOR_NOTE) &&
          record["text"].includes(RECOVERED_HEADING),
      ),
  );
  return typeof path === "string" &&
    readIndex >= 0 &&
    staleIndex > readIndex &&
    reobserveIndex > staleIndex &&
    correctedIndex > reobserveIndex &&
    verified
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The concurrent edit did not produce a recoverable stale-observation conflict followed by reobservation, correction, and readback preserving the collaborator's addition",
      };
}

function fileMutationRecord(
  call: InvocationCardPayloadLike,
  status: "applied" | "unchanged" | "conflict",
): Record<string, unknown> | null {
  return (
    records(call).find(
      (record) =>
        record["protocol"] === "file-mutation.v1" &&
        record["status"] === status,
    ) ?? null
  );
}

function hasSemanticMutationEvidence(record: Record<string, unknown>): boolean {
  const vcsResult = record["vcsResult"];
  return (
    record["storage"] === "vcs" &&
    typeof record["intent"] === "string" &&
    isRecord(vcsResult) &&
    typeof vcsResult["workUnitId"] === "string" &&
    typeof vcsResult["applicationId"] === "string" &&
    Array.isArray(vcsResult["changeIds"]) &&
    vcsResult["changeIds"].length > 0
  );
}

function validateUnifiedFileAuthoring(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["write", "edit", "read"]);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const writeIndex = calls.findIndex((call) => {
    if (
      call.name !== "write" ||
      !isComplete(call) ||
      typeof call.arguments?.["intent"] !== "string"
    ) {
      return false;
    }
    const mutation = fileMutationRecord(call, "applied");
    return Boolean(
      mutation &&
      hasSemanticMutationEvidence(mutation) &&
      records(call).some(
        (record) =>
          record["kind"] === "write" && record["status"] === "created",
      ),
    );
  });
  const editIndex = calls.findIndex((call, index) => {
    if (
      index <= writeIndex ||
      call.name !== "edit" ||
      !isComplete(call) ||
      typeof call.arguments?.["intent"] !== "string"
    ) {
      return false;
    }
    const mutation = fileMutationRecord(call, "applied");
    return Boolean(
      mutation &&
      hasSemanticMutationEvidence(mutation) &&
      records(call).some(
        (record) =>
          record["mode"] === "normalized" && typeof record["line"] === "number",
      ),
    );
  });
  const editedPath =
    editIndex >= 0 && typeof calls[editIndex]?.arguments?.["path"] === "string"
      ? calls[editIndex]!.arguments!["path"]
      : null;
  const readIndex = calls.findIndex(
    (call, index) =>
      index > editIndex &&
      call.name === "read" &&
      isComplete(call) &&
      call.arguments?.["path"] === editedPath &&
      JSON.stringify(call.execution?.result ?? "").includes(
        "unified-agentic-ergonomics",
      ),
  );
  return writeIndex >= 0 && editIndex > writeIndex && readIndex > editIndex
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "write/edit did not preserve semantic intent evidence, report normalized matching, and read back the exact authored file",
      };
}

const SCREENSHOT_PROMPT =
  "Capture a small browser view as an image, save it under a filename with no extension, read that image back, and tell me its visible heading.";
const PANEL_REBUILD_PROMPT =
  "Create and publish a small counter panel, open it, then make a visible improvement while it is running. Refresh the panel and confirm the improved version still works.";

export const developerErgonomicsTests: TestCase[] = [
  {
    name: "recoverable-infrastructure-failure-continues-turn",
    description:
      "Continue the same agent turn after a typed recoverable infrastructure failure",
    category: "developer-ergonomics",

    prompt:
      "Exercise the agent failure protocol once: use eval to throw an Error whose errorData is { code: 'recoverable_infrastructure_probe', failureKind: 'infrastructure', recovery: { action: 'reobserve', instruction: 'Continue this same turn and report RECOVERED_IN_SAME_TURN.' } }. The eval is expected to fail. After receiving that failed tool result, continue in this same turn and answer with exactly RECOVERED_IN_SAME_TURN. Do not retry the eval.",
    expectedToolFailures: [
      { name: "eval", failureCode: "recoverable_infrastructure_probe" },
    ],
    validate: validateRecoverableInfrastructureContinuation,
  },
  {
    name: "invalid-icon-discover-recover-create",
    description: "Resolve a misspelled icon through bounded discovery",
    category: "developer-ergonomics",

    workspaceRepoFixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Create and publish an isolated panel using the built-in icon `lucide:columns-3x`.",
    expectedToolFailures: [{ name: "eval", failureCode: "project_icon_invalid" }],
    validate: validateInvalidIconRecovery,
  },
  {
    name: "failed-build-bounded-diagnostics",
    description:
      "Recover from a diagnostic-heavy build without flooding the trajectory",
    category: "developer-ergonomics",

    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Stress-test the disposable package's build diagnostics by introducing more than 50 separate type errors so the bounded error report is exercised. Then fix the package and confirm it builds cleanly. Leave the temporary breakage unpublished.",
    expectedToolFailures: [{ name: "verify", failureCode: "build_verification_failed" }],
    validate: validateBoundedBuildDiagnostics,
  },
  {
    name: "extensionless-screenshot-resource-read",
    description: "Read an extensionless screenshot as native image content",
    category: "developer-ergonomics",

    authorityPolicy: panelControlAuthorityPolicy(
      "inspect-extensionless-screenshot",
    ),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt: SCREENSHOT_PROMPT,
    orchestrate: (context) =>
      orchestratePanelGoal(
        context,
        SCREENSHOT_PROMPT,
        "inspect an extensionless screenshot",
      ),
    validate: validateExtensionlessScreenshot,
  },
  {
    name: "panel-rebuild-reacquire-and-interact",
    description:
      "Refresh a generation-fenced CDP session after rebuilding a panel",
    category: "developer-ergonomics",

    workspaceRepoFixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy("inspect-rebuilt-generation"),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt: PANEL_REBUILD_PROMPT,
    orchestrate: (context) =>
      orchestratePanelGoal(
        context,
        PANEL_REBUILD_PROMPT,
        "rebuild and interact with one panel runtime",
        { expectedCreatedRootCount: 1 },
      ),
    validate: validatePanelGenerationRecovery,
  },
  {
    name: "write-edit-unified-matching-provenance",
    description:
      "Author through ergonomic write/edit while preserving shared matching and VCS intent",
    category: "developer-ergonomics",

    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    prompt:
      'In the disposable project, create one new text file with the complete content `Status: “before”` and a concise stated intent. Then make a targeted replacement in that same file using straight-quoted old text `Status: "before"`, changing it to `Status: "unified-agentic-ergonomics"` with a distinct concise stated intent. Use the natural whole-file and targeted-edit capabilities, verify the final file by reading it, and do not publish.',
    validate: validateUnifiedFileAuthoring,
  },
  {
    name: "stale-edit-reobserve-and-apply",
    description:
      "Recover an optimistic file edit without losing a concurrent collaborator update",
    category: "developer-ergonomics",

    workspaceRepoFixture: CONTENT_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Harness-orchestrated concurrent note edit and stale-observation recovery.",
    orchestrate: orchestrateStaleEditRecovery,
    validate: validateStaleEditRecovery,
  },
];
