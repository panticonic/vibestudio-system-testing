import type { TestCase, TestExecutionResult } from "../types.js";
import {
  BUILDABLE_PANEL_WORKSPACE_REPO_FIXTURE,
  BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
  BUILDABLE_REGULAR_WORKER_WORKSPACE_REPO_FIXTURE,
  OPTIMIZABLE_PANEL_WORKSPACE_REPO_FIXTURE,
} from "../types.js";
import {
  completedScenarioEvidence,
  hasNonEmptyStructuredResult,
  invocationReturnValue,
  walkRecords,
} from "./_scenario-evidence.js";
import { PANEL_AUTOMATION_RESOURCE, panelControlAuthorityPolicy } from "../panel-authority.js";
import type { InvocationCardPayloadLike } from "./_helpers.js";
import {
  eventRef,
  managedMutation,
  record,
  stringArray,
  successfulToolDetails,
  unitForPath,
  verificationMatches,
  workspacePath,
  zeroWorkingCounts,
} from "./_managed-unit-evidence.js";

function validateWorkspaceBuild(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["verify"]);
  if (!base.passed) return base;
  const contextId = result.provenance?.contextId;
  if (!contextId) {
    return { passed: false, reason: "Build verification exposed no exact task context" };
  }
  const verified = base.evidence.calls.some((call) => {
    const unit = unitForPath(call.arguments?.["target"], "packages");
    return unit !== null && verificationMatches(call, "build", unit, contextId);
  });
  return verified
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: "No successful exact-context package build verification was observed",
      };
}

function validateSandboxedWorkspaceTest(
  result: TestExecutionResult,
  runtime: "browser" | "workerd",
) {
  const base = completedScenarioEvidence(result, ["verify"]);
  if (!base.passed) return base;
  const contextId = result.provenance?.contextId;
  if (!contextId) return { passed: false, reason: "Test verification exposed no exact task context" };
  if (base.evidence.calls.some((call) => call.name === "extensions.invoke")) {
    return { passed: false, reason: "Sandboxed verification reached the native extension route" };
  }
  const verified = base.evidence.calls.some((call) => {
    if (call.arguments?.["operation"] !== "test") return false;
    const details = successfulToolDetails(call, "verify");
    const receipt = record(details?.["receipt"]);
    const report = record(details?.["report"]);
    return (
      details?.["status"] === "passed" &&
      receipt?.["protocol"] === "unit-verification-receipt.v1" &&
      receipt["operation"] === "test" &&
      receipt["runtime"] === runtime &&
      receipt["contextId"] === contextId &&
      typeof receipt["artifactKey"] === "string" &&
      typeof receipt["executionDigest"] === "string" &&
      typeof report?.["total"] === "number" &&
      report["total"] > 0 &&
      report["failed"] === 0
    );
  });
  return verified
    ? { passed: true, reason: undefined }
    : { passed: false, reason: `No prompt-free ${runtime} test receipt was observed` };
}

function buildPerformanceResult(values: readonly unknown[]): boolean {
  return walkRecords(values).some((record) => {
    const firstRun = record["firstRun"];
    const verifiedCacheRun = record["verifiedCacheRun"];
    const targets = record["targets"];
    return (
      record["version"] === 1 &&
      typeof record["source"] === "string" &&
      firstRun !== null &&
      typeof firstRun === "object" &&
      typeof (firstRun as Record<string, unknown>)["elapsedMs"] === "number" &&
      typeof (firstRun as Record<string, unknown>)["cacheState"] === "string" &&
      verifiedCacheRun !== null &&
      typeof verifiedCacheRun === "object" &&
      typeof (verifiedCacheRun as Record<string, unknown>)["elapsedMs"] === "number" &&
      (verifiedCacheRun as Record<string, unknown>)["sameBuildKeys"] === true &&
      Array.isArray(targets) &&
      targets.length > 0 &&
      targets.every((target) => {
        if (target === null || typeof target !== "object") return false;
        const value = target as Record<string, unknown>;
        return (
          typeof value["buildKey"] === "string" &&
          typeof value["artifactBytes"] === "number" &&
          typeof value["executableModuleCount"] === "number" &&
          typeof value["executableSourceBytes"] === "number"
        );
      })
    );
  });
}

