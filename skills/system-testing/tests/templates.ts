import type { ManagedTemplateCandidateReceiver } from "../template-candidate-managed.js";
import { templateCandidateManagedWorlds } from "../template-candidate-worlds.js";
import type { TemplateReleaseReceiver } from "../template-release-managed.js";
import { templateReleasePart, templateReleaseWorlds } from "../template-release-worlds.js";
import type { TestCase, TestExecutionResult } from "../types.js";
import {
  completedScenarioEvidence,
  invocationConsoleOutput,
  walkRecords,
  type ScenarioEvidence,
} from "./_scenario-evidence.js";
import { findLastAgentMessage } from "./_helpers.js";

/**
 * The workspace part this scenario asks to be snapshotted.
 *
 * The prompt names it in prose and the validator checks the plan selected it,
 * so both have to mean the same package — and it has to be a package the
 * workspace still has. Deriving the prompt from this constant is what keeps a
 * deleted part from leaving a test that fails for a reason ("the plan did not
 * select it") that says nothing about the part being gone.
 */
export const AUTHORED_PART = templateReleasePart;
const AUTHORED_PART_PROSE = "template management library";

function invokedTemplateOperation(code: string, operation: string): boolean {
  if (new RegExp(`\\b(?:services\\.)?templates\\.${operation}\\s*\\(`, "u").test(code)) return true;
  if (!code.includes("@workspace-extensions/templates")) return false;
  const quoted = `(["'])${operation}\\1`;
  const convenienceCall = new RegExp(
    `(?:\\bextensions|\\([^)]*\\bextensions\\b[^)]*\\))\\.invoke\\s*\\([^,]+,\\s*${quoted}`,
    "u",
  ).test(code);
  const portableCall =
    /rpc\.call\s*\(\s*(["'])main\1\s*,\s*(?:(["'])extensions\.invoke\2|mainRpcMethods\[\s*(["'])extensions\.invoke\3\s*\])\s*,/u.test(
      code,
    ) && new RegExp(quoted, "u").test(code);
  const indirectCall =
    /extensions\.invoke\s*\([^,]+,\s*[A-Za-z_$][\w$]*/u.test(code) &&
    new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\(\\s*${quoted}`, "u").test(code);
  return convenienceCall || portableCall || indirectCall;
}

function consoleStructuredValues(calls: ScenarioEvidence["calls"]): unknown[] {
  const values: unknown[] = [];
  for (const call of calls) {
    const output = invocationConsoleOutput(call);
    if (!output) continue;
    for (const [open, close] of [
      ["{", "}"],
      ["[", "]"],
    ] as const) {
      const start = output.indexOf(open);
      const end = output.lastIndexOf(close);
      if (start < 0 || end <= start) continue;
      try {
        values.push(JSON.parse(output.slice(start, end + 1)));
      } catch {
        // Console evidence is optional; exact eval return values remain preferred.
      }
    }
  }
  return values;
}


function templateAuthoringPrepared(result: TestExecutionResult) {
  const base = completedScenarioEvidence(result);
  if (!base.passed) return base;
  if (
    !invokedTemplateOperation(base.evidence.evalCode, "authoringParts") ||
    !invokedTemplateOperation(base.evidence.evalCode, "inspectAuthoring")
  ) {
    return {
      passed: false,
      reason:
        "Completed eval did not discover parts and inspect an authoring plan",
    };
  }
  if (invokedTemplateOperation(base.evidence.evalCode, "publishAuthoring")) {
    return {
      passed: false,
      reason: "Preparation-only scenario unexpectedly published a template",
    };
  }
  const records = walkRecords([
    ...base.evidence.evalValues,
    ...consoleStructuredValues(base.evidence.calls),
  ]);
  const receipts = new Map<
    string,
    { mainEventId?: string; manifest?: string; requestedParts: Set<string> }
  >();
  for (const record of records) {
    const fingerprint = record["fingerprint"];
    if (
      typeof fingerprint !== "string" ||
      !/^v1-sha256:[0-9a-f]{64}$/u.test(fingerprint)
    ) {
      continue;
    }
    const receipt = receipts.get(fingerprint) ?? {
      requestedParts: new Set<string>(),
    };
    if (typeof record["mainEventId"] === "string") {
      receipt.mainEventId = record["mainEventId"];
    }
    if (typeof record["manifest"] === "string")
      receipt.manifest = record["manifest"];
    const requested = Array.isArray(record["requestedParts"])
      ? record["requestedParts"]
      : Array.isArray(record["requested"])
        ? record["requested"]
        : Array.isArray(record["selectedParts"])
          ? record["selectedParts"]
          : [];
    for (const repoPath of requested) {
      if (typeof repoPath === "string") receipt.requestedParts.add(repoPath);
    }
    receipts.set(fingerprint, receipt);
  }
  const exactReceipts = [...receipts].filter(
    ([, receipt]) =>
      receipt.manifest !== undefined && receipt.requestedParts.size > 0,
  );
  if (!exactReceipts.length) {
    return {
      passed: false,
      reason: "Authoring inspection did not return an exact non-empty plan",
    };
  }
  const selectedReceipts = exactReceipts.filter(([, receipt]) =>
    receipt.requestedParts.has(AUTHORED_PART),
  );
  if (!selectedReceipts.length) {
    return {
      passed: false,
      reason: `Authoring plan did not select the requested ${AUTHORED_PART}`,
    };
  }
  const final = findLastAgentMessage(result);
  const reportedExactPlan = selectedReceipts.some(([fingerprint]) =>
    final.includes(fingerprint),
  );
  return reportedExactPlan
    ? { passed: true, reason: undefined }
    : {
        passed: false,
        reason: "Final response did not identify the observed exact plan",
      };
}

export const templateTests: TestCase[] = [
  {
    name: "templates-authoring-prepare",
    description: `Prepare a self-contained upstream snapshot from the local ${AUTHORED_PART_PROSE}`,
    category: "templates",

    // Stated as the user's goal, deliberately without the repository path: a
    // path in the prompt reframes this as a file hunt, and the scenario is
    // whether the workspace's own authoring capability gets discovered and
    // used. AUTHORED_PART stays the validator's expectation.
    prompt:
      `Prepare a reusable workspace snapshot containing this workspace's ${AUTHORED_PART_PROSE}. ` +
      "Show me what source and required dependencies it would include, with an exact plan " +
      "I can review. Do not publish anything.",
    validate: templateAuthoringPrepared,
  },
];


