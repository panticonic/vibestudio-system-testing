import type { ManagedDeploymentReceiver } from "@workspace-skills/system-testing/remote-deployment-managed";
import type { RemoteCommissionReceiver } from "@workspace-skills/system-testing/remote-commission-managed";
import type { ManagedApprovalTransitionReceiver } from "@workspace-skills/system-testing/approval-transition-managed";
import type { RemoteRouteReceiver } from "@workspace-skills/system-testing/remote-route-managed";
import type { ManagedNotificationReceiver } from "@workspace-skills/system-testing/notification-lifecycle-managed";
import { cliContinuationWork, remoteRouteWorlds } from "@workspace-skills/system-testing/remote-route-worlds";
import type { RetainedTriageReceiver } from "@workspace-skills/system-testing/retained-triage-managed";
import { seedSystemRelease } from "@workspace-skills/system-testing/open-goal-system-release-records";
import { retainedTriageWorlds } from "@workspace-skills/system-testing/retained-triage-worlds";
import type { GitHubSetupReceiver } from "@workspace-skills/system-testing/github-setup-managed";
import type { ManagedGitHubDiagnosisReceiver } from "@workspace-skills/system-testing/github-diagnosis-managed";
import type { PersonalResumeReceiver } from "@workspace-skills/system-testing/personal-resume-managed";
import type { ManagedUnitDesignReceiver } from "@workspace-skills/system-testing/unit-design-managed";
import type { ManagedTemplateCandidateReceiver } from "@workspace-skills/system-testing/template-candidate-managed";
import type { TemplateReleaseReceiver } from "@workspace-skills/system-testing/template-release-managed";
import type { ManagedIntegrationReadinessReceiver } from "@workspace-skills/system-testing/integration-readiness-managed";
import type { ManagedTerminalCheckReceiver } from "@workspace-skills/system-testing/terminal-check-managed";
import type { ManagedTerminalEvidenceReceiver } from "@workspace-skills/system-testing/terminal-evidence-managed";
import type { ManagedProblemDraftReceiver } from "@workspace-skills/system-testing/problem-draft-managed";
import type { ManagedClientAdmissionReceiver } from "@workspace-skills/system-testing/client-admission-contract";
import { managedClientAdmissionWorlds } from "@workspace-skills/system-testing/client-admission-worlds";
import type { ManagedReleaseReviewHandoffReceiver } from "@workspace-skills/system-testing/release-review-handoff-contract";
import { releaseReviewHandoffWork } from "@workspace-skills/system-testing/release-review-handoff-worlds";
import type { PdfMediaReceiver } from "@workspace-skills/system-testing/pdf-media-managed";
import type { AndroidPairReceiver } from "@workspace-skills/system-testing/android-pair-managed";
import type { AndroidInstallReceiver } from "@workspace-skills/system-testing/android-install-managed";
import type { AndroidAuditReceiver } from "@workspace-skills/system-testing/android-audit-managed";
import type { DeliveryHistoryReceiver } from "@workspace-skills/system-testing/delivery-history-managed";
import { deliveryHistoryOperation } from "@workspace-skills/system-testing/delivery-history-worlds";
import type { PublicationRevisionReceiver } from "@workspace-skills/system-testing/publication-revision-managed";
import type { TranscriptCursorReceiver } from "@workspace-skills/system-testing/transcript-cursor-managed";
import type { UnitIdentityReceiver } from "@workspace-skills/system-testing/unit-identity-managed";
import { seedGmailComposeChannel, type GmailComposeHistoryReceiver } from "@workspace-skills/system-testing/gmail-compose-history-managed";
import { seedOpenGmailComposes } from "@workspace-skills/system-testing/open-goal-gmail-seed";
import { gmailContinuationWork, managedGoogleSetupWorlds } from "@workspace-skills/system-testing/google-setup-worlds";
import type { ExplorerProbeInput, ExplorerProbeReceiver } from "@workspace-skills/system-testing/explorer-probe-managed";
import type { TourRehearsalInput, TourRehearsalReceiver } from "@workspace-skills/system-testing/tour-rehearsal-managed";
import type { BuildPerformanceInput, BuildPerformanceReceiver } from "@workspace-skills/system-testing/build-performance-managed";
import type { ManagedLogHandoffReceiver } from "@workspace-skills/system-testing/log-handoff-managed";
import { managedLogHandoffWorlds } from "@workspace-skills/system-testing/log-handoff-worlds";
import type { ManagedLogCursorReceiver } from "@workspace-skills/system-testing/log-cursor-managed";
import { managedLogCursorWorlds } from "@workspace-skills/system-testing/log-cursor-worlds";
import { evalRecoveryProbeCode, type ManagedEvalRecoveryReceiver } from "@workspace-skills/system-testing/eval-recovery-managed";
import type { ManagedPdfLayoutReceiver } from "@workspace-skills/system-testing/pdf-layout-managed";
import type { ManagedDictationReceiver } from "@workspace-skills/system-testing/offline-dictation-managed";
import type { ManagedNativeSuiteReceiver } from "@workspace-skills/system-testing/native-suite-managed";
import type { ManagedGitBridgeReviewReceiver } from "@workspace-skills/system-testing/git-bridge-review-managed";
import type { ManagedVcsDeliveryReceiver } from "@workspace-skills/system-testing/vcs-delivery-managed";
import type { ManagedWebBriefReceiver } from "@workspace-skills/system-testing/web-brief-managed";
import type { ManagedResearchHandoffReceiver } from "@workspace-skills/system-testing/research-handoff-managed";
import { researchHandoffWork } from "@workspace-skills/system-testing/web-brief-worlds";
import type { ManagedArchitectureBoundaryReceiver } from "@workspace-skills/system-testing/architecture-boundary-managed";
import type { ManagedExtensionReleaseReceiver } from "@workspace-skills/system-testing/extension-release-managed";
import type { ManagedAuthorityReviewReceiver } from "@workspace-skills/system-testing/authority-review-managed";
import type { ManagedAgenticChangeReceiver } from "@workspace-skills/system-testing/agentic-change-managed";
import type { ManagedGadReviewReceiver } from "@workspace-skills/system-testing/gad-review-managed";
import { phoneSetupUnavailable, type ManagedPhoneSetupReceiver } from "@workspace-skills/system-testing/phone-setup-managed";
import type { TestkitCleanupInput, ManagedTestkitCleanupReceiver } from "@workspace-skills/system-testing/testkit-cleanup-contract";
import type { SessionReplayInput, ManagedSessionReplayReceiver } from "@workspace-skills/system-testing/session-replay-contract";
import type { PanelHealthInput, ManagedPanelHealthReceiver } from "@workspace-skills/system-testing/panel-health-contract";
import type { ChannelRosterInput, ManagedChannelRosterReceiver } from "@workspace-skills/system-testing/channel-roster-contract";
import type { MissionPlanningInput, ManagedMissionPlanningReceiver } from "@workspace-skills/system-testing/mission-planning-contract";
import type { BrowserHandoffInput, ManagedBrowserHandoffReceiver } from "@workspace-skills/system-testing/browser-handoff-contract";
import type { BrowserLibraryInput, ManagedBrowserLibraryReceiver } from "@workspace-skills/system-testing/browser-library-contract";
import type { CollectionInput, ManagedCollectionReceiver } from "@workspace-skills/system-testing/collection-contract";
import type { TendrilInput, ManagedTendrilReceiver } from "@workspace-skills/system-testing/tendril-contract";
import type { ProvenanceHistoryInput, ManagedProvenanceHistoryReceiver } from "@workspace-skills/system-testing/provenance-history-contract";
import type { RuntimeProgramInput, ManagedRuntimeProgramReceiver } from "@workspace-skills/system-testing/runtime-program-contract";
import type { IncidentContinuationInput, ManagedIncidentContinuationReceiver } from "@workspace-skills/system-testing/incident-continuation-contract";
import { incidentContinuationWorlds } from "@workspace-skills/system-testing/incident-continuation-worlds";
import type { LogAuditInput, ManagedLogAuditReceiver } from "@workspace-skills/system-testing/log-audit-contract";
import { hostWorkerdLogTag, managedLogAuditWorlds } from "@workspace-skills/system-testing/log-audit-worlds";
import type { LocalComparisonInput, ManagedLocalComparisonReceiver } from "@workspace-skills/system-testing/local-model-comparison-contract";
import type { GoogleSetupInput, ManagedGoogleSetupReceiver } from "@workspace-skills/system-testing/google-setup-contract";
import type { NewsInput, ManagedNewsReceiver } from "@workspace-skills/system-testing/news-contract";
import { managedNewsWorlds, newsHandoffWork } from "@workspace-skills/system-testing/news-worlds";
import type { SpectroliteInput, ManagedSpectroliteReceiver } from "@workspace-skills/system-testing/spectrolite-contract";
import { managedSpectroliteWorlds, spectroliteHandoffWork } from "@workspace-skills/system-testing/spectrolite-worlds";
import type { GardenReviewInput, ManagedGrimoireReceiver } from "@workspace-skills/system-testing/grimoire-contract";
import type { AdventureReviewInput, ManagedAdventureReceiver, ProgrammedAdventureInput } from "@workspace-skills/system-testing/adventure-review-contract";
import type { RegencyReviewInput, ManagedRegencyReceiver } from "@workspace-skills/system-testing/regency-review-contract";
import type { DriveCheckpointInput, ManagedDriveCheckpointReceiver } from "@workspace-skills/system-testing/drive-checkpoint-contract";
import type { BrowserImportInput, ManagedBrowserImportReceiver } from "@workspace-skills/system-testing/browser-import-contract";
import type { DriveSharingInput, ManagedDriveSharingReceiver } from "@workspace-skills/system-testing/drive-sharing-contract";
import { driveCheckpointHandoffWork, managedDriveCheckpointWorlds } from "@workspace-skills/system-testing/drive-checkpoint-worlds";
import { grimoireHandoffWork, managedGrimoireWorlds } from "@workspace-skills/system-testing/grimoire-worlds";
import type { ChecklistInput, ManagedChecklistReceiver } from "@workspace-skills/system-testing/checklist-contract";
import type { ManagedSetupReceiver, SetupInput } from "@workspace-skills/system-testing/onboarding-contract";
import type { VerifiedMemoryReceiver, VerifiedMemoryInput } from "@workspace-skills/system-testing/verified-memory-contract";
import { managedMemoryOperation } from "@workspace-skills/system-testing/verified-memory-worlds";
import type { ManagedAuthoringReceiver, AuthoringInput } from "@workspace-skills/system-testing/authoring-contract";
import type { ManagedPresentationReceiver, PresentationTeacherInput } from "@workspace-skills/system-testing/presentation-contract";
import type { ManagedPdfReceiver, PdfIntakeInput } from "@workspace-skills/system-testing/pdf-intake-contract";
import type { ManagedPublicationReceiver, PublicationInput } from "@workspace-skills/system-testing/publication-preflight-contract";
import { closeOwnedScheduledRecovery, seedOwnedScheduledRecovery } from "@workspace-skills/system-testing/open-goal-scheduled-recovery-managed";
import {
  pauseManagedAutomationFixture,
  pauseOpenPersonalAutomation,
  seedManagedAutomation,
  seedOpenPersonalAutomation,
} from "@workspace-skills/system-testing/automation-lifecycle-managed";
import type { ManagedAutomationReceiver } from "@workspace-skills/system-testing/automation-lifecycle-contract";
import { scratchHandoffInputSchema, scratchHandoffTeacherInputSchema, type ScratchHandoffInput, type ScratchHandoffTeacherInput, type ScratchHandoffReceiver } from "@workspace-skills/system-testing/scratch-handoff-contract";
import { managedScratchWorlds } from "@workspace-skills/system-testing/scratch-handoff-worlds";
import {localMessagingInputSchema,localMessagingQualificationSchema,type LocalMessagingInput,type LocalMessagingQualification,type LocalMessagingResult} from "@workspace-skills/system-testing/local-messaging-contract";
import {localMessagingQualificationCode,localMessagingTeacherCode} from "./local-messaging-teacher.js";
import {ownedDossierQualificationInput,ownedOperationsInputSchema,type OwnedDossierQualificationInput,type OwnedOperationsInput,type OwnedOperationsResult} from "@workspace-skills/system-testing/owned-operations-contract";
import {ownedOperationsTeacherCode, qualifyHeldReleaseDossierCode} from "./owned-operations-teacher.js";
import { contentProjectTeacherInputSchema, contentProjectInputSchema, type ContentProjectTeacherInput, type ContentProjectInput, type ContentProjectResult, type ContentProjectReceiver } from "@workspace-skills/system-testing/content-project-contract";
import { createVcsClient } from "@workspace/runtime/vcs-client";
import { prepareWorkspaceIntegration, verifyWorkspaceIntegration, exerciseWorkspaceIntegration,
  type OwnedIntegrationWorld, type IntegrationFixtureInput, type IntegrationFixtureReceiver,
} from "@workspace-skills/system-testing/vcs-integration-fixture-contract";
import type { IntegrationHandoffReceiver } from "@workspace-skills/system-testing/integration-handoff-contract";
import { authoredTeacherCode, composedTeacherCode, domainTeacherCode, domainTeacherQualificationCode, openGoalTeacherCode } from "./authored-teacher.js";
import type { OpenGoalReceiver } from "@workspace-skills/system-testing/open-goal-managed";
import {
  openPhoneFirstRunWorlds, openSkillMaintenanceWorlds, openDesktopReadinessWorlds, openContentArchiveWorlds, openSystemReleaseWorlds, openTestkitCloseoutWorlds, openPanelSourceMigrationWorlds, openWorkspaceShareWorlds, openNotificationStateWorlds, openAgentCapabilityWorlds, openMobileContinuityWorlds, openInstalledPackageWorlds, openAssetIntegrityWorlds, openTendrilRouteWorlds, openLocalPresentationWorlds, openAdventureJourneyWorlds, openChatContinuityWorlds, openEditorialWorlds, openPortfolioWorlds, openRegencyWorlds, openImageCandidateWorlds, openApiReadinessWorlds, openNewsEvidenceWorlds, newsGoalWorlds, openGoalCalendarWorlds, openGoalGmailWorlds, openGoalGoogleWorlds, openGoalGoogleHandoffWorlds, openGoalOwnedPreviewWorlds, openGoalPanelRecoveryWorlds, openGoalPdfWorlds, openGoalPdfVaultWorlds, openGoalPersonalWorlds,
  openScheduledRecoveryWorlds, capabilityPlanWorlds, openGoalGitHubWorlds,
  openAssemblyWorlds, openTemplateMigrationWorlds,
  openExtensionDossierWorlds,
  personalWelcomeWorlds, dictationHandoffWorlds, specialistHandoffWorlds, providerHandoffWorlds, openProblemReportWorlds, openCompoundRecoveryWorlds, openOwnedResearchWorlds, openTerminalWorlds, openOwnedTaskWorlds, openGoalGoogleSetupWorlds, openUnitRolloutWorlds,
  openDeployedInterfaceWorlds, openLocalWidthWorlds, openBuildIncidentWorlds, openGoalEvalHandoffWorlds, openGoalProgramRunWorlds, openGoalAuthoringWorlds, openDiagnosticWorlds, openReconciliationWorlds, openGoalRecoveryWorlds, openLocalDeliveryWorlds, openPersonalArtifactWorlds, openPersonalAutomationWorlds, openPersonalHistoryWorlds, openBrowserMigrationWorlds,
  operatorGoalWorlds, publicationGoalWorlds, spectroliteGoalWorlds, openVaultKnowledgeWorlds, openClientDiagnosticsWorlds,
} from "@workspace-skills/system-testing/open-goal-worlds";

import {
  createMainRpcCaller,
  mainRpcMethods,
} from "@vibestudio/service-schemas/mainRpc";
import type { MainRpcCaller } from "@vibestudio/service-schemas/mainRpc";
import {
  panelTeacherInputSchema,
  unitRepairTeacherInputSchema,
  type UnitRepairTeacherInput,
  type UnitRepairTeacherResult,
  workspaceIntegrationTeacherInputSchema,
  type WorkspaceIntegrationTeacherInput,
  type PanelTeacherInput,
  type PanelTeacherResult,
  systemTestDescriptorSchema,
  systemTestDoctorResultSchema,
  systemTestFailedRunSchema,
  systemTestRunConfigSchema,
  systemTestRunCompletionSchema,
  systemTestRunnerSnapshotSchema,
  systemTestTrajectoryPageSchema,
  type SystemTestDescriptor,
  type SystemTestDoctorResult,
  type SystemTestRunCompletion,
  type SystemTestRunConfig,
  type SystemTestFailedRunConfig,
  type SystemTestRunnerSnapshot,
  type SystemTestTrajectoryPage,
} from "@vibestudio/service-schemas/systemTestRunner";
/**
 * Sealed authority conduit for the headless system-test harness.
 *
 * System-test source is intentionally evaluated in the normal EvalDO runtime,
 * where its portable APIs actually live. EvalDO recognizes this exact sealed
 * runner build and issues the explicit test policy for its nested runs. No
 * session, shell, or arbitrary eval can impersonate that execution identity.
 */
import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import { deserializeRpcFailure, formatRpcFailure } from "@vibestudio/rpc";
import {
  anyOf,
  methodCapability,
  relationship,
} from "@vibestudio/shared/authorization";
import {
  createEvalExecutor,
  createEvalRunHandle,
  createEvalRunObserver,
  evalRunStatusSchema,
} from "@vibestudio/service-schemas/eval";
import type { z } from "zod";
import {
  inspectSystemTestRun,
  systemTestTrajectory,
} from "@workspace-skills/system-testing/record-analysis";
import type { SystemTestRunRecord } from "@workspace-skills/system-testing/cli";
import { readEvalStatusWithRetry } from "./eval-status-retry.js";

type EvalRunStatus = z.infer<typeof evalRunStatusSchema>;

interface EvalCancelResult {
  ok: true;
  forcedReset: boolean;
}

interface StoredSystemTestRecord {
  kind: "system-test-record-v1";
  scopeKey: string;
  length: number;
}

export type {
  SystemTestRunCompletion,
  SystemTestRunnerSnapshot,
} from "@vibestudio/service-schemas/systemTestRunner";

const managedDomainWork = {
  LogHandoff: {kind:"domain",domain:"serverLogs",operation:"reviewHostLogHandoff",input:{goal:"Compare the assigned host-log windows"}},
  LogCursor: {kind:"domain",domain:"serverLogs",operation:"reviewLogCursor",input:{goal:"Review the assigned saved log cursor"}},
  EvalRecovery: {kind:"domain",domain:"evalRecovery",operation:"reviewEvalRecovery",input:{goal:"Review the assigned eval attempt"}},
  PdfLayout: {kind:"domain",domain:"pdfIntake",operation:"reviewPdfLayout",input:{goal:"Review the assigned PDF layout"}},
  Dictation: {kind:"domain",domain:"dictation",operation:"reviewDictation",input:{goal:"Review the assigned offline dictation"}},
  NativeSuite: {kind:"domain",domain:"testSuite",operation:"reviewTestSuite",input:{goal:"Review the assigned declared test suite"}},
  GitBridgeReview: {kind:"domain",domain:"gitBridge",operation:"reviewGitBridge",input:{goal:"Review the assigned Git Bridge repository"}},
  VcsDelivery: {kind:"domain",domain:"vcsDelivery",operation:"reviewVcsDelivery",input:{goal:"Review the assigned semantic VCS delivery"}},
  WebBrief: {kind:"domain",domain:"webResearch",operation:"writeAssignedBrief",input:{goal:"Write the assigned web brief"}},
  ResearchIntake: {kind:"domain",domain:"research",operation:"reviewLiveResearchIntake",input:{goal:"Review the assigned public evidence"}},
  ArchitectureBoundary: {kind:"domain",domain:"architecture",operation:"reviewArchitectureBoundary",input:{goal:"Review the assigned architecture boundary"}},
  ProblemDraft: {kind:"domain",domain:"problems",operation:"saveProblemDraft",input:{goal:"Save the assigned local report"}},
  ClientAdmission: {kind:"domain",domain:"clientDevelopment",operation:"reviewClientAdmission",input:{goal:"Review the assigned System client"}},
  ExtensionRelease: {kind:"domain",domain:"extensionDevelopment",operation:"reviewExtensionRelease",input:{goal:"Review the assigned extension release"}},
  AuthorityReview: {kind:"domain",domain:"capabilities",operation:"reviewAuthority",input:{goal:"Review the assigned authority ceiling"}},
  AgenticChange: {kind:"domain",domain:"agenticDevelopment",operation:"planAgenticChange",input:{goal:"Plan the assigned agentic change"}},
} as const;