function validateBuildPerformanceProfile(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const profiles = base.evidence.calls.flatMap(nativeBuildProfiles);
  return buildPerformanceResult(profiles)
    ? { passed: true, reason: undefined }
    : { passed: false, reason: "Build profiling retained no native first-run, verified-cache, and size evidence" };
}

function nativeBuildProfiles(call: InvocationCardPayloadLike): Record<string, unknown>[] {
  const details = successfulToolDetails(call, "eval");
  const journal = record(details?.["operationJournal"]);
  if (journal?.["protocol"] !== "workspace-operations.v1" || journal["truncated"] !== false ||
      !Array.isArray(journal["entries"])) return [];
  return journal["entries"].flatMap((value) => {
    const entry = record(value);
    const profile = record(entry?.["receipt"]);
    return entry?.["type"] === "build.profile" && profile?.["version"] === 1 ? [profile] : [];
  });
}

interface BuildProfileEvidence {
  index: number;
  unit: string;
  contextId: string;
  stateHash: string;
  buildKeys: Map<string, string>;
  initialBytes: Map<string, number>;
}

function buildProfileEvidence(call: InvocationCardPayloadLike, index: number): BuildProfileEvidence[] {
  return nativeBuildProfiles(call).flatMap((profile) => {
    const evidence = profileEvidence(profile, index);
    return evidence ? [evidence] : [];
  });
}

function profileEvidence(profile: Record<string, unknown>, index: number): BuildProfileEvidence | null {
  const unit = unitForPath(profile["source"], "panels");
  const ref = profile["ref"];
  const contextId = typeof ref === "string" && ref.startsWith("ctx:") ? ref.slice(4) : null;
  const report = record(profile["report"]);
  const verifiedCacheRun = record(profile["verifiedCacheRun"]);
  if (
    !unit ||
    !contextId ||
    workspacePath(profile["source"]) !== unit ||
    workspacePath(report?.["repoPath"]) !== unit ||
    report?.["status"] !== "ok" ||
    report["kind"] !== "panel" ||
    !Array.isArray(report["diagnostics"]) ||
    report["diagnostics"].some((value) => record(value)?.["severity"] === "error") ||
    typeof report["stateHash"] !== "string" ||
    verifiedCacheRun?.["sameBuildKeys"] !== true
  ) {
    return null;
  }

  const initialBytes = new Map<string, number>();
  const buildKeys = new Map<string, string>();
  const reportedBuilds = report["builds"];
  if (!Array.isArray(reportedBuilds) || !Array.isArray(profile["targets"])) return null;
  for (const targetValue of profile["targets"] as unknown[]) {
    const target = record(targetValue);
    const bundleReport = record(target?.["bundleReport"]);
    const initial = record(bundleReport?.["initial"]);
    if (
      typeof target?.["target"] !== "string" ||
      typeof target["buildKey"] !== "string" ||
      typeof initial?.["bytes"] !== "number" ||
      initial["bytes"] < 0
    ) {
      return null;
    }
    if (buildKeys.has(target["target"]) || !reportedBuilds.some((value) => {
      const build = record(value);
      return build !== null && build["target"] === target["target"] && build["buildKey"] === target["buildKey"];
    })) return null;
    initialBytes.set(target["target"], initial["bytes"]);
    buildKeys.set(target["target"], target["buildKey"]);
  }
  return initialBytes.size > 0 && reportedBuilds.length === buildKeys.size
    ? { index, unit, contextId, stateHash: report["stateHash"], buildKeys, initialBytes }
    : null;
}

function profileImproved(before: BuildProfileEvidence, after: BuildProfileEvidence): boolean {
  if (before.unit !== after.unit || before.contextId !== after.contextId ||
      before.stateHash === after.stateHash || before.buildKeys.size !== after.buildKeys.size ||
      [...before.buildKeys.keys()].some((target) => !after.buildKeys.has(target))) return false;
  return [...before.initialBytes].some(
    ([target, bytes]) =>
      typeof after.initialBytes.get(target) === "number" && after.initialBytes.get(target)! < bytes
  );
}

