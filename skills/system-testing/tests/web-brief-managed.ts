import { openVaultKnowledgeWorlds } from "../open-goal-vault-knowledge-worlds.js";
import { openGoalGoogleSetupWorlds, googleSetupRequiresUnits } from "../open-goal-google-setup-worlds.js";
import { openGoalPanelRecoveryWorlds } from "../open-goal-panel-recovery-worlds.js";
import { openGoalOwnedPreviewWorlds } from "../open-goal-owned-preview-worlds.js";
import type { TestCase } from "../types.js";
import type { ManagedWebBriefReceiver } from "../web-brief-managed.js";
import type { ManagedResearchHandoffReceiver } from "../research-handoff-managed.js";
import type { OpenGoalReceiver } from "../open-goal-managed.js";
import type { AgentExecutionTestPolicySpec } from "@vibestudio/shared/authority/testPolicy";
import {
  browserGoalWorlds, newsGoalRequiresUnits, newsGoalWorlds, openGoalCalendarWorlds, openGoalGmailWorlds,
  evalHandoffRequiresUnits, openGoalEvalHandoffWorlds, programRunRequiresUnits, openGoalProgramRunWorlds, authoringRequiresUnits, openGoalAuthoringWorlds, openGoalGoogleHandoffWorlds, openGoalGoogleWorlds, openGoalPdfWorlds, openGoalPdfVaultWorlds, openGoalPersonalWorlds, openGoalRecoveryWorlds,
  operatorGoalWorlds, operatorGoalRequiresUnits, openGoalWorlds, publicationGoalWorlds,
  openLocalDeliveryWorlds, localDeliveryRequiresUnits,
  openUnitRolloutWorlds, unitRolloutRequiresUnits,
  openDiagnosticWorlds, openDiagnosticRequiresUnits, openDiagnosticAuthority,
  openTerminalRequiresUnits, openTerminalWorlds,
  openReconciliationWorlds, reconciliationRequiresUnits,
  openPersonalArtifactWorlds, openPersonalAutomationWorlds, openPersonalHistoryWorlds, personalArtifactRequiresUnits,
  personalAutomationAuthority, personalAutomationRequiresUnits, personalHistoryRequiresUnits,
  openBrowserMigrationWorlds, browserMigrationRequiresUnits,
  publicSourceOrigins, spectroliteGoalWorlds, suiteGoalWorlds, type PublicResearchWorld,
} from "../open-goal-worlds.js";
import { PANEL_AUTOMATION_RESOURCE, PANEL_RUNTIME_STATE_AUTHORITY, PANEL_RUNTIME_SUPERVISION_AUTHORITY, panelControlAuthorityPolicy } from "../panel-authority.js";
import { nativeSuiteAuthority } from "./native-suite-managed.js";
import { newsAuthority } from "./news-managed.js";
import { missionPlanningSettings } from "./mission-planning-managed.js";
import { browserLibrarySettings } from "./browser-library-managed.js";
import {
  managedResearchIntakeWorlds,
  managedResearchHandoffWorlds,
  managedWebBriefWorlds,
} from "../web-brief-worlds.js";

type Teacher = Awaited<
  ReturnType<ManagedWebBriefReceiver["runManagedWebBriefTeacher"]>
>;
type Qualification = Awaited<
  ReturnType<ManagedWebBriefReceiver["qualifyManagedWebBrief"]>
>;
const settings = {
  category: "project-lifecycle",
  explicitOnly: true,
  validation: "harness" as const,
  timeoutMs: 6 * 60_000,
  requiresUnits: ["skills/web-research"],
};
const intakeSettings = {
  ...settings,
  requiresUnits: ["skills/web-research", "skills/research-intake"],
};