type TemplateRelease = Awaited<ReturnType<TemplateReleaseReceiver["runTemplateReleaseTeacher"]>>;
type Qualification = Awaited<ReturnType<TemplateReleaseReceiver["qualifyTemplateRelease"]>>;
const templateReleaseSettings = {
  category: "templates",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["extensions/templates", AUTHORED_PART],
};

templateTests.push(...templateReleaseWorlds.map((world): TestCase => ({
  ...templateReleaseSettings,
  name: `template-release-live-${world.id}`,
  description: "Review VibeStudio's native template authoring receipt",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runTemplateRelease(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a template review capture");
    const { teacher, ...fixture } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId: fixture.contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, templateRelease: fixture },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as TemplateRelease["teacher"] | undefined;
    const fixture = result.diagnostics?.["templateRelease"] as Omit<TemplateRelease, "teacher"> | undefined;
    return { passed: teacher?.trainingEligible === true && fixture?.verification.passed === true, details: fixture?.verification.checks };
  },
})));
templateTests.push(...templateReleaseWorlds.map((world): TestCase => ({
  ...templateReleaseSettings,
  name: `template-release-oracle-qualification-${world.id}`,
  description: "Verify one exact protected-main template receipt without model calls",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runTemplateRelease(world.id, true, signal);
    if (result.kind !== "reference") throw new Error("Template qualification invoked a model");
    return { messages: [], duration: Date.now() - start, diagnostics: { templateRelease: result.value } };
  },
  validate(result) {
    const outcome = result.diagnostics?.["templateRelease"] as Qualification | undefined;
    return {
      passed: outcome?.caseId === world.id && outcome.passed === true,
      details: outcome?.checks,
    };
  },
})));

type TemplateCandidate = Awaited<ReturnType<ManagedTemplateCandidateReceiver["runTemplateCandidateTeacher"]>>;
type CandidateQualification = Awaited<ReturnType<ManagedTemplateCandidateReceiver["qualifyTemplateCandidate"]>>;
const templateCandidateSettings = {
  category: "templates",
  explicitOnly: true,
  validation: "harness" as const,
  requiresUnits: ["extensions/templates", "skills/template-candidate"],
};

const templatePreparationAuthority = {
  authority: [{
    ruleId: "assigned-template-candidate-preparation",
    capability: { kind: "prefix" as const, prefix: "userland:extensions/templates/workspace.templates.update#" },
    resource: { kind: "exact" as const, key: "workspace.templates:extension:@workspace-extensions/templates" },
    tier: "gated" as const,
    decision: "once" as const,
  }],
};

templateTests.push(...templateCandidateManagedWorlds.map((world): TestCase => ({
  ...templateCandidateSettings,
  ...(world.status === "validate-candidate" ? { authorityPolicy: templatePreparationAuthority } : {}),
  name: `template-candidate-live-${world.id}`,
  description: "Review VibeStudio's live template update offer",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runTemplateCandidate(world.id, false, signal);
    if (result.kind !== "teacher") throw new Error("Expected a template review capture");
    const { teacher, ...fixture } = result.value;
    return {
      messages: [], duration: Date.now() - start,
      provenance: { contextId: fixture.contextId, channelId: null, branchId: null, agentEntityId: null, agentTargetId: null },
      diagnostics: { natlangTeacher: teacher, templateCandidateManaged: fixture },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as TemplateCandidate["teacher"] | undefined;
    const fixture = result.diagnostics?.["templateCandidateManaged"] as Omit<TemplateCandidate, "teacher"> | undefined;
    return { passed: teacher?.trainingEligible === true && fixture?.verification.passed === true, details: fixture?.verification.checks };
  },
})));
templateTests.push(...templateCandidateManagedWorlds.map((world): TestCase => ({
  ...templateCandidateSettings,
  ...(world.status === "validate-candidate" ? { authorityPolicy: templatePreparationAuthority } : {}),
  name: `template-candidate-oracle-qualification-${world.id}`,
  description: "Verify the authorized native template workflow without model calls",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const start = Date.now();
    const result = await runner.runTemplateCandidate(world.id, true, signal);
    if (result.kind !== "reference") throw new Error("Template qualification invoked a model");
    return { messages: [], duration: Date.now() - start, diagnostics: { templateCandidateManaged: result.value } };
  },
  validate(result) {
    const outcome = result.diagnostics?.["templateCandidateManaged"] as CandidateQualification | undefined;
    return {
      passed: outcome?.caseId === world.id && outcome.passed === true,
      details: outcome?.checks,
    };
  },
})));