function validatePanelPerformanceRepair(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["eval", "vcs"]);
  if (!base.passed) return base;
  const calls = base.evidence.calls;
  const profiles = calls.flatMap(buildProfileEvidence);
  const mutations = calls.flatMap((call, index) => {
    const evidence = managedMutation(call, index, "panels");
    return evidence ? [evidence] : [];
  });
  if (mutations.length === 0) {
    return { passed: false, reason: "No completed managed panel optimization was observed" };
  }
  const units = new Set(mutations.map(({ unit }) => unit));
  const contexts = new Set(mutations.map(({ contextId }) => contextId));
  const applicationIds = mutations.map(({ applicationId }) => applicationId);
  if (
    units.size !== 1 ||
    contexts.size !== 1 ||
    new Set(applicationIds).size !== applicationIds.length
  ) {
    return {
      passed: false,
      reason: "Panel optimization mutations did not form one context-local chain for one unit",
    };
  }
  const unit = [...units][0]!;
  const contextId = [...contexts][0]!;
  const firstMutationIndex = mutations[0]!.index;
  const lastMutationIndex = mutations.at(-1)!.index;

  for (const before of profiles) {
    if (
      before.index >= firstMutationIndex ||
      before.unit !== unit ||
      before.contextId !== contextId
    ) {
      continue;
    }
    for (const after of profiles) {
      if (after.index <= lastMutationIndex || !profileImproved(before, after)) continue;

      // profileBuild returns the exact native build/typecheck report itself.
      // Its validated state and target keys are the final verification proof.
      for (let commitIndex = after.index + 1; commitIndex < calls.length; commitIndex += 1) {
        const commitCall = calls[commitIndex]!;
        if (commitCall.name !== "vcs" || commitCall.arguments?.["operation"] !== "commit") {
          continue;
        }
        const commitDetails = successfulToolDetails(commitCall, "vcs");
        const commit = record(commitDetails?.["result"]);
        const event = record(commit?.["event"]);
        const eventId = event?.["kind"] === "event" ? event["eventId"] : null;
        const committedApplicationIds = commit?.["committedApplicationIds"];
        if (
          commit?.["contextId"] !== contextId ||
          typeof eventId !== "string" ||
          !stringArray(committedApplicationIds) ||
          committedApplicationIds.length !== applicationIds.length ||
          !committedApplicationIds.every((id, index) => id === applicationIds[index])
        ) {
          continue;
        }

        for (let statusIndex = commitIndex + 1; statusIndex < calls.length; statusIndex += 1) {
          const statusCall = calls[statusIndex]!;
          if (statusCall.name !== "vcs" || statusCall.arguments?.["operation"] !== "status") {
            continue;
          }
          const status = record(successfulToolDetails(statusCall, "vcs")?.["result"]);
          if (
            status?.["contextId"] === contextId &&
            status["clean"] === true &&
            eventRef(status["committed"], eventId) &&
            eventRef(status["workingHead"], eventId) &&
            zeroWorkingCounts(status["workingCounts"])
          ) {
            return { passed: true, reason: undefined };
          }
        }
      }
    }
  }
  return {
    passed: false,
    reason:
      "No causal optimization episode joined a same-context baseline, managed panel mutation, smaller initial payload profile, exact final build, complete application-chain commit, and matching clean event",
  };
}

function validateNpmImport(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const evalCall = base.evidence.calls.find(
    (call) =>
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true &&
      call.arguments?.["imports"] !== null &&
      typeof call.arguments?.["imports"] === "object" &&
      Object.values(call.arguments!["imports"] as Record<string, unknown>).some(
        (value) => typeof value === "string" && value.startsWith("npm:")
      )
  );
  if (!evalCall) {
    return { passed: false, reason: "No successful eval resolved an npm import-map entry" };
  }
  const returned = invocationReturnValue(evalCall);
  return returned.present && hasNonEmptyStructuredResult([returned.value])
    ? { passed: true, reason: undefined }
    : { passed: false, reason: "The npm import produced no observable result" };
}