const SYSTEM_TEST_OPERATOR = anyOf(
  methodCapability("host"),
  relationship("workspace-role", "root"),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JavaScript slices by UTF-16 code unit. A page is therefore at most 64K code
// units and at most 256KiB once SQLite encodes it as UTF-8.
const SYSTEM_TEST_RECORD_PAGE_CODE_UNITS = 64 * 1024;

export function splitSystemTestRecord(text: string): string[] {
  if (text.length === 0) return [""];
  const pages: string[] = [];
  for (let offset = 0; offset < text.length; ) {
    let end = Math.min(
      text.length,
      offset + SYSTEM_TEST_RECORD_PAGE_CODE_UNITS,
    );
    const last = text.charCodeAt(end - 1),
      next = text.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end -= 1;
    pages.push(text.slice(offset, end));
    offset = end;
  }
  return pages;
}

export function assembleSystemTestRecord(
  expectedLength: number,
  expectedPageCount: number,
  pages: ReadonlyArray<{ page_index: number; page_text: string }>,
): string {
  if (
    pages.length !== expectedPageCount ||
    pages.some((page, index) => page.page_index !== index)
  ) {
    throw new Error("system-test record has incomplete durable pages");
  }
  const text = pages.map((page) => page.page_text).join("");
  if (text.length !== expectedLength) {
    throw new Error(
      `system-test record has invalid durable length (${text.length}/${expectedLength})`,
    );
  }
  return text;
}

/** Read immutable record bytes with bounded RPC pages and one streaming decoder. */
export async function readSystemTestRecordBlob(
  call: MainRpcCaller,
  digest: string,
  size: number,
): Promise<unknown> {
  if (
    !/^[a-f0-9]{64}$/u.test(digest) ||
    !Number.isSafeInteger(size) ||
    size <= 0
  ) {
    throw new Error("Invalid system-test record blob reference");
  }
  const stat = await call("blobstore.stat", [digest]);
  if (!stat || stat.size !== size)
    throw new Error(
      "System-test record blob size does not match its reference",
    );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let serialized = "";
  const pageBytes = 64 * 1024;
  for (let offset = 0; offset < size; offset += pageBytes) {
    const length = Math.min(pageBytes, size - offset);
    const page = await call("blobstore.getRangeBytes", [
      digest,
      offset,
      length,
    ]);
    if (!page)
      throw new Error(`System-test record blob ${digest} is unavailable`);
    const bytes = Uint8Array.from(atob(page.bytesBase64), (char) =>
      char.charCodeAt(0),
    );
    if (bytes.length !== length)
      throw new Error("System-test record blob was truncated");
    serialized += decoder.decode(bytes, { stream: true });
  }
  serialized += decoder.decode();
  return JSON.parse(serialized);
}

function systemTestEvaluation(config: SystemTestRunConfig, recordOwner: string) {
  return {
    runId: systemTestEvalRunId(config.runId),
    scope: { key: config.runId, lifecycle: "finite" as const },
    source: {
      kind: "inline" as const,
      code: systemTestEvalCode(config, recordOwner),
      syntax: "typescript" as const,
    },
  };
}

function systemTestEvalCode(
  options: SystemTestRunConfig,
  recordOwner: string,
): string {
  return `
    import {
      inspectSystemTestRun,
      failedSystemTestRunRecord,
      failedSystemTestPreparationRecord,
      installedWorkspaceUnits,
      runSystemTests,
      systemTestTrajectory,
      systemTestProgressCheckpoint,
      SYSTEM_TEST_DURABLE_HEARTBEAT_LIMIT,
    } from "@workspace-skills/system-testing/cli";
    const { blobstore, rpc } = await import("@workspace/runtime");
    const { systemTestRunnerRpcMethods } = await import("@workspace-workers/system-test-runner/contract");
    const recordOwner = ${JSON.stringify(recordOwner)};
    const options = ${JSON.stringify(options)};
    // Which units this workspace carries is a property of the workspace, not
    // of the catalog: templates are independent repositories and Personal and
    // System install different ones. Read it here, once, from inside the
    // workspace that will run the cases.
    const startedAt = new Date().toISOString();
    const progressKey = options.runId;
    let checkpointCompletedCount = -1;
    let lastRunRecord = null;
    const retainedEntries = new Map();
    const persistRunRecord = async (record) => {
      const completedNames = new Set((lastProgress?.completed || []).map(entry => entry.name));
      const entries = record.suite.results.filter(entry => record.status !== "running" || completedNames.has(entry.test.name));
      for (const entry of entries) {
        if (retainedEntries.has(entry.test.name)) continue;
        const stored = await blobstore.putText(JSON.stringify(entry));
        retainedEntries.set(entry.test.name, { testName: entry.test.name, digest: stored.digest, size: stored.size });
      }
      const header = { ...record, suite: { ...record.suite, results: [] } };
      await rpc.call(recordOwner, systemTestRunnerRpcMethods.storeSystemTestRunCheckpoint, [progressKey, header, entries.map(entry => retainedEntries.get(entry.test.name))]);
    };
    // EvalDO durably stores each progress payload with a 64 KiB ceiling. Leave
    // room for its event envelope and encoded strings instead of measuring
    // against the larger transient RPC transport limit.
    const durableHeartbeatLimit = SYSTEM_TEST_DURABLE_HEARTBEAT_LIMIT;
    let lastProgress = null;
    const publishProgress = (progress) => {
      const durable = systemTestProgressCheckpoint(lastProgress, progress);
      lastProgress = durable;
      ctx.reportProgress(durable);
    };
    // Report claims are judged by Base's claimCheck program through this eval's natlang provider: the same
    // executor role, model gateway and call records as every eval's natlang calls. Loaded on first use.
    let claimProgram = null;
    const claimJudge = async (text, claims) => {
      claimProgram ??= natlang.load("skills/sandbox/claims/claimCheck.nl");
      return (await claimProgram).check(text, claims);
    };
    try {
      const installedUnits = await installedWorkspaceUnits();
      const record = await runSystemTests({
        ...options,
        installedUnits,
        claimJudge,
        contextId: ctx.contextId,
        onProgress: publishProgress,
        onInspectionUpdate: async (liveRecord) => {
          lastRunRecord = liveRecord;
          const completedCount = lastProgress?.completed?.length ?? 0;
          if (completedCount !== checkpointCompletedCount) {
            await persistRunRecord(liveRecord);
            checkpointCompletedCount = completedCount;
          }
          const limits = { failures: 2, messages: 4, invocations: 6, debugEvents: 6, text: 300 };
          const inspect = inspectSystemTestRun(liveRecord, { limits });
          const base = { ...(lastProgress || {}) };
          const trajectories = {};
          for (const entry of liveRecord.suite.results) {
            const name = entry.test.name;
            const candidate = {
              ...trajectories,
              [name]: { bounded: systemTestTrajectory(liveRecord, name, { limits }) },
            };
            const heartbeat = { ...base, liveInspection: { inspect, trajectories: candidate } };
            if (JSON.stringify(heartbeat).length <= durableHeartbeatLimit) {
              Object.assign(trajectories, candidate);
            }
          }
          publishProgress({ ...base, liveInspection: { inspect, trajectories } });
        },
        registerCancellationCleanup: (cleanup) => ctx.onCancel(async () => {
          const cancelledRecord = await cleanup();
          if (cancelledRecord) {
            await persistRunRecord(cancelledRecord);
          }
        }),
      });
      lastRunRecord = record;
      await persistRunRecord(record);
      return { runId: record.runId };
    } catch (error) {
      const prior = lastProgress && typeof lastProgress === "object"
        ? lastProgress
        : { runId: progressKey, startedAt: new Date().toISOString(), total: 0, queued: [], running: [], completed: [] };
      publishProgress({
        ...prior,
        status: "errored",
        updatedAt: new Date().toISOString(),
        running: [],
        error: error instanceof Error ? error.message : String(error),
      });
      const failure = error instanceof Error ? error.message : String(error);
      await persistRunRecord(lastRunRecord ? failedSystemTestRunRecord(
          lastRunRecord,
          (lastProgress?.completed || []).map(entry => entry.name),
          failure,
        ) : failedSystemTestPreparationRecord(
          { ...options, contextId: ctx.contextId }, failure, startedAt,
        )).catch(checkpointError => {
          throw new Error(failure + "; terminal checkpoint could not be retained: " + String(checkpointError), { cause: error });
        });
      throw error;
    }
  `;
}

export class SystemTestRunnerDO extends DurableObjectBase implements IntegrationFixtureReceiver, ContentProjectReceiver, ScratchHandoffReceiver, IntegrationHandoffReceiver, ManagedAutomationReceiver, ManagedPublicationReceiver, ManagedPdfReceiver, ManagedChecklistReceiver {
  protected createTables(): void {
    this.sql.exec(`CREATE TABLE system_test_records (
      run_id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL,
      completed_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE system_test_entries (
      run_id TEXT NOT NULL, test_name TEXT NOT NULL, digest TEXT NOT NULL,
      length INTEGER NOT NULL, page_count INTEGER NOT NULL,
      PRIMARY KEY (run_id, test_name)
    )`);
    this.sql.exec(`CREATE TABLE system_test_entry_pages (
      run_id TEXT NOT NULL, test_name TEXT NOT NULL, page_index INTEGER NOT NULL,
      page_text TEXT NOT NULL, PRIMARY KEY (run_id, test_name, page_index)
    )`);
  }

  private persistedHeader(
    runId: string,
  ): { record: SystemTestRunRecord; entryNames: string[] } | null {
    const row = this.sql
      .exec<{
        record_json: string;
      }>(`SELECT record_json FROM system_test_records WHERE run_id = ?`, runId)
      .toArray()[0];
    return row ? JSON.parse(row.record_json) : null;
  }

  private requirePersistedHeader(runId: string) {
    const header = this.persistedHeader(runId);
    if (!header)
      throw new Error(`No durable system-test record exists for ${runId}`);
    return header;
  }

  private requirePersistedRecord(
    runId: string,
    testName?: string,
  ): SystemTestRunRecord {
    const { record, entryNames } = this.requirePersistedHeader(runId);
    const names = testName
      ? entryNames.filter((name) => name === testName)
      : entryNames;
    const results = names.map((name) => {
      const entry = this.sql
        .exec<{
          length: number;
          page_count: number;
        }>(
          `SELECT length, page_count FROM system_test_entries WHERE run_id = ? AND test_name = ?`,
          runId,
          name,
        )
        .toArray()[0];
      if (!entry)
        throw new Error(`Missing retained system-test entry ${runId}/${name}`);
      const pages = this.sql
        .exec<{
          page_index: number;
          page_text: string;
        }>(
          `SELECT page_index, page_text FROM system_test_entry_pages WHERE run_id = ? AND test_name = ? ORDER BY page_index`,
          runId,
          name,
        )
        .toArray();
      return JSON.parse(
        assembleSystemTestRecord(entry.length, entry.page_count, pages),
      );
    });
    return { ...record, suite: { ...record.suite, results } };
  }

  @rpc({
    website: {
      kind: "closed",
      reason: "Only the workspace test operator may retain a run checkpoint.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async storeSystemTestRunCheckpoint(
    runId: string,
    record: SystemTestRunRecord,
    entries: { testName: string; digest: string; size: number }[],
  ): Promise<void> {
    if (
      record?.runId !== runId ||
      record.schemaVersion !== 1 ||
      record.suite.results.length !== 0 ||
      new Set(entries.map((entry) => entry.testName)).size !== entries.length
    )
      throw new Error(`System-test record ${runId} has an invalid identity`);
    const stale = () => {
      const prior = this.persistedHeader(runId);
      return (
        prior &&
        (prior.record.status !== "running" ||
          prior.record.updatedAt > record.updatedAt)
      );
    };
    if (stale()) return;
    const ensureCompletedEntriesRetained = () => {
      const prior = this.persistedHeader(runId);
      const names = new Set(entries.map((entry) => entry.testName));
      if (prior?.entryNames.some((name) => !names.has(name)))
        throw new Error(
          `System-test checkpoint ${runId} cannot forget completed entries`,
        );
    };
    ensureCompletedEntriesRetained();
    const prepared: {
      testName: string;
      digest: string;
      size: number;
      length: number;
      pages: string[];
    }[] = [];
    for (const reference of entries) {
      const prior = this.sql
        .exec<{
          digest: string;
        }>(
          "SELECT digest FROM system_test_entries WHERE run_id = ? AND test_name = ?",
          runId,
          reference.testName,
        )
        .toArray()[0];
      if (prior) {
        if (prior.digest !== reference.digest)
          throw new Error(
            `Completed system-test entry ${runId}/${reference.testName} cannot be replaced`,
          );
        continue;
      }
      const entry = await readSystemTestRecordBlob(
        createMainRpcCaller(this.rpc),
        reference.digest,
        reference.size,
      );
      if (
        !isRecord(entry) ||
        !isRecord(entry["test"]) ||
        entry["test"]["name"] !== reference.testName ||
        !isRecord(entry["execution"]) ||
        !isRecord(entry["result"])
      )
        throw new Error(
          `System-test entry ${runId}/${reference.testName} has an invalid identity`,
        );
      const serialized = JSON.stringify(entry);
      prepared.push({
        ...reference,
        length: serialized.length,
        pages: splitSystemTestRecord(serialized),
      });
    }
    // All immutable bytes arrive before the storage transaction. Either the
    // checkpoint's entries and header become visible together, or none do.
    // Recheck after external reads so a late writer cannot replace terminal proof.
    this.ctx.storage.transactionSync(() => {
      if (stale()) return;
      ensureCompletedEntriesRetained();
      for (const entry of prepared) {
        const prior = this.sql
          .exec<{
            digest: string;
          }>(
            "SELECT digest FROM system_test_entries WHERE run_id = ? AND test_name = ?",
            runId,
            entry.testName,
          )
          .toArray()[0];
        if (prior) {
          if (prior.digest !== entry.digest)
            throw new Error(
              `Completed system-test entry ${runId}/${entry.testName} cannot be replaced`,
            );
          continue;
        }
        for (const [index, text] of entry.pages.entries())
          this.sql.exec(
            "INSERT INTO system_test_entry_pages (run_id, test_name, page_index, page_text) VALUES (?, ?, ?, ?)",
            runId,
            entry.testName,
            index,
            text,
          );
        this.sql.exec(
          "INSERT INTO system_test_entries (run_id, test_name, digest, length, page_count) VALUES (?, ?, ?, ?, ?)",
          runId,
          entry.testName,
          entry.digest,
          entry.length,
          entry.pages.length,
        );
      }
      this.sql.exec(
        `INSERT INTO system_test_records (run_id, record_json, completed_at) VALUES (?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET record_json = excluded.record_json, completed_at = excluded.completed_at`,
        runId,
        JSON.stringify({
          record,
          entryNames: entries.map((entry) => entry.testName),
        }),
        Date.now(),
      );
    });
  }

  private async runHarnessUtility(
    kind: "doctor" | "list" | "teacher",
    code: string | ((runId: string) => string),
    approvals?: "pregranted-only",
  ): Promise<unknown> {
    const runId = `system-test-runner:${kind}:${crypto.randomUUID()}`;
    // A utility call owns a finite EvalDO for exactly one invocation. Startup
    // approval can call doctor while the CLI issues its next doctor/list
    // request, so a kind-only scope would let one invocation dispose or
    // overwrite another invocation's result before it was read.
    const { subKey, scopeKey } = systemTestUtilityKeys(
      kind,
      crypto.randomUUID(),
    );
    try {
      const execute = createEvalExecutor(createMainRpcCaller(this.rpc));
      const result = await execute({
        runId,
        scope: { key: subKey, lifecycle: "finite" },
        ...(approvals ? { authority: { effects: "read-write" as const, approvals } } : {}),
        source: {
          kind: "inline",
          code: `
          ${typeof code === "function" ? code(runId) : code}
          const serialized = JSON.stringify(utilityValue);
          scope[${JSON.stringify(scopeKey)}] = serialized;
          return {
            kind: "system-test-record-v1",
            scopeKey: ${JSON.stringify(scopeKey)},
            length: serialized.length,
          };
        `,
          syntax: "typescript",
        },
      });
      if (!result.success) {
        throw new Error(
          result.error
            ? formatRpcFailure(deserializeRpcFailure(result.error))
            : `system-test ${kind} eval failed`,
        );
      }
      const stored = parseStoredSystemTestRecord(result.returnValue);
      try {
        return await this.readStoredSystemTestRecord(subKey, stored);
      } finally {
        await this.rpc.call("main", mainRpcMethods["eval.deleteScopeValue"], [
          { scopeKey: subKey, key: stored.scopeKey },
        ]);
      }
    } finally {
      await this.rpc.call("main", mainRpcMethods["eval.dispose"], [
        { scopeKey: subKey },
      ]);
    }
  }

  @rpc({ website: { kind: "closed", reason: "Owned teacher execution uses one seeded test context and panel." },
    requires: SYSTEM_TEST_OPERATOR, effect: { kind: "open" }, tier: "open", sensitivity: "write" })
  async runPanelTeacher(input: PanelTeacherInput): Promise<PanelTeacherResult> {
    const selected = panelTeacherInputSchema.parse(input);
    return await this.runHarnessUtility("teacher", (runId) => authoredTeacherCode({
      executorModel:selected.executorModel,skill: "repairPanel",serviceNames:["panelRepair","panelRepairEdit"],
      request:{panelSource:selected.panelSource,goal:selected.goal},
      bindingCode:`
        import {panelTree,vcs,contextId as actualContextId} from "@workspace/runtime";
        import {createPanelRepair} from "@workspace/natlang-services";
        const selected=${JSON.stringify(selected)};
        if(actualContextId!==selected.contextId) throw new Error("Teacher worker belongs to another context");
        const panel=panelTree.get(selected.panelId), assigned=await panel.observe();
        if(assigned.contextId!==selected.contextId || assigned.source!==selected.panelSource || assigned.kind!=="workspace" || assigned.requestedRef!=="ctx:"+selected.contextId) throw new Error("Teacher panel is outside selected fixture context");
        const assignedService=createPanelRepair({contextId:selected.contextId,panelSource:selected.panelSource,panel,vcs,build:services.build});
      `,
    },runId)) as PanelTeacherResult;
  }

  @rpc({website:{kind:"closed",reason:"Owned synthetic local messaging only, with independent routing and absence verification."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runLocalMessagingTeacher(input:LocalMessagingInput):Promise<LocalMessagingResult>{
    const selected=localMessagingInputSchema.parse(input);
    return await this.runHarnessUtility("teacher",runId=>localMessagingTeacherCode(selected,runId)) as LocalMessagingResult;
  }

  @rpc({website:{kind:"closed",reason:"Checks owned local messaging with its original delivery receipts."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyLocalMessaging(input: LocalMessagingQualification): Promise<LocalMessagingResult> {
    const selected = localMessagingQualificationSchema.parse(input);
    return await this.runHarnessUtility("teacher", localMessagingQualificationCode(selected)) as LocalMessagingResult;
  }

  @rpc({ website: { kind: "closed", reason: "Runs authored repair in one owned worker fixture." },
    requires: SYSTEM_TEST_OPERATOR, effect: { kind: "open" }, tier: "open", sensitivity: "write" })
  async runUnitRepairTeacher(input: UnitRepairTeacherInput): Promise<UnitRepairTeacherResult> {
    const selected = unitRepairTeacherInputSchema.parse(input);
    return await this.runHarnessUtility("teacher", (runId) => `${authoredTeacherCode({
      executorModel: selected.executorModel,
      skill: "repairUnit",
      serviceNames: ["unitRepair", "unitRepairEdit"],
      request: { unit: selected.unit, suite: "unit", goal: selected.goal },
      bindingCode: `
        import {vcs, rpc, openPanel, contextId as actualContextId} from "@workspace/runtime";
        import {createUnitRepair,verifyUnit,verifyUnitRepairOutcome} from "@workspace-skills/system-testing/unit-repair-oracle";
        const selected=${JSON.stringify(selected)};
        if(actualContextId!==selected.contextId) throw new Error("Teacher worker belongs to another context");
        const build = services.build;
        const verifyTests = (command) => verifyUnit({
          rpc, openPanel, contextId: selected.contextId,
          operationPrefix: "natlang-unit-repair",
        }, command);
        const options = {contextId: selected.contextId, unit: selected.unit, suite: "unit",
          editablePaths: [selected.unit + "/index.ts"], vcs, build, verifyTests};
        const repair = createUnitRepair(options);
        const assignedService = {...repair.unitRepair, ...repair.unitRepairEdit};
        const oracle = createUnitRepair(options);
        const baseline = await oracle.unitRepair.observe();
        if(baseline.build.status!=="failed" ||
          !baseline.build.diagnostics.some(d=>d.severity==="error" && (d.source==="tsc" || d.source==="esbuild"))) {
          throw new Error("Expected the seeded source to fail the real compiler");
        }
        const protectedPaths = [selected.unit + "/package.json", selected.unit + "/index.test.ts"];
        const protectedBefore = await oracle.unitRepair.readSource(baseline.revision, protectedPaths);
      `,
    }, runId)}
      const verification = await verifyUnitRepairOutcome(oracle, baseline, protectedPaths, protectedBefore);
      utilityValue = {
        teacher: utilityValue, world: {contextId: selected.contextId, unit: selected.unit, before: baseline.revision,
          after: verification.evidence.revision, baseline: baseline.build.diagnostics},
        verification,
      };
    `) as UnitRepairTeacherResult;
  }

  @rpc({website:{kind:"closed",reason:"Run an authored owned-worker workflow with a private persisted-state and cleanup oracle."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runOwnedOperationsTeacher(input:OwnedOperationsInput):Promise<OwnedOperationsResult> {
    const selected=ownedOperationsInputSchema.parse(input);
    return await this.runHarnessUtility("teacher",runId=>ownedOperationsTeacherCode(selected,runId)) as OwnedOperationsResult;
  }

  @rpc({website:{kind:"closed",reason:"Verify a held release dossier using live worker and VCS readbacks."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyHeldReleaseDossier(input:OwnedDossierQualificationInput):Promise<Omit<OwnedOperationsResult,"teacher">> {
    const selected=ownedDossierQualificationInput.parse(input);
    return await this.runHarnessUtility("teacher",qualifyHeldReleaseDossierCode(selected)) as Omit<OwnedOperationsResult,"teacher">;
  }

  @rpc({website:{kind:"closed",reason:"Runs the authored content-project workflow in one owned context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runContentProjectTeacher(input:ContentProjectTeacherInput):Promise<ContentProjectResult> {
    const selected=contentProjectTeacherInputSchema.parse(input);
    return await this.runHarnessUtility("teacher",runId=>`${authoredTeacherCode({
      executorModel:selected.executorModel,skill: "deliverProject",serviceNames:["projectWorkspace","projectWorkspaceEdit"],request:selected.request,
      bindingCode:`
        import {vcs,contextId as actualContextId} from "@workspace/runtime";
        import {prepareProjects} from "@workspace-skills/workspace-dev";
        import {createProjectDelivery} from "@workspace/natlang-services";
        import {verifyContentProject} from "@workspace-skills/system-testing/content-project-oracle";
        const selected=${JSON.stringify(selected)};
        if(actualContextId!==selected.contextId)throw new Error("Content teacher belongs to another context");
        const before=await vcs.status({contextId:selected.contextId});
        if(!before.clean)throw new Error("Content teacher requires a clean owned context");
        const privateRequest=structuredClone(selected.request);
        const assignedService=createProjectDelivery({contextId:actualContextId,vcs,prepareProjects},selected);
        if((await assignedService.observe()).repositoryId)throw new Error("Content fixture assigned repository is not fresh");
      `,
    },runId)}
      const verification=await verifyContentProject(vcs,{contextId:selected.contextId,repoPath:"projects/"+selected.name,request:privateRequest,before});
      const after=await vcs.status({contextId:selected.contextId});
      utilityValue={teacher:utilityValue,world:{kind:"content-project",contextId:selected.contextId,repoPath:"projects/"+selected.name,before:JSON.stringify(before.workingHead),after:JSON.stringify(after.workingHead),request:privateRequest},verification};
    `) as ContentProjectResult;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the content structural verifier using actual owned product state without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runContentProjectReference(input:ContentProjectInput,variant:"reference"|"negative") {
    const selected=contentProjectInputSchema.parse(input);
    if(variant!=="reference"&&variant!=="negative")throw new Error("Unknown content verifier candidate");
    return await this.runHarnessUtility("teacher",`
      import {vcs,contextId as actualContextId} from "@workspace/runtime";
      import {prepareProjects} from "@workspace-skills/workspace-dev";
      import {runContentProjectReference} from "@workspace-skills/system-testing/content-project-reference";
      const selected=${JSON.stringify(selected)};
      if(actualContextId!==selected.contextId)throw new Error("Content reference belongs to another context");
      const utilityValue=await runContentProjectReference({contextId:actualContextId,vcs,prepareProjects},selected,${JSON.stringify(variant)});
    `) as Awaited<ReturnType<ContentProjectReceiver["runContentProjectReference"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Runs one managed corpus world in its owned context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runScratchHandoffTeacher(input: ScratchHandoffTeacherInput): ReturnType<ScratchHandoffReceiver["runScratchHandoffTeacher"]> {
    const selected = scratchHandoffTeacherInputSchema.parse(input);
    const world = managedScratchWorlds.find((item) => item.id === selected.caseId);
    if (!world) throw new Error("Unknown scratch handoff case");
    return await this.runHarnessUtility("teacher", runId => {
      const work = {kind:"domain" as const,domain:"scratchHandoff",operation:"assembleHandoff",input:{goal:world.goal}};
      const captured = domainTeacherCode({executorModel:selected.executorModel,work,inputCode:"seeded.request",bindingCode:`
        import {fs,vcs,rpc,contextId as actualContextId} from "@workspace/runtime";
        import {bindManagedScratchHandoff,seedScratchHandoff,verifyManagedScratchHandoff} from "@workspace-skills/system-testing/scratch-handoff-managed";
        const selected=${JSON.stringify(selected)};
        if(actualContextId!==selected.contextId) throw new Error("Scratch handoff belongs to another context");
        const seeded=await seedScratchHandoff(fs,vcs,selected.caseId);
        const assignedServices=bindManagedScratchHandoff(fs,rpc,seeded.request);
      `},runId);
      return `${captured}
        const verification=await verifyManagedScratchHandoff(fs,vcs,rpc,seeded,utilityValue.report);
        utilityValue={teacher:utilityValue,world:{contextId:actualContextId,caseId:selected.caseId},verification};
      `;
    }) as Awaited<ReturnType<ScratchHandoffReceiver["runScratchHandoffTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the real scratch filesystem verifier without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyScratchHandoff(input: ScratchHandoffInput, negative: boolean): ReturnType<ScratchHandoffReceiver["qualifyScratchHandoff"]> {
    const selected=scratchHandoffInputSchema.parse(input);
    return await this.runHarnessUtility("teacher",`
      import {fs,vcs,rpc,contextId as actualContextId} from "@workspace/runtime";
      import {qualifyManagedScratchHandoff} from "@workspace-skills/system-testing/scratch-handoff-managed";
      const selected=${JSON.stringify(selected)};
      if(actualContextId!==selected.contextId) throw new Error("Scratch qualification belongs to another context");
      const utilityValue=await qualifyManagedScratchHandoff(fs,vcs,rpc,selected.caseId,${JSON.stringify(negative)});
    `) as Awaited<ReturnType<ScratchHandoffReceiver["qualifyScratchHandoff"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Runs a composed integration and handoff in an owned workspace."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runIntegrationHandoffTeacher(input: {caseId:string;executorModel:string}): ReturnType<IntegrationHandoffReceiver["runIntegrationHandoffTeacher"]> {
    const world = this.integrationFixtureWorld();
    return await this.runHarnessUtility("teacher",runId=>`${composedTeacherCode({
      executorModel:input.executorModel,
      workflowRequest:{goal:"Integrate then create a scratch handoff",work:[
        {kind:"integrateWorkspace",input:{goal:"Integrate assigned changes"}},
        {kind:"domain",domain:"scratchHandoff",operation:"assembleHandoff",input:{goal:"Handoff verified state"}},
      ]},
      requiredOrder:["integrateWorkspace","assembleHandoff"],
      requestCode:"assignment.request",
      bindingCode:`
        import {fs,vcs,rpc,contextId as actualContextId} from "@workspace/runtime";
        import {prepareIntegrationHandoff,verifyIntegrationHandoff} from "@workspace-skills/system-testing/integration-handoff-managed";
        const world=${JSON.stringify(world)}, caseId=${JSON.stringify(input.caseId)};
        if(actualContextId!==world.fixture.contextId) throw new Error("Integration handoff belongs to another context");
        const ports={fs,vcs,rpc};
        const assignment=await prepareIntegrationHandoff(ports,world,caseId);
        const assignedServices=assignment.services;
      `,
    },runId)}
      const verification=await verifyIntegrationHandoff(ports,world,assignment,utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,caseId,verification};
    `) as Awaited<ReturnType<IntegrationHandoffReceiver["runIntegrationHandoffTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the live integration and handoff dependency without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyIntegrationHandoff(caseId: string): ReturnType<IntegrationHandoffReceiver["qualifyIntegrationHandoff"]> {
    const world = this.integrationFixtureWorld();
    return await this.runHarnessUtility("teacher",`
      import {fs,vcs,rpc,contextId as actualContextId} from "@workspace/runtime";
      import {qualifyIntegrationHandoff} from "@workspace-skills/system-testing/integration-handoff-managed";
      const world=${JSON.stringify(world)};
      if(actualContextId!==world.fixture.contextId) throw new Error("Integration qualification belongs to another context");
      const utilityValue=await qualifyIntegrationHandoff({fs,vcs,rpc},world,${JSON.stringify(caseId)});
    `) as Awaited<ReturnType<IntegrationHandoffReceiver["qualifyIntegrationHandoff"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Runs one test-owned, manual-only automation lifecycle assignment."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedAutomationTeacher(input:{caseId:string;contextId:string;executorModel:string}): ReturnType<ManagedAutomationReceiver["runManagedAutomationTeacher"]> {
    const owner = await this.integrationFixtureIdentity();
    if (owner.contextId !== input.contextId) throw new Error("Automation case belongs to another context");
    const seed = await seedManagedAutomation(this.rpc,input.caseId);
    try {
      return await this.runHarnessUtility("teacher",runId => `${domainTeacherCode({
        executorModel:input.executorModel,
        work:{kind:"domain",domain:"automationLifecycle",operation:"reconcileAutomation",input:{goal:"Reconcile the assigned mission"}},
        inputCode:"prepared.request",bindingCode:`
          import {rpc,contextId as actualContextId} from "@workspace/runtime";
          import {prepareManagedAutomation,verifyManagedAutomation} from "@workspace-skills/system-testing/automation-lifecycle-managed";
          if(actualContextId!==${JSON.stringify(input.contextId)}) throw new Error("Automation case belongs to another context");
          const prepared=await prepareManagedAutomation(rpc,${JSON.stringify(seed)});
          const assignedServices=prepared.services;
        `,
      },runId)}
        const verification=await verifyManagedAutomation(prepared,utilityValue.report);
        utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
      `) as Awaited<ReturnType<ManagedAutomationReceiver["runManagedAutomationTeacher"]>>;
    } finally {await pauseManagedAutomationFixture(this.rpc,seed);}
  }

  @rpc({website:{kind:"closed",reason:"Qualifies owner-scoped automation scheduling without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedAutomation(input:{caseId:string;contextId:string}): ReturnType<ManagedAutomationReceiver["qualifyManagedAutomation"]> {
    const owner = await this.integrationFixtureIdentity();
    if (owner.contextId !== input.contextId) throw new Error("Automation qualification belongs to another context");
    const seed = await seedManagedAutomation(this.rpc,input.caseId);
    try {
      return await this.runHarnessUtility("teacher",`
        import {rpc,contextId as actualContextId} from "@workspace/runtime";
        import {qualifyManagedAutomation} from "@workspace-skills/system-testing/automation-lifecycle-managed";
        if(actualContextId!==${JSON.stringify(input.contextId)}) throw new Error("Automation qualification belongs to another context");
        const utilityValue=await qualifyManagedAutomation(rpc,${JSON.stringify(seed)});
      `) as Awaited<ReturnType<ManagedAutomationReceiver["qualifyManagedAutomation"]>>;
    } finally {await pauseManagedAutomationFixture(this.rpc,seed);}
  }

  @rpc({website:{kind:"closed",reason:"Reviews an assigned native mission and rechecks its current state."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runAutomationPlanningTeacher(input:{caseId:string;contextId:string;executorModel:string}): ReturnType<ManagedAutomationReceiver["runAutomationPlanningTeacher"]> {
    const owner = await this.integrationFixtureIdentity();
    if (owner.contextId !== input.contextId) throw new Error("Automation review belongs to another context");
    const seed = await seedManagedAutomation(this.rpc, input.caseId, true);
    try {
      return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
        executorModel: input.executorModel,
        work: { kind: "domain", domain: "automation", operation: "reviewAssignedAutomation", input: { goal: "Review the assigned automation" } },
        inputCode: "prepared.request",
        bindingCode: this.managedAutomationPlanningBindings(input.contextId, seed),
      }, runId)}
        const verification=await prepared.verify(utilityValue.report);
        utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
      `) as Awaited<ReturnType<ManagedAutomationReceiver["runAutomationPlanningTeacher"]>>;
    } finally {
      await pauseManagedAutomationFixture(this.rpc, seed);
    }
  }

  @rpc({website:{kind:"closed",reason:"Verifies live planning snapshots and a real definition edit without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyAutomationPlanning(input:{caseId:string;contextId:string}): ReturnType<ManagedAutomationReceiver["qualifyAutomationPlanning"]> {
    const owner = await this.integrationFixtureIdentity();
    if (owner.contextId !== input.contextId) throw new Error("Automation review belongs to another context");
    const seed = await seedManagedAutomation(this.rpc, input.caseId, true);
    try {
      return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
        [{ domain: "automation", operation: "reviewAssignedAutomation" }],
        this.managedAutomationPlanningBindings(input.contextId, seed),
      )) as Awaited<ReturnType<ManagedAutomationReceiver["qualifyAutomationPlanning"]>>;
    } finally {
      await pauseManagedAutomationFixture(this.rpc, seed);
    }
  }

  private managedAutomationPlanningBindings(contextId:string, seed: Awaited<ReturnType<typeof seedManagedAutomation>>): string {
    return `
      import {rpc,contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedAutomationPlanning} from "@workspace-skills/system-testing/automation-lifecycle-managed";
      if(actualContextId!==${JSON.stringify(contextId)}) throw new Error("Automation review belongs to another context");
      const prepared=await prepareManagedAutomationPlanning(rpc,${JSON.stringify(seed)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews an owned portable build and rendered panel without publication."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedPublicationTeacher(input: PublicationInput & {executorModel:string}): ReturnType<ManagedPublicationReceiver["runManagedPublicationTeacher"]> {
    return await this.runHarnessUtility("teacher",runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"publication",operation:"preflightPublication",input:{goal:input.goal}},
      inputCode:"prepared.request",bindingCode:`
        import {rpc,vcs,panelTree,contextId as actualContextId} from "@workspace/runtime";
        import {prepareManagedPublication,verifyManagedPublication} from "@workspace-skills/system-testing/publication-preflight-managed";
        const input=${JSON.stringify(input)};
        if(actualContextId!==input.contextId) throw new Error("Publication preflight belongs to another context");
        const panel=panelTree.get(input.panelId);
        const prepared=await prepareManagedPublication(rpc,vcs,panel,input);
        const assignedServices={websiteReadback:prepared.service};
      `,
    },runId)}
      const verification=await verifyManagedPublication(rpc,vcs,panel,prepared,utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedPublicationReceiver["runManagedPublicationTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks real website packaging and panel reception without a model or deployment."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedPublication(input: PublicationInput): ReturnType<ManagedPublicationReceiver["qualifyManagedPublication"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{ domain: "publication", operation: "preflightPublication" }], `
      import {rpc,vcs,panelTree,contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedPublication,qualifyManagedPublication} from "@workspace-skills/system-testing/publication-preflight-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Publication qualification belongs to another context");
      const panel=panelTree.get(input.panelId);
      const review=await prepareManagedPublication(rpc,vcs,panel,input);
      const assignedServices={websiteReadback:review.service};
      const prepared={qualify:()=>qualifyManagedPublication(rpc,vcs,panel,review)};
    `)) as Awaited<ReturnType<ManagedPublicationReceiver["qualifyManagedPublication"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Runs one local PDF extraction assignment in its owned context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedPdfTeacher(input: PdfIntakeInput & {executorModel:string}): ReturnType<ManagedPdfReceiver["runManagedPdfTeacher"]> {
    return await this.runHarnessUtility("teacher",runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"pdfIntake",operation:"extractPdfEvidence",input:{goal:"Extract assigned PDF evidence"}},
      inputCode:"prepared.request",bindingCode:`
        import {fs,rpc,vcs,extensions,contextId as actualContextId} from "@workspace/runtime";
        import {prepareManagedPdf,verifyManagedPdf} from "@workspace-skills/system-testing/pdf-intake-managed";
        const input=${JSON.stringify(input)};
        if(actualContextId!==input.contextId) throw new Error("PDF intake belongs to another context");
        const ports={fs,rpc,vcs,extensions};
        const prepared=await prepareManagedPdf(ports,input.caseId);
        const assignedServices=prepared.bindings;
      `,
    },runId)}
      const verification=await verifyManagedPdf(ports,prepared,utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedPdfReceiver["runManagedPdfTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies bundled PDF extraction against owned PDF bytes without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedPdf(input: PdfIntakeInput): ReturnType<ManagedPdfReceiver["qualifyManagedPdf"]> {
    return await this.runHarnessUtility("teacher",`
      import {fs,rpc,vcs,extensions,contextId as actualContextId} from "@workspace/runtime";
      import {qualifyManagedPdf} from "@workspace-skills/system-testing/pdf-intake-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("PDF qualification belongs to another context");
      const utilityValue=await qualifyManagedPdf({fs,rpc,vcs,extensions},input.caseId);
    `) as Awaited<ReturnType<ManagedPdfReceiver["qualifyManagedPdf"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Runs PDF intake followed by a scratch handoff in one owned context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedPdfHandoffTeacher(input: PdfIntakeInput & {executorModel:string}): ReturnType<ManagedPdfReceiver["runManagedPdfHandoffTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${composedTeacherCode({
      executorModel: input.executorModel,
      workflowRequest: { goal: "Carry verified PDF evidence into scratch", work: [
        { kind: "domain", domain: "pdfIntake", operation: "extractPdfEvidence", input: { goal: "Read the assigned PDF pages" } },
        { kind: "domain", domain: "scratchHandoff", operation: "assembleHandoff", input: { goal: "Hand over verified evidence" } },
      ] },
      requiredOrder: ["extractPdfEvidence", "assembleHandoff"],
      requestCode: "prepared.request",
      bindingCode: `
        import {fs,rpc,vcs,extensions,contextId as actualContextId} from "@workspace/runtime";
        import {prepareManagedPdfHandoff,verifyManagedPdfHandoff} from "@workspace-skills/system-testing/pdf-handoff-managed";
        const input=${JSON.stringify(input)};
        if(actualContextId!==input.contextId) throw new Error("PDF handoff belongs to another context");
        const ports={fs,rpc,vcs,extensions};
        const prepared=await prepareManagedPdfHandoff(ports,input.caseId);
        const assignedServices=prepared.services;
      `,
    }, runId)}
      const verification=await verifyManagedPdfHandoff(ports,prepared,utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedPdfReceiver["runManagedPdfHandoffTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies actual PDF page transfer into an owned scratch artifact without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedPdfHandoff(input: PdfIntakeInput): ReturnType<ManagedPdfReceiver["qualifyManagedPdfHandoff"]> {
    return await this.runHarnessUtility("teacher", `
      import {fs,rpc,vcs,extensions,contextId as actualContextId} from "@workspace/runtime";
      import {qualifyManagedPdfHandoff} from "@workspace-skills/system-testing/pdf-handoff-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("PDF handoff qualification belongs to another context");
      const utilityValue=await qualifyManagedPdfHandoff({fs,rpc,vcs,extensions},input.caseId);
    `) as Awaited<ReturnType<ManagedPdfReceiver["qualifyManagedPdfHandoff"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the assigned live panel diagnostics."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedPanelHealthTeacher(input: PanelHealthInput & {executorModel:string}): ReturnType<ManagedPanelHealthReceiver["runManagedPanelHealthTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      ${this.panelHealthBindings(input)}
      ${domainTeacherCode({
        executorModel: input.executorModel,
        work: {kind:"domain",domain:"panelHealth",operation:"reviewPanelHealth",input:{goal:"Review the assigned panel's health"}},
        inputCode: "prepared.request",
        bindingCode: "const assignedServices=prepared.services;",
      },runId)}
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedPanelHealthReceiver["runManagedPanelHealthTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live DOM and console observations without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedPanelHealth(input: PanelHealthInput): ReturnType<ManagedPanelHealthReceiver["qualifyManagedPanelHealth"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.panelHealthBindings(input)}
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedPanelHealthReceiver["qualifyManagedPanelHealth"]>>;
  }

  private panelHealthBindings(input: PanelHealthInput): string {
    return `
      import {panelTree,contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedPanelHealth} from "@workspace-skills/system-testing/panel-health-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Panel health belongs to another context");
      const prepared=await prepareManagedPanelHealth(panelTree.get(input.panelId),actualContextId,input.source,input.caseId);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Prepares a response for the assigned managed preview."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedPresentationTeacher(input: PresentationTeacherInput): ReturnType<ManagedPresentationReceiver["runManagedPresentationTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => domainTeacherCode({
      executorModel: input.executorModel,
      work:{kind:"domain",domain:"visualize",operation:"preparePresentation",input:input.request},
      inputCode:"assignedRequest",
      bindingCode:`
        import {contextId as actualContextId} from "@workspace/runtime";
        if(actualContextId!==${JSON.stringify(input.contextId)}) throw new Error("Presentation belongs to another context");
        const assignedRequest=${JSON.stringify(input.request)};
        const assignedServices={};
      `,
    }, runId)) as Awaited<ReturnType<ManagedPresentationReceiver["runManagedPresentationTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Reviews real Testkit cleanup in an owned fixture context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedTestkitCleanupTeacher(input: TestkitCleanupInput & {executorModel:string}): ReturnType<ManagedTestkitCleanupReceiver["runManagedTestkitCleanupTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"sessionTest",operation:"reviewLiveCleanup",input:{goal:"Review live Testkit cleanup"}},
      inputCode:"prepared.request",
      bindingCode:this.testkitCleanupBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedTestkitCleanupReceiver["runManagedTestkitCleanupTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies real Testkit cleanup without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedTestkitCleanup(input: TestkitCleanupInput): ReturnType<ManagedTestkitCleanupReceiver["qualifyManagedTestkitCleanup"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.testkitCleanupBindings(input)}
      if(prepared.describesProgram) {
        const program=await natlang.describe("skills/vibestudio-workflows/runWorkflow.nl");
        for(const name of ["reviewLiveCleanup", "reviewSessionTest", "reviewRelease", "checkTestkitRelease"]) {
          if(!program.functions.some((fn)=>fn.name===name)) throw new Error("The shared Natlang workflow is missing "+name);
        }
      }
      let rejectedForeignReceipt=false;
      try {await assignedServices.testkitCleanup.inspect("foreign-receipt");}
      catch(error) {rejectedForeignReceipt=error instanceof Error && error.message.includes("assigned cleanup receipt once");}
      await assignedServices.testkitCleanup.inspect(prepared.request.receipt);
      const utilityValue={verified:prepared.verify(prepared.reference),rejectedForeignReceipt};
    `) as Awaited<ReturnType<ManagedTestkitCleanupReceiver["qualifyManagedTestkitCleanup"]>>;
  }

  private testkitCleanupBindings(input: TestkitCleanupInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareTestkitCleanup} from "@workspace-skills/system-testing/testkit-cleanup-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Testkit cleanup belongs to a different context");
      const prepared=await prepareTestkitCleanup(input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the assigned headless session and exact replay evidence."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedSessionReplayTeacher(input: SessionReplayInput & {executorModel:string}): ReturnType<ManagedSessionReplayReceiver["runManagedSessionReplayTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"sessionTest",operation:"reviewLiveReplay",input:{goal:"Review reconnect evidence"}},
      inputCode:"prepared.request",
      bindingCode:this.sessionReplayBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedSessionReplayReceiver["runManagedSessionReplayTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the assigned durable replay without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedSessionReplay(input: SessionReplayInput): ReturnType<ManagedSessionReplayReceiver["qualifyManagedSessionReplay"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.sessionReplayBindings(input)}
      if(prepared.describesProgram) {
        const program=await natlang.describe("skills/vibestudio-workflows/runWorkflow.nl");
        for(const name of ["reviewLiveReplay", "reviewSessionTest", "checkContinuation"]) {
          if(!program.functions.some((fn)=>fn.name===name)) throw new Error("The shared Natlang workflow is missing "+name);
        }
      }
      let rejectedForeignReceipt=false;
      try {await assignedServices.sessionReplay.inspect("foreign-receipt");}
      catch(error) {rejectedForeignReceipt=error instanceof Error && error.message.includes("assigned checkpoints");}
      for(const receipt of prepared.request.checkpoints) await assignedServices.sessionReplay.inspect(receipt);
      const utilityValue={verified:prepared.verify(prepared.reference()),rejectedForeignReceipt};
    `) as Awaited<ReturnType<ManagedSessionReplayReceiver["qualifyManagedSessionReplay"]>>;
  }

  private sessionReplayBindings(input: SessionReplayInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {bindSessionReplay} from "@workspace-skills/system-testing/session-replay-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Session replay belongs to a different context");
      const prepared=bindSessionReplay(actualContextId,input.caseId,input.evidence);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews only the assigned compiler snapshots in this owned context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedAuthoringTeacher(input: AuthoringInput & {executorModel:string}): ReturnType<ManagedAuthoringReceiver["runManagedAuthoringTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"natlangAuthoring",operation:"reviewProgram",input:{goal:"Review the assigned Natlang source"}},
      inputCode:"prepared.request",
      bindingCode:`
        import {fs,vcs,contextId as actualContextId} from "@workspace/runtime";
        import {prepareManagedAuthoring,verifyManagedAuthoring} from "@workspace-skills/system-testing/authoring-managed";
        const input=${JSON.stringify(input)};
        if(actualContextId!==input.contextId) throw new Error("Authoring review belongs to another context");
        const ports={fs,vcs,describe:(path)=>natlang.describe(path)};
        const prepared=await prepareManagedAuthoring(ports,input.caseId);
        const assignedServices={authoringCompiler:prepared.service};
      `,
    }, runId)}
      const verification=await verifyManagedAuthoring(ports,prepared,utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedAuthoringReceiver["runManagedAuthoringTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies real compiler readbacks in an owned context without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedAuthoring(input: AuthoringInput): ReturnType<ManagedAuthoringReceiver["qualifyManagedAuthoring"]> {
    return await this.runHarnessUtility("teacher",`
      import {fs,vcs,contextId as actualContextId} from "@workspace/runtime";
      import {qualifyManagedAuthoring} from "@workspace-skills/system-testing/authoring-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Authoring qualification belongs to another context");
      const utilityValue=await qualifyManagedAuthoring({fs,vcs,describe:(path)=>natlang.describe(path)},input.caseId);
    `) as Awaited<ReturnType<ManagedAuthoringReceiver["qualifyManagedAuthoring"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Verifies one assigned workspace memory decision at its committed source."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedMemoryTeacher(input: VerifiedMemoryInput & {executorModel:string}): ReturnType<VerifiedMemoryReceiver["runManagedMemoryTeacher"]> {
    const operation = managedMemoryOperation(input.caseId);
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"verifiedMemory",operation,input:{goal:"Verify the assigned historical decision"}},
      inputCode:"prepared.comparisonRequest ?? prepared.request",
      bindingCode:`
        import {memory,vcs,blobstore,contextId as actualContextId} from "@workspace/runtime";
        import {prepareManagedMemory,verifyManagedMemory} from "@workspace-skills/system-testing/verified-memory-managed";
        const input=${JSON.stringify(input)};
        if(actualContextId!==input.contextId) throw new Error("Memory review belongs to another context");
        await natlang.describe(${JSON.stringify(`skills/memory/verifiedRecall/${operation}.nl`)});
        const ports={memory,vcs,blobstore};
        const prepared=await prepareManagedMemory(ports,actualContextId,input.caseId);
        const assignedServices=prepared.services;
      `,
    }, runId)}
      const verification=await verifyManagedMemory(ports,prepared,utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<VerifiedMemoryReceiver["runManagedMemoryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies workspace recall and VCS readback in an owned context without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedMemory(input: VerifiedMemoryInput): ReturnType<VerifiedMemoryReceiver["qualifyManagedMemory"]> {
    const operation = managedMemoryOperation(input.caseId);
    return await this.runHarnessUtility("teacher",`
      import {memory,vcs,blobstore,contextId as actualContextId} from "@workspace/runtime";
      import {qualifyManagedMemory} from "@workspace-skills/system-testing/verified-memory-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Memory qualification belongs to another context");
      await natlang.describe(${JSON.stringify(`skills/memory/verifiedRecall/${operation}.nl`)});
      const utilityValue=await qualifyManagedMemory({memory,vcs,blobstore},actualContextId,input.caseId);
    `) as Awaited<ReturnType<VerifiedMemoryReceiver["qualifyManagedMemory"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Plans onboarding using only the actual assigned owner receipt."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedSetupTeacher(input: SetupInput & {executorModel:string}): ReturnType<ManagedSetupReceiver["runManagedSetupTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"onboarding",operation:"planSetup",input:{goal:"Plan the assigned installed setup"}},
      inputCode:"prepared.request",
      bindingCode:`
        import {vcs,contextId as actualContextId} from "@workspace/runtime";
        import {inspectInstalledSetup} from "@workspace-skills/onboarding/prepare-installed-setup";
        import {prepareManagedSetup,verifyManagedSetup} from "@workspace-skills/system-testing/onboarding-managed";
        const input=${JSON.stringify(input)};
        if(actualContextId!==input.contextId) throw new Error("Setup plan belongs to another context");
        const ports={vcs,observe:inspectInstalledSetup};
        const prepared=await prepareManagedSetup(ports,actualContextId,input.caseId);
        const assignedServices={onboardingRead:prepared.service};
      `,
    }, runId)}
      const verification=await verifyManagedSetup(ports,prepared,utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedSetupReceiver["runManagedSetupTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies installed onboarding receipts and catalog routes without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedSetup(input: SetupInput): ReturnType<ManagedSetupReceiver["qualifyManagedSetup"]> {
    return await this.runHarnessUtility("teacher",`
      import {vcs,contextId as actualContextId} from "@workspace/runtime";
      import {inspectInstalledSetup} from "@workspace-skills/onboarding/prepare-installed-setup";
      import {qualifyManagedSetup} from "@workspace-skills/system-testing/onboarding-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Setup qualification belongs to another context");
      await natlang.describe("skills/onboarding/prepareSetup/planSetup.nl");
      const utilityValue=await qualifyManagedSetup({vcs,observe:inspectInstalledSetup},actualContextId,input.caseId);
    `) as Awaited<ReturnType<ManagedSetupReceiver["qualifyManagedSetup"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Reconciles the assigned live channel roster."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedChannelRosterTeacher(input: ChannelRosterInput & {executorModel:string}): ReturnType<ManagedChannelRosterReceiver["runManagedChannelRosterTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      ${this.channelRosterBindings(input)}
      ${domainTeacherCode({
        executorModel: input.executorModel,
        work: {kind:"domain",domain:"channelAgent",operation:"runRosterPlan",input:{goal:"Reconcile the assigned channels"}},
        inputCode: "prepared.request",
        bindingCode: "const assignedServices=prepared.services;",
      },runId)}
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedChannelRosterReceiver["runManagedChannelRosterTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies real channel membership and conflict handling without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedChannelRoster(input: ChannelRosterInput): ReturnType<ManagedChannelRosterReceiver["qualifyManagedChannelRoster"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.channelRosterBindings(input)}
      await natlang.describe("skills/agents/channel-membership/runRosterPlan.nl");
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedChannelRosterReceiver["qualifyManagedChannelRoster"]>>;
  }

  private channelRosterBindings(input: ChannelRosterInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedChannelRoster} from "@workspace-skills/system-testing/channel-roster-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Channel roster belongs to another context");
      const prepared=await prepareManagedChannelRoster(input.caseId);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reconciles assigned planning records in an owned Mission Control store."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedMissionPlanningTeacher(input: MissionPlanningInput & {executorModel:string}): ReturnType<ManagedMissionPlanningReceiver["runManagedMissionPlanningTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      ${this.missionPlanningBindings(input)}
      ${domainTeacherCode({
        executorModel: input.executorModel,
        work: {kind:"domain",domain:"missionPlanning",operation:"reconcileMissionPlan",input:{goal:"Reconcile the assigned Mission Control plan"}},
        inputCode: "prepared.request",
        bindingCode: "const assignedServices=prepared.services;",
      },runId)}
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedMissionPlanningReceiver["runManagedMissionPlanningTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies revision-bound Mission Control changes without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedMissionPlanning(input: MissionPlanningInput): ReturnType<ManagedMissionPlanningReceiver["qualifyManagedMissionPlanning"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.missionPlanningBindings(input)}
      if (world.id===managedMissionPlanningWorlds[0]?.id)
        await natlang.describe("skills/mission-planning/reconcileMissionPlan.nl");
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedMissionPlanningReceiver["qualifyManagedMissionPlanning"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Reviews one owned live Mission Control card."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedMissionFacilityTeacher(input: MissionPlanningInput & {executorModel:string}): ReturnType<ManagedMissionPlanningReceiver["runManagedMissionFacilityTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"personalFacility",operation:"reviewPersonalFacility",input:{goal:"Review the assigned Mission Control card"}},
      inputCode:"prepared.request",
      bindingCode:this.missionFacilityBindings(input),
    },runId)}
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedMissionPlanningReceiver["runManagedMissionFacilityTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live card revision and prerequisite checks without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedMissionFacility(input: MissionPlanningInput): ReturnType<ManagedMissionPlanningReceiver["qualifyManagedMissionFacility"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"personalFacility",operation:"reviewPersonalFacility"}],this.missionFacilityBindings(input),
    )) as Awaited<ReturnType<ManagedMissionPlanningReceiver["qualifyManagedMissionFacility"]>>;
  }

  private missionFacilityBindings(input: MissionPlanningInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedMissionFacility} from "@workspace-skills/mission-planning-runtime/managed";
      import {missionFacilityWorlds} from "@workspace-skills/system-testing/mission-facility-worlds";
      const input=${JSON.stringify({contextId:input.contextId,caseId:input.caseId})};
      const world=missionFacilityWorlds.find(({id})=>id===input.caseId);
      if(!world || actualContextId!==input.contextId) throw new Error("Unknown Mission Control review assignment");
      const prepared=await prepareManagedMissionFacility(world);
      const assignedServices=prepared.services;
    `;
  }

  private missionPlanningBindings(input: MissionPlanningInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedMissionPlanning} from "@workspace-skills/mission-planning-runtime/managed";
      import {missionProjects,missionCards,managedMissionPlanningWorlds} from "@workspace-skills/system-testing/mission-planning-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Mission planning belongs to another context");
      const world=managedMissionPlanningWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown mission planning assignment");
      const prepared=await prepareManagedMissionPlanning(world,{projects:missionProjects,cards:missionCards});
    `;
  }

  @rpc({website:{kind:"closed",reason:"Executes the owned browser-reference handoff."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedBrowserHandoffTeacher(input: BrowserHandoffInput & {executorModel:string}): ReturnType<ManagedBrowserHandoffReceiver["runManagedBrowserHandoffTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      ${this.browserHandoffBindings(input)}
      let teacher, verification;
      try {
        ${composedTeacherCode({
          executorModel: input.executorModel,
          workflowRequest: {goal:"Prove and hand off the assigned browser bookmark",work:[
            {kind:"domain",domain:"browserLibrary",operation:"curateBrowserLibrary",input:{goal:"Curate the assigned browser library"}},
            {kind:"domain",domain:"collection",operation:"organizeCollection",input:{goal:"Persist the verified reference on the assigned panel"}},
          ]},
          requestCode: "prepared.workflowRequest",
          requiredOrder: ["curateBrowserLibrary","organizeCollection"],
          bindingCode: "const assignedServices=prepared.services;",
        }, runId)}
        teacher=utilityValue;
        verification=await prepared.verify(teacher.report);
      } finally { await prepared.close(); }
      const utilityValue={teacher,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedBrowserHandoffReceiver["runManagedBrowserHandoffTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the browser-to-collection dependency without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedBrowserHandoff(input: BrowserHandoffInput): ReturnType<ManagedBrowserHandoffReceiver["qualifyManagedBrowserHandoff"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.browserHandoffBindings(input)}
      let utilityValue;
      try {
        if (assignment.id===managedBrowserHandoffWorlds[0]?.id)
          await natlang.describe("skills/vibestudio-workflows/runWorkflow.nl");
        utilityValue=await prepared.qualify();
      } finally { await prepared.close(); }
    `) as Awaited<ReturnType<ManagedBrowserHandoffReceiver["qualifyManagedBrowserHandoff"]>>;
  }

  private browserHandoffBindings(input: BrowserHandoffInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedBrowserHandoff} from "@workspace-skills/browser-handoff-runtime";
      import {folders,origin,seedBookmarks,seedVisits,managedBrowserLibraryWorlds} from "@workspace-skills/system-testing/browser-library-worlds";
      import {collectionRootTitle,collectionSeed} from "@workspace-skills/system-testing/collection-worlds";
      import {managedBrowserHandoffWorlds} from "@workspace-skills/system-testing/browser-handoff-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Browser handoff belongs to another context");
      const assignment=managedBrowserHandoffWorlds.find(({id})=>id===input.caseId);
      const library=managedBrowserLibraryWorlds.find(({id})=>id===assignment?.library);
      if(!assignment || !library) throw new Error("Unknown browser handoff assignment");
      const prepared=await prepareManagedBrowserHandoff({
        contextId:actualContextId,assignment,library,
        history:{folders,origin,bookmarks:seedBookmarks,visits:seedVisits},
        collectionRoot:collectionRootTitle,collectionSeed,
      });
    `;
  }

  @rpc({website:{kind:"closed",reason:"Curates test-owned browser references."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedBrowserLibraryTeacher(input: BrowserLibraryInput & {executorModel:string}): ReturnType<ManagedBrowserLibraryReceiver["runManagedBrowserLibraryTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      ${this.browserLibraryBindings(input)}
      let teacher, verification;
      try {
        ${domainTeacherCode({
          executorModel: input.executorModel,
          work: {kind:"domain",domain:"browserLibrary",operation:"curateBrowserLibrary",input:{goal:"Curate the assigned browser library"}},
          inputCode: "prepared.request",
          bindingCode: "const assignedServices=prepared.services;",
        }, runId)}
        teacher=utilityValue;
        verification=await prepared.verify(teacher.report);
      } finally { await prepared.close(); }
      const utilityValue={teacher,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedBrowserLibraryReceiver["runManagedBrowserLibraryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the real browser library without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedBrowserLibrary(input: BrowserLibraryInput): ReturnType<ManagedBrowserLibraryReceiver["qualifyManagedBrowserLibrary"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.browserLibraryBindings(input)}
      let utilityValue;
      try {
        await natlang.describe("skills/browser-library/curateBrowserLibrary.nl");
        const rejectsOutside=await prepared.rejectsOutside();
        const report=await prepared.reference();
        const verification=await prepared.verify(report);
        const altered={findings:report.findings.map(row=>({...row,evidence:["unrelated-observation"]}))};
        const rejectsWrongReceipt=!(await prepared.verify(altered)).passed;
        utilityValue={verification,rejectsOutside,rejectsWrongReceipt};
      } finally { await prepared.close(); }
    `) as Awaited<ReturnType<ManagedBrowserLibraryReceiver["qualifyManagedBrowserLibrary"]>>;
  }

  private browserLibraryBindings(input: BrowserLibraryInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedBrowserLibrary} from "@workspace-skills/browser-library-runtime/managed";
      import {folders,origin,seedBookmarks,seedVisits,managedBrowserLibraryWorlds} from "@workspace-skills/system-testing/browser-library-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Browser library belongs to another context");
      const world=managedBrowserLibraryWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown browser-library assignment");
      const prepared=await prepareManagedBrowserLibrary(actualContextId,world,{folders,origin,bookmarks:seedBookmarks,visits:seedVisits});
    `;
  }

  @rpc({website:{kind:"closed",reason:"Organizes one test-owned collection."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedCollectionTeacher(input: CollectionInput & {executorModel:string}): ReturnType<ManagedCollectionReceiver["runManagedCollectionTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      ${this.collectionBindings(input)}
      ${domainTeacherCode({
        executorModel: input.executorModel,
        work: {kind:"domain",domain:"collection",operation:"organizeCollection",input:{goal:"Organize the assigned collection"}},
        inputCode: "prepared.request",
        bindingCode: "const assignedServices=prepared.services;",
      }, runId)}
      const verification=await prepared.verify(utilityValue.report);
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification};
    `) as Awaited<ReturnType<ManagedCollectionReceiver["runManagedCollectionTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live collection effects without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedCollection(input: CollectionInput): ReturnType<ManagedCollectionReceiver["qualifyManagedCollection"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.collectionBindings(input)}
      await natlang.describe("skills/collection-conductor/organizeCollection.nl");
      const rejectsOutside=await prepared.rejectsOutside();
      const report=await prepared.reference();
      const verification=await prepared.verify(report);
      const altered={results:report.results.map(row=>({...row,evidence:["unrelated-observation"]}))};
      const rejectsWrongReceipt=!(await prepared.verify(altered)).passed;
      const utilityValue={verification,rejectsOutside,rejectsWrongReceipt};
    `) as Awaited<ReturnType<ManagedCollectionReceiver["qualifyManagedCollection"]>>;
  }

  private collectionBindings(input: CollectionInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedCollection} from "@workspace-skills/collection-conductor-runtime/managed";
      import {collectionRootTitle,collectionSeed,managedCollectionWorlds} from "@workspace-skills/system-testing/collection-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Collection belongs to another context");
      const world=managedCollectionWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown collection assignment");
      const prepared=await prepareManagedCollection(actualContextId,world,collectionRootTitle,collectionSeed);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Exercises the owned live Tendril board."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedTendrilTeacher(input: TendrilInput & {executorModel:string}): ReturnType<ManagedTendrilReceiver["runManagedTendrilTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      ${this.tendrilBindings(input)}
      let teacher;
      try {
        ${domainTeacherCode({
          executorModel: input.executorModel,
          work: {kind:"domain",domain:"tendril",operation:"runTendril",input:{goal:"Operate the assigned Tendril board"}},
          inputCode: "prepared.request",
          bindingCode: "const assignedServices=prepared.services;",
        }, runId)}
        teacher=utilityValue;
      } finally { await prepared.close(); }
      const utilityValue={teacher,contextId:actualContextId,verification:prepared.verify(teacher.report)};
    `) as Awaited<ReturnType<ManagedTendrilReceiver["runManagedTendrilTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Verifies the actual Tendril state and panel without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedTendril(input: TendrilInput): ReturnType<ManagedTendrilReceiver["qualifyManagedTendril"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.tendrilBindings(input)}
      let utilityValue;
      try {
        await natlang.describe("skills/tendrils/workflow/runTendril.nl");
        const report=await prepared.reference();
        const verification=prepared.verify(report);
        const altered={...report,presentation:{...report.presentation,slotId:"different-panel"}};
        utilityValue={verification,rejectsOtherSlot:!prepared.verify(altered).passed};
      } finally { await prepared.close(); }
    `) as Awaited<ReturnType<ManagedTendrilReceiver["qualifyManagedTendril"]>>;
  }

  private tendrilBindings(input: TendrilInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedTendril} from "@workspace-skills/system-testing/tendril-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Tendril belongs to another context");
      const prepared=prepareManagedTendril(input);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Verifies the assigned release checklist through a live workspace PTY."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedChecklistTeacher(input: ChecklistInput & {executorModel:string}): ReturnType<ManagedChecklistReceiver["runManagedChecklistTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedChecklist,verifyManagedChecklist} from "@workspace-skills/system-testing/checklist-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Checklist belongs to another context");
      const prepared=prepareManagedChecklist(input.caseId);
      let teacher, retired;
      try {
        ${domainTeacherCode({
          executorModel:input.executorModel,
          work:{kind:"domain",domain:"terminalChecklist",operation:"verifyChecklist",input:{goal:"Verify the assigned release checklist"}},
          inputCode:"prepared.request",
          bindingCode:"const assignedServices=prepared.services;",
        }, runId)}
        teacher=utilityValue;
      } finally {
        retired=await prepared.close();
      }
      const utilityValue={teacher,contextId:actualContextId,verification:verifyManagedChecklist(prepared,teacher.report,retired)};
    `) as Awaited<ReturnType<ManagedChecklistReceiver["runManagedChecklistTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live release checklist screens and restart without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedChecklist(input: ChecklistInput): ReturnType<ManagedChecklistReceiver["qualifyManagedChecklist"]> {
    return await this.runHarnessUtility("teacher",`
      import {contextId as actualContextId} from "@workspace/runtime";
      import {qualifyManagedChecklist} from "@workspace-skills/system-testing/checklist-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Checklist qualification belongs to another context");
      await natlang.describe("skills/terminal-apps/checklist/verifyChecklist.nl");
      const utilityValue=await qualifyManagedChecklist(input.caseId);
    `) as Awaited<ReturnType<ManagedChecklistReceiver["qualifyManagedChecklist"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Observes the installed garden service in the test-owned world."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async inspectOwnedGarden(input: Parameters<ManagedGrimoireReceiver["inspectOwnedGarden"]>[0]) {
    return await this.runHarnessUtility("teacher", `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {observeGarden} from "@workspace-skills/examples-review-fixtures/live-garden";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Garden belongs to another context");
      const utilityValue=await observeGarden(input.garden,"before");
    `);
  }

  @rpc({website:{kind:"closed",reason:"Reviews assigned Grimoire claims against the installed garden worker."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedGrimoireTeacher(input: GardenReviewInput & {executorModel:string}): ReturnType<ManagedGrimoireReceiver["runManagedGrimoireTeacher"]> {
    if (input.portfolioCaseId) {
      return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
        executorModel:input.executorModel,
        work:{kind:"domain",domain:"examples",operation:"reviewExample",input:{goal:"Review the assigned live demos"}},
        inputCode:"assignment.request",
        bindingCode:this.examplesPortfolioBindings(input),
      },runId)}
        const verification=await prepared.verify(utilityValue.report);
        utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
      `) as Awaited<ReturnType<ManagedGrimoireReceiver["runManagedGrimoireTeacher"]>>;
    }
    if (managedGrimoireWorlds.find(({ id }) => id === input.caseId)?.handoff) {
      return await this.runHarnessUtility("teacher", runId => `${composedTeacherCode({
        executorModel: input.executorModel,
        workflowRequest: {
          goal: "Stage a handoff from the committed garden",
          work: grimoireHandoffWork.map(selector => ({ ...selector, input: { goal: "Review or stage garden evidence" } })),
        },
        requiredOrder: grimoireHandoffWork.map(({ operation }) => operation),
        requestCode: "prepared.request",
        bindingCode: this.gardenReviewBindings(input, true),
      }, runId)}
        utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
      `) as Awaited<ReturnType<ManagedGrimoireReceiver["runManagedGrimoireTeacher"]>>;
    }
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"examples",operation:"reviewExample",input:{goal:"Review the assigned garden"}},
      inputCode:"world.request",
      bindingCode:this.gardenReviewBindings(input),
    },runId)}
      const verification=prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedGrimoireReceiver["runManagedGrimoireTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies real garden observations and negative evidence without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedGrimoire(input: GardenReviewInput): ReturnType<ManagedGrimoireReceiver["qualifyManagedGrimoire"]> {
    if (input.portfolioCaseId) {
      const work = [{kind:"domain",domain:"examples",operation:"reviewExample"}] as const;
      return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
        work, this.examplesPortfolioBindings(input),
      )) as Awaited<ReturnType<ManagedGrimoireReceiver["qualifyManagedGrimoire"]>>;
    }
    if (managedGrimoireWorlds.find(({ id }) => id === input.caseId)?.handoff) {
      return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
        grimoireHandoffWork, this.gardenReviewBindings(input, true),
      )) as Awaited<ReturnType<ManagedGrimoireReceiver["qualifyManagedGrimoire"]>>;
    }
    return await this.runHarnessUtility("teacher", `
      ${this.gardenReviewBindings(input)}
      await natlang.describe("skills/examples-review/reviewExample.nl");
      await assignedServices.gardenRead.observe();
      const report=prepared.expected();
      const verification=prepared.verify(report);
      const altered={...report,evidenceIds:["other-garden"]};
      const utilityValue={
        verification,
        rejectedAlteredEvidence:!prepared.verify(altered).passed,
      };
    `) as Awaited<ReturnType<ManagedGrimoireReceiver["qualifyManagedGrimoire"]>>;
  }

  private ownedGardenBindings(input: GardenReviewInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareGardenReview} from "@workspace-skills/examples-review-fixtures/live-garden";
      import {managedGrimoireWorlds} from "@workspace-skills/system-testing/grimoire-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Garden belongs to another context");
      const world=managedGrimoireWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown Grimoire world");
      const garden=prepareGardenReview(input.garden,input.before,world.request.claims,world.expected,world.actions.map(action=>action.toLowerCase()));
    `;
  }

  private gardenReviewBindings(input: GardenReviewInput, handoff = false): string {
    return `
      ${handoff ? 'import {prepareGrimoireHandoff} from "@workspace-skills/system-testing/grimoire-handoff-managed";' : ""}
      ${this.ownedGardenBindings(input)}
      const prepared=${handoff ? "await prepareGrimoireHandoff(world,garden)" : "garden"};
      const assignedServices=prepared.services;
    `;
  }

  private examplesPortfolioBindings(input: GardenReviewInput): string {
    return `
      import {preparePortfolioReview} from "@workspace-skills/examples-review-fixtures/live-portfolio";
      import {prepareRealmReview} from "@workspace-skills/examples-review-fixtures/live-realm";
      import {examplesPortfolioAssignment} from "@workspace-skills/system-testing/examples-portfolio-worlds";
      ${this.ownedGardenBindings(input)}
      const assignment=examplesPortfolioAssignment(input.portfolioCaseId);
      if(assignment.garden.id!==input.caseId) throw new Error("A different garden was assigned to this portfolio");
      const realm=prepareRealmReview(input.garden.replace(/^natlang-garden-/u,"natlang-realm-"),assignment.realm);
      const prepared=preparePortfolioReview(assignment.request,garden,realm,assignment.world.expected);
      const assignedServices=prepared.services;
    `;
  }

  private adventureAssignment(input: { contextId: string; caseId: string }): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {managedAdventureWorlds} from "@workspace-skills/system-testing/adventure-review-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Adventure belongs to another context");
      const world=managedAdventureWorlds.find(item=>item.id===input.caseId);
      if(!world) throw new Error("Unknown assigned Adventure opening");
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reads an owned Adventure opening for the system test."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async inspectManagedAdventureOpening(input: Parameters<ManagedAdventureReceiver["inspectManagedAdventureOpening"]>[0]) {
    return await this.runHarnessUtility("teacher", `
      ${this.adventureAssignment(input)}
      import {inspectAdventureOpening} from "@workspace-skills/examples-review-fixtures/live-adventure";
      const utilityValue=await inspectAdventureOpening(input.journey);
    `);
  }

  private adventureReviewBindings(input: AdventureReviewInput): string {
    return `
      ${this.adventureAssignment(input)}
      import {prepareAdventureReview} from "@workspace-skills/examples-review-fixtures/live-adventure";
      const prepared=prepareAdventureReview(input.journey,input.before,input.panel,world);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews saved Adventure access and illustration with Natlang."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedAdventureTeacher(input: AdventureReviewInput & {executorModel:string}): ReturnType<ManagedAdventureReceiver["runManagedAdventureTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"examples",operation:"reviewExample",input:{goal:"Review the assigned Adventure opening"}},
      inputCode:"world.request",
      bindingCode:this.adventureReviewBindings(input),
    },runId)}
      const verification=await prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedAdventureReceiver["runManagedAdventureTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks the saved Adventure and rejects unrelated evidence without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyManagedAdventure(input: AdventureReviewInput): ReturnType<ManagedAdventureReceiver["qualifyManagedAdventure"]> {
    const work = [{kind:"domain", domain:"examples", operation:"reviewExample"}] as const;
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      work, this.adventureReviewBindings(input),
    )) as Awaited<ReturnType<ManagedAdventureReceiver["qualifyManagedAdventure"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Captures review of the original Adventure interaction and reload."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async captureProgrammedAdventure(input: ProgrammedAdventureInput & {executorModel:string}): ReturnType<ManagedAdventureReceiver["captureProgrammedAdventure"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"examples",operation:"reviewExample",input:{goal:"Review the programmed Adventure transition"}},
      inputCode:"programmedAdventureWorld.request",
      bindingCode:`
        import {contextId as actualContextId} from "@workspace/runtime";
        import {programmedAdventureWorld} from "@workspace-skills/system-testing/adventure-transition-world";
        import {prepareProgrammedAdventure} from "@workspace-skills/examples-review-fixtures/live-programmed-adventure";
        const input=${JSON.stringify(input)};
        if(actualContextId!==input.contextId) throw new Error("Adventure belongs to another context");
        const prepared=prepareProgrammedAdventure(input.journey,programmedAdventureWorld.request,input.before,input.frames);
        const assignedServices=prepared.services;
      `,
    },runId)}
      const verification=prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedAdventureReceiver["captureProgrammedAdventure"]>>;
  }

  private browserImportBindings(input: BrowserImportInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {managedBrowserImportWorlds} from "@workspace-skills/system-testing/browser-import-worlds";
      import {prepareManagedBrowserImport} from "@workspace-skills/browser-import-runtime/managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Browser migration belongs to another context");
      const world=managedBrowserImportWorlds.find(item=>item.id===input.caseId);
      if(!world) throw new Error("Unknown assigned Browser migration case");
      const prepared=await prepareManagedBrowserImport(world);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the caller-owned browser migration assignment."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedBrowserImportTeacher(input: BrowserImportInput & {executorModel:string}): ReturnType<ManagedBrowserImportReceiver["runManagedBrowserImportTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"browserImport",operation:"reviewBrowserImport",input:{goal:"Review the assigned Browser migration"}},
      inputCode:"prepared.request",
      bindingCode:this.browserImportBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedBrowserImportReceiver["runManagedBrowserImportTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks the browser migration receipt and preview boundaries without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedBrowserImport(input: BrowserImportInput): ReturnType<ManagedBrowserImportReceiver["qualifyManagedBrowserImport"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"browserImport",operation:"reviewBrowserImport"}], this.browserImportBindings(input),
    )) as Awaited<ReturnType<ManagedBrowserImportReceiver["qualifyManagedBrowserImport"]>>;
  }

  private driveSharingBindings(input: DriveSharingInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {managedDriveSharingWorlds} from "@workspace-skills/system-testing/drive-sharing-worlds";
      import {prepareDriveSharing} from "@workspace-skills/google-drive/live-drive-sharing";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Drive sharing belongs to another context");
      const world=managedDriveSharingWorlds.find(item=>item.id===input.caseId);
      if(!world) throw new Error("Unknown assigned Drive sharing case");
      const prepared=prepareDriveSharing(world);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Runs the caller-owned Drive inventory and sharing review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async runManagedDriveSharingTeacher(input: DriveSharingInput & {executorModel:string}): ReturnType<ManagedDriveSharingReceiver["runManagedDriveSharingTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"google",operation:"guideGoogleWorkspace",input:{goal:"Review the assigned Drive sharing"}},
      inputCode:"prepared.request",
      bindingCode:this.driveSharingBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedDriveSharingReceiver["runManagedDriveSharingTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks the Drive inventory gate and permission reads without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyManagedDriveSharing(input: DriveSharingInput): ReturnType<ManagedDriveSharingReceiver["qualifyManagedDriveSharing"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"google",operation:"guideGoogleWorkspace"}], this.driveSharingBindings(input),
    )) as Awaited<ReturnType<ManagedDriveSharingReceiver["qualifyManagedDriveSharing"]>>;
  }

  private driveCheckpointBindings(input: DriveCheckpointInput, handoff: boolean): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {managedDriveCheckpointWorlds} from "@workspace-skills/system-testing/drive-checkpoint-worlds";
      import {prepareDriveCheckpoint} from "@workspace-skills/google-drive/live-drive-checkpoint";
      ${handoff ? 'import {prepareDriveCheckpointHandoff} from "@workspace-skills/system-testing/drive-checkpoint-handoff-managed";' : ""}
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Drive checkpoint belongs to another context");
      const world=managedDriveCheckpointWorlds.find(item=>item.id===input.caseId);
      if(!world) throw new Error("Unknown assigned Drive checkpoint case");
      const checkpoint=await prepareDriveCheckpoint(world);
      const prepared=${handoff ? "await prepareDriveCheckpointHandoff(checkpoint,world.id)" : "checkpoint"};
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Runs a caller-owned Drive checkpoint review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedDriveCheckpointTeacher(input: DriveCheckpointInput & {executorModel:string}): ReturnType<ManagedDriveCheckpointReceiver["runManagedDriveCheckpointTeacher"]> {
    const handoff = managedDriveCheckpointWorlds.find(({ id }) => id === input.caseId)?.handoff === true;
    return await this.runHarnessUtility("teacher", runId => `
      ${this.driveCheckpointBindings(input, handoff)}
      let result;
      try {
        ${handoff ? composedTeacherCode({
          executorModel: input.executorModel,
          workflowRequest: {
            goal: "Review and hand off the assigned Drive checkpoint",
            work: driveCheckpointHandoffWork.map(selector => ({ ...selector, input: { goal: "Review checkpoint evidence" } })),
          },
          requiredOrder: driveCheckpointHandoffWork.map(({ operation }) => operation),
          requestCode: "prepared.request",
          bindingCode: "",
        }, runId) : domainTeacherCode({
          executorModel:input.executorModel,
          work:{kind:"domain",domain:"google",operation:"guideGoogleWorkspace",input:{goal:"Review the assigned checkpoint"}},
          inputCode:"prepared.request",
          bindingCode:"",
        },runId)}
        result={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
      } finally { await checkpoint.close(); }
      const utilityValue=result;
    `) as Awaited<ReturnType<ManagedDriveCheckpointReceiver["runManagedDriveCheckpointTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks the Drive transport and checkpoint readback without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedDriveCheckpoint(input: DriveCheckpointInput): ReturnType<ManagedDriveCheckpointReceiver["qualifyManagedDriveCheckpoint"]> {
    const handoff = managedDriveCheckpointWorlds.find(({ id }) => id === input.caseId)?.handoff === true;
    return await this.runHarnessUtility("teacher", `
      ${this.driveCheckpointBindings(input, handoff)}
      let result;
      try {
        ${domainTeacherQualificationCode(handoff ? driveCheckpointHandoffWork : [{domain:"google",operation:"guideGoogleWorkspace"}], "")}
        result=utilityValue;
      } finally { await checkpoint.close(); }
      const utilityValue=result;
    `) as Awaited<ReturnType<ManagedDriveCheckpointReceiver["qualifyManagedDriveCheckpoint"]>>;
  }

  private regencyReviewBindings(input: RegencyReviewInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {managedRegencyWorlds} from "@workspace-skills/system-testing/regency-review-worlds";
      import {prepareRealmReview} from "@workspace-skills/examples-review-fixtures/live-realm";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Regency belongs to another context");
      const world=managedRegencyWorlds.find(item=>item.id===input.caseId);
      if(!world) throw new Error("Unknown assigned Regency review");
      const prepared=prepareRealmReview(input.realm,world);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the Regency opening and its forecast through Natlang."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async runManagedRegencyTeacher(input: RegencyReviewInput & {executorModel:string}): ReturnType<ManagedRegencyReceiver["runManagedRegencyTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"examples",operation:"reviewExample",input:{goal:"Review the assigned realm settlement"}},
      inputCode:"world.request",
      bindingCode:this.regencyReviewBindings(input),
    },runId)}
      const verification=await prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedRegencyReceiver["runManagedRegencyTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the saved realm and forecast without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyManagedRegency(input: RegencyReviewInput): ReturnType<ManagedRegencyReceiver["qualifyManagedRegency"]> {
    const work = [{kind:"domain", domain:"examples", operation:"reviewExample"}] as const;
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      work, this.regencyReviewBindings(input),
    )) as Awaited<ReturnType<ManagedRegencyReceiver["qualifyManagedRegency"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Reviews owned Spectrolite document and actual preview evidence."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedSpectroliteTeacher(input: SpectroliteInput & {executorModel:string}): ReturnType<ManagedSpectroliteReceiver["runManagedSpectroliteTeacher"]> {
    if (managedSpectroliteWorlds.find(({ id }) => id === input.caseId)?.handoff) {
      return await this.runHarnessUtility("teacher", runId => `${composedTeacherCode({
        executorModel: input.executorModel,
        workflowRequest: {
          goal: "Review the live editor and plan the document handoff",
          work: spectroliteHandoffWork.map(selector => ({ ...selector, input: { goal: "Inspect the assigned revision" } })),
        },
        requiredOrder: spectroliteHandoffWork.map(({ operation }) => operation),
        requestCode: "prepared.request",
        bindingCode: this.spectroliteBindings(input, true),
      },runId)}
        utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
      `) as Awaited<ReturnType<ManagedSpectroliteReceiver["runManagedSpectroliteTeacher"]>>;
    }
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"spectrolite",operation:"reviewSpectrolite",input:{goal:"Review the assigned Spectrolite document"}},
      inputCode:"prepared.request",
      bindingCode:this.spectroliteBindings(input),
    },runId)}
      const verification=prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedSpectroliteReceiver["runManagedSpectroliteTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live Spectrolite evidence without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedSpectrolite(input: SpectroliteInput): ReturnType<ManagedSpectroliteReceiver["qualifyManagedSpectrolite"]> {
    if (managedSpectroliteWorlds.find(({ id }) => id === input.caseId)?.handoff)
      return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
        spectroliteHandoffWork,
        this.spectroliteBindings(input, true),
      )) as Awaited<ReturnType<ManagedSpectroliteReceiver["qualifyManagedSpectrolite"]>>;
    return await this.runHarnessUtility("teacher", `
      ${this.spectroliteBindings(input)}
      await natlang.describe("skills/spectrolite-review/reviewSpectrolite.nl");
      await assignedServices.spectroliteRead.observe();
      const report=prepared.reference();
      const verification=prepared.verify(report);
      const altered={findings:report.findings.map(finding=>({...finding,evidenceIds:["different-revision"]}))};
      const utilityValue={verification,rejectedDifferentRevision:!prepared.verify(altered).passed};
    `) as Awaited<ReturnType<ManagedSpectroliteReceiver["qualifyManagedSpectrolite"]>>;
  }

  private spectroliteBindings(input: SpectroliteInput, handoff = false): string {
    return `
      import {panelTree,contextId as actualContextId} from "@workspace/runtime";
      import {prepareSpectroliteReview,prepareSpectroliteHandoff} from "@workspace-skills/spectrolite-review-fixtures/live";
      import {managedSpectroliteWorlds,spectrolitePanel,spectroliteVault,spectroliteHandoffWork} from "@workspace-skills/system-testing/spectrolite-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Spectrolite review belongs to another context");
      const world=managedSpectroliteWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown Spectrolite assignment");
      const panel=panelTree.get(input.panelId);
      const panelState=await panel.observe();
      if(panelState.source!==spectrolitePanel || panelState.contextId!==input.contextId || panelState.requestedRef!=="ctx:"+input.contextId || panelState.kind!=="workspace") throw new Error("Spectrolite panel belongs to another assignment");
      const review=prepareSpectroliteReview(panel,actualContextId,spectroliteVault,world,input.navigation);
      ${handoff ? 'if(!world.handoff) throw new Error("Missing Spectrolite handoff assignment"); const prepared=prepareSpectroliteHandoff(review,spectroliteHandoffWork,world.handoff);' : "const prepared=review;"}
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the owned News participant and its exact schedule owners."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedNewsTeacher(input: NewsInput & {executorModel:string}): ReturnType<ManagedNewsReceiver["runManagedNewsTeacher"]> {
    if (managedNewsWorlds.find(({ id }) => id === input.caseId)?.handoff) {
      return await this.runHarnessUtility("teacher", runId => `
        ${this.newsBindings(input)}
        if (!world.handoff) throw new Error("Missing News handoff assignment");
        let result;
        try {
          await prepared.seed();
          const handoff=await prepareNewsHandoff({fs,rpc,vcs},prepared,{id:world.id,handoff:world.handoff,repair:world.repair});
          ${composedTeacherCode({
            executorModel: input.executorModel,
            workflowRequest: {
              goal: "Stage a handoff from the verified News settings",
              work: newsHandoffWork.map((selector) => ({ ...selector, input: { goal: "Collect or stage assigned News evidence" } })),
            },
            requiredOrder: newsHandoffWork.map(({ operation }) => operation),
            requestCode: "handoff.request",
            bindingCode: "const assignedServices=handoff.services;",
          }, runId)}
          result={contextId:actualContextId,teacher:utilityValue,verification:await handoff.verify(utilityValue.report)};
        } finally { await prepared.close(); }
        const utilityValue=result;
      `) as Awaited<ReturnType<ManagedNewsReceiver["runManagedNewsTeacher"]>>;
    }
    return await this.runHarnessUtility("teacher", runId => `
      ${this.newsBindings(input)}
      let teacher;
      try {
        await prepared.seed();
        ${domainTeacherCode({
          executorModel:input.executorModel,
          work:{kind:"domain",domain:"news",operation:"reviewNews",input:{goal:"Review the assigned News settings"}},
          inputCode:"prepared.request",
          bindingCode:"const assignedServices=prepared.services;",
        },runId)}
        teacher=utilityValue;
      } finally { await prepared.close(); }
      const utilityValue={contextId:actualContextId,teacher,verification:prepared.verify(teacher.report)};
    `) as Awaited<ReturnType<ManagedNewsReceiver["runManagedNewsTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks installed reader and schedule state without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedNews(input: NewsInput): ReturnType<ManagedNewsReceiver["qualifyManagedNews"]> {
    if (managedNewsWorlds.find(({ id }) => id === input.caseId)?.handoff) {
      return await this.runHarnessUtility("teacher", `
        ${this.newsBindings(input)}
        if (!world.handoff) throw new Error("Missing News handoff assignment");
        let result;
        try {
          await prepared.seed();
          const handoff=await prepareNewsHandoff({fs,rpc,vcs},prepared,{id:world.id,handoff:world.handoff,repair:world.repair});
          {
            ${domainTeacherQualificationCode(newsHandoffWork, "const assignedServices=handoff.services; const prepared=handoff;")}
            result=utilityValue;
          }
        } finally { await prepared.close(); }
        const utilityValue=result;
      `) as Awaited<ReturnType<ManagedNewsReceiver["qualifyManagedNews"]>>;
    }
    return await this.runHarnessUtility("teacher", `
      ${this.newsBindings(input)}
      let report;
      try {
        await natlang.describe("skills/news-workflows/reviewNews.nl");
        await prepared.seed();
        report=await prepared.qualify();
      } finally { await prepared.close(); }
      const verification=prepared.verify(report);
      const altered={...report,findings:report.findings.map(finding=>({...finding,evidenceIds:["different-reader"]}))};
      const utilityValue={verification,rejectedDifferentEvidence:!prepared.verify(altered).passed};
    `) as Awaited<ReturnType<ManagedNewsReceiver["qualifyManagedNews"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Retires only schedules owned by the News fixture."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async retireManagedNews(input: NewsInput): Promise<boolean> {
    return await this.runHarnessUtility("teacher", `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {retireNewsOwners} from "@workspace/news-live-evidence/live";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("News cleanup belongs to another context");
      const utilityValue=await retireNewsOwners(input);
    `) as boolean;
  }

  private newsBindings(input: NewsInput): string {
    return `
      import {contextId as actualContextId,fs,rpc,vcs} from "@workspace/runtime";
      import {prepareLiveNews} from "@workspace/news-live-evidence/live";
      import {managedNewsWorlds} from "@workspace-skills/system-testing/news-worlds";
      import {prepareNewsHandoff} from "@workspace-skills/system-testing/news-handoff-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("News review belongs to another context");
      const world=managedNewsWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown News assignment");
      const prepared=prepareLiveNews(input,world);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the owned Google setup panel and account readiness."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedGoogleSetupTeacher(input: GoogleSetupInput & {executorModel:string}): ReturnType<ManagedGoogleSetupReceiver["runManagedGoogleSetupTeacher"]> {
    const compose = managedGoogleSetupWorlds.find(({ id }) => id === input.caseId)?.compose;
    if (compose) {
      const bindings = await this.gmailContinuationBindings(input, compose.caseId);
      return await this.runHarnessUtility("teacher", runId => `${composedTeacherCode({
        executorModel: input.executorModel,
        workflowRequest: {
          goal: "Review setup and plan continuation of the retained compose card",
          work: gmailContinuationWork.map((selector) => ({ ...selector, input: { goal: "Review assigned evidence" } })),
        },
        requiredOrder: gmailContinuationWork.map(({ operation }) => operation),
        requestCode: "prepared.request",
        bindingCode: bindings,
      }, runId)}
        utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
      `) as Awaited<ReturnType<ManagedGoogleSetupReceiver["runManagedGoogleSetupTeacher"]>>;
    }
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"google",operation:"guideGoogleWorkspace",input:{goal:"Review the assigned setup journey"}},
      inputCode:"prepared.request",
      bindingCode:this.googleSetupBindings(input),
    },runId)}
      const verification=prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedGoogleSetupReceiver["runManagedGoogleSetupTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the installed Google setup journey without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedGoogleSetup(input: GoogleSetupInput): ReturnType<ManagedGoogleSetupReceiver["qualifyManagedGoogleSetup"]> {
    const compose = managedGoogleSetupWorlds.find(({ id }) => id === input.caseId)?.compose;
    if (compose)
      return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
        gmailContinuationWork,
        await this.gmailContinuationBindings(input, compose.caseId),
      )) as Awaited<ReturnType<ManagedGoogleSetupReceiver["qualifyManagedGoogleSetup"]>>;
    return await this.runHarnessUtility("teacher", `
      ${this.googleSetupBindings(input)}
      await natlang.describe(googleSetupSkill+"/guideGoogleWorkspace.nl");
      await assignedServices.googleWorkspaceRead.readiness();
      await assignedServices.googleSetupPanel.observe();
      const report=prepared.reference();
      const verification=prepared.verify(report);
      const altered={...report,panelFindings:report.panelFindings.map(finding=>({...finding,evidenceId:"different-panel"}))};
      const utilityValue={verification,rejectedDifferentReceipt:!prepared.verify(altered).passed};
    `) as Awaited<ReturnType<ManagedGoogleSetupReceiver["qualifyManagedGoogleSetup"]>>;
  }

  private async gmailContinuationBindings(input: GoogleSetupInput, composeCase: string): Promise<string> {
    return `
      ${this.googleSetupBindings(input, true)}
      ${await this.gmailComposeBindings({ contextId:input.contextId, caseId:composeCase }, true)}
      import {prepareGmailContinuation} from "@workspace-skills/system-testing/gmail-continuation-managed";
      if(!world.compose || seed.caseId!==world.compose.caseId) throw new Error("Wrong compose continuation assignment");
      const prepared=prepareGmailContinuation(setup,compose,world.compose.action);
      const assignedServices=prepared.services;
    `;
  }

  private googleSetupBindings(input: GoogleSetupInput, continuation = false): string {
    return `
      import {panelTree,contextId as actualContextId} from "@workspace/runtime";
      import {prepareGoogleSetupJourney} from "@workspace-skills/google-drive/live-setup-journey";
      import {managedGoogleSetupWorlds,googleSetupPanel,googleSetupSkill} from "@workspace-skills/system-testing/google-setup-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Google setup review belongs to another context");
      const world=managedGoogleSetupWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown Google setup case");
      const panel=panelTree.get(input.panelId);
      const state=await panel.observe();
      if(state.source!==googleSetupPanel || state.contextId!==input.contextId || state.requestedRef!=="ctx:"+input.contextId || state.kind!=="workspace") throw new Error("Google setup panel belongs to another assignment");
      const ${continuation ? "setup" : "prepared"}=prepareGoogleSetupJourney(panel,actualContextId,world);
      ${continuation ? "" : "const assignedServices=prepared.services;"}
    `;
  }

  @rpc({website:{kind:"closed",reason:"Compares read-only inventory for the assigned local models."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedLocalComparisonTeacher(input: LocalComparisonInput & {executorModel:string}): ReturnType<ManagedLocalComparisonReceiver["runManagedLocalComparisonTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"localModel",operation:"prepareLocalModel",input:{goal:"Compare the assigned local models"}},
      inputCode:"prepared.request",
      bindingCode:this.localComparisonBindings(input),
    },runId)}
      const verification=prepared.verify(utilityValue.report,await prepared.readback());
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedLocalComparisonReceiver["runManagedLocalComparisonTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the actual catalog and comparison without executing models."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedLocalComparison(input: LocalComparisonInput): ReturnType<ManagedLocalComparisonReceiver["qualifyManagedLocalComparison"]> {
    return await this.runHarnessUtility("teacher", `
      ${this.localComparisonBindings(input)}
      await natlang.describe(localModelSkill+"/prepareLocalModel.nl");
      const refs=[prepared.request.modelRef,...prepared.request.alternatives];
      for(const ref of refs) await assignedServices.localModelTaskInventory.inspect(ref);
      const after=await prepared.readback();
      const verification=prepared.verify(prepared.expected,after);
      let rejectedOutsideInventory=false;
      try { await assignedServices.localModelTaskInventory.inspect("local:outside-assignment"); }
      catch { rejectedOutsideInventory=true; }
      const rejectedDifferentModel=rejectedOutsideInventory&&!prepared.verify({...prepared.expected,ref:"local:outside-assignment"},after).passed;
      const utilityValue={verification,rejectedDifferentModel};
    `) as Awaited<ReturnType<ManagedLocalComparisonReceiver["qualifyManagedLocalComparison"]>>;
  }

  private localComparisonBindings(input: LocalComparisonInput): string {
    return `
      import {extensions,contextId as actualContextId} from "@workspace/runtime";
      import {prepareLocalModelComparison} from "@workspace-skills/local-model-task-bindings/live";
      import {localModelComparisonWorlds,localModelSkill} from "@workspace-skills/system-testing/local-model-comparison-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Local model comparison belongs to another context");
      const world=localModelComparisonWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown local model comparison");
      const prepared=await prepareLocalModelComparison(extensions,actualContextId,world);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews exact windows of the owned test server log."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedLogAuditTeacher(input: LogAuditInput & {executorModel:string}): ReturnType<ManagedLogAuditReceiver["runManagedLogAuditTeacher"]> {
    const bindings=await this.logAuditBindings(input);
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"system",operation:"investigateSystem",input:{goal:"Review the assigned host log windows"}},
      inputCode:"prepared.request",
      bindingCode:bindings,
    },runId)}
      const verification=prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedLogAuditReceiver["runManagedLogAuditTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the current server log windows without executing a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedLogAudit(input: LogAuditInput): ReturnType<ManagedLogAuditReceiver["qualifyManagedLogAudit"]> {
    const bindings=await this.logAuditBindings(input);
    return await this.runHarnessUtility("teacher", `
      ${bindings}
      await natlang.describe(systemInvestigationSkill+"/investigateSystem.nl");
      for(const {sinceSeq,tag} of prepared.request.windows) await assignedServices.serverLog.query({sinceSeq,tag,limit:100});
      const verification=prepared.verify(prepared.expected);
      let rejectedForeign=false;
      try { await assignedServices.serverLog.query({sinceSeq:0,tag:"unrelated",limit:100}); }
      catch { rejectedForeign=true; }
      const rejectedDifferentWindow=rejectedForeign&&!prepared.verify({...prepared.expected,findings:[{code:"log-routine",evidenceIds:["another-boot:1"]}]}).passed;
      const utilityValue={verification,rejectedDifferentWindow};
    `) as Awaited<ReturnType<ManagedLogAuditReceiver["qualifyManagedLogAudit"]>>;
  }

  private async seedAssignedHostLog(expectedContextId: string, lines: readonly string[]) {
    const {contextId}=await this.integrationFixtureIdentity();
    if (contextId!==expectedContextId) throw new Error("Host log fixture belongs to another context");
    const marker=`natlang-host-log-${crypto.randomUUID()}`;
    const initial=await this.rpc.call("main",mainRpcMethods["serverLog.query"],[{contains:marker,limit:1}]);
    const seed={marker,boot:initial.serverBootId,workspaceId:initial.workspaceId,start:initial.latestSeq,steps:[] as number[]};
    for (const [index,line] of lines.entries()) {
      const message=`${marker} ${line}`;
      console.warn(message);
      const sinceSeq=seed.steps.at(-1)??seed.start;
      const deadline=Date.now()+10_000;
      while (true) {
        const current=await this.rpc.call("main",mainRpcMethods["serverLog.query"],[{sinceSeq,tag:hostWorkerdLogTag,contains:marker,limit:4}]);
        if (current.serverBootId!==seed.boot || current.workspaceId!==seed.workspaceId) throw new Error("Host log changed while seeding the test");
        const captured=current.records.find(record=>record.message.includes(message));
        if (captured) { seed.steps.push(captured.seq); break; }
        if (Date.now()>=deadline) throw new Error(`VibeStudio did not capture issued host-log line ${index+1}`);
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    }
    return seed;
  }

  private async logAuditBindings(input: LogAuditInput): Promise<string> {
    const world=managedLogAuditWorlds.find(({id})=>id===input.caseId);
    if (!world) throw new Error("Unknown host log audit assignment");
    const seed=await this.seedAssignedHostLog(input.contextId, world.lines);
    return `
      import {rpc,contextId as actualContextId} from "@workspace/runtime";
      import {mainRpcMethods} from "@vibestudio/service-schemas/mainRpc";
      import {prepareManagedLogAudit} from "@workspace-skills/system-investigation-live";
      import {managedLogAuditWorlds,systemInvestigationSkill} from "@workspace-skills/system-testing/log-audit-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Host log audit belongs to another context");
      const world=managedLogAuditWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown host log audit");
      const prepared=prepareManagedLogAudit(filter=>rpc.call("main",mainRpcMethods["serverLog.query"],[filter]),actualContextId,world,${JSON.stringify(seed)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures only secret-free readiness from the owned integration fixture."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedIntegrationReadinessTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedIntegrationReadinessReceiver["runManagedIntegrationReadinessTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"apiIntegration",operation:"reviewIntegration",input:{goal:"Check the assigned integration"}},
      inputCode:"prepared.request",
      bindingCode:this.managedIntegrationReadinessBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedIntegrationReadinessReceiver["runManagedIntegrationReadinessTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies exact host credential matches with a disposable seeded binding."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedIntegrationReadiness(input: {contextId:string;caseId:string}): ReturnType<ManagedIntegrationReadinessReceiver["qualifyManagedIntegrationReadiness"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.managedIntegrationReadinessBindings(input)}
      await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedIntegrationReadinessReceiver["qualifyManagedIntegrationReadiness"]>>;
  }

  private managedIntegrationReadinessBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedIntegrationReadiness} from "@workspace-skills/system-testing/integration-readiness-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Integration readiness belongs to another context");
      const prepared=prepareManagedIntegrationReadiness(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Runs an exact terminal check plan owned by the test context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedTerminalCheckTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedTerminalCheckReceiver["runManagedTerminalCheckTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"terminalChecks",operation:"runTerminalChecks",input:{goal:"Complete the assigned terminal checks"}},
      inputCode:"prepared.request",
      bindingCode:this.managedTerminalCheckBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedTerminalCheckReceiver["runManagedTerminalCheckTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies bounded native terminal execution without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedTerminalCheck(input: {contextId:string;caseId:string}): ReturnType<ManagedTerminalCheckReceiver["qualifyManagedTerminalCheck"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.managedTerminalCheckBindings(input)}
      await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedTerminalCheckReceiver["qualifyManagedTerminalCheck"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Reviews an assigned retained terminal operation."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedTerminalEvidenceTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedTerminalEvidenceReceiver["runManagedTerminalEvidenceTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"deviceAndTerminal",operation:"reviewDeviceAndTerminal",input:{goal:"Review the assigned terminal operation"}},
      inputCode:"prepared.request",
      bindingCode:this.managedTerminalEvidenceBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedTerminalEvidenceReceiver["runManagedTerminalEvidenceTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies terminal receipt provenance without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedTerminalEvidence(input: {contextId:string;caseId:string}): ReturnType<ManagedTerminalEvidenceReceiver["qualifyManagedTerminalEvidence"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"deviceAndTerminal",operation:"reviewDeviceAndTerminal"}],this.managedTerminalEvidenceBindings(input),
    )) as Awaited<ReturnType<ManagedTerminalEvidenceReceiver["qualifyManagedTerminalEvidence"]>>;
  }

  private managedTerminalEvidenceBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedTerminalEvidence} from "@workspace-skills/system-testing/terminal-evidence-managed";
      const prepared=await prepareManagedTerminalEvidence(${JSON.stringify({contextId:input.contextId,caseId:input.caseId})});
      const assignedServices=prepared.services;
    `;
  }

  private managedTerminalCheckBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedTerminalChecks} from "@workspace-skills/system-testing/terminal-check-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Terminal checks belong to another context");
      const prepared=prepareManagedTerminalChecks(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned local-only problem report."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedProblemDraftTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedProblemDraftReceiver["runManagedProblemDraftTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.ProblemDraft,
      inputCode:"prepared.request",
      bindingCode:this.managedProblemDraftBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedProblemDraftReceiver["runManagedProblemDraftTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live local report writes without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedProblemDraft(input: {contextId:string;caseId:string}): ReturnType<ManagedProblemDraftReceiver["qualifyManagedProblemDraft"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.ProblemDraft],
      this.managedProblemDraftBindings(input),
    )) as Awaited<ReturnType<ManagedProblemDraftReceiver["qualifyManagedProblemDraft"]>>;
  }

  private managedProblemDraftBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedProblemDraft} from "@workspace-skills/system-testing/problem-draft-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Problem draft belongs to another context");
      const prepared=await prepareManagedProblemDraft(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned System client admission review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedClientAdmissionTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedClientAdmissionReceiver["runManagedClientAdmissionTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.ClientAdmission,
      inputCode:"prepared.request",
      bindingCode:this.managedClientAdmissionBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedClientAdmissionReceiver["runManagedClientAdmissionTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live client admission observations without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedClientAdmission(input: {contextId:string;caseId:string}): ReturnType<ManagedClientAdmissionReceiver["qualifyManagedClientAdmission"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.ClientAdmission],
      this.managedClientAdmissionBindings(input),
    )) as Awaited<ReturnType<ManagedClientAdmissionReceiver["qualifyManagedClientAdmission"]>>;
  }

  private managedClientAdmissionBindings(input: {contextId:string;caseId:string}): string {
    const assignment=managedClientAdmissionWorlds.find(({id})=>id===input.caseId);
    if(!assignment) throw new Error("Unknown client admission assignment");
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedClientAdmission} from "@workspace-skills/clientdev/managed-fixture";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Client review belongs to another context");
      const prepared=await prepareManagedClientAdmission(actualContextId,${JSON.stringify(assignment)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned release and authority review handoff."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedReleaseReviewHandoffTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedReleaseReviewHandoffReceiver["runManagedReleaseReviewHandoffTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${composedTeacherCode({
      executorModel:input.executorModel,
      workflowRequest:{goal:"Prepare the assigned release review handoff",work:releaseReviewHandoffWork.map((work)=>({...work,input:{goal:"Complete assigned work"}}))},
      requiredOrder:releaseReviewHandoffWork.map(({operation})=>operation),
      requestCode:"prepared.request",
      bindingCode:this.managedReleaseReviewHandoffBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedReleaseReviewHandoffReceiver["runManagedReleaseReviewHandoffTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the live release review and handoff dependency gates without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedReleaseReviewHandoff(input: {contextId:string;caseId:string}): ReturnType<ManagedReleaseReviewHandoffReceiver["qualifyManagedReleaseReviewHandoff"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      releaseReviewHandoffWork,
      this.managedReleaseReviewHandoffBindings(input),
    )) as Awaited<ReturnType<ManagedReleaseReviewHandoffReceiver["qualifyManagedReleaseReviewHandoff"]>>;
  }

  private managedReleaseReviewHandoffBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareReleaseReviewHandoff} from "@workspace-skills/system-testing/release-review-handoff-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Release handoff belongs to another context");
      const prepared=await prepareReleaseReviewHandoff(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned Git Bridge review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedGitBridgeReviewTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedGitBridgeReviewReceiver["runManagedGitBridgeReviewTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.GitBridgeReview,
      inputCode:"prepared.request",
      bindingCode:this.managedGitBridgeReviewBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedGitBridgeReviewReceiver["runManagedGitBridgeReviewTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the live Git Bridge and semantic repository without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedGitBridgeReview(input: {contextId:string;caseId:string}): ReturnType<ManagedGitBridgeReviewReceiver["qualifyManagedGitBridgeReview"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.GitBridgeReview],
      this.managedGitBridgeReviewBindings(input),
    )) as Awaited<ReturnType<ManagedGitBridgeReviewReceiver["qualifyManagedGitBridgeReview"]>>;
  }

  private managedGitBridgeReviewBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedGitBridgeReview} from "@workspace-skills/system-testing/git-bridge-review-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Git Bridge review belongs to another context");
      const prepared=await prepareManagedGitBridgeReview(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned semantic VCS delivery review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedVcsDeliveryTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedVcsDeliveryReceiver["runManagedVcsDeliveryTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.VcsDelivery,
      inputCode:"prepared.request",
      bindingCode:this.managedVcsDeliveryBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedVcsDeliveryReceiver["runManagedVcsDeliveryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live semantic VCS delivery reads without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedVcsDelivery(input: {contextId:string;caseId:string}): ReturnType<ManagedVcsDeliveryReceiver["qualifyManagedVcsDelivery"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.VcsDelivery],
      this.managedVcsDeliveryBindings(input),
    )) as Awaited<ReturnType<ManagedVcsDeliveryReceiver["qualifyManagedVcsDelivery"]>>;
  }

  private managedVcsDeliveryBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedVcsDelivery} from "@workspace-skills/system-testing/vcs-delivery-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("VCS delivery review belongs to another context");
      const prepared=await prepareManagedVcsDelivery(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures recovery of the assigned eval side effect."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedEvalRecoveryTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedEvalRecoveryReceiver["runManagedEvalRecoveryTeacher"]> {
    const probe = await this.runEvalRecoveryProbe(input);
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.EvalRecovery,
      inputCode:"prepared.request",
      bindingCode:this.managedEvalRecoveryBindings(input, probe),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedEvalRecoveryReceiver["runManagedEvalRecoveryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the original native journal and exact readback without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedEvalRecovery(input: {contextId:string;caseId:string}): ReturnType<ManagedEvalRecoveryReceiver["qualifyManagedEvalRecovery"]> {
    const probe = await this.runEvalRecoveryProbe(input);
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.EvalRecovery],
      this.managedEvalRecoveryBindings(input, probe),
    )) as Awaited<ReturnType<ManagedEvalRecoveryReceiver["qualifyManagedEvalRecovery"]>>;
  }

  private managedEvalRecoveryBindings(input: {contextId:string;caseId:string}, probe: Awaited<ReturnType<SystemTestRunnerDO["runEvalRecoveryProbe"]>>): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedEvalRecovery} from "@workspace-skills/system-testing/eval-recovery-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Eval recovery belongs to another context");
      const prepared=prepareManagedEvalRecovery(input,${JSON.stringify(probe)});
      const assignedServices=prepared.services;
    `;
  }

  private async runEvalRecoveryProbe(input: { contextId: string; caseId: string }) {
    const code = evalRecoveryProbeCode(input);
    const runId = "system-test-eval-recovery:" + crypto.randomUUID();
    const scope = { key: runId, lifecycle: "finite" as const };
    const execute = createEvalExecutor(createMainRpcCaller(this.rpc));
    try {
      const result = await execute({
        runId, scope, source: { kind: "inline", code, syntax: "typescript" },
      });
      if (!result.success && result.error) {
        const failure = formatRpcFailure(deserializeRpcFailure(result.error));
        if (!failure.includes("Intentional failure after the assigned store"))
          throw new Error("Eval recovery source failed before the assigned outcome: " + failure);
      }
      if (!result.operationJournal || result.operationJournal.entries.length === 0)
        throw new Error("Eval recovery source returned no native receipts");
      return { runId, success: result.success, operationJournal: result.operationJournal };
    } finally {
      await this.rpc.call("main", mainRpcMethods["eval.dispose"], [{ scopeKey: scope.key }]);
    }
  }

  @rpc({website:{kind:"closed",reason:"Captures an exact website revision review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runPublicationRevisionTeacher(input: {contextId:string;caseId:string;source:string;executorModel:string}): ReturnType<PublicationRevisionReceiver["runPublicationRevisionTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"publication",operation:"reviewPublicationRevision",input:{goal:"Review the assigned website revision"}},
      inputCode: "prepared.request",
      bindingCode: this.publicationRevisionBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<PublicationRevisionReceiver["runPublicationRevisionTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies native package comparison without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyPublicationRevision(input: {contextId:string;caseId:string;source:string}): ReturnType<PublicationRevisionReceiver["qualifyPublicationRevision"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"publication",operation:"reviewPublicationRevision"}], this.publicationRevisionBindings(input),
    )) as Awaited<ReturnType<PublicationRevisionReceiver["qualifyPublicationRevision"]>>;
  }

  private publicationRevisionBindings(input: {contextId:string;caseId:string;source:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {preparePublicationRevision} from "@workspace-skills/system-testing/publication-revision-managed";
      const prepared=await preparePublicationRevision(${JSON.stringify(input)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures review of real PDF extraction evidence."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runPdfMediaTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<PdfMediaReceiver["runPdfMediaTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"mediaImport",operation:"reviewMediaAndImport",input:{goal:"Review the assigned PDF extraction"}},
      inputCode: "prepared.request",
      bindingCode: this.pdfMediaBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<PdfMediaReceiver["runPdfMediaTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the live PDF extraction and evidence readback."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyPdfMedia(input: {contextId:string;caseId:string}): ReturnType<PdfMediaReceiver["qualifyPdfMedia"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"mediaImport",operation:"reviewMediaAndImport"}], this.pdfMediaBindings(input),
    )) as Awaited<ReturnType<PdfMediaReceiver["qualifyPdfMedia"]>>;
  }

  private pdfMediaBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedPdfMedia} from "@workspace-skills/system-testing/pdf-media-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("PDF review belongs to another context");
      const prepared=await prepareManagedPdfMedia(input);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned Android pairing."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runAndroidPairTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<AndroidPairReceiver["runAndroidPairTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"mobileSystem",operation:"runMobileScenario",input:{goal:"Exercise the assigned Android pairing"}},
      inputCode: "prepared.request",
      bindingCode: this.androidPairBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<AndroidPairReceiver["runAndroidPairTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies desktop pairing and the Android workspace readback."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyAndroidPair(input: {contextId:string;caseId:string}): ReturnType<AndroidPairReceiver["qualifyAndroidPair"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"mobileSystem",operation:"runMobileScenario"}], this.androidPairBindings(input),
    )) as Awaited<ReturnType<AndroidPairReceiver["qualifyAndroidPair"]>>;
  }

  private androidPairBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId,workspace} from "@workspace/runtime";
      import {phoneSetup} from "@workspace-skills/phone-setup";
      import {prepareManagedAndroidPair} from "@workspace-skills/system-testing/android-pair-managed";
      import {bindInstalledMobileScenario} from "@workspace-skills/mobile-system-testing/live-bindings";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Android pairing belongs to another context");
      const prepared=await prepareManagedAndroidPair(input,await workspace.getActive(),await phoneSetup(),bindInstalledMobileScenario);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned Android development installation."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runAndroidInstallTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<AndroidInstallReceiver["runAndroidInstallTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"mobileSystem",operation:"runMobileScenario",input:{goal:"Exercise the assigned Android development installation"}},
      inputCode: "prepared.request",
      bindingCode: this.androidInstallBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<AndroidInstallReceiver["runAndroidInstallTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the assigned Android installation and readback."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyAndroidInstall(input: {contextId:string;caseId:string}): ReturnType<AndroidInstallReceiver["qualifyAndroidInstall"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"mobileSystem",operation:"runMobileScenario"}], this.androidInstallBindings(input),
    )) as Awaited<ReturnType<AndroidInstallReceiver["qualifyAndroidInstall"]>>;
  }

  private androidInstallBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId,rpc} from "@workspace/runtime";
      import {mainRpcMethods} from "@vibestudio/service-schemas/mainRpc";
      import {prepareManagedAndroidInstall} from "@workspace-skills/system-testing/android-install-managed";
      import {listMobileDebugDevices,bindInstalledMobileScenario,inspectInternalAndroidApp} from "@workspace-skills/mobile-system-testing/live-bindings";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Android installation belongs to another context");
      const {workspaceId}=await rpc.call("main",mainRpcMethods["auth.getConnectionInfo"],[]);
      if(!workspaceId) throw new Error("The assigned Android installation requires a workspace");
      const prepared=await prepareManagedAndroidInstall(input,workspaceId,{
        bind:bindInstalledMobileScenario,inventory:listMobileDebugDevices,verifyApp:inspectInternalAndroidApp,
      });
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned Android runtime audit."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runAndroidAuditTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<AndroidAuditReceiver["runAndroidAuditTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"mobileDebug",operation:"auditAndroidRuntime",input:{goal:"Audit the assigned Android runtime"}},
      inputCode: "prepared.request",
      bindingCode: this.androidAuditBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<AndroidAuditReceiver["runAndroidAuditTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies native Android inventory and application evidence."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyAndroidAudit(input: {contextId:string;caseId:string}): ReturnType<AndroidAuditReceiver["qualifyAndroidAudit"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"mobileDebug",operation:"auditAndroidRuntime"}], this.androidAuditBindings(input),
    )) as Awaited<ReturnType<AndroidAuditReceiver["qualifyAndroidAudit"]>>;
  }

  private androidAuditBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedAndroidAudit} from "@workspace-skills/mobile-runtime-audit-bindings/managed";
      import {androidAuditWorlds} from "@workspace-skills/system-testing/android-audit-worlds";
      import {listAndroidAuditDevices,bindAndroidRuntimeAudit} from "@workspace-skills/mobile-runtime-audit-bindings";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Android audit belongs to another context");
      const world=androidAuditWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown Android audit assignment");
      const prepared=await prepareManagedAndroidAudit(input,world,listAndroidAuditDevices,bindAndroidRuntimeAudit);
      const assignedServices=prepared.services;
    `;
  }

  private managedDeploymentBindings({ contextId, caseId }: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedDeployment} from "@workspace-skills/system-testing/remote-deployment-managed";
      const prepared=await prepareManagedDeployment(${JSON.stringify({contextId,caseId})});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Drives the disposable terminal profile through the assigned deployment."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedDeploymentTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedDeploymentReceiver["runManagedDeploymentTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"remoteAccess",operation:"deployRemoteServer",input:{goal:"Verify the assigned deployment"}},
      inputCode: "prepared.request",
      goalCode: "prepared.goal",
      bindingCode: this.managedDeploymentBindings(input),
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedDeploymentReceiver["runManagedDeploymentTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the assigned hub and terminal path without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedDeployment(input: {contextId:string;caseId:string}): ReturnType<ManagedDeploymentReceiver["qualifyManagedDeployment"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"remoteAccess",operation:"deployRemoteServer"}], this.managedDeploymentBindings(input),
    )) as Awaited<ReturnType<ManagedDeploymentReceiver["qualifyManagedDeployment"]>>;
  }

  private remoteCommissionBindings({ contextId }: {contextId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareRemoteCommission} from "@workspace-skills/system-testing/remote-commission-managed";
      const prepared=await prepareRemoteCommission({contextId:${JSON.stringify(contextId)}});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Drives the disposable terminal profile through approved commissioning."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runRemoteCommissionTeacher(input: {contextId:string;executorModel:string}): ReturnType<RemoteCommissionReceiver["runRemoteCommissionTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"remoteAccess",operation:"commissionRemoteWorkspace",input:{goal:"Open the assigned workspace"}},
      inputCode: "prepared.request",
      goalCode: "prepared.goal",
      bindingCode: this.remoteCommissionBindings(input),
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<RemoteCommissionReceiver["runRemoteCommissionTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the assigned hub and terminal path without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyRemoteCommission(input: {contextId:string}): ReturnType<RemoteCommissionReceiver["qualifyRemoteCommission"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"remoteAccess",operation:"commissionRemoteWorkspace"}], this.remoteCommissionBindings(input),
    )) as Awaited<ReturnType<RemoteCommissionReceiver["qualifyRemoteCommission"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Verifies the assigned live gateway identity."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async runRemoteRouteTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<RemoteRouteReceiver["runRemoteRouteTeacher"]> {
    if (remoteRouteWorlds.find(({id})=>id===input.caseId)?.cli) {
      return await this.runHarnessUtility("teacher",runId=>`${composedTeacherCode({
        executorModel:input.executorModel,
        workflowRequest:{
          goal:"Verify the gateway and plan the assigned CLI continuation",
          work:cliContinuationWork.map(selector=>({...selector,input:{goal:"Verify the assigned CLI context"}})),
        },
        requiredOrder:cliContinuationWork.map(({operation})=>operation),
        requestCode:"prepared.request",
        bindingCode:this.remoteRouteBindings(input,true),
      },runId)}
        utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
      `) as Awaited<ReturnType<RemoteRouteReceiver["runRemoteRouteTeacher"]>>;
    }
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"remoteAccess",operation:"reviewRemoteRoute",input:{goal:"Review the assigned workspace gateway"}},
      inputCode: "prepared.request",
      bindingCode: this.remoteRouteBindings(input),
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<RemoteRouteReceiver["runRemoteRouteTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the actual gateway identity review without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyRemoteRoute(input: {contextId:string;caseId:string}): ReturnType<RemoteRouteReceiver["qualifyRemoteRoute"]> {
    if (remoteRouteWorlds.find(({id})=>id===input.caseId)?.cli)
      return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
        cliContinuationWork, this.remoteRouteBindings(input,true),
      )) as Awaited<ReturnType<RemoteRouteReceiver["qualifyRemoteRoute"]>>;
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"remoteAccess",operation:"reviewRemoteRoute"}], this.remoteRouteBindings(input),
    )) as Awaited<ReturnType<RemoteRouteReceiver["qualifyRemoteRoute"]>>;
  }

  private remoteRouteBindings(input: {contextId:string;caseId:string}, continuation=false): string {
    const prepare=continuation?"prepareCliContinuation":"prepareRemoteRoute";
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {${prepare}} from "@workspace-skills/system-testing/remote-route-managed";
      const prepared=await ${prepare}(${JSON.stringify({contextId:input.contextId,caseId:input.caseId})});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Runs a scoped shell notification lifecycle in the owned test workspace."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedNotificationTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedNotificationReceiver["runManagedNotificationTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`
      ${this.notificationBindings(input)}
      let output;
      try {
        ${domainTeacherCode({
          executorModel:input.executorModel,
          work:{kind:"domain",domain:"conversation",operation:"runNotificationLifecycle",input:{goal:"Show and dismiss the assigned notification"}},
          inputCode:"prepared.request",
          bindingCode:"const assignedServices=prepared.services;",
        },runId)}
        output={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
      } finally { await prepared.cleanup(); }
      const utilityValue=output;
    `) as Awaited<ReturnType<ManagedNotificationReceiver["runManagedNotificationTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies an owned shell notification lifecycle without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedNotification(input: {contextId:string;caseId:string}): ReturnType<ManagedNotificationReceiver["qualifyManagedNotification"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.notificationBindings(input)}
      let output;
      try {
        ${domainTeacherQualificationCode([{domain:"conversation",operation:"runNotificationLifecycle"}],"const assignedServices=prepared.services;")}
        output=utilityValue;
      } finally { await prepared.cleanup(); }
      const utilityValue=output;
    `) as Awaited<ReturnType<ManagedNotificationReceiver["qualifyManagedNotification"]>>;
  }

  private notificationBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedNotification} from "@workspace-skills/system-testing/notification-lifecycle-managed";
      const prepared=prepareManagedNotification(${JSON.stringify({contextId:input.contextId,caseId:input.caseId})});
    `;
  }

  @rpc({website:{kind:"closed",reason:"Triages the failed diagnostic from one owned fixture run."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runRetainedTriageTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<RetainedTriageReceiver["runRetainedTriageTeacher"]> {
    const bindingCode = await this.retainedTriageBindings(input);
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"testReview",operation:"reviewRetainedFailure",input:{goal:"Triage the assigned retained diagnostic"}},
      inputCode: "prepared.request",
      bindingCode,
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<RetainedTriageReceiver["runRetainedTriageTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies retained triage after releasing the actual fixture run."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyRetainedTriage(input: {contextId:string;caseId:string}): ReturnType<RetainedTriageReceiver["qualifyRetainedTriage"]> {
    const bindingCode = await this.retainedTriageBindings(input);
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"testReview",operation:"reviewRetainedFailure"}], bindingCode,
    )) as Awaited<ReturnType<RetainedTriageReceiver["qualifyRetainedTriage"]>>;
  }

  private async retainedTriageBindings(input: {contextId:string;caseId:string}): Promise<string> {
    const world = retainedTriageWorlds.find(({id})=>id===input.caseId);
    const owner = await this.integrationFixtureIdentity();
    if (!world || owner.contextId!==input.contextId || !this.caller?.userId || this.caller.userId==="system")
      throw new Error("Retained triage requires the assigned case and authenticated fixture owner");
    const runId = `retained-triage-${crypto.randomUUID()}`;
    let released = false;
    try {
      const result = await createEvalExecutor(createMainRpcCaller(this.rpc))(
        systemTestEvaluation({runId,contextId:input.contextId,names:[world.testName],concurrency:1},this.rpcSelfId),
      );
      if (!result.success)
        throw new Error(result.error ? formatRpcFailure(deserializeRpcFailure(result.error)) : "The retained triage fixture execution failed");
      const summary = (await this.getSystemTestRunResult(runId)).summary;
      if (summary.total !== 1 || summary.failedTests.length !== 1 || summary.failedTests[0] !== world.testName)
        throw new Error("The retained triage fixture did not persist the assigned failed test");
      released = (await this.releaseSystemTestRunExecution(runId)).released;
      if (!released) throw new Error("The retained triage fixture did not release the source execution");
    } finally {
      if (!released) await this.rpc.call("main",mainRpcMethods["eval.dispose"],[{scopeKey:runId}]);
    }
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareRetainedTriage} from "@workspace-skills/system-testing/retained-triage-managed";
      const prepared=prepareRetainedTriage(${JSON.stringify({contextId:input.contextId,caseId:input.caseId,runId,runnerTargetId:this.rpcSelfId,released})});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the assigned Personal GitHub connection without verifying it."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async runGitHubSetupTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<GitHubSetupReceiver["runGitHubSetupTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"github",operation:"reviewGitHubSetup",input:{goal:"Review the assigned GitHub connection"}},
      inputCode: "prepared.request",
      bindingCode: this.gitHubSetupBindings(input),
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<GitHubSetupReceiver["runGitHubSetupTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Diagnoses a caller-assigned local GitHub preflight."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedGitHubDiagnosisTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedGitHubDiagnosisReceiver["runManagedGitHubDiagnosisTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"github",operation:"diagnoseGitHubOperation",input:{goal:"Diagnose the assigned GitHub operation"}},
      inputCode:"prepared.request",
      bindingCode:this.gitHubDiagnosisBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedGitHubDiagnosisReceiver["runManagedGitHubDiagnosisTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies local GitHub preflight and setup routing without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedGitHubDiagnosis(input: {contextId:string;caseId:string}): ReturnType<ManagedGitHubDiagnosisReceiver["qualifyManagedGitHubDiagnosis"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"github",operation:"diagnoseGitHubOperation"}],this.gitHubDiagnosisBindings(input),
    )) as Awaited<ReturnType<ManagedGitHubDiagnosisReceiver["qualifyManagedGitHubDiagnosis"]>>;
  }

  private gitHubDiagnosisBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {bindGitHubDiagnosis} from "@workspace-skills/github/diagnosis";
      import {listGitHubCredentials} from "@workspace-skills/github";
      import {prepareManagedGitHubDiagnosis} from "@workspace-skills/github/diagnosis-managed";
      import {managedGitHubDiagnosisWorlds} from "@workspace-skills/system-testing/github-diagnosis-worlds";
      const input=${JSON.stringify({contextId:input.contextId,caseId:input.caseId})};
      const world=managedGitHubDiagnosisWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown assigned github-diagnosis case");
      const prepared=await prepareManagedGitHubDiagnosis(input,world,{
        bind:bindGitHubDiagnosis,countCredentials:async()=>(await listGitHubCredentials()).length,
      });
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews assigned working and published extension manifests."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedUnitDesignTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedUnitDesignReceiver["runManagedUnitDesignTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"unitDesign",operation:"reviewWorkspaceUnit",input:{goal:"Review the assigned extension design"}},
      inputCode:"prepared.request",
      bindingCode:this.unitDesignBindings(input),
    },runId)}
      utilityValue={teacher:utilityValue,contextId:actualContextId,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedUnitDesignReceiver["runManagedUnitDesignTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies assigned extension manifest validation without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedUnitDesign(input: {contextId:string;caseId:string}): ReturnType<ManagedUnitDesignReceiver["qualifyManagedUnitDesign"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"unitDesign",operation:"reviewWorkspaceUnit"}],this.unitDesignBindings(input),
    )) as Awaited<ReturnType<ManagedUnitDesignReceiver["qualifyManagedUnitDesign"]>>;
  }

  private unitDesignBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedUnitDesign} from "@workspace-skills/system-testing/unit-design-managed";
      const prepared=await prepareManagedUnitDesign(${JSON.stringify({contextId:input.contextId,caseId:input.caseId})});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned Personal repository handoff."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runPersonalResumeTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<PersonalResumeReceiver["runPersonalResumeTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"personal",operation:"runPersonalWorkflow",input:{goal:"Resume the assigned repository"}},
      inputCode:"prepared.request",
      bindingCode:this.personalResumeBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<PersonalResumeReceiver["runPersonalResumeTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies repository and GitHub owner reads without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyPersonalResume(input: {contextId:string;caseId:string}): ReturnType<PersonalResumeReceiver["qualifyPersonalResume"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"personal",operation:"runPersonalWorkflow"}],this.personalResumeBindings(input),
    )) as Awaited<ReturnType<PersonalResumeReceiver["qualifyPersonalResume"]>>;
  }

  private personalResumeBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {getGitHubOnboardingStatus,personalRepositoryWorkflowInput} from "@workspace-skills/github";
      import {composeOnboardingCapabilities,onboardingInteraction,resolveOnboardingSelection,personalSetupWorkflowInput} from "@workspace-skills/onboarding";
      import {preparePersonalResume} from "@workspace-skills/github/resume-managed";
      import {personalResumeWorlds} from "@workspace-skills/system-testing/personal-resume-worlds";
      const input=${JSON.stringify({contextId:input.contextId,caseId:input.caseId})};
      const world=personalResumeWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown assigned personal-resume case");
      const prepared=await preparePersonalResume(input,world,{
        async inspect(goal,repository,clean){
          return personalRepositoryWorkflowInput(goal,repository,clean?"clean":"dirty",await getGitHubOnboardingStatus());
        },
        async resolve(goal,action){
          const capabilityId="connection.github";
          const overview=await composeOnboardingCapabilities();
          const selection=resolveOnboardingSelection(onboardingInteraction(capabilityId,action),overview.catalog);
          return personalSetupWorkflowInput(goal,"selection",{
            catalog:overview.catalog.filter(row=>row.id===capabilityId),
            snapshot:overview.snapshot.filter(row=>row.id===capabilityId),
          },selection);
        },
      });
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Checks live Personal GitHub setup routing without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyGitHubSetup(input: {contextId:string;caseId:string}): ReturnType<GitHubSetupReceiver["qualifyGitHubSetup"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"github",operation:"reviewGitHubSetup"}], this.gitHubSetupBindings(input),
    )) as Awaited<ReturnType<GitHubSetupReceiver["qualifyGitHubSetup"]>>;
  }

  private gitHubSetupBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {listGitHubCredentials} from "@workspace-skills/github";
      import {bindGitHubSetupReview} from "@workspace-skills/github/setup-review";
      import {prepareGitHubSetup} from "@workspace-skills/system-testing/github-setup-managed";
      const prepared=await prepareGitHubSetup(${JSON.stringify({contextId:input.contextId,caseId:input.caseId})},{
        bind:bindGitHubSetupReview,countCredentials:async ()=>(await listGitHubCredentials()).length,
      });
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the assigned native template authoring plan."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async runTemplateReleaseTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<TemplateReleaseReceiver["runTemplateReleaseTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"templates",operation:"reviewTemplateRelease",input:{goal:"Review the assigned template plan"}},
      inputCode: "prepared.request",
      bindingCode: this.templateReleaseBindings(input),
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<TemplateReleaseReceiver["runTemplateReleaseTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks live protected-main authoring receipts without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyTemplateRelease(input: {contextId:string;caseId:string}): ReturnType<TemplateReleaseReceiver["qualifyTemplateRelease"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"templates",operation:"reviewTemplateRelease"}], this.templateReleaseBindings(input),
    )) as Awaited<ReturnType<TemplateReleaseReceiver["qualifyTemplateRelease"]>>;
  }

  private templateReleaseBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareTemplateRelease} from "@workspace-skills/system-testing/template-release-managed";
      const prepared=await prepareTemplateRelease(${JSON.stringify({contextId:input.contextId,caseId:input.caseId})});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the assigned live approval observations."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async runManagedApprovalTransitionTeacher(input: Parameters<ManagedApprovalTransitionReceiver["runManagedApprovalTransitionTeacher"]>[0]): ReturnType<ManagedApprovalTransitionReceiver["runManagedApprovalTransitionTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"capabilities",operation:"reviewApprovalTransition",input:{goal:"Review the assigned approval observations"}},
      inputCode: "prepared.request",
      bindingCode: this.approvalTransitionBindings(input),
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedApprovalTransitionReceiver["runManagedApprovalTransitionTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Verifies the managed approval observations without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyManagedApprovalTransition(input: Parameters<ManagedApprovalTransitionReceiver["qualifyManagedApprovalTransition"]>[0]): ReturnType<ManagedApprovalTransitionReceiver["qualifyManagedApprovalTransition"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"capabilities",operation:"reviewApprovalTransition"}], this.approvalTransitionBindings(input),
    )) as Awaited<ReturnType<ManagedApprovalTransitionReceiver["qualifyManagedApprovalTransition"]>>;
  }

  private approvalTransitionBindings({ contextId, observation }: Parameters<ManagedApprovalTransitionReceiver["qualifyManagedApprovalTransition"]>[0]): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedApprovalTransition} from "@workspace-skills/system-testing/approval-transition-managed";
      const prepared=prepareManagedApprovalTransition(${JSON.stringify({contextId,observation})});
      const assignedServices={};
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the assigned native template update offer."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async runTemplateCandidateTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedTemplateCandidateReceiver["runTemplateCandidateTeacher"]> {
    return await this.runHarnessUtility("teacher", runId => `${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"templateCandidate",operation:"stageTemplateCandidate",input:{goal:"Review the assigned template update"}},
      inputCode: "prepared.request",
      bindingCode: this.templateCandidateBindings(input),
    }, runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedTemplateCandidateReceiver["runTemplateCandidateTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Checks live template update and protected-main receipts without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async qualifyTemplateCandidate(input: {contextId:string;caseId:string}): ReturnType<ManagedTemplateCandidateReceiver["qualifyTemplateCandidate"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [{domain:"templateCandidate",operation:"stageTemplateCandidate"}], this.templateCandidateBindings(input),
    )) as Awaited<ReturnType<ManagedTemplateCandidateReceiver["qualifyTemplateCandidate"]>>;
  }

  private templateCandidateBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedTemplateCandidate} from "@workspace-skills/system-testing/template-candidate-managed";
      const prepared=await prepareManagedTemplateCandidate(${JSON.stringify({contextId:input.contextId,caseId:input.caseId})});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures a scoped delivery history audit."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runDeliveryHistoryTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<DeliveryHistoryReceiver["runDeliveryHistoryTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"conversation",operation:deliveryHistoryOperation(input.caseId),input:{goal:"Audit the assigned delivery receipt"}},
      inputCode: "prepared.request",
      bindingCode: this.deliveryHistoryBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report).finally(prepared.release)};
    `) as Awaited<ReturnType<DeliveryHistoryReceiver["runDeliveryHistoryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies actual channel replay and consumer identity without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyDeliveryHistory(input: {contextId:string;caseId:string}): ReturnType<DeliveryHistoryReceiver["qualifyDeliveryHistory"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"conversation",operation:deliveryHistoryOperation(input.caseId)}], this.deliveryHistoryBindings(input),
    )) as Awaited<ReturnType<DeliveryHistoryReceiver["qualifyDeliveryHistory"]>>;
  }

  private deliveryHistoryBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareDeliveryHistory} from "@workspace-skills/system-testing/delivery-history-managed";
      const prepared=await prepareDeliveryHistory(${JSON.stringify(input)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned bounded channel transcript read."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runTranscriptCursorTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<TranscriptCursorReceiver["runTranscriptCursorTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"sessionTest",operation:"resumeChannelTranscript",input:{goal:"Recover the assigned transcript"}},
      inputCode: "prepared.request",
      bindingCode: this.transcriptCursorBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<TranscriptCursorReceiver["runTranscriptCursorTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies actual replay coordinates without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyTranscriptCursor(input: {contextId:string;caseId:string}): ReturnType<TranscriptCursorReceiver["qualifyTranscriptCursor"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"sessionTest",operation:"resumeChannelTranscript"}], this.transcriptCursorBindings(input),
    )) as Awaited<ReturnType<TranscriptCursorReceiver["qualifyTranscriptCursor"]>>;
  }

  private transcriptCursorBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareTranscriptCase} from "@workspace-skills/system-testing/transcript-cursor-managed";
      const prepared=await prepareTranscriptCase(${JSON.stringify(input)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned unit identity review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runUnitIdentityTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<UnitIdentityReceiver["runUnitIdentityTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"unitIdentity",operation:"prepareUnitIdentity",input:{goal:"Review the assigned unit icon"}},
      inputCode: "prepared.request",
      bindingCode: this.unitIdentityBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<UnitIdentityReceiver["runUnitIdentityTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies icon preparation against the actual working state without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyUnitIdentity(input: {contextId:string;caseId:string}): ReturnType<UnitIdentityReceiver["qualifyUnitIdentity"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"unitIdentity",operation:"prepareUnitIdentity"}], this.unitIdentityBindings(input),
    )) as Awaited<ReturnType<UnitIdentityReceiver["qualifyUnitIdentity"]>>;
  }

  private unitIdentityBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareUnitIdentityCase} from "@workspace-skills/system-testing/unit-identity-managed";
      const prepared=await prepareUnitIdentityCase(${JSON.stringify(input)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned Gmail compose history review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runGmailComposeHistoryTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<GmailComposeHistoryReceiver["runGmailComposeHistoryTeacher"]> {
    const bindings = await this.gmailComposeBindings(input);
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"gmailReview",operation:"auditComposeHistory",input:{goal:"Review the assigned compose history"}},
      inputCode: "prepared.request",
      bindingCode: bindings,
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<GmailComposeHistoryReceiver["runGmailComposeHistoryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies native compose channel receipts without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyGmailComposeHistory(input: {contextId:string;caseId:string}): ReturnType<GmailComposeHistoryReceiver["qualifyGmailComposeHistory"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"gmailReview",operation:"auditComposeHistory"}],
      await this.gmailComposeBindings(input),
    )) as Awaited<ReturnType<GmailComposeHistoryReceiver["qualifyGmailComposeHistory"]>>;
  }

  private async gmailComposeBindings(input: {contextId:string;caseId:string}, continuation = false): Promise<string> {
    const identity = await this.integrationFixtureIdentity();
    if (identity.contextId !== input.contextId) throw new Error("Compose history belongs to another context");
    const seed = await seedGmailComposeChannel(this.rpc,input,identity.ownerEntityId);
    return `
      import {contextId as ${continuation ? "composeContextId" : "actualContextId"}} from "@workspace/runtime";
      import {bindGmailComposeHistory} from "@workspace-skills/gmail-compose-history-bindings";
      import {prepareGmailComposeHistory} from "@workspace-skills/system-testing/gmail-compose-history-managed";
      const seed=${JSON.stringify(seed)};
      if(${continuation ? "composeContextId" : "actualContextId"}!==seed.contextId) throw new Error("Compose history belongs to another context");
      const bound=bindGmailComposeHistory({...seed,envelopeIds:seed.lineage.map(item=>item.id)});
      const ${continuation ? "compose" : "prepared"}=prepareGmailComposeHistory(seed,bound);
      ${continuation ? "" : "const assignedServices=prepared.services;"}
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned text contract probe."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runExplorerProbeTeacher(input: ExplorerProbeInput & {executorModel:string}): ReturnType<ExplorerProbeReceiver["runExplorerProbeTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"explorer",operation:"probeWorkspaceText",input:{goal:"Probe the assigned text stores"}},
      inputCode: "prepared.request",
      bindingCode: this.explorerProbeBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ExplorerProbeReceiver["runExplorerProbeTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the native text round trip without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyExplorerProbe(input: ExplorerProbeInput): ReturnType<ExplorerProbeReceiver["qualifyExplorerProbe"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"explorer",operation:"probeWorkspaceText"}],
      this.explorerProbeBindings(input),
    )) as Awaited<ReturnType<ExplorerProbeReceiver["qualifyExplorerProbe"]>>;
  }

  private explorerProbeBindings(input: ExplorerProbeInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {bindExplorerTextProbe} from "@workspace-skills/explorer-probe-bindings";
      import {prepareExplorerProbe} from "@workspace-skills/system-testing/explorer-probe-managed";
      import {explorerTextWorlds} from "@workspace-skills/system-testing/explorer-probe-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Explorer probe belongs to another context");
      const world=explorerTextWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown Explorer probe assignment");
      const prepared=prepareExplorerProbe(input,bindExplorerTextProbe(world));
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures a rehearsal on the assigned tour panel."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runTourRehearsalTeacher(input: TourRehearsalInput & {executorModel:string}): ReturnType<TourRehearsalReceiver["runTourRehearsalTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"tour",operation:"rehearseTour",input:{goal:"Rehearse the assigned tour"}},
      inputCode: "prepared.request",
      bindingCode: this.tourRehearsalBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<TourRehearsalReceiver["runTourRehearsalTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the real tour state and presentation without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyTourRehearsal(input: TourRehearsalInput): ReturnType<TourRehearsalReceiver["qualifyTourRehearsal"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"tour",operation:"rehearseTour"}],
      this.tourRehearsalBindings(input),
    )) as Awaited<ReturnType<TourRehearsalReceiver["qualifyTourRehearsal"]>>;
  }

  private tourRehearsalBindings(input: TourRehearsalInput): string {
    return `
      import {contextId as actualContextId,panelTree} from "@workspace/runtime";
      import {bindTourRehearsal} from "@workspace-skills/tour-rehearsal-bindings";
      import {prepareTourRehearsal} from "@workspace-skills/system-testing/tour-rehearsal-managed";
      import {tourRehearsalWorlds} from "@workspace-skills/system-testing/tour-rehearsal-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Tour rehearsal belongs to another context");
      const world=tourRehearsalWorlds.find(({id})=>id===input.caseId);
      if(!world) throw new Error("Unknown tour rehearsal assignment");
      const bound=bindTourRehearsal(panelTree.get(input.panelId),{
        contextId:actualContextId,allowed:[...world.allowed],topics:[...world.topics],goal:world.goal,restore:world.restore,
      });
      const prepared=prepareTourRehearsal(input,bound);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned native build performance review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runBuildPerformanceTeacher(input: BuildPerformanceInput & {executorModel:string}): ReturnType<BuildPerformanceReceiver["runBuildPerformanceTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel: input.executorModel,
      work: {kind:"domain",domain:"performance",operation:"reviewBuildPerformance",input:{goal:input.goal}},
      inputCode: "prepared.request",
      bindingCode: this.buildPerformanceBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<BuildPerformanceReceiver["runBuildPerformanceTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the native build and same-key repeat without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyBuildPerformance(input: BuildPerformanceInput): ReturnType<BuildPerformanceReceiver["qualifyBuildPerformance"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [{domain:"performance",operation:"reviewBuildPerformance"}],
      this.buildPerformanceBindings(input),
    )) as Awaited<ReturnType<BuildPerformanceReceiver["qualifyBuildPerformance"]>>;
  }

  private buildPerformanceBindings(input: BuildPerformanceInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {bindBuildPerformance} from "@workspace-skills/performance-build-bindings";
      import {prepareBuildPerformance} from "@workspace-skills/system-testing/build-performance-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Build performance belongs to another context");
      const prepared=prepareBuildPerformance(input,bindBuildPerformance(input));
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned host log cursor review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedLogCursorTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedLogCursorReceiver["runManagedLogCursorTeacher"]> {
    const bindings=await this.managedLogCursorBindings(input);
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.LogCursor,
      inputCode:"prepared.request",
      bindingCode:bindings,
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedLogCursorReceiver["runManagedLogCursorTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies host log cursor resumption without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedLogCursor(input: {contextId:string;caseId:string}): ReturnType<ManagedLogCursorReceiver["qualifyManagedLogCursor"]> {
    const bindings=await this.managedLogCursorBindings(input);
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.LogCursor],
      bindings,
    )) as Awaited<ReturnType<ManagedLogCursorReceiver["qualifyManagedLogCursor"]>>;
  }

  private async managedLogCursorBindings(input: {contextId:string;caseId:string}): Promise<string> {
    const world=managedLogCursorWorlds.find(({id})=>id===input.caseId);
    if (!world) throw new Error("Unknown assigned saved host log cursor");
    const seed=await this.seedAssignedHostLog(input.contextId, world.lines);
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedLogCursor} from "@workspace-skills/system-testing/log-cursor-managed";
      import {bindServerLogCursor} from "@workspace-skills/server-log-cursor-bindings";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Host log cursor review belongs to another context");
      const prepared=prepareManagedLogCursor(input,${JSON.stringify(seed)},bindServerLogCursor);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned host log handoff."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedLogHandoffTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedLogHandoffReceiver["runManagedLogHandoffTeacher"]> {
    const bindings=await this.managedLogHandoffBindings(input);
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.LogHandoff,
      inputCode:"prepared.request",
      bindingCode:bindings,
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedLogHandoffReceiver["runManagedLogHandoffTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies host log handoff without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedLogHandoff(input: {contextId:string;caseId:string}): ReturnType<ManagedLogHandoffReceiver["qualifyManagedLogHandoff"]> {
    const bindings=await this.managedLogHandoffBindings(input);
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.LogHandoff],
      bindings,
    )) as Awaited<ReturnType<ManagedLogHandoffReceiver["qualifyManagedLogHandoff"]>>;
  }

  private async managedLogHandoffBindings(input: {contextId:string;caseId:string}): Promise<string> {
    const world=managedLogHandoffWorlds.find(({id})=>id===input.caseId);
    if (!world) throw new Error("Unknown assigned host-log handoff");
    const lines=[...world.earlier,...world.later].flatMap(({line,repeat})=>Array<string>(repeat).fill(line));
    const seed=await this.seedAssignedHostLog(input.contextId, lines);
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedLogHandoff} from "@workspace-skills/system-testing/log-handoff-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Host log handoff belongs to another context");
      const prepared=prepareManagedLogHandoff(input,${JSON.stringify(seed)});
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned PDF layout review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedPdfLayoutTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedPdfLayoutReceiver["runManagedPdfLayoutTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.PdfLayout,
      inputCode:"prepared.request",
      bindingCode:this.managedPdfLayoutBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedPdfLayoutReceiver["runManagedPdfLayoutTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies actual PDF fragment geometry without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedPdfLayout(input: {contextId:string;caseId:string}): ReturnType<ManagedPdfLayoutReceiver["qualifyManagedPdfLayout"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.PdfLayout],
      this.managedPdfLayoutBindings(input),
    )) as Awaited<ReturnType<ManagedPdfLayoutReceiver["qualifyManagedPdfLayout"]>>;
  }

  private managedPdfLayoutBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedPdfLayout} from "@workspace-skills/system-testing/pdf-layout-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("PDF layout review belongs to another context");
      const prepared=prepareManagedPdfLayout(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned offline dictation review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedDictationTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedDictationReceiver["runManagedDictationTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.Dictation,
      inputCode:"prepared.request",
      bindingCode:this.managedDictationBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedDictationReceiver["runManagedDictationTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies installed speech readiness without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedDictation(input: {contextId:string;caseId:string}): ReturnType<ManagedDictationReceiver["qualifyManagedDictation"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.Dictation],
      this.managedDictationBindings(input),
    )) as Awaited<ReturnType<ManagedDictationReceiver["qualifyManagedDictation"]>>;
  }

  private managedDictationBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedDictation} from "@workspace-skills/system-testing/offline-dictation-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Dictation review belongs to another context");
      const prepared=prepareManagedDictation(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned declared test suite review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedNativeSuiteTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedNativeSuiteReceiver["runManagedNativeSuiteTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.NativeSuite,
      inputCode:"prepared.request",
      bindingCode:this.managedNativeSuiteBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedNativeSuiteReceiver["runManagedNativeSuiteTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies suite declarations and verification without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedNativeSuite(input: {contextId:string;caseId:string}): ReturnType<ManagedNativeSuiteReceiver["qualifyManagedNativeSuite"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.NativeSuite],
      this.managedNativeSuiteBindings(input),
    )) as Awaited<ReturnType<ManagedNativeSuiteReceiver["qualifyManagedNativeSuite"]>>;
  }

  private managedNativeSuiteBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedNativeSuite} from "@workspace-skills/system-testing/native-suite-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Suite review belongs to another context");
      const prepared=prepareManagedNativeSuite(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned public source brief."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedWebBriefTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedWebBriefReceiver["runManagedWebBriefTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.WebBrief,
      inputCode:"prepared.request",
      bindingCode:this.managedWebBriefBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedWebBriefReceiver["runManagedWebBriefTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live public page fetches and receipts without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedWebBrief(input: {contextId:string;caseId:string}): ReturnType<ManagedWebBriefReceiver["qualifyManagedWebBrief"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.WebBrief],
      this.managedWebBriefBindings(input),
    )) as Awaited<ReturnType<ManagedWebBriefReceiver["qualifyManagedWebBrief"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Reviews receipts from assigned public evidence."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedResearchIntakeTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedWebBriefReceiver["runManagedResearchIntakeTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,work:managedDomainWork.ResearchIntake,
      inputCode:"prepared.request",bindingCode:this.managedWebBriefBindings(input,true),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedWebBriefReceiver["runManagedResearchIntakeTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies assigned research receipt reads without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedResearchIntake(input: {contextId:string;caseId:string}): ReturnType<ManagedWebBriefReceiver["qualifyManagedResearchIntake"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      [managedDomainWork.ResearchIntake],this.managedWebBriefBindings(input,true),
    )) as Awaited<ReturnType<ManagedWebBriefReceiver["qualifyManagedResearchIntake"]>>;
  }

  private managedWebBriefBindings(input: {contextId:string;caseId:string}, intake=false): string {
    const prepare=intake?"prepareManagedResearchIntake":"prepareManagedWebBrief";
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {${prepare}} from "@workspace-skills/system-testing/web-brief-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Web brief belongs to another context");
      const prepared=${prepare}(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Runs a user goal in an owned system-test context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runOpenGoalTeacher(input: Parameters<OpenGoalReceiver["runOpenGoalTeacher"]>[0]): ReturnType<OpenGoalReceiver["runOpenGoalTeacher"]> {
    const assembly = openAssemblyWorlds.some(({ id }) => id === input.caseId);
    const templateMigration = openTemplateMigrationWorlds.some(({ id }) => id === input.caseId);
    const capabilityPlan = capabilityPlanWorlds.some(({ id }) => id === input.caseId);
    const ownedResearch = openOwnedResearchWorlds.some(({ id }) => id === input.caseId);
    const terminalHandoff = openTerminalWorlds.some(({ id }) => id === input.caseId);
    const evalHandoff = openGoalEvalHandoffWorlds.find(({ id }) => id === input.caseId);
    const programRun = openGoalProgramRunWorlds.find(({ id }) => id === input.caseId);
    const authoring = openGoalAuthoringWorlds.find(({ id }) => id === input.caseId);
    const google = openGoalGoogleWorlds.find(({ id }) => id === input.caseId);
    const googleSetup = openGoalGoogleSetupWorlds.find(({ id }) => id === input.caseId);
    const githubWork = openGoalGitHubWorlds.find(({ id }) => id === input.caseId);
    const apiReadiness = openApiReadinessWorlds.some(({ id }) => id === input.caseId);
    const chatContinuity = openChatContinuityWorlds.some(({ id }) => id === input.caseId);
    const editorialPacket = openEditorialWorlds.some(({ id }) => id === input.caseId);
    const demoPortfolio = openPortfolioWorlds.some(({ id }) => id === input.caseId);
    const regencyBriefing = openRegencyWorlds.some(({ id }) => id === input.caseId);
    const imageCandidate = openImageCandidateWorlds.some(({ id }) => id === input.caseId);
    const newsEvidence = openNewsEvidenceWorlds.some(({ id }) => id === input.caseId);
    const news = newsGoalWorlds.find(({ id }) => id === input.caseId);
    const vaultKnowledge = openVaultKnowledgeWorlds.find(({ id }) => id === input.caseId);
    const spectrolite = spectroliteGoalWorlds.find(({ id }) => id === input.caseId);
    const personal = openGoalPersonalWorlds.find(({ id }) => id === input.caseId);
    const operator = operatorGoalWorlds.some(({ id }) => id === input.caseId);
    const localDelivery = openLocalDeliveryWorlds.find(({ id }) => id === input.caseId);
    const recovery = openGoalRecoveryWorlds.find(({ id }) => id === input.caseId);
    const clientDiagnostics = openClientDiagnosticsWorlds.find(({ id }) => id === input.caseId);
    const visualRecovery = openGoalPanelRecoveryWorlds.some(({ id }) => id === input.caseId);
    const ownedPreview = openGoalOwnedPreviewWorlds.some(({ id }) => id === input.caseId);
    const publication = publicationGoalWorlds.some(({ id }) => id === input.caseId);
    const pdf = openGoalPdfWorlds.some(({ id }) => id === input.caseId);
    const gmail = openGoalGmailWorlds.find(({ id }) => id === input.caseId);
    let gmailSeed;
    if (gmail) {
      const identity = await this.integrationFixtureIdentity();
      if (identity.contextId !== input.contextId) throw new Error("Gmail goal belongs to another context");
      gmailSeed = await seedOpenGmailComposes(this.rpc, input, identity.ownerEntityId, gmail.composes);
    }
    const pdfVault = openGoalPdfVaultWorlds.some(({ id }) => id === input.caseId);
    const calendar = openGoalCalendarWorlds.find(({ id }) => id === input.caseId);
    const personalArtifacts = openPersonalArtifactWorlds.find(({ id }) => id === input.caseId);
    const browserMigration = openBrowserMigrationWorlds.find(({ id }) => id === input.caseId);
    const personalHistory = openPersonalHistoryWorlds.find(({ id }) => id === input.caseId);
    const googleHandoff = openGoalGoogleHandoffWorlds.find(({ id }) => id === input.caseId);
    const personalAutomation = openPersonalAutomationWorlds.find(({ id }) => id === input.caseId);
    const diagnostics = openDiagnosticWorlds.find(({ id }) => id === input.caseId);
    const diagnosticsSeed = diagnostics ? await this.seedAssignedHostLog(input.contextId, diagnostics.lines) : null;
    let automationSeed: Awaited<ReturnType<typeof seedOpenPersonalAutomation>> | undefined;
    if (personalAutomation) {
      const owner = await this.integrationFixtureIdentity();
      if (owner.contextId !== input.contextId) throw new Error("Automation goal belongs to another context");
      automationSeed = await seedOpenPersonalAutomation(this.rpc, personalAutomation);
    }
    const reconciliation = openReconciliationWorlds.find(({ id }) => id === input.caseId);
    const reconciliationSeed = reconciliation && await this.seedWorkspaceIntegration(
      { seed: reconciliation.id, worldId: reconciliation.id }, reconciliation.assignment,
    );
    const unitRollout = openUnitRolloutWorlds.find(({ id }) => id === input.caseId);
    const ownedTask = openOwnedTaskWorlds.find(({ id }) => id === input.caseId);
    const scheduledRecovery = openScheduledRecoveryWorlds.find(({ id }) => id === input.caseId);
    let scheduledSeed: Awaited<ReturnType<typeof seedOwnedScheduledRecovery>> | undefined;
    if (scheduledRecovery) {
      const owner = await this.integrationFixtureIdentity();
      if (owner.contextId !== input.contextId) throw new Error("Scheduled recovery belongs to another context");
      scheduledSeed = await seedOwnedScheduledRecovery(this.rpc, scheduledRecovery);
    }
    const compoundRecovery = openCompoundRecoveryWorlds.find(({ id }) => id === input.caseId);
    const personalWelcome = personalWelcomeWorlds.some(({ id }) => id === input.caseId);
    const dictationHandoff = dictationHandoffWorlds.some(({ id }) => id === input.caseId);
    const specialistHandoff = specialistHandoffWorlds.some(({ id }) => id === input.caseId);
    const providerHandoff = providerHandoffWorlds.some(({ id }) => id === input.caseId);
    const problemReport = openProblemReportWorlds.some(({ id }) => id === input.caseId);
    const buildIncident = openBuildIncidentWorlds.find(({ id }) => id === input.caseId);
    const localWidth = openLocalWidthWorlds.find(({ id }) => id === input.caseId);
    const adventure = openAdventureJourneyWorlds.find(({ id }) => id === input.caseId);
    const presentation = openLocalPresentationWorlds.find(({ id }) => id === input.caseId);
    const deployedInterface = openDeployedInterfaceWorlds.find(({ id }) => id === input.caseId);
    const extensionDossier = openExtensionDossierWorlds.find(({ id }) => id === input.caseId);
    const tendrilRoute = openTendrilRouteWorlds.find(({ id }) => id === input.caseId);
    const installedPackage = openInstalledPackageWorlds.find(({ id }) => id === input.caseId);
    const assetIntegrity = openAssetIntegrityWorlds.find(({ id }) => id === input.caseId);
    const mobileContinuity = openMobileContinuityWorlds.find(({ id }) => id === input.caseId);
    const agentCapability = openAgentCapabilityWorlds.find(({ id }) => id === input.caseId);
    const workspaceShare = openWorkspaceShareWorlds.find(({ id }) => id === input.caseId);
    const notificationState = openNotificationStateWorlds.find(({ id }) => id === input.caseId);
    const desktopReadiness = openDesktopReadinessWorlds.find(({ id }) => id === input.caseId);
    const panelSourceMigration = openPanelSourceMigrationWorlds.find(({ id }) => id === input.caseId);
    const skillMaintenance = openSkillMaintenanceWorlds.find(({ id }) => id === input.caseId);
    const phoneFirstRun = openPhoneFirstRunWorlds.find(({ id }) => id === input.caseId);
    const testkitCloseout = openTestkitCloseoutWorlds.find(({ id }) => id === input.caseId);
    const systemRelease = openSystemReleaseWorlds.find(({ id }) => id === input.caseId);
    let systemReleaseSeed: Awaited<ReturnType<typeof seedSystemRelease>> | undefined;
    if (systemRelease) {
      const owner = await this.integrationFixtureIdentity();
      if (owner.contextId !== input.contextId) throw new Error("System release review belongs to another context");
      systemReleaseSeed = await seedSystemRelease(input.contextId, systemRelease, {
        put: text => this.rpc.call("main", mainRpcMethods["blobstore.putText"], [text]),
        persist: (runId, record, entries) => this.storeSystemTestRunCheckpoint(runId, record, entries),
      });
    }
    const contentArchive = openContentArchiveWorlds.find(({ id }) => id === input.caseId);
    const prepare = phoneFirstRun
      ? `import {vcs} from "@workspace/runtime";
         import {preparePhoneFirstRun} from "@workspace-skills/system-testing/open-goal-phone-first-run-managed";
         import {workspacePhoneReadiness} from "@workspace-clients/mobile-browser/phone-readiness";
         import {bindPhoneSetup} from "@workspace-skills/phone-setup/workflow";
         import {eligiblePhoneDesktops} from "@workspace-skills/phone-setup/eligibility";
         const prepared=await preparePhoneFirstRun(input,${JSON.stringify(phoneFirstRun)},
           {contextId:actualContextId,vcs,workspacePhoneReadiness,bindPhoneSetup,eligiblePhoneDesktops});`
      : contentArchive
      ? `import {prepareContentArchive} from "@workspace-skills/system-testing/open-goal-content-archive-managed";
         const prepared=await prepareContentArchive(input,${JSON.stringify(contentArchive)});`
      : testkitCloseout
      ? `import {prepareOpenTestkitCloseout} from "@workspace-skills/system-testing/open-goal-testkit-closeout-managed";
         const prepared=await prepareOpenTestkitCloseout(input,${JSON.stringify(testkitCloseout)});`
      : systemRelease
      ? `import {prepareSystemRelease} from "@workspace-skills/system-testing/open-goal-system-release-managed";
         const prepared=await prepareSystemRelease(input,${JSON.stringify(systemRelease)},${JSON.stringify(systemReleaseSeed)},${JSON.stringify(this.rpcSelfId)});`
      : skillMaintenance
      ? `import {vcs,rpc} from "@workspace/runtime";
         import {createMainRpcCaller} from "@vibestudio/service-schemas/mainRpc";
         import {prepareSkillMaintenance} from "@workspace-skills/system-testing/open-goal-skill-maintenance-managed";
         import {ownedSkillMaintenanceNative} from "@workspace-skills/system-testing/open-goal-skill-maintenance-native";
         const prepared=await prepareSkillMaintenance(input,${JSON.stringify(skillMaintenance)},
           {contextId:actualContextId,vcs,describe:path=>natlang.describe(path),
            native:ownedSkillMaintenanceNative(createMainRpcCaller(rpc),actualContextId)});`
      : panelSourceMigration
      ? `import {preparePanelSourceMigration} from "@workspace-skills/system-testing/open-goal-panel-source-migration-managed";
         const prepared=await preparePanelSourceMigration(input,${JSON.stringify(panelSourceMigration)});`
      : desktopReadiness
      ? `import {vcs,rpc} from "@workspace/runtime";
         import {prepareDesktopReadiness} from "@workspace-skills/system-testing/open-goal-desktop-readiness-managed";
         import * as updateModel from "@workspace/client-update-core";
         import * as updateProjection from "@workspace-clients/desktop-browser/update-projection";
         import * as layout from "@workspace-clients/desktop-browser/placement";
         import {bindClientAdmission} from "@workspace-skills/clientdev/workflow";
         const prepared=await prepareDesktopReadiness(input,${JSON.stringify(desktopReadiness)},
           {contextId:actualContextId,vcs,rpc,desktop:{updateModel,updateProjection,layout,bindClientAdmission}});`
      : notificationState
      ? `import {runtime,rpc} from "@workspace/runtime";
         import {prepareOpenNotificationState} from "@workspace-skills/system-testing/open-goal-notification-state-managed";
         const prepared=await prepareOpenNotificationState(input,${JSON.stringify(notificationState)},
           {contextId:actualContextId,runtime,rpc});`
      : workspaceShare
      ? `import {prepareWorkspaceShare} from "@workspace-skills/system-testing/open-goal-workspace-share-managed";
         const prepared=await prepareWorkspaceShare(input,${JSON.stringify(workspaceShare)});`
      : agentCapability
      ? `import {prepareAgentCapability} from "@workspace-skills/system-testing/open-goal-agent-capability-managed";
         const prepared=await prepareAgentCapability(input,${JSON.stringify(agentCapability)});`
      : mobileContinuity
      ? `import {fs,vcs} from "@workspace/runtime";
         import {prepareOpenMobileContinuity} from "@workspace-skills/mobile-system-testing/open-continuity";
         import * as continuity from "@workspace-clients/mobile-browser/continuity";
         const prepared=await prepareOpenMobileContinuity(input,${JSON.stringify(mobileContinuity)},
           {contextId:actualContextId,fs,vcs,continuity});`
      : assetIntegrity
      ? `import {fs,rpc,vcs} from "@workspace/runtime";
         import {prepareOpenAssetIntegrity} from "@workspace-skills/system-testing/open-goal-asset-integrity-managed";
         const prepared=await prepareOpenAssetIntegrity(input,${JSON.stringify(assetIntegrity)},
           {contextId:actualContextId,fs,vcs,rpc});`
      : installedPackage
      ? `import {prepareInstalledPackage} from "@workspace-skills/system-testing/open-goal-installed-package-managed";
         const prepared=await prepareInstalledPackage(input,${JSON.stringify(installedPackage)});`
      : tendrilRoute
      ? `import {prepareOpenTendrilRoute} from "@workspace-skills/system-testing/open-goal-tendril-route-managed";
         const prepared=await prepareOpenTendrilRoute(input,${JSON.stringify(tendrilRoute)});`
      : extensionDossier
      ? `import {prepareExtensionDossier} from "@workspace-skills/system-testing/open-goal-extension-dossier-managed";
         const prepared=await prepareExtensionDossier(input,${JSON.stringify(extensionDossier)});`
      : deployedInterface
      ? `import {prepareDeployedInterfaceGoal} from "@workspace-skills/system-testing/open-goal-deployed-interface-managed";
         if(input.contextId!==actualContextId)throw new Error("Interface review belongs to another context");
         const prepared=await prepareDeployedInterfaceGoal(input,${JSON.stringify(deployedInterface)});`
      : presentation
      ? `import {prepareOpenLocalPresentation} from "@workspace-skills/system-testing/open-goal-local-presentation-managed";
         if (!input.panelId || !input.source) throw new Error("Local presentation requires its owned renderer");
         const prepared=await prepareOpenLocalPresentation(input,${JSON.stringify(presentation)});`
      : adventure
      ? `import {prepareOpenAdventureGoal} from "@workspace-skills/open-adventure-journey-runtime";
         const prepared=await prepareOpenAdventureGoal(input,${JSON.stringify(adventure)});`
      : personalWelcome
      ? `import {prepareOpenPersonalWelcome} from "@workspace-skills/system-testing/open-goal-personal-welcome-managed";
         import {onboardingCatalog} from "@workspace-skills/onboarding/catalog";
         import {onboardingInteraction,projectSetupRoute} from "@workspace-skills/onboarding/routing";
         import {DECK,sceneEyebrow} from "@workspace-panels/tour/deck";
         import {bindExplorerTextProbe} from "@workspace-skills/explorer-probe-bindings";
         const prepared=await prepareOpenPersonalWelcome(input,{
           catalog:onboardingCatalog,
           deck:DECK.map((scene,i)=>({...scene,position:i+1,eyebrow:sceneEyebrow(scene.id)})),
           route:(id,action)=>projectSetupRoute(onboardingInteraction(id,action)),
           bindProbe:bindExplorerTextProbe,
         });`
      : dictationHandoff
      ? `import {prepareOpenDictationHandoff} from "@workspace-skills/system-testing/open-goal-dictation-managed";
         const prepared=await prepareOpenDictationHandoff(input);`
      : localWidth
      ? `import {fs,rpc,vcs} from "@workspace/runtime";
         import {prepareLocalWidthGoal} from "@workspace-skills/system-testing/open-goal-local-width-managed";
         import {readWorkspaceBytes} from "@workspace-skills/system-testing/scratch-handoff-managed";
         const prepared=await prepareLocalWidthGoal(input,${JSON.stringify(localWidth)},
           {contextId:actualContextId,fs,vcs,readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)});`
      : buildIncident
      ? `import {fs,rpc,vcs,blobstore} from "@workspace/runtime";
         import {mainRpcMethods} from "@vibestudio/service-schemas/mainRpc";
         import {profileBuild} from "@workspace/testkit";
         import {prepareRetainedBuildIncident} from "@workspace-skills/system-testing/open-goal-build-incidents-managed";
         import {readWorkspaceBytes} from "@workspace-skills/system-testing/scratch-handoff-managed";
         const prepared=await prepareRetainedBuildIncident(input,${JSON.stringify(buildIncident)},
           {contextId:actualContextId,fs,vcs,blobstore,
             profile:(source,ref)=>profileBuild(source,{ref,verifyCache:true}),
             metadata:key=>rpc.call("main",mainRpcMethods["build.getBuildMetadata"],[key]),
             readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)});`
      : specialistHandoff
      ? `import {prepareOpenSpecialistHandoff} from "@workspace-skills/system-testing/open-goal-specialist-managed";
         const prepared=await prepareOpenSpecialistHandoff(input);`
      : providerHandoff
      ? `import {prepareOpenProviderHandoff} from "@workspace-skills/system-testing/open-goal-provider-handoff-managed";
         const prepared=await prepareOpenProviderHandoff(input);`
      : problemReport
      ? `import {prepareOpenProblemReport} from "@workspace-skills/system-testing/open-goal-problem-report-managed";
         const prepared=await prepareOpenProblemReport(input);`
      : compoundRecovery
      ? `import {fs,rpc,vcs} from "@workspace/runtime";
         import {createMainRpcCaller} from "@vibestudio/service-schemas/mainRpc";
         import {openEvalHandoffNative} from "@workspace-skills/system-testing/open-goal-eval-handoff-managed";
         import {prepareCompoundRecoveryHandoff} from "@workspace-skills/system-testing/open-goal-compound-recovery-managed";
         import {readWorkspaceBytes} from "@workspace-skills/system-testing/scratch-handoff-managed";
         const prepared=await prepareCompoundRecoveryHandoff(input,${JSON.stringify(compoundRecovery)},
           {contextId:actualContextId,fs,vcs,native:openEvalHandoffNative(createMainRpcCaller(rpc)),readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)});`
      : ownedResearch
      ? `import {prepareOpenOwnedResearch} from "@workspace-skills/system-testing/open-goal-owned-research-managed";
         const prepared=await prepareOpenOwnedResearch(input);`
      : scheduledRecovery
      ? `import {prepareOwnedScheduledRecovery} from "@workspace-skills/system-testing/open-goal-scheduled-recovery-managed";
         const prepared=await prepareOwnedScheduledRecovery(input,${JSON.stringify(scheduledRecovery)},${JSON.stringify(scheduledSeed)});`
      : templateMigration
      ? `import {extensions,fs,rpc,vcs} from "@workspace/runtime";
         import {templateUpdateReviewSchema, templateUpdateStatusSchema} from "@vibestudio/service-schemas/templates";
         import {prepareOpenTemplateMigration} from "@workspace-skills/system-testing/open-goal-template-migration-managed";
         const unit="@workspace-extensions/templates";
         const readStatus=async method=>templateUpdateStatusSchema.parse(await extensions.invoke(unit,method,[]));
         const candidate=async (method,params)=>templateUpdateReviewSchema.parse(await extensions.invoke(unit,method,[params]));
         const prepared=await prepareOpenTemplateMigration(input,{contextId:actualContextId,fs,rpc,vcs,templates:{
           updateStatus:()=>readStatus("updateStatus"), checkUpdates:()=>readStatus("checkUpdates"),
           prepareUpdate:params=>candidate("prepareUpdate",params), reviewUpdate:params=>candidate("reviewUpdate",params),
         }});`
      : assembly
      ? `import {fs,rpc,vcs} from "@workspace/runtime";
         import {prepareOpenWorkspaceAssembly} from "@workspace-skills/system-testing/open-goal-workspace-assembly-managed";
         const prepared=await prepareOpenWorkspaceAssembly(input,{contextId:actualContextId,fs,rpc,vcs});`
      : capabilityPlan
      ? `import {fs,rpc,vcs} from "@workspace/runtime";
         import {prepareOpenCapabilityPlan} from "@workspace-skills/system-testing/open-goal-capability-plan-managed";
         const prepared=await prepareOpenCapabilityPlan(input,{contextId:actualContextId,fs,vcs,rpc});`
      : ownedTask
      ? `import {createDurableObjectServiceClient} from "@workspace/runtime";
         import {missionControlRpcMethods} from "@workspace/mission-control/rpc-contract";
         import {prepareOwnedTaskRecovery} from "@workspace-skills/system-testing/open-goal-owned-task-managed";
         const store=createDurableObjectServiceClient("mission-planning-fixture.v1",missionControlRpcMethods,"natlang-mission-planning-"+actualContextId);
         const prepared=await prepareOwnedTaskRecovery(input,${JSON.stringify(ownedTask)},store);`
      : unitRollout
      ? `import {vcs,blobstore,openPanel,rpc} from "@workspace/runtime";
         import {prepareOpenUnitRollout} from "@workspace-skills/system-testing/open-goal-unit-rollout-managed";
         const prepared=await prepareOpenUnitRollout(input,${JSON.stringify(unitRollout)},{contextId:actualContextId,vcs,blobstore,openPanel,rpc,build:services.build});`
      : terminalHandoff
      ? `import {prepareOpenTerminalGoal} from "@workspace-skills/system-testing/open-goal-terminal-managed";
         const prepared=await prepareOpenTerminalGoal({contextId:input.contextId,caseId:input.caseId});`
      : reconciliationSeed
      ? `import {fs,rpc,vcs} from "@workspace/runtime";
         import {prepareOpenReconciliation} from "@workspace-skills/system-testing/open-goal-reconciliation-managed";
         const prepared=await prepareOpenReconciliation(input,${JSON.stringify(reconciliation)},${JSON.stringify(reconciliationSeed.stored)},{fs,rpc,vcs});`
      : evalHandoff
      ? `import {fs,rpc,vcs} from "@workspace/runtime";
         import {createMainRpcCaller} from "@vibestudio/service-schemas/mainRpc";
         import {prepareOpenEvalHandoff,openEvalHandoffNative} from "@workspace-skills/system-testing/open-goal-eval-handoff-managed";
         import {readWorkspaceBytes} from "@workspace-skills/system-testing/scratch-handoff-managed";
         const prepared=await prepareOpenEvalHandoff(input,${JSON.stringify(evalHandoff)},
           {contextId:actualContextId,fs,vcs,native:openEvalHandoffNative(createMainRpcCaller(rpc)),readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)});`
      : programRun
      ? `import {fs,vcs} from "@workspace/runtime";
         import {prepareOpenProgramRun} from "@workspace-skills/system-testing/open-goal-program-run-managed";
         const prepared=await prepareOpenProgramRun(input,${JSON.stringify(programRun)},{contextId:actualContextId,fs,vcs,describe:path=>natlang.describe(path),load:path=>natlang.load(path)});`
      : googleSetup
      ? `import {panelTree} from "@workspace/runtime";
         import {prepareOpenGoogleSetup} from "@workspace-skills/google-drive/open-google-setup-managed";
         if (!input.source || !input.panelId) throw new Error("Google setup needs its assigned welcome panel");
         const prepared=await prepareOpenGoogleSetup(panelTree.get(input.panelId),actualContextId,input.source,${JSON.stringify(googleSetup)});`
      : clientDiagnostics
      ? `import {prepareOpenClientDiagnostics} from "@workspace-skills/system-testing/open-goal-client-diagnostics-managed";
         if (!input.source || !input.clientPanels) throw new Error("Client diagnostics needs its owned local panels");
         const prepared=await prepareOpenClientDiagnostics(input,${JSON.stringify(clientDiagnostics)});`
      : githubWork
      ? `import {prepareOpenGitHub} from "@workspace-skills/github/open-github-managed";
         const prepared=await prepareOpenGitHub(${JSON.stringify(githubWork)});`
      : visualRecovery
      ? `import {prepareOpenPanelRecovery} from "@workspace-skills/system-testing/open-goal-panel-recovery-managed";
         if (!input.source || !input.recoveryPanels) throw new Error("Visual recovery needs its owned live surfaces");
         const prepared=await prepareOpenPanelRecovery(input);`
      : diagnostics
      ? `import {prepareOpenSystemDiagnostics} from "@workspace-skills/open-system-diagnostics-runtime";
         const prepared=await prepareOpenSystemDiagnostics(input,${JSON.stringify(diagnostics)},${JSON.stringify(diagnosticsSeed)});`
      : authoring
      ? `import {fs,vcs} from "@workspace/runtime";
         import {prepareOpenAuthoringGoal} from "@workspace-skills/system-testing/open-goal-authoring-managed";
         const prepared=await prepareOpenAuthoringGoal(input,${JSON.stringify(authoring)},{contextId:actualContextId,fs,vcs,describe:path=>natlang.describe(path)});`
      : personalAutomation
      ? `import {prepareOpenPersonalAutomation} from "@workspace-skills/open-personal-automation-runtime";
         const prepared=await prepareOpenPersonalAutomation(input,${JSON.stringify(personalAutomation)},${JSON.stringify(automationSeed)});`
      : ownedPreview
      ? `import {prepareOpenOwnedPreviewGoal} from "@workspace-skills/system-testing/open-goal-owned-preview-managed";
         if (!input.panelId || !input.source) throw new Error("An owned preview needs its original renderer");
         const prepared=await prepareOpenOwnedPreviewGoal(input);`
      : googleHandoff
      ? `import {prepareOpenGoogleHandoffGoal} from "@workspace-skills/open-google-handoff-goal/managed";
         const candidate=await prepareOpenGoogleHandoffGoal(input,${JSON.stringify(googleHandoff)});
         const prepared={...candidate,verify:async report=>candidate.verify(report?.skill==="googleHandoff" && report.status==="workspace-skill-reviewed" ? report.outcome : null)};`
      : browserMigration
      ? `import {prepareOpenBrowserMigration} from "@workspace-skills/browser-import-runtime/open-migration-managed";
         const prepared=await prepareOpenBrowserMigration(${JSON.stringify(browserMigration)});`
      : personalHistory
      ? `import {prepareOpenPersonalHistory} from "@workspace-skills/open-personal-history-runtime";
         const prepared=await prepareOpenPersonalHistory(input,${JSON.stringify(personalHistory)});`
      : calendar
      ? `import {prepareOpenCalendarGoal} from "@workspace-skills/open-calendar-goal/managed";
         const candidate=await prepareOpenCalendarGoal(input,${JSON.stringify(calendar)});
         const prepared={...candidate,verify:async report=>candidate.verify(report?.skill==="calendar" && report.status==="workspace-skill-reviewed" ? report.outcome : null)};`
      : personalArtifacts
      ? `import {prepareOpenPersonalArtifacts} from "@workspace-skills/open-personal-artifacts-runtime";
         const prepared=await prepareOpenPersonalArtifacts(input,${JSON.stringify(personalArtifacts)});`
      : pdfVault
      ? `import {prepareOpenPdfVaultGoal} from "@workspace-skills/system-testing/open-goal-pdf-vault-managed";
         import {prepareOpenSpectroliteGoal} from "@workspace-skills/spectrolite-review-fixtures/open-goal";
         if (!input.panelId) throw new Error("The PDF-backed correction needs its owned vault renderer");
         const prepared=await prepareOpenPdfVaultGoal(input,prepareOpenSpectroliteGoal);`
      : gmail
      ? `import {prepareOpenGmailGoal} from "@workspace-skills/open-gmail-goal/managed";
         const prepared=await prepareOpenGmailGoal(input,${JSON.stringify(gmail)},${JSON.stringify(gmailSeed)});`
      : pdf
      ? `import {prepareOpenPdfGoal} from "@workspace-skills/system-testing/open-goal-pdf-managed";
         const prepared=await prepareOpenPdfGoal(input);`
      : publication
      ? `import {prepareOpenPublicationGoal} from "@workspace-skills/system-testing/open-goal-publication-managed";
         if (!input.panelId || !input.source) throw new Error("The publishing goal needs its owned renderer");
         const prepared=await prepareOpenPublicationGoal(input);`
      : localDelivery
      ? `import {runtime,rpc} from "@workspace/runtime";
         import {prepareOpenLocalDelivery} from "@workspace-skills/system-testing/open-goal-local-delivery-managed";
         const prepared=await prepareOpenLocalDelivery(input,${JSON.stringify(localDelivery)},{runtime,rpc});`
      : recovery
      ? `import {prepareOpenRecoveryGoal} from "@workspace-skills/system-testing/open-goal-recovery-managed";
         const prepared=await prepareOpenRecoveryGoal(input,${JSON.stringify(recovery)});`
      : personal
      ? `import {prepareOpenPersonalGoal} from "@workspace-skills/open-personal-goal/managed";
         const prepared=await prepareOpenPersonalGoal(input,${JSON.stringify(personal)});`
      : operator
        ? `import {prepareOpenGoalOperator} from "@workspace-skills/system-testing/open-goal-operator-managed";
           const prepared=await prepareOpenGoalOperator(input);`
        : google
      ? `import {prepareOpenGoalDrive} from "@workspace-skills/google-drive/open-goal-drive";
         const prepared=await prepareOpenGoalDrive(input,${JSON.stringify(google)});`
      : apiReadiness
      ? `import {prepareOpenApiReadiness} from "@workspace-skills/system-testing/open-goal-api-readiness-managed";
         import {matchUrlBoundCredentialCandidates,findCredentialBinding} from "@vibestudio/credential-client/urlBoundSelection";
         import {findMatchingUrlAudience} from "@vibestudio/credential-client/urlAudience";
         import {credentialLifecycle} from "@vibestudio/credential-client/credentialStatus";
         const prepared=await prepareOpenApiReadiness(input,{match:matchUrlBoundCredentialCandidates,binding:findCredentialBinding,
           audience:findMatchingUrlAudience,lifecycle:credentialLifecycle});`
      : chatContinuity
      ? `import {prepareOpenChatContinuity} from "@workspace-skills/system-testing/open-goal-chat-continuity-managed";
         const prepared=await prepareOpenChatContinuity(input);`
      : editorialPacket
      ? `import {prepareOpenEditorial} from "@workspace-skills/system-testing/open-goal-editorial-managed";
         import {openEditorialMissionStore} from "@workspace-skills/open-personal-goal/editorial-owner";
         const prepared=await prepareOpenEditorial(input,openEditorialMissionStore);`
      : demoPortfolio
      ? `import {prepareOpenPortfolio} from "@workspace-skills/system-testing/open-goal-portfolio-managed";
         import {pairedPortfolioInstalled} from "@workspace-skills/examples-review-fixtures/open-portfolio-owner";
         const prepared=await prepareOpenPortfolio(input,pairedPortfolioInstalled);`
      : regencyBriefing
      ? `import {prepareOpenRegency} from "@workspace-skills/system-testing/open-goal-regency-managed";
         import {openRegencyInstalled} from "@workspace-skills/examples-review-fixtures/open-regency-owner";
         const prepared=await prepareOpenRegency(input,openRegencyInstalled);`
      : imageCandidate
      ? `import {prepareOpenImageCandidate} from "@workspace-skills/system-testing/open-goal-image-candidate-managed";
         const prepared=await prepareOpenImageCandidate(input);`
      : newsEvidence
      ? `import {prepareOpenNewsEvidence} from "@workspace-skills/system-testing/open-goal-news-evidence-managed";
         import {canonicalizeUrl,articleId,captureNewsReaderReadback} from "@workspace/feeds";
         const prepared=await prepareOpenNewsEvidence(input,{canonicalizeUrl,articleId,capture:captureNewsReaderReadback});`
      : news
        ? `import {prepareOpenGoalNews} from "@workspace/news-live-evidence/open-goal";
           if (input.news?.contextId!==input.contextId || input.news.caseId!==input.caseId)
             throw new Error("News goal needs its owned participant");
           const prepared=await prepareOpenGoalNews(input.news,${JSON.stringify(news)});`
        : vaultKnowledge
          ? `import {prepareVaultKnowledge} from "@workspace-skills/spectrolite-review-fixtures/knowledge-managed";
             if (!input.panelId) throw new Error("Open vault knowledge needs its owned renderer");
             const prepared=await prepareVaultKnowledge(input,${JSON.stringify(vaultKnowledge)});`
        : spectrolite
          ? `import {prepareOpenSpectroliteGoal} from "@workspace-skills/spectrolite-review-fixtures/open-goal";
             const prepared=await prepareOpenSpectroliteGoal(input,${JSON.stringify(spectrolite)});`
          : `import {prepareOpenGoal} from "@workspace-skills/system-testing/open-goal-managed";
             const prepared=await prepareOpenGoal(input);`;
    const bindingCode = `
        import {contextId as actualContextId} from "@workspace/runtime";
        const input=${JSON.stringify(input)};
        if (input.contextId!==actualContextId) throw new Error("User goal belongs to another context");
        ${prepare}
        const assignedServices=prepared.services;
    `;
    let operationError: unknown;
    try {
      if (input.qualification && unitRollout)
        console.info("[open-unit-rollout]", {
          caseId: input.caseId, contextId: input.contextId, phase: "utility.eval", event: "started",
        });
      const approvals = apiReadiness ? "pregranted-only" as const : undefined;
      if (input.qualification) return await this.runHarnessUtility("teacher", `
        ${bindingCode}
        if (!("qualify" in prepared)) throw new Error("The open goal has no model-free qualification");
        let utilityValue;
        try { utilityValue={teacher:null,verification:await prepared.qualify()}; }
        finally { await prepared.close?.(); }
      `, approvals) as Awaited<ReturnType<OpenGoalReceiver["runOpenGoalTeacher"]>>;
      return await this.runHarnessUtility("teacher", runId => `
        ${bindingCode}
        let result;
        try {
          ${openGoalTeacherCode({ executorModel: input.executorModel, bindingCode: "", goal: input.goal }, runId)}
          result={teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
        } finally { await prepared.close?.(); }
        const utilityValue=result;
      `, approvals) as Awaited<ReturnType<OpenGoalReceiver["runOpenGoalTeacher"]>>;
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      if (scheduledSeed) {
        try {
          await closeOwnedScheduledRecovery(this.rpc, scheduledSeed.items);
        } catch (cleanup) {
          if (operationError !== undefined)
            throw new AggregateError([operationError, cleanup], "Scheduled recovery and cleanup both failed");
          throw cleanup;
        }
      }
      if (automationSeed) {
        try {
          await pauseOpenPersonalAutomation(this.rpc, automationSeed.items);
        } catch (cleanup) {
          if (operationError !== undefined)
            throw new AggregateError([operationError, cleanup], `Automation verification failed (${operationError}); cleanup also failed (${cleanup})`);
          throw cleanup;
        }
      }
    }
  }

  @rpc({website:{kind:"closed",reason:"Hands off verified public research in an owned scratch context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedResearchHandoffTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedResearchHandoffReceiver["runManagedResearchHandoffTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${composedTeacherCode({
      executorModel:input.executorModel,
      workflowRequest:{goal:"Prepare an evidence handoff",work:researchHandoffWork.map(work=>({...work,input:{goal:"Complete assigned work"}}))},
      requiredOrder:researchHandoffWork.map(({operation})=>operation),
      requestCode:"prepared.request",
      bindingCode:this.managedResearchHandoffBindings(input),
    },runId)}
      utilityValue={teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedResearchHandoffReceiver["runManagedResearchHandoffTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies public research and the native scratch handoff without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedResearchHandoff(input: {contextId:string;caseId:string}): ReturnType<ManagedResearchHandoffReceiver["qualifyManagedResearchHandoff"]> {
    return await this.runHarnessUtility("teacher",domainTeacherQualificationCode(
      researchHandoffWork,this.managedResearchHandoffBindings(input),
    )) as Awaited<ReturnType<ManagedResearchHandoffReceiver["qualifyManagedResearchHandoff"]>>;
  }

  private managedResearchHandoffBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedResearchHandoff} from "@workspace-skills/system-testing/research-handoff-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Research handoff belongs to another context");
      const prepared=await prepareManagedResearchHandoff(input);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures assigned architecture ownership from the actual local route."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedArchitectureBoundaryTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedArchitectureBoundaryReceiver["runManagedArchitectureBoundaryTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.ArchitectureBoundary,
      inputCode:"prepared.request",
      bindingCode:this.managedArchitectureBoundaryBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedArchitectureBoundaryReceiver["runManagedArchitectureBoundaryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies installed architecture provider evidence without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedArchitectureBoundary(input: {contextId:string;caseId:string}): ReturnType<ManagedArchitectureBoundaryReceiver["qualifyManagedArchitectureBoundary"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.ArchitectureBoundary],
      this.managedArchitectureBoundaryBindings(input),
    )) as Awaited<ReturnType<ManagedArchitectureBoundaryReceiver["qualifyManagedArchitectureBoundary"]>>;
  }

  private managedArchitectureBoundaryBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedArchitectureBoundary} from "@workspace-skills/system-testing/architecture-boundary-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Architecture review belongs to another context");
      const prepared=await prepareManagedArchitectureBoundary(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an assigned extension source and live release review."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedExtensionReleaseTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedExtensionReleaseReceiver["runManagedExtensionReleaseTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.ExtensionRelease,
      inputCode:"prepared.request",
      bindingCode:this.managedExtensionReleaseBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedExtensionReleaseReceiver["runManagedExtensionReleaseTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live extension review without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedExtensionRelease(input: {contextId:string;caseId:string}): ReturnType<ManagedExtensionReleaseReceiver["qualifyManagedExtensionRelease"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.ExtensionRelease],
      this.managedExtensionReleaseBindings(input),
    )) as Awaited<ReturnType<ManagedExtensionReleaseReceiver["qualifyManagedExtensionRelease"]>>;
  }

  private managedExtensionReleaseBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedExtensionRelease} from "@workspace-skills/system-testing/extension-release-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Extension review belongs to another context");
      const prepared=await prepareManagedExtensionRelease(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures assigned host preflight and scope comparison."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedAuthorityReviewTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedAuthorityReviewReceiver["runManagedAuthorityReviewTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.AuthorityReview,
      inputCode:"prepared.request",
      bindingCode:this.managedAuthorityReviewBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedAuthorityReviewReceiver["runManagedAuthorityReviewTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies real host preflight observations without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedAuthorityReview(input: {contextId:string;caseId:string}): ReturnType<ManagedAuthorityReviewReceiver["qualifyManagedAuthorityReview"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.AuthorityReview],
      this.managedAuthorityReviewBindings(input),
    )) as Awaited<ReturnType<ManagedAuthorityReviewReceiver["qualifyManagedAuthorityReview"]>>;
  }

  private managedAuthorityReviewBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedAuthorityReview} from "@workspace-skills/system-testing/authority-review-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Authority review belongs to another context");
      const prepared=prepareManagedAuthorityReview(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures an agentic stack change plan from owned source."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedAgenticChangeTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedAgenticChangeReceiver["runManagedAgenticChangeTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:managedDomainWork.AgenticChange,
      inputCode:"prepared.request",
      bindingCode:this.managedAgenticChangeBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedAgenticChangeReceiver["runManagedAgenticChangeTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live agentic stack source observations without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedAgenticChange(input: {contextId:string;caseId:string}): ReturnType<ManagedAgenticChangeReceiver["qualifyManagedAgenticChange"]> {
    return await this.runHarnessUtility("teacher", domainTeacherQualificationCode(
      [managedDomainWork.AgenticChange],
      this.managedAgenticChangeBindings(input),
    )) as Awaited<ReturnType<ManagedAgenticChangeReceiver["qualifyManagedAgenticChange"]>>;
  }

  private managedAgenticChangeBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedAgenticChange} from "@workspace-skills/system-testing/agentic-change-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Agentic development belongs to another context");
      const prepared=await prepareManagedAgenticChange(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures a GAD review of a conversation owned by the test context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedGadReviewTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedGadReviewReceiver["runManagedGadReviewTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"gad",operation:"reviewChannel",input:{goal:"Review the assigned channel"}},
      inputCode:"prepared.request",
      bindingCode:this.managedGadReviewBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedGadReviewReceiver["runManagedGadReviewTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live channel health and transcript evidence without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedGadReview(input: {contextId:string;caseId:string}): ReturnType<ManagedGadReviewReceiver["qualifyManagedGadReview"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.managedGadReviewBindings(input)}
      await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedGadReviewReceiver["qualifyManagedGadReview"]>>;
  }

  private managedGadReviewBindings(input: {contextId:string;caseId:string}): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedGadReview} from "@workspace-skills/system-testing/gad-review-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("GAD review belongs to another context");
      const prepared=await prepareManagedGadReview(actualContextId,input.caseId);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Captures the assigned read-only phone setup task."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedPhoneSetupTeacher(input: {contextId:string;executorModel:string}): ReturnType<ManagedPhoneSetupReceiver["runManagedPhoneSetupTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"phoneSetup",operation:"setUpPhone",input:{goal:phoneSetupUnavailable.goal}},
      inputCode:"binding.request",
      bindingCode:this.managedPhoneSetupBindings(input.contextId),
    },runId)}
      const verification=verifyDesktopUnavailable(actualContextId,binding.request,readback,utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedPhoneSetupReceiver["runManagedPhoneSetupTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies read-only phone provider evidence without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedPhoneSetup(input: {contextId:string}): ReturnType<ManagedPhoneSetupReceiver["qualifyManagedPhoneSetup"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.managedPhoneSetupBindings(input.contextId)}
      await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
      let rejectsForeignReceipt=false;
      try { await assignedServices.phoneSetupRead.start("foreign-phone-setup"); }
      catch (error) {
        rejectsForeignReceipt=error instanceof Error && error.message.includes("current stage");
      }
      const observed=await assignedServices.phoneSetupRead.start(binding.request.operationId);
      const verification=verifyDesktopUnavailable(actualContextId,binding.request,readback,{
        status:"desktop-unavailable",
        pairedDeviceId:null,
        evidenceIds:[observed.receipt],
        guidance:"Open the desktop app on this account",
      });
      const utilityValue={verification,rejectsForeignReceipt};
    `) as Awaited<ReturnType<ManagedPhoneSetupReceiver["qualifyManagedPhoneSetup"]>>;
  }

  private managedPhoneSetupBindings(contextId: string): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {bindPhoneSetup} from "@workspace-skills/phone-setup/workflow";
      import {verifyDesktopUnavailable} from "@workspace-skills/system-testing/phone-setup-managed";
      if(actualContextId!==${JSON.stringify(contextId)}) throw new Error("Phone setup belongs to another context");
      const binding=await bindPhoneSetup({
        goal:${JSON.stringify(phoneSetupUnavailable.goal)},
        target:{platform:${JSON.stringify(phoneSetupUnavailable.platform)}},
      });
      let readback=null;
      const readOnly=async()=>{throw new Error("This assignment only reads desktop providers");};
      const assignedServices={phoneSetupRead:{
        start:async id=>{
          const observed=await binding.services.phoneSetupRead.start(id);
          if(observed.desktops.length!==0) throw new Error("The owned headless account unexpectedly has an eligible desktop");
          readback=structuredClone(observed);
          return observed;
        },
        discover:readOnly,
        readiness:readOnly,
      }};
    `;
  }

  @rpc({website:{kind:"closed",reason:"Runs the assigned incident continuation in an owned context."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedIncidentContinuationTeacher(input: IncidentContinuationInput & {executorModel:string}): ReturnType<ManagedIncidentContinuationReceiver["runManagedIncidentContinuationTeacher"]> {
    const bindings=await this.incidentContinuationBindings(input);
    return await this.runHarnessUtility("teacher",runId=>`${composedTeacherCode({
      executorModel: input.executorModel,
      workflowRequest: {goal:"Verify the incident and assess local follow-up",work:[
        {kind:"domain",domain:"system",operation:"investigateSystem",input:{goal:"Verify the incident"}},
        {kind:"domain",domain:"localModel",operation:"prepareLocalModel",input:{goal:"Assess the local follow-up"}},
      ]},
      bindingCode: bindings,
      requestCode:"continuation.workflowRequest",
      requiredOrder:["investigateSystem","prepareLocalModel"],
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,...await continuation.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedIncidentContinuationReceiver["runManagedIncidentContinuationTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the incident report's two live sources without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedIncidentContinuation(input: IncidentContinuationInput): ReturnType<ManagedIncidentContinuationReceiver["qualifyManagedIncidentContinuation"]> {
    const bindings=await this.incidentContinuationBindings(input);
    return await this.runHarnessUtility("teacher",`
      ${bindings}
      await natlang.describe("skills/vibestudio-workflows/runWorkflow.nl");
      const utilityValue=await continuation.qualify();
    `) as Awaited<ReturnType<ManagedIncidentContinuationReceiver["qualifyManagedIncidentContinuation"]>>;
  }

  private async incidentContinuationBindings(input: IncidentContinuationInput): Promise<string> {
    const incident=incidentContinuationWorlds.find(({id})=>id===input.caseId);
    if(!incident) throw new Error("Unknown incident continuation assignment");
    const log=await this.logAuditBindings({contextId:input.contextId,caseId:incident.log});
    return `
      ${log}
      import {extensions} from "@workspace/runtime";
      import {prepareIncidentContinuation} from "@workspace-skills/system-investigation-live/continuation";
      import {localModelComparisonWorlds} from "@workspace-skills/system-testing/local-model-comparison-worlds";
      const incident=${JSON.stringify(incident)};
      const models=localModelComparisonWorlds.find(world=>world.id===incident.models);
      if(!models) throw new Error("Unknown incident model comparison");
      const continuation=prepareIncidentContinuation(actualContextId,incident.id,incident.goal,prepared,extensions,models);
      Object.assign(assignedServices,continuation.services);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the owned typed program and execution evidence."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedRuntimeProgramTeacher(input: RuntimeProgramInput & {executorModel:string}): ReturnType<ManagedRuntimeProgramReceiver["runManagedRuntimeProgramTeacher"]> {
    const observation=await this.measureRuntimeProgram(input);
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"runtimeEvidence",operation:"reviewRuntimeEvidence",input:{goal:"Review the owned program evidence"}},
      inputCode:"observed.request",
      bindingCode:`
        import {contextId as actualContextId} from "@workspace/runtime";
        import {verifyRuntimeProgram} from "@workspace-skills/system-testing/runtime-program-managed";
        const observed=${JSON.stringify(observation)};
        if(actualContextId!==observed.contextId) throw new Error("Runtime program review belongs to another context");
        const assignedServices={};
      `,
    },runId)}
      const verification=verifyRuntimeProgram(observed,utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedRuntimeProgramReceiver["runManagedRuntimeProgramTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies actual typed program receipts without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedRuntimeProgram(input: RuntimeProgramInput): ReturnType<ManagedRuntimeProgramReceiver["qualifyManagedRuntimeProgram"]> {
    return await this.runHarnessUtility("teacher",runId=>`
      ${this.runtimeProgramBindings(input,runId)}
      await natlang.describe("skills/runtime-evidence-review/reviewRuntimeEvidence.nl");
      const report={kind:"program",next:observed.expected,basis:observed.request.execution?.id??observed.request.path};
      const verification=verifyRuntimeProgram(observed,report);
      const rejectedWrongReceipt=!verifyRuntimeProgram(observed,{...report,basis:"foreign-program-receipt"}).passed;
      const utilityValue={verification,rejectedWrongReceipt};
    `) as Awaited<ReturnType<ManagedRuntimeProgramReceiver["qualifyManagedRuntimeProgram"]>>;
  }

  private async measureRuntimeProgram(input: RuntimeProgramInput): Promise<unknown> {
    return await this.runHarnessUtility("teacher",runId=>`
      ${this.runtimeProgramBindings(input,runId)}
      const utilityValue=observed;
    `);
  }

  private runtimeProgramBindings(input: RuntimeProgramInput, runId: string) {
    return `
      import {fs,contextId as actualContextId} from "@workspace/runtime";
      import {measureRuntimeProgram,verifyRuntimeProgram} from "@workspace-skills/system-testing/runtime-program-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Runtime program belongs to another context");
      const observed=await measureRuntimeProgram({fs,describe:path=>natlang.describe(path),load:path=>natlang.load(path)},actualContextId,${JSON.stringify(runId)},input.caseId);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews exact provenance in the owned fixture repository."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedProvenanceHistoryTeacher(input: ProvenanceHistoryInput & {executorModel:string}): ReturnType<ManagedProvenanceHistoryReceiver["runManagedProvenanceHistoryTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"provenance",operation:"reviewProvenance",input:{goal:"Read assigned VCS provenance"}},
      inputCode:"prepared.request",
      bindingCode:this.provenanceHistoryBindings(input),
    },runId)}
      const verification=await prepared.verify(utilityValue.report);
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification};
    `) as Awaited<ReturnType<ManagedProvenanceHistoryReceiver["runManagedProvenanceHistoryTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies the native provenance read and evidence scope without model calls."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedProvenanceHistory(input: ProvenanceHistoryInput): ReturnType<ManagedProvenanceHistoryReceiver["qualifyManagedProvenanceHistory"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.provenanceHistoryBindings(input)}
      await natlang.describe("skills/provenance-orientation/reviewProvenance.nl");
      let rejectedOutside=false;
      try { await assignedServices.provenanceHistory.readNext({path:"other-workspace.txt",walk:"cause",scope:"work-unit"}); }
      catch { rejectedOutside=true; }
      for(const check of prepared.request.checks) await assignedServices.provenanceHistory.readNext(check);
      const report=prepared.reference();
      const verification=await prepared.verify(report);
      const altered={...report,findings:report.findings.map(row=>({...row,evidence:["foreign-evidence"]}))};
      const rejectedWrongCoordinate=rejectedOutside&&!(await prepared.verify(altered)).passed;
      const utilityValue={verification,rejectedWrongCoordinate};
    `) as Awaited<ReturnType<ManagedProvenanceHistoryReceiver["qualifyManagedProvenanceHistory"]>>;
  }

  private provenanceHistoryBindings(input: ProvenanceHistoryInput) {
    return `
      import {vcs,contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedProvenanceHistory} from "@workspace-skills/system-testing/provenance-history-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Provenance history belongs to another context");
      const prepared=await prepareManagedProvenanceHistory(vcs,actualContextId,input.repoPath,input.caseId);
      const assignedServices={provenanceHistory:prepared.service};
    `;
  }

  private async integrationFixtureIdentity() {
    const ownerEntityId = `do:${this.env["WORKER_SOURCE"]}:${this.env["WORKER_CLASS_NAME"]}:${this.objectKey}`;
    const contextId = await this.rpc.call("main",mainRpcMethods["runtime.resolveContext"],[ownerEntityId]);
    if (!contextId) throw new Error("Integration fixture worker has no registered context");
    return {ownerEntityId,contextId};
  }

  private integrationFixtureWorld(): OwnedIntegrationWorld {
    const row = this.sql.exec<{value:string}>("SELECT value FROM state WHERE key = ?", "__integration_fixture").toArray()[0];
    if (!row) throw new Error("Integration fixture was not prepared by this worker");
    return JSON.parse(row.value) as OwnedIntegrationWorld;
  }

  private async seedWorkspaceIntegration(
    input: IntegrationFixtureInput, assignment?: Parameters<typeof prepareWorkspaceIntegration>[3],
  ) {
    const {contextId,ownerEntityId}=await this.integrationFixtureIdentity();
    const vcs=createVcsClient(this.rpc,contextId);
    const world=await prepareWorkspaceIntegration({vcs,createContext:async()=>({contextId}),
      // The outer harness owns target teardown; it runs even if this invocation fails.
      destroyContext:async()=>{},
      createSourceContext:async(parentContextId)=>{
        if(parentContextId!==contextId) throw new Error("Integration source has another parent");
        const child=await this.rpc.call("main",mainRpcMethods["runtime.createSubagentContext"],[{parentContextId,ownerEntityId,targetKey:`integration-source:${ownerEntityId}:${crypto.randomUUID()}`}]);
        return {...child,ownerEntityId};
      },
    },input.seed,input.worldId,assignment);
    const {cleanup,...stored}=world;
    return {stored,before:(await vcs.status()).workingHead};
  }

  @rpc({website:{kind:"closed",reason:"Harness seeds its owned local VCS exercise without publishing."}, requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async prepareWorkspaceIntegrationFixture(input:IntegrationFixtureInput) {
    const {stored,before}=await this.seedWorkspaceIntegration(input);
    this.sql.exec("INSERT OR REPLACE INTO state(key,value) VALUES (?,?)", "__integration_fixture",JSON.stringify(stored));
    return {...stored,before};
  }

  @rpc({website:{kind:"closed",reason:"Independent oracle reads only the stored fixture and real VCS state."}, requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async verifyWorkspaceIntegrationFixture() {
    const {contextId}=await this.integrationFixtureIdentity();
    const world=this.integrationFixtureWorld();
    if(world.fixture.contextId!==contextId) throw new Error("Stored integration fixture belongs to another context");
    return verifyWorkspaceIntegration(createVcsClient(this.rpc,contextId),world.fixture);
  }

  @rpc({website:{kind:"closed",reason:"Harness qualifies reference, negative and alias candidates in an owned world without model calls."}, requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyWorkspaceIntegrationFixture(variant:"reference"|"negative"|"alias") {
    const {contextId}=await this.integrationFixtureIdentity();
    const world=this.integrationFixtureWorld();
    if(world.fixture.contextId!==contextId) throw new Error("Stored integration fixture belongs to another context");
    if(!["reference","negative","alias"].includes(variant)) throw new Error("Unknown oracle qualification variant");
    return exerciseWorkspaceIntegration(createVcsClient(this.rpc,contextId),world,variant);
  }

  @rpc({ website:{kind:"closed",reason:"Owned VCS teacher operates only in the explicit test context and source."}, requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write" })
  async runWorkspaceIntegrationTeacher(input: WorkspaceIntegrationTeacherInput): Promise<PanelTeacherResult> {
    const selected=workspaceIntegrationTeacherInputSchema.parse(input);
    return await this.runHarnessUtility("teacher",runId=>authoredTeacherCode({
      executorModel:selected.executorModel,skill: "integrateWorkspace",serviceNames:["workspaceIntegration"],request:{goal:selected.goal},
      bindingCode:`
        import {vcs,contextId as actualContextId} from "@workspace/runtime";
        import {createWorkspaceIntegration} from "@workspace/natlang-services";
        const selected=${JSON.stringify(selected)};
        if(actualContextId!==selected.contextId) throw new Error("Teacher worker belongs to another context");
        const assignedService=createWorkspaceIntegration({vcs,contextId:selected.contextId,source:selected.source,files:selected.files});
      `,
    },runId)) as PanelTeacherResult;
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async doctor(model?: string): Promise<SystemTestDoctorResult> {
    return systemTestDoctorResultSchema.parse(
      await this.runHarnessUtility(
        "doctor",
        `
        import { systemTestDoctor } from "@workspace-skills/system-testing/cli";
        const utilityValue = await systemTestDoctor(${JSON.stringify(model)});
      `,
      ),
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async listSystemTests(category?: string): Promise<SystemTestDescriptor[]> {
    return systemTestDescriptorSchema.array().parse(
      await this.runHarnessUtility(
        "list",
        `
        import {
          installedWorkspaceUnits,
          listSystemTests,
        } from "@workspace-skills/system-testing/cli";
        const category = ${JSON.stringify(category)};
        const installedUnits = await installedWorkspaceUnits();
        const utilityValue = listSystemTests({ installedUnits }).filter(
          (test) => !category || test.category === category
        );
      `,
      ),
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async startSystemTestRun(
    options: SystemTestRunConfig,
  ): Promise<{ runId: string }> {
    const config = systemTestRunConfigSchema.parse(options);
    if (!this.caller?.userId || this.caller.userId === "system") {
      throw new Error("System tests require an authenticated human initiator");
    }
    const handle = createEvalRunHandle(
      createMainRpcCaller(this.rpc),
      systemTestEvaluation(config, this.rpcSelfId),
    );
    await handle.start();
    return { runId: options.runId };
  }

  private async readStoredSystemTestRecord(
    runId: string,
    stored: StoredSystemTestRecord,
  ): Promise<unknown> {
    const pageSize = 128 * 1024;
    let text = "";
    for (let offset = 0; offset < stored.length; offset += pageSize) {
      const page = await this.rpc.call(
        "main",
        mainRpcMethods["eval.readScopeTextPage"],
        [
          {
            scopeKey: runId,
            key: stored.scopeKey,
            offset,
            limit: Math.min(pageSize, stored.length - offset),
          },
        ],
      );
      if (page.length !== stored.length || page.encoding !== "utf16le-base64") {
        throw new Error(
          `system-test record ${runId} changed while it was being read`,
        );
      }
      text += decodeUtf16LeBase64(page.chunk);
    }
    if (text.length !== stored.length) {
      throw new Error(
        `system-test record ${runId} was truncated (${text.length}/${stored.length} UTF-16 units)`,
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `system-test record ${runId} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getSystemTestRunSnapshot(
    runId: string,
  ): Promise<SystemTestRunnerSnapshot> {
    const record = this.persistedHeader(runId)?.record;
    if (record && record.status !== "running") {
      return { status: "done", result: { success: true } };
    }
    const status = await this.readSystemTestEvalStatus(runId);
    return systemTestRunnerSnapshotSchema.parse({
      status: status.status,
      ...(status.progress !== undefined ? { progress: status.progress } : {}),
      ...(status.result
        ? {
            result: {
              success: status.result.success,
              ...(status.result.error
                ? {
                    error: formatRpcFailure(
                      deserializeRpcFailure(status.result.error),
                    ),
                  }
                : {}),
            },
          }
        : {}),
    });
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getSystemTestRunResult(
    runId: string,
  ): Promise<SystemTestRunCompletion> {
    const persisted = this.persistedHeader(runId)?.record;
    if (persisted && persisted.status !== "running")
      return systemTestRunCompletionSchema.parse({
        summary: persisted.summary,
      });
    const status = await this.readSystemTestEvalStatus(runId);
    if (status.status !== "done") {
      throw new Error(
        `System-test run ${runId} is ${status.status}; no terminal result is available`,
      );
    }
    if (!status.result?.success) {
      if (status.result?.error) {
        throw deserializeRpcFailure(status.result.error);
      }
      throw new Error(`System-test run ${runId} failed`);
    }
    throw new Error(
      `System-test run ${runId} settled without a durable terminal record`,
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async releaseSystemTestRunExecution(
    runId: string,
  ): Promise<{ released: boolean }> {
    const record = this.requirePersistedHeader(runId).record;
    if (record.status === "running")
      throw new Error(
        `System-test run ${runId} is still active; execution cannot be released`,
      );
    const released = await this.rpc.call(
      "main",
      mainRpcMethods["eval.dispose"],
      [{ scopeKey: runId }],
    );
    return { released: released.ok };
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "write",
  })
  async cancelSystemTestRun(runId: string): Promise<SystemTestRunCompletion> {
    let cancellation: EvalCancelResult;
    try {
      cancellation = await this.evalRunObserver(runId).cancel();
    } catch (error) {
      throw new Error(
        `System-test run ${runId} could not settle its inner eval cancellation: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    if (cancellation.forcedReset) {
      throw new Error(
        `System-test run ${runId} required a forced EvalDO scope reset after non-cooperative cancellation; ` +
          "its terminal cleanup record is unavailable. Restart from a fresh exact run.",
      );
    }
    const record = this.requirePersistedHeader(runId).record;
    if (record.status === "running")
      throw new Error(
        `System-test run ${runId} cancellation did not persist its terminal record`,
      );
    return systemTestRunCompletionSchema.parse({ summary: record.summary });
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async inspectSystemTestRun(
    runId: string,
    testName?: string,
  ): Promise<unknown> {
    return inspectSystemTestRun(
      this.requirePersistedRecord(runId, testName),
      testName ? { testName } : undefined,
    );
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async readSystemTestTrajectoryPage(
    runId: string,
    testName: string,
    full: boolean,
    offset: number,
    limit: number,
  ): Promise<SystemTestTrajectoryPage> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    ) {
      throw new Error("Invalid system-test trajectory page range");
    }
    const text = JSON.stringify(
      systemTestTrajectory(
        this.requirePersistedRecord(runId, testName),
        testName,
        {
          full,
        },
      ),
      null,
      2,
    );
    return systemTestTrajectoryPageSchema.parse({
      length: text.length,
      encoding: "plain-string",
      chunk: text.slice(offset, offset + Math.min(limit, 128 * 1024)),
    });
  }

  @rpc({
    website: {
      kind: "closed",
      reason:
        "This receiver owns workspace orchestration or retained workspace data; websites require a reviewed bounded operation.",
    },
    requires: SYSTEM_TEST_OPERATOR,
    effect: { kind: "open" },
    tier: "open",
    sensitivity: "read",
  })
  async getFailedSystemTestRun(runId: string): Promise<{
    config: SystemTestFailedRunConfig;
    names: string[];
  }> {
    const record = this.requirePersistedHeader(runId).record;
    return systemTestFailedRunSchema.parse({
      config: record.config,
      names: [
        ...new Set([
          ...record.summary.failedTests,
          ...record.summary.testsWithUnexpectedToolFailures,
        ]),
      ],
    });
  }

  private readSystemTestEvalStatus(runId: string): Promise<EvalRunStatus> {
    return readEvalStatusWithRetry(() => this.evalRunObserver(runId).get());
  }

  private evalRunObserver(runId: string) {
    return createEvalRunObserver(createMainRpcCaller(this.rpc), {
      runId: systemTestEvalRunId(runId),
      scopeKey: runId,
    });
  }
}

export function systemTestUtilityKeys(
  kind: "doctor" | "list" | "teacher",
  invocationId: string,
): { subKey: string; scopeKey: string } {
  return {
    subKey: `system-test-${kind}-${invocationId}`,
    scopeKey: `$systemTestUtility:${kind}:${invocationId}`,
  };
}

function systemTestEvalRunId(runId: string): string {
  return `system-test-runner:${runId}`;
}

function parseStoredSystemTestRecord(value: unknown): StoredSystemTestRecord {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<string, unknown>)["kind"] !== "system-test-record-v1" ||
    typeof (value as Record<string, unknown>)["scopeKey"] !== "string" ||
    !Number.isInteger((value as Record<string, unknown>)["length"]) ||
    Number((value as Record<string, unknown>)["length"]) < 0
  ) {
    throw new Error(
      "system-test eval completed without a stored record envelope",
    );
  }
  return value as StoredSystemTestRecord;
}

function decodeUtf16LeBase64(value: string): string {
  const binary = atob(value);
  if (binary.length % 2 !== 0) throw new Error("invalid UTF-16LE scope page");
  let result = "";
  const chunkSize = 16_384;
  for (let offset = 0; offset < binary.length; offset += chunkSize * 2) {
    const end = Math.min(binary.length, offset + chunkSize * 2);
    const units = new Uint16Array((end - offset) / 2);
    for (let index = offset; index < end; index += 2) {
      units[(index - offset) / 2] =
        binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8);
    }
    result += String.fromCharCode(...units);
  }
  return result;
}

export default {
  async fetch(): Promise<Response> {
    return new Response("System-test runner Durable Object.", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