export const managedWebBriefTests: TestCase[] = managedWebBriefWorlds.map(
  (world) => ({
    ...settings,
    name: `web-brief-live-${world.id}`,
    description: "Write an exact brief from assigned public webpages",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedWebBrief(world.id, false, signal);
      if (run.kind !== "teacher")
        throw new Error("Expected a Natlang web brief");
      const { contextId, teacher, verification } = run.result;
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId,
          channelId: null,
          branchId: null,
          agentEntityId: null,
          agentTargetId: null,
        },
        diagnostics: {
          natlangTeacher: teacher,
          managedWebBrief: verification,
        },
      };
    },
    validate(result) {
      const teacher = result.diagnostics?.["natlangTeacher"] as
        | Teacher["teacher"]
        | undefined;
      const verification = result.diagnostics?.["managedWebBrief"] as
        | Teacher["verification"]
        | undefined;
      return {
        passed: Boolean(teacher?.trainingEligible && verification?.passed),
        details: verification?.checks,
      };
    },
  }),
);

type OpenGoalResult = Awaited<ReturnType<OpenGoalReceiver["runOpenGoalTeacher"]>>;
const referenceGoals = [...openGoalWorlds, ...openTerminalWorlds, ...openReconciliationWorlds, ...openGoalEvalHandoffWorlds, ...openGoalProgramRunWorlds, ...openGoalAuthoringWorlds,
  ...browserGoalWorlds, ...suiteGoalWorlds, ...newsGoalWorlds, ...spectroliteGoalWorlds, ...openVaultKnowledgeWorlds, ...openGoalGoogleWorlds,
  ...openGoalPersonalWorlds, ...operatorGoalWorlds, ...openDiagnosticWorlds, ...openGoalRecoveryWorlds, ...openLocalDeliveryWorlds, ...openUnitRolloutWorlds, ...publicationGoalWorlds,
  ...openGoalPdfWorlds, ...openGoalGmailWorlds, ...openGoalPdfVaultWorlds, ...openGoalCalendarWorlds,
  ...openPersonalArtifactWorlds, ...openPersonalHistoryWorlds, ...openGoalGoogleHandoffWorlds, ...openPersonalAutomationWorlds, ...openGoalOwnedPreviewWorlds, ...openGoalPanelRecoveryWorlds, ...openBrowserMigrationWorlds, ...openGoalGoogleSetupWorlds];
