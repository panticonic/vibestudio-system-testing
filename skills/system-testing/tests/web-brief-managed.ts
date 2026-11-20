import { openVaultKnowledgeWorlds } from "../open-goal-vault-knowledge-worlds.js";
import { openGoalGoogleSetupWorlds, googleSetupRequiresUnits } from "../open-goal-google-setup-worlds.js";
import { openClientDiagnosticsWorlds, clientDiagnosticsRequiresUnits } from "../open-goal-client-diagnostics-worlds.js";
import { openGoalGitHubWorlds, githubOpenRequiresUnits, githubOpenAuthority } from "../open-goal-github-worlds.js";
import { openGoalPanelRecoveryWorlds } from "../open-goal-panel-recovery-worlds.js";
import { openGoalOwnedPreviewWorlds } from "../open-goal-owned-preview-worlds.js";
import type { TestCase } from "../types.js";
import type { ManagedWebBriefReceiver } from "../web-brief-managed.js";
import type { ManagedResearchHandoffReceiver } from "../research-handoff-managed.js";
import type { OpenGoalReceiver } from "../open-goal-managed.js";
import type { AgentExecutionTestPolicySpec } from "@vibestudio/shared/authority/testPolicy";
import {
  openTendrilRouteWorlds, openLocalPresentationWorlds, openAdventureJourneyWorlds, adventureGoalRequiresUnits, adventureGoalAuthority,
  browserGoalWorlds, newsGoalRequiresUnits, newsGoalWorlds, openGoalCalendarWorlds, openGoalGmailWorlds,
  evalHandoffRequiresUnits, openGoalEvalHandoffWorlds, programRunRequiresUnits, openGoalProgramRunWorlds, authoringRequiresUnits, openGoalAuthoringWorlds, openGoalGoogleHandoffWorlds, openGoalGoogleWorlds, openGoalPdfWorlds, openGoalPdfVaultWorlds, openGoalPersonalWorlds, openGoalRecoveryWorlds,
  operatorGoalWorlds, operatorGoalRequiresUnits, openGoalWorlds, publicationGoalWorlds,
  openOwnedTaskWorlds, ownedTaskRequiresUnits,
  openLocalDeliveryWorlds, localDeliveryRequiresUnits,
  openUnitRolloutWorlds, unitRolloutRequiresUnits,
  openBuildIncidentWorlds, buildIncidentRequiresUnits,
  openDeployedInterfaceWorlds, openDeployedInterfaceRequiresUnits,
  openExtensionDossierWorlds, openExtensionDossierRequiresUnits,
  openLocalWidthWorlds, openLocalWidthRequiresUnits,
  openDiagnosticWorlds, openDiagnosticRequiresUnits, openDiagnosticAuthority,
  capabilityPlanRequiresUnits, capabilityPlanWorlds,
  openAssemblyRequiresUnits, openAssemblyWorlds,
  compoundRecoveryRequiresUnits, openCompoundRecoveryWorlds,
  personalWelcomeRequiresUnits, personalWelcomeWorlds,
  dictationHandoffRequiresUnits, dictationHandoffWorlds,
  specialistHandoffRequiresUnits, specialistHandoffWorlds,
  providerHandoffRequiresUnits, providerHandoffWorlds,
  openProblemReportWorlds, problemReportRequiresUnits,
  openTemplateMigrationRequiresUnits, openTemplateMigrationWorlds,
  openOwnedResearchWorlds, openTerminalRequiresUnits, openTerminalWorlds,
  openReconciliationWorlds, reconciliationRequiresUnits,
  openPersonalArtifactWorlds, openPersonalAutomationWorlds, openPersonalHistoryWorlds, personalArtifactRequiresUnits,
  openScheduledRecoveryWorlds, scheduledRecoveryRequiresUnits,
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
const referenceGoals = [...openGoalWorlds, ...openTendrilRouteWorlds, ...openExtensionDossierWorlds, ...personalWelcomeWorlds, ...openDeployedInterfaceWorlds, ...openLocalPresentationWorlds, ...specialistHandoffWorlds, ...openAdventureJourneyWorlds, ...dictationHandoffWorlds, ...openLocalWidthWorlds, ...openBuildIncidentWorlds, ...providerHandoffWorlds, ...openProblemReportWorlds, ...openCompoundRecoveryWorlds, ...openOwnedResearchWorlds, ...openScheduledRecoveryWorlds, ...openAssemblyWorlds, ...openTemplateMigrationWorlds, ...capabilityPlanWorlds, ...openOwnedTaskWorlds, ...openTerminalWorlds, ...openReconciliationWorlds, ...openGoalEvalHandoffWorlds, ...openGoalProgramRunWorlds, ...openGoalAuthoringWorlds,
  ...browserGoalWorlds, ...suiteGoalWorlds, ...newsGoalWorlds, ...spectroliteGoalWorlds, ...openVaultKnowledgeWorlds, ...openGoalGoogleWorlds,
  ...openGoalPersonalWorlds, ...operatorGoalWorlds, ...openDiagnosticWorlds, ...openGoalRecoveryWorlds, ...openLocalDeliveryWorlds, ...openUnitRolloutWorlds, ...publicationGoalWorlds,
  ...openGoalPdfWorlds, ...openGoalGmailWorlds, ...openGoalPdfVaultWorlds, ...openGoalCalendarWorlds,
  ...openPersonalArtifactWorlds, ...openPersonalHistoryWorlds, ...openGoalGoogleHandoffWorlds, ...openPersonalAutomationWorlds, ...openGoalOwnedPreviewWorlds, ...openGoalPanelRecoveryWorlds, ...openBrowserMigrationWorlds, ...openGoalGoogleSetupWorlds, ...openClientDiagnosticsWorlds, ...openGoalGitHubWorlds];
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
  "deployed-interface": { requiresUnits: openDeployedInterfaceRequiresUnits },
  "extension-dossier": { requiresUnits: openExtensionDossierRequiresUnits },
  "local-width": { requiresUnits: openLocalWidthRequiresUnits },
  "personal-welcome": { requiresUnits: personalWelcomeRequiresUnits },
  "dictation-handoff": { requiresUnits: dictationHandoffRequiresUnits },
  "adventure-journey": { requiresUnits: adventureGoalRequiresUnits, authorityPolicy: adventureGoalAuthority, resources: [PANEL_AUTOMATION_RESOURCE] },
  "specialist-handoff": { requiresUnits: specialistHandoffRequiresUnits },
  "provider-handoff": { requiresUnits: providerHandoffRequiresUnits },
  "problem-report": { requiresUnits: problemReportRequiresUnits },
  "capability-plan": { requiresUnits: capabilityPlanRequiresUnits },
  "workspace-assembly": { requiresUnits: openAssemblyRequiresUnits },
  templateMigration: { requiresUnits: openTemplateMigrationRequiresUnits },
  "terminal-handoff": { requiresUnits: openTerminalRequiresUnits },
  "local-reconciliation": { requiresUnits: reconciliationRequiresUnits },
  "compound-recovery": { requiresUnits: compoundRecoveryRequiresUnits },
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
  githubWork: { requiresUnits: githubOpenRequiresUnits, authorityPolicy: { authority: githubOpenAuthority } },
  "scheduled-recovery": {
    requiresUnits: scheduledRecoveryRequiresUnits,
    authorityPolicy: { authority: [personalAutomationAuthority[0]] },
  },
  "personal-automation": {
    requiresUnits: personalAutomationRequiresUnits,
    authorityPolicy: { authority: personalAutomationAuthority },
  },
  operator: { requiresUnits: operatorGoalRequiresUnits },
  "build-incident": { requiresUnits: buildIncidentRequiresUnits },
  "system-diagnostics": { requiresUnits: openDiagnosticRequiresUnits, authorityPolicy: openDiagnosticAuthority },
  "local-delivery": { requiresUnits: localDeliveryRequiresUnits },
  "unit-rollout": { requiresUnits: unitRolloutRequiresUnits, resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-unit-rollout", [PANEL_RUNTIME_SUPERVISION_AUTHORITY]) },
  "owned-task": { requiresUnits: ownedTaskRequiresUnits, authorityPolicy: missionPlanningSettings.authorityPolicy },
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
  ...(world.kind === "clientDiagnostics" ? {
    requiresUnits: clientDiagnosticsRequiresUnits,
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-owned-client-diagnostics", world.surfaces.some(scene => scene.reload) ? [
      PANEL_RUNTIME_SUPERVISION_AUTHORITY,
      {
        ruleId: "reload-owned-client-diagnostic",
        capability: { kind: "exact", key: "runtime.supervision.manage" },
        resource: { kind: "prefix", prefix: "restart:panel:panel:" },
        tier: "gated", decision: "once",
      },
    ] : []),
    workspaceRepoFixture: { kind: "open-goal-client-diagnostics", section: "panels", caseId: world.id },
  } : {}),
  ...(world.kind === "tendrilRoute" ? {
    requiresUnits: ["skills/open-user-goal", "skills/tendrils", "panels/tendril-workflow-fixture",
      "workers/tendril", "workers/pubsub-channel"],
  } : {}),
  ...(world.kind === "localPresentation" ? {
    requiresUnits: ["skills/open-user-goal", "skills/visualize"],
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-owned-local-presentation"),
    workspaceRepoFixture: { kind: "presentation-preview-panel", section: "panels", caseId: world.id },
  } : {}),
  ...(world.kind === "visualRecovery" ? {
    requiresUnits: ["skills/open-user-goal", "skills/panel-health", "skills/panel-health-runtime"],
    resources: [PANEL_AUTOMATION_RESOURCE],
    authorityPolicy: panelControlAuthorityPolicy("inspect-open-visual-recovery", [
      PANEL_RUNTIME_SUPERVISION_AUTHORITY,
      ...(world.surfaces.some(surface => surface.reloadStage) ? [{
        ruleId: "reload-owned-recovery-renderer",
        capability: { kind: "exact" as const, key: "runtime.supervision.manage" },
        resource: { kind: "prefix" as const, prefix: "restart:panel:panel:" },
        tier: "gated" as const,
        decision: "once" as const,
      }] : []),
    ]),
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
  ...(world.kind === "templateMigration" && world.authority ? { authorityPolicy: { authority: [{
    ruleId: "prepare-owned-template-migration",
    capability: { kind: "prefix" as const, prefix: "userland:extensions/templates/workspace.templates.update#" },
    resource: { kind: "exact" as const, key: "workspace.templates:extension:@workspace-extensions/templates" },
    tier: "gated" as const, decision: "once" as const,
  }] } } : {}),
  ...(world.kind === "terminal-handoff" ? { authorityPolicy: { authority: [
    { ruleId: "launch-assigned-release-checklist", capability: { kind: "exact" as const, key: "terminal-apps.run" },
      resource: { kind: "exact" as const, key: "terminal-app:terminal-apps/release-checklist" }, tier: "gated" as const, decision: "task" as const },
    ...(world.checks ? [{ ruleId: "verify-assigned-local-checks", capability: { kind: "prefix" as const, prefix: "userland:extensions/shell/native.shell.execute#" },
      resource: { kind: "exact" as const, key: "native.shell:extension:@workspace-extensions/shell" }, tier: "gated" as const, decision: "task" as const }] : []),
  ] } } : {}),
  ...(world.kind === "owned-research" || world.kind === "owned-research-and-edit" ? {
    requiresUnits: ["skills/open-user-goal", "skills/web-research", "extensions/shell"],
    authorityPolicy: { authority: [{
      ruleId: "start-owned-loopback-research-fixture",
      capability: { kind: "prefix" as const, prefix: "userland:extensions/shell/native.shell.execute#" },
      resource: { kind: "exact" as const, key: "native.shell:extension:@workspace-extensions/shell" },
      tier: "gated" as const, decision: "task" as const,
    }] },
  } : {}),
  name: `open-goal-${qualification ? "oracle-" : ""}${world.id}`,
  description: world.kind === "owned-research" || world.kind === "owned-research-and-edit" ? "Discover exact held evidence from the owned public-session HTTP fixture" :
    world.kind === "research" ? "Answer a user question by discovering public evidence" :
    world.kind === "browser" ? "Determine and verify a live browser panel outcome" :
    world.kind === "suite" ? "Select and verify a live declared workspace suite" :
    world.kind === "adventure-journey" ? "Recover a disposable Adventure save and verify its player evidence and authorized next turn" :
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
    world.kind === "githubWork" ? "Review the owned local Git checkout and current GitHub owner authority" :
    world.kind === "personal-history" ? "Verify decisions across immutable archive milestones" :
    world.kind === "scheduled-recovery" ? "Recover an owned future schedule and verify exact retained decisions and local handoff" :
    world.kind === "personal-automation" ? "Coordinate live monitor scheduling with independent state readback" :
    world.kind === "personal" ? "Plan and verify work against the current Mission Control board" :
    world.kind === "personal-welcome" ? "Resolve the current Personal welcome, first-run route, tour cue or local Explorer retry" :
    world.kind === "dictation-handoff" ? "Resolve retained offline dictation and its owned draft" :
    world.kind === "specialist-handoff" ? "Verify currently available specialist and original local integration evidence" :
    world.kind === "provider-handoff" ? "Resolve retained provider approval and original conversation evidence with a scoped handoff" :
    world.kind === "problem-report" ? "Verify a scoped local incident draft and retain surrounding reports" :
    world.kind === "compound-recovery" ? "Join independently verified native recovery with a current local operating note" :
    world.kind === "eval-handoff" ? "Recover original EvalDO receipts and authorized workspace handoffs" :
    world.kind === "capability-plan" ? "Plan against current callable interfaces and load relevant installed knowledge" :
    world.kind === "workspace-assembly" ? "Resolve a package assembly and verify the exact revision and local build evidence" :
    world.kind === "templateMigration" ? "Review an exact template migration against the protected installation and local evidence" :
    world.kind === "terminal-handoff" ? "Work from live release checklist state and independently verified terminal receipts" :
    world.kind === "program-run" ? "Run authorized current programs with independent native output and signed receipts" :
    world.kind === "authoring" ? "Discover current program sources and verify an exact compiler review handoff" :
    world.kind === "local-reconciliation" ? "Reconcile exact local and incoming workspace revisions and verify the retained handoff" :
    world.kind === "build-incident" ? "Reconcile a retained native build profile and exact source coordinates" :
    world.kind === "deployed-interface" ? "Review the exact installed interface, deployed claim, and approved local scope" :
    world.kind === "extension-dossier" ? "Compare extension releases and prepare a scoped local verification dossier" :
    world.kind === "local-width" ? "Reconcile current local model readiness with retained execution width evidence" :
    world.kind === "system-diagnostics" ? "Check exact live log windows and independently verify the incident outcome" :
    world.kind === "operator" ? "Resolve readiness and authorized operations on the owned hub" :
    world.kind === "unit-rollout" ? "Diagnose and verify an owned workspace unit with controlled local source rollout" :
    world.kind === "owned-task" ? "Recover current owned card and attempt evidence with an independently confirmed local handoff" :
    world.kind === "local-delivery" ? "Resolve current local recipients and check retained delivery, recovery, and exact acknowledgment" :
    world.kind === "recovery" ? "Recover current work from retained session evidence" :
    world.kind === "clientDiagnostics" ? "Diagnose the owned client and its durable conversation with exact readback" :
    world.kind === "tendrilRoute" ? "Verify the retained local Tendril audience and instruction route" :
    world.kind === "localPresentation" ? "Verify an accessible presentation of the current owned local evidence" :
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
