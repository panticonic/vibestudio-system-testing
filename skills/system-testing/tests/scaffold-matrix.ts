import {
  PANEL_AUTOMATION_RESOURCE,
  panelControlAuthorityPolicy,
} from "../panel-authority.js";
import {
  CREATED_PACKAGE_WORKSPACE_REPO_FIXTURE,
  CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
  CREATED_PROJECT_WORKSPACE_REPO_FIXTURE,
  CREATED_SKILL_WORKSPACE_REPO_FIXTURE,
  CREATED_WORKER_WORKSPACE_REPO_FIXTURE,
  type TestCase,
  type TestExecutionResult,
  type WorkspaceRepoCreationScope,
} from "../types.js";
import { preparedProject, publishedPreparation } from "./_project-evidence.js";
import { getToolCalls } from "./_helpers.js";
import {
  completedScenarioEvidence,
  walkRecords,
} from "./_scenario-evidence.js";

type ExecutableScaffold = {
  name: string;
  description: string;
  prompt: string;
  projectType: "panel" | "worker" | "package" | "skill";
  section: "panels" | "workers" | "packages" | "skills";
  fixture: WorkspaceRepoCreationScope;
  template?: "agentic";
  requiresUnits?: TestCase["requiresUnits"];
  authorityPolicy?: TestCase["authorityPolicy"];
};

const AGENTIC_WORKER_TEST_AUTHORITY_POLICY: TestCase["authorityPolicy"] = {
  authority: [
    {
      ruleId: "agentic-worker-native-suite-verification",
      capability: {
        kind: "prefix",
        prefix: "userland:extensions/test-runner/native.code.execute-tests#",
      },
      resource: {
        kind: "exact",
        key: "native.code.tests:extension:@workspace-extensions/test-runner",
      },
      tier: "gated",
      decision: "once",
    },
  ],
};