const openGoalCases = referenceGoals.map(world => ({ world, qualification: false }));
openGoalCases.push(...referenceGoals.map(world => ({ world, qualification: true })));
const publicResearchAuthority = (world: PublicResearchWorld): Pick<AgentExecutionTestPolicySpec, "authority"> => ({
  authority: [
    "https://lite.duckduckgo.com", "https://html.duckduckgo.com",
    "https://api.tavily.com", "https://api.search.brave.com", "https://api.exa.ai",
    ...publicSourceOrigins(world),
  ].map((origin, index) => ({
    ruleId: `open-goal-public-origin-${index + 1}`,
    capability: { kind: "exact", key: "network.response.read" },
    resource: { kind: "exact", key: origin },
    tier: "gated",
    decision: "once",
  })),
});
const templateSettings = {
  "terminal-handoff": { requiresUnits: openTerminalRequiresUnits },
  "local-reconciliation": { requiresUnits: reconciliationRequiresUnits },
  "eval-handoff": { requiresUnits: evalHandoffRequiresUnits },
  "program-run": { requiresUnits: programRunRequiresUnits },
  authoring: { requiresUnits: authoringRequiresUnits },
  personal: { ...missionPlanningSettings, requiresUnits: [...missionPlanningSettings.requiresUnits, "skills/open-user-goal", "skills/open-personal-goal"] },
  "personal-artifacts": {
    requiresUnits: personalArtifactRequiresUnits,
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-personal-artifacts", browserLibrarySettings.authorityPolicy.authority),
    resources: [PANEL_AUTOMATION_RESOURCE],
  },
  "personal-history": { requiresUnits: personalHistoryRequiresUnits },
  browserMigration: { requiresUnits: browserMigrationRequiresUnits },
  "personal-automation": {
    requiresUnits: personalAutomationRequiresUnits,
    authorityPolicy: { authority: personalAutomationAuthority },
  },
  operator: { requiresUnits: operatorGoalRequiresUnits },
  "system-diagnostics": { requiresUnits: openDiagnosticRequiresUnits, authorityPolicy: openDiagnosticAuthority },
  "local-delivery": { requiresUnits: localDeliveryRequiresUnits },
  "unit-rollout": { requiresUnits: unitRolloutRequiresUnits, resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-unit-rollout", [PANEL_RUNTIME_SUPERVISION_AUTHORITY]) },
  recovery: { requiresUnits: ["skills/open-user-goal", "skills/open-session-recovery", "skills/session-cursor-bindings", "workers/pubsub-channel"] },
  news: { requiresUnits: newsGoalRequiresUnits, authorityPolicy: newsAuthority, resources: [PANEL_AUTOMATION_RESOURCE] },
  spectrolite: {
    requiresUnits: ["skills/open-user-goal", "skills/spectrolite-review", "skills/spectrolite-review-fixtures", "panels/spectrolite"],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-goal-spectrolite"),
    resources: [PANEL_AUTOMATION_RESOURCE],
  },
  vaultWork: {
    requiresUnits: ["skills/open-user-goal", "skills/spectrolite-review", "skills/spectrolite-review-fixtures", "panels/spectrolite"],
    authorityPolicy: panelControlAuthorityPolicy("inspect-vault-knowledge"),
    resources: [PANEL_AUTOMATION_RESOURCE],
  },
  google: { requiresUnits: ["skills/open-user-goal", "skills/google-drive", "packages/google-workspace"] },
  calendar: { requiresUnits: ["skills/open-user-goal", "skills/open-calendar-goal", "packages/google-workspace"] },
  "google-handoff": { requiresUnits: ["skills/open-user-goal", "skills/open-google-handoff-goal", "packages/google-workspace", "packages/gmail"] },
  gmail: { requiresUnits: ["skills/open-user-goal", "skills/open-gmail-goal", "skills/gmail-compose-history-bindings", "packages/gmail", "workers/pubsub-channel"] },
  pdfVault: {
    requiresUnits: ["skills/open-user-goal", "skills/pdf-intake", "skills/pdf-intake-bindings", "extensions/pdf-ingest",
      "skills/spectrolite-review", "skills/spectrolite-review-fixtures", "panels/spectrolite"],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-goal-pdf-vault"),
    resources: [PANEL_AUTOMATION_RESOURCE],
  },
  pdf: { requiresUnits: ["skills/open-user-goal", "skills/pdf-intake", "skills/pdf-intake-bindings", "extensions/pdf-ingest"] },
};
managedWebBriefTests.push(...openGoalCases.map(({ world, qualification }): TestCase => ({
  ...settings,
  requiresUnits: world.kind === "suite" ? [...new Set(["skills/open-user-goal", "skills/native-suite-review", "extensions/test-runner", ...world.routes.map(route => route.target)])] :
    world.kind === "browser" ? ["skills/open-user-goal"] : ["skills/web-research"],
  ...(world.kind === "research" || world.kind === "research-and-edit"
    ? { authorityPolicy: publicResearchAuthority(world) } : {}),
  ...(world.kind === "suite" && world.execution ? world.execution.runtime === "native"
    ? { authorityPolicy: nativeSuiteAuthority }
    : { authorityPolicy: { authority: [PANEL_RUNTIME_STATE_AUTHORITY] }, resources: [PANEL_AUTOMATION_RESOURCE] }
    : {}),
  ...(world.kind === "browser" ? {
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-goal-panel"),
    workspaceRepoFixture: { kind: "open-goal-browser-panel", section: "panels", caseId: world.id },
  } : {}),
  ...(world.kind === "browserMigration" && world.collection ? {
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: { authority: [PANEL_RUNTIME_STATE_AUTHORITY] },
  } : {}),
  ...(world.kind === "googleSetup" ? {
    requiresUnits: googleSetupRequiresUnits,
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-google-setup", [
      PANEL_RUNTIME_SUPERVISION_AUTHORITY,
      {
        ruleId: "reload-owned-google-setup",
        capability: { kind: "exact", key: "runtime.supervision.manage" },
        resource: { kind: "prefix", prefix: "restart:panel:panel:" },
        tier: "gated", decision: "once",
      },
    ]),
    workspaceRepoFixture: { kind: "open-goal-google-setup", section: "panels", caseId: world.id },
  } : {}),
  ...(world.kind === "visualRecovery" ? {
    requiresUnits: ["skills/open-user-goal", "skills/panel-health", "skills/panel-health-runtime"],
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-visual-recovery", [PANEL_RUNTIME_SUPERVISION_AUTHORITY]),
    workspaceRepoFixture: { kind: "open-goal-panel-recovery", section: "panels", caseId: world.id },
  } : {}),
  ...(world.kind === "ownedPreview" ? {
    requiresUnits: ["skills/open-user-goal", "skills/publish-preflight", "skills/publish-preflight-bindings", "packages/integrations"],
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-goal-owned-preview", [{
      ruleId: "approve-the-disposable-preview-operation",
      capability: { kind: "exact", key: "website.publish" },
      resource: { kind: "prefix", prefix: "managed-preview-" }, tier: "critical", decision: "once",
    }]),
    workspaceRepoFixture: { kind: "open-goal-owned-preview-panel", section: "panels", caseId: world.id },
  } : {}),
  ...(world.kind === "publication" ? {
    requiresUnits: ["skills/open-user-goal", "skills/publish-preflight", "skills/publish-preflight-bindings", "skills/publication-revision-bindings"],
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-goal-publication", world.targets.some(target => target.journal) ? [{
      ruleId: "seed-disposable-publication-journal",
      capability: { kind: "exact", key: "website.publish" },
      resource: { kind: "prefix", prefix: "managed-publication-" },
      tier: "critical", decision: "once",
    }] : []),
    workspaceRepoFixture: { kind: "open-goal-publication-panel", section: "panels", caseId: world.id },
  } : {}),
  ...(world.kind in templateSettings
    ? templateSettings[world.kind as keyof typeof templateSettings] : {}),
  ...(world.kind === "terminal-handoff" ? { authorityPolicy: { authority: [
    { ruleId: "launch-assigned-release-checklist", capability: { kind: "exact" as const, key: "terminal-apps.run" },
      resource: { kind: "exact" as const, key: "terminal-app:terminal-apps/release-checklist" }, tier: "gated" as const, decision: "task" as const },
    ...(world.checks ? [{ ruleId: "verify-assigned-local-checks", capability: { kind: "prefix" as const, prefix: "userland:extensions/shell/native.shell.execute#" },
      resource: { kind: "exact" as const, key: "native.shell:extension:@workspace-extensions/shell" }, tier: "gated" as const, decision: "task" as const }] : []),
  ] } } : {}),
  name: `open-goal-${qualification ? "oracle-" : ""}${world.id}`,
  description: world.kind === "research" ? "Answer a user question by discovering public evidence" :
    world.kind === "browser" ? "Determine and verify a live browser panel outcome" :
    world.kind === "suite" ? "Select and verify a live declared workspace suite" :
    world.kind === "news" ? "Resolve a user goal against the current News reader and mission owners" :
    world.kind === "vaultWork" ? "Resolve long-form knowledge work against the current native vault" :
    world.kind === "spectrolite" ? "Navigate or edit the live Spectrolite vault and verify the outcome" :
    world.kind === "googleSetup" ? "Assess the exact Google onboarding gate and current owner route" :
    world.kind === "google" ? "Resolve a read-only Drive goal from observed provider pages" :
    world.kind === "gmail" ? "Recover Gmail compose and delivery state from retained records and current provider readback" :
    world.kind === "calendar" ? "Reconcile live calendar windows, confirm a current decision, and verify its handoff" :
    world.kind === "google-handoff" ? "Reconcile retained Gmail decisions with the current linked Drive assets" :
    world.kind === "personal-artifacts" ? "Resolve current browser library and collection state within an owned workspace" :
    world.kind === "browserMigration" ? "Review live browser import authority, owner receipts, and collection handoff" :
    world.kind === "personal-history" ? "Verify decisions across immutable archive milestones" :
    world.kind === "personal-automation" ? "Coordinate live monitor scheduling with independent state readback" :
    world.kind === "personal" ? "Plan and verify work against the current Mission Control board" :
    world.kind === "eval-handoff" ? "Recover original EvalDO receipts and authorized workspace handoffs" :
    world.kind === "terminal-handoff" ? "Work from live release checklist state and independently verified terminal receipts" :
    world.kind === "program-run" ? "Run authorized current programs with independent native output and signed receipts" :
    world.kind === "authoring" ? "Discover current program sources and verify an exact compiler review handoff" :
    world.kind === "local-reconciliation" ? "Reconcile exact local and incoming workspace revisions and verify the retained handoff" :
    world.kind === "system-diagnostics" ? "Check exact live log windows and independently verify the incident outcome" :
    world.kind === "operator" ? "Resolve readiness and authorized operations on the owned hub" :
    world.kind === "unit-rollout" ? "Diagnose and verify an owned workspace unit with controlled local source rollout" :
    world.kind === "local-delivery" ? "Resolve current local recipients and check retained delivery, recovery, and exact acknowledgment" :
    world.kind === "recovery" ? "Recover current work from retained session evidence" :
    world.kind === "visualRecovery" ? "Diagnose and restore the selected live owned surface and verify the exact rendered result" :
    world.kind === "ownedPreview" ? "Publish to the authorized disposable preview and verify its exact hosted artifact" :
    world.kind === "publication" ? "Check the requested website destination against real package and publication evidence" :
    world.kind === "pdfVault" ? "Ground a working vault correction in the original PDF and verify its revision" :
    world.kind === "pdf" ? "Inspect the selected PDF using original text, geometry and retained raster evidence" :
      "Find and revise a workspace document while preserving a concurrent edit",
  prompt: world.goal,
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const { teacher, verification } = await runner.runOpenGoal(world, signal, qualification);
    return {
      messages: [],
      duration: Date.now() - started,
      provenance: {
        contextId: verification.contextId,
        channelId: null, branchId: null, agentEntityId: null, agentTargetId: null,
      },
      diagnostics: { natlangTeacher: teacher, openGoalVerification: verification },
    };
  },
  validate(result) {
    const teacher = result.diagnostics?.["natlangTeacher"] as (OpenGoalResult["teacher"] & { trainingEligible?: boolean }) | null | undefined;
    const proof = result.diagnostics?.["openGoalVerification"] as OpenGoalResult["verification"] | undefined;
    return { passed: (qualification ? teacher === null : teacher?.trainingEligible === true) &&
      proof?.passed === true && proof.goal === world.goal, details: proof?.checks };
  },
})));