function validateWorkspaceImport(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  const imported = base.evidence.calls.find((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError) {
      return false;
    }
    const code = String(call.arguments?.["code"] ?? "");
    const imports = call.arguments?.["imports"];
    const hasWorkspaceImportMapEntry =
      imports !== null &&
      typeof imports === "object" &&
      !Array.isArray(imports) &&
      Object.values(imports as Record<string, unknown>).some(
        (value) => typeof value === "string" && !value.startsWith("npm:")
      );
    const hasDirectWorkspaceImport =
      /\b(?:from\s*|import\s*(?:\(\s*)?)["']@workspace(?:-[a-z0-9-]+)?\//u.test(code);
    return hasWorkspaceImportMapEntry || hasDirectWorkspaceImport;
  });
  if (!imported || !/\bimport\b/u.test(String(imported.arguments?.["code"] ?? ""))) {
    return { passed: false, reason: "No successful eval imported a workspace-built package" };
  }
  const returned = invocationReturnValue(imported);
  return returned.present && hasNonEmptyStructuredResult([returned.value])
    ? { passed: true, reason: undefined }
    : { passed: false, reason: "The workspace import exposed no structured exports" };
}

export const buildTests: TestCase[] = [
  {
    name: "panel-performance-optimize",
    description: "Measure and remove a disposable panel's avoidable bundle-size waste",
    category: "performance",
    workspaceRepoFixture: OPTIMIZABLE_PANEL_WORKSPACE_REPO_FIXTURE,
    authorityPolicy: panelControlAuthorityPolicy("inspect-panel-performance-repair"),
    resources: [PANEL_AUTOMATION_RESOURCE],
    prompt:
      "The disposable panel is much larger than its tiny UI warrants. Please investigate and fix it without changing what it displays.",

    validate: validatePanelPerformanceRepair,
  },
  {
    name: "build-performance-profile",
    description:
      "Profile one exact workspace build and attribute its verified-cache and payload costs",
    category: "build",
    prompt:
      "Use the shipped performance guidance to profile a small existing workspace UI unit in this exact context. Compare the observed first build path with a verified-cache repeat, attribute artifact, executable-module, and bundle size where available, and report the exact measurements plus whether the build keys matched. Keep source and bundle contents out of the result.",
    validate: validateBuildPerformanceProfile,
  },
  {
    name: "build-workspace-package",
    description: "Build and type-check a workspace unit and verify success",
    category: "build",
    workspaceRepoFixture: BUILDABLE_PACKAGE_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Build and type-check the small disposable workspace package prepared for this task and tell me whether it succeeded, including any diagnostics you observed.",

    validate: validateWorkspaceBuild,
  },
  {
    name: "test-workspace-worker-workerd",
    description: "Run a worker suite in its complete workerd runtime without native approval",
    category: "build",
    workspaceRepoFixture: BUILDABLE_REGULAR_WORKER_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Add one small test for the disposable worker's exported baseline value, run its declared workerd suite in the complete worker runtime, and tell me the result. Do not publish.",

    validate: (result) => validateSandboxedWorkspaceTest(result, "workerd"),
  },
  {
    name: "test-workspace-panel-browser",
    description: "Run a panel suite in a visible complete panel runtime under Testbench",
    category: "build",
    workspaceRepoFixture: BUILDABLE_PANEL_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Add one small test proving that the declared browser suite has a real panel document and injected panel runtime, run that suite, and tell me the result. Do not publish.",

    validate: (result) => validateSandboxedWorkspaceTest(result, "browser"),
  },
  {
    name: "build-npm-package",
    description: "Build an npm package and get a bundle",
    category: "build",
    authorityPolicy: {
      authority: [
        {
          ruleId: "inspect-npm-dependency",
          capability: { kind: "exact", key: "workspace.dependencies.inspect" },
          resource: { kind: "exact", key: "workspace.dependencies.inspect" },
          tier: "gated",
          decision: "once",
        },
      ],
    },
    prompt:
      "Load a small pure-JavaScript dependency from npm in the sandbox and demonstrate that it works.",
    validate: validateNpmImport,
  },
  {
    name: "import-built-package",
    description: "Import a built package and inspect its exports",
    category: "build",
    prompt:
      "Import an existing workspace-built package in the sandbox and describe the exports you observed.",
    validate: validateWorkspaceImport,
  },
];