const EXECUTABLE_SCAFFOLDS: ExecutableScaffold[] = [
  {
    name: "scaffold-react-panel-build",
    description: "Build the default React panel scaffold",
    prompt:
      "Create and publish a new panel from the standard React starter, and confirm that it builds successfully.",
    projectType: "panel",
    section: "panels",
    fixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
  },
  {
    name: "scaffold-svelte-panel-build",
    description: "Build the Svelte panel scaffold",
    prompt:
      "Create and publish a new Svelte panel, and confirm that it builds successfully.",
    projectType: "panel",
    section: "panels",
    fixture: CREATED_PANEL_WORKSPACE_REPO_FIXTURE,
    requiresUnits: ["packages/svelte", "templates/svelte"],
  },
  {
    name: "scaffold-stateless-worker-build",
    description: "Build the stateless worker scaffold",
    prompt:
      "Create and publish a new stateless worker, and confirm that it builds successfully.",
    projectType: "worker",
    section: "workers",
    fixture: CREATED_WORKER_WORKSPACE_REPO_FIXTURE,
  },
  {
    name: "scaffold-agentic-worker-build",
    description: "Build the durable agent worker scaffold",
    prompt:
      "Create and publish a new durable agent worker, and confirm that it builds successfully.",
    projectType: "worker",
    section: "workers",
    fixture: CREATED_WORKER_WORKSPACE_REPO_FIXTURE,
    template: "agentic",
    authorityPolicy: AGENTIC_WORKER_TEST_AUTHORITY_POLICY,
  },
  {
    name: "scaffold-package-build",
    description: "Build the package scaffold",
    prompt:
      "Create and publish a new workspace package, and confirm that it builds successfully.",
    projectType: "package",
    section: "packages",
    fixture: CREATED_PACKAGE_WORKSPACE_REPO_FIXTURE,
  },
  {
    name: "scaffold-skill-build",
    description: "Build the skill scaffold",
    prompt:
      "Create and publish a new workspace skill, and confirm that it builds successfully.",
    projectType: "skill",
    section: "skills",
    fixture: CREATED_SKILL_WORKSPACE_REPO_FIXTURE,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function details(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value["details"]) ? value["details"] : value;
}

function createdScaffold(
  record: Record<string, unknown>,
  projectType: ExecutableScaffold["projectType"] | "project",
  section: ExecutableScaffold["section"] | "projects",
): boolean {
  return (
    preparedProject(record, projectType) &&
    String(record["created"]).startsWith(`${section}/`)
  );
}

function hasAgenticWorkerEvidence(record: Record<string, unknown>): boolean {
  const preflight = record["preflight"];
  const files = record["files"];
  const created = record["created"];
  if (
    !isRecord(preflight) ||
    !Array.isArray(preflight["importedPackages"]) ||
    !Array.isArray(files) ||
    typeof created !== "string"
  ) {
    return false;
  }
  const importedPackages = new Set(
    preflight["importedPackages"].filter(
      (value): value is string => typeof value === "string",
    ),
  );
  const generatedFiles = new Set(
    files.filter((value): value is string => typeof value === "string"),
  );
  const workerName = created.split("/").at(-1);
  return Boolean(
    workerName &&
      ["@workspace/agentic-do", "@workspace/harness", "vitest"].every((name) =>
        importedPackages.has(name),
      ) &&
      generatedFiles.has(`${workerName}-worker.ts`) &&
      generatedFiles.has(`${workerName}-worker.test.ts`),
  );
}

function successfulBuildReceipt(
  record: Record<string, unknown>,
  target: string,
): boolean {
  const receipt = record["receipt"];
  if (
    !isRecord(receipt) ||
    receipt["protocol"] !== "unit-verification-receipt.v1" ||
    receipt["operation"] !== "build" ||
    typeof receipt["stateHash"] !== "string"
  ) {
    return false;
  }
  const unit = receipt["unit"];
  const builds = receipt["builds"];
  return (
    receipt["target"] === target &&
    receipt["status"] === "ok" &&
    typeof receipt["contextId"] === "string" &&
    receipt["ref"] === `ctx:${receipt["contextId"]}` &&
    typeof receipt["reportDigest"] === "string" &&
    receipt["reportDigest"].length === 64 &&
    isRecord(unit) &&
    unit["repoPath"] === target &&
    Array.isArray(builds) &&
    builds.length > 0 &&
    builds.every(
      (build) =>
        isRecord(build) &&
        typeof build["target"] === "string" &&
        typeof build["buildKey"] === "string",
    )
  );
}

function validateExecutableScaffold(
  result: TestExecutionResult,
  variant: ExecutableScaffold,
) {
  const base = completedScenarioEvidence(result, ["eval", "verify"]);
  if (!base.passed) return base;
  const calls = getToolCalls(result);
  const createIndex = calls.findIndex(
    (call) =>
      call.name === "eval" &&
      call.execution?.status === "complete" &&
      call.execution.isError !== true &&
      walkRecords([details(call.execution.result)]).some(
        (record) =>
          createdScaffold(record, variant.projectType, variant.section) &&
          (variant.template !== "agentic" ||
            hasAgenticWorkerEvidence(record)) &&
          publishedPreparation(result, record),
      ),
  );
  if (createIndex < 0) {
    return {
      passed: false,
      reason:
        variant.template === "agentic"
          ? "No published agentic worker scaffold with its canonical dependencies and native suite was returned"
          : `No published ${variant.projectType} scaffold was returned`,
    };
  }
  const target = walkRecords([details(calls[createIndex]!.execution?.result)])
    .map((record) => record["created"])
    .find(
      (value): value is string =>
        typeof value === "string" && value.startsWith(`${variant.section}/`),
    );
  if (!target)
    return {
      passed: false,
      reason: "The scaffold result had no exact repository path",
    };
  const buildIndex = calls.findIndex((call, index) => {
    if (
      index <= createIndex ||
      call.name !== "verify" ||
      call.execution?.isError === true
    ) {
      return false;
    }
    const value = details(call.execution?.result);
    return Boolean(value && successfulBuildReceipt(value, target));
  });
  return buildIndex >= 0
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason:
          "The published scaffold was not followed by a clean exact build receipt",
      };
}

function validateContentScaffold(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result, ["eval"]);
  if (!base.passed) return base;
  return walkRecords(base.evidence.evalValues).some(
    (record) =>
      createdScaffold(record, "project", "projects") &&
      publishedPreparation(result, record),
  )
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: "No published content-only project scaffold was returned",
      };
}

export const scaffoldMatrixTests: TestCase[] = [
  ...EXECUTABLE_SCAFFOLDS.map(
    (variant): TestCase => ({
      name: variant.name,
      description: variant.description,
      category: "scaffold-matrix",

      workspaceRepoFixture: variant.fixture,
      requiresUnits: variant.requiresUnits,
      ...(variant.section === "panels"
        ? {
            authorityPolicy: panelControlAuthorityPolicy(
              `inspect-${variant.name}`,
            ),
            resources: [PANEL_AUTOMATION_RESOURCE],
          }
        : {}),
      ...(variant.authorityPolicy
        ? { authorityPolicy: variant.authorityPolicy }
        : {}),
      prompt: variant.prompt,
      validate: (result) => validateExecutableScaffold(result, variant),
    }),
  ),
  {
    name: "scaffold-content-project-preflight",
    description: "Publish a local content-only project repository",
    category: "scaffold-matrix",

    workspaceRepoFixture: CREATED_PROJECT_WORKSPACE_REPO_FIXTURE,
    prompt:
      "Create and publish a new content-only project in this workspace, and confirm that it is ready to use.",
    validate: validateContentScaffold,
  },
];