managedWebBriefTests.push({
  ...settings,
  name: "web-brief-oracle-qualification",
  description:
    "Qualify live public fetch and cached evidence without model calls",
  prompt: "Check the assigned public URLs and exact cached evidence.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: Qualification[] = [];
    for (const { id } of managedWebBriefWorlds) {
      const run = await runner.runManagedWebBrief(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Web brief qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { webBriefQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["webBriefQualification"] as
      | Qualification[]
      | undefined;
    return {
      passed:
        checks?.length === managedWebBriefWorlds.length &&
        checks.every(
          ({ verification, rejectedUnassignedUrl, rejectedForeignDigest }) =>
            verification.passed &&
            rejectedUnassignedUrl &&
            rejectedForeignDigest,
        ),
      details: { checks },
    };
  },
});

type HandoffTeacher = Awaited<ReturnType<ManagedResearchHandoffReceiver["runManagedResearchHandoffTeacher"]>>;
type HandoffQualification = Awaited<ReturnType<ManagedResearchHandoffReceiver["qualifyManagedResearchHandoff"]>>;
managedWebBriefTests.push(...managedResearchHandoffWorlds.flatMap((world) =>
  [false, true].map((qualification): TestCase => ({
    ...intakeSettings,
    requiresUnits: [...intakeSettings.requiresUnits, "skills/scratch-handoff"],
    name: `research-handoff-${qualification ? "oracle" : "live"}-${world.id}`,
    description: "Transfer verified public research into an independently checked scratch handoff",
    prompt: world.goal,
    async orchestrate({ runner, signal }) {
      const started = Date.now();
      const run = await runner.runManagedResearchHandoff(world.id, qualification, signal);
      const diagnostics = run.kind === "reference"
        ? { researchHandoffQualification: run.result }
        : { natlangTeacher: run.result.teacher, managedResearchHandoff: run.result.verification };
      return {
        messages: [],
        duration: Date.now() - started,
        provenance: {
          contextId: run.result.verification.contextId,
          channelId: null, branchId: null, agentEntityId: null, agentTargetId: null,
        },
        diagnostics,
      };
    },
    validate(result) {
      if (qualification) {
        const proof = result.diagnostics?.["researchHandoffQualification"] as HandoffQualification | undefined;
        return {
          passed: proof?.verification.passed === true && proof.earlyReadDenied && proof.earlyWriteDenied,
          details: proof?.verification.checks,
        };
      }
      const proof = result.diagnostics?.["managedResearchHandoff"] as HandoffTeacher["verification"] | undefined;
      const teacher = result.diagnostics?.["natlangTeacher"] as HandoffTeacher["teacher"] | undefined;
      return { passed: teacher?.trainingEligible === true && proof?.passed === true, details: proof?.checks };
    },
  }))
));

type IntakeTeacher = Awaited<
  ReturnType<ManagedWebBriefReceiver["runManagedResearchIntakeTeacher"]>
>;
type IntakeCheck = Awaited<
  ReturnType<ManagedWebBriefReceiver["qualifyManagedResearchIntake"]>
>;
managedWebBriefTests.push(
  ...managedResearchIntakeWorlds.map(
    (world): TestCase => ({
      ...intakeSettings,
      name: `research-intake-live-${world.id}`,
      description:
        "Review acquired public research evidence from verified cache receipts",
      prompt: world.goal,
      async orchestrate({ runner, signal }) {
        const started = Date.now();
        const run = await runner.runManagedResearchIntake(
          world.id,
          false,
          signal,
        );
        if (run.kind !== "teacher")
          throw new Error("Expected a live research intake capture");
        const { contextId, teacher, verification } = run.result;
        return {
          messages: [],
          duration: Date.now() - started,
          provenance: {
            contextId,
            channelId: null,
            branchId: null,
            agentEntityId: null,
            agentTargetId: null,
          },
          diagnostics: {
            natlangTeacher: teacher,
            managedResearchIntake: verification,
          },
        };
      },
      validate(result) {
        const capture = result.diagnostics?.["natlangTeacher"] as
          | IntakeTeacher["teacher"]
          | undefined;
        const verification = result.diagnostics?.["managedResearchIntake"] as
          | IntakeTeacher["verification"]
          | undefined;
        return {
          passed:
            capture?.trainingEligible === true && verification?.passed === true,
          details: verification?.checks,
        };
      },
    }),
  ),
);
managedWebBriefTests.push({
  ...intakeSettings,
  name: "research-intake-oracle-qualification",
  description:
    "Qualify assigned live research receipts and scoped cache reads with no model",
  prompt: "Check the live source receipts before research interpretation.",
  async orchestrate({ runner, signal }) {
    const started = Date.now();
    const checks: IntakeCheck[] = [];
    for (const { id } of managedResearchIntakeWorlds) {
      const run = await runner.runManagedResearchIntake(id, true, signal);
      if (run.kind !== "reference")
        throw new Error("Research intake qualification invoked a teacher");
      checks.push(run.result);
    }
    return {
      messages: [],
      duration: Date.now() - started,
      diagnostics: { researchIntakeQualification: checks },
    };
  },
  validate(result) {
    const checks = result.diagnostics?.["researchIntakeQualification"] as
      | IntakeCheck[]
      | undefined;
    return {
      passed:
        checks?.length === managedResearchIntakeWorlds.length &&
        checks.every(
          ({ verification, rejectedWrongOperation }) =>
            verification.passed && rejectedWrongOperation,
        ),
      details: { cases: checks?.map(({ verification }) => verification.checks) },
    };
  },
});
