import type { ManagedIntegrationReadinessReceiver } from "@workspace-skills/system-testing/integration-readiness-managed";
import type { ManagedTerminalCheckReceiver } from "@workspace-skills/system-testing/terminal-check-managed";
import type { ManagedProblemDraftReceiver } from "@workspace-skills/system-testing/problem-draft-managed";
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
import type { SpectroliteInput, ManagedSpectroliteReceiver } from "@workspace-skills/system-testing/spectrolite-contract";
import type { GardenReviewInput, ManagedGrimoireReceiver } from "@workspace-skills/system-testing/grimoire-contract";
import type { ChecklistInput, ManagedChecklistReceiver } from "@workspace-skills/system-testing/checklist-contract";
import type { ManagedSetupReceiver, SetupInput } from "@workspace-skills/system-testing/onboarding-contract";
import type { VerifiedMemoryReceiver, VerifiedMemoryInput } from "@workspace-skills/system-testing/verified-memory-contract";
import { managedMemoryOperation } from "@workspace-skills/system-testing/verified-memory-worlds";
import type { ManagedAuthoringReceiver, AuthoringInput } from "@workspace-skills/system-testing/authoring-contract";
import type { ManagedPresentationReceiver, PresentationTeacherInput } from "@workspace-skills/system-testing/presentation-contract";
import type { ManagedPdfReceiver, PdfIntakeInput } from "@workspace-skills/system-testing/pdf-intake-contract";
import type { ManagedPublicationReceiver, PublicationInput } from "@workspace-skills/system-testing/publication-preflight-contract";
import { pauseManagedAutomationFixture, seedManagedAutomation } from "@workspace-skills/system-testing/automation-lifecycle-managed";
import type { ManagedAutomationReceiver } from "@workspace-skills/system-testing/automation-lifecycle-contract";
import { scratchHandoffInputSchema, scratchHandoffTeacherInputSchema, type ScratchHandoffInput, type ScratchHandoffTeacherInput, type ScratchHandoffReceiver } from "@workspace-skills/system-testing/scratch-handoff-contract";
import { managedScratchWorlds } from "@workspace-skills/system-testing/scratch-handoff-worlds";
import {localMessagingInputSchema,type LocalMessagingInput,type LocalMessagingResult} from "@workspace-skills/system-testing/local-messaging-contract";
import {localMessagingTeacherCode} from "./local-messaging-teacher.js";
import {ownedOperationsInputSchema,type OwnedOperationsInput,type OwnedOperationsResult} from "@workspace-skills/system-testing/owned-operations-contract";
import {ownedOperationsTeacherCode} from "./owned-operations-teacher.js";
import { contentProjectTeacherInputSchema, contentProjectInputSchema, type ContentProjectTeacherInput, type ContentProjectInput, type ContentProjectResult, type ContentProjectReceiver } from "@workspace-skills/system-testing/content-project-contract";
import { createVcsClient } from "@workspace/runtime/vcs-client";
import { prepareWorkspaceIntegration, verifyWorkspaceIntegration, exerciseWorkspaceIntegration,
  type OwnedIntegrationWorld, type IntegrationFixtureInput, type IntegrationFixtureReceiver,
} from "@workspace-skills/system-testing/vcs-integration-fixture-contract";
import type { IntegrationHandoffReceiver } from "@workspace-skills/system-testing/integration-handoff-contract";
import { authoredTeacherCode, composedTeacherCode, domainTeacherCode } from "./authored-teacher.js";
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
    return await this.runHarnessUtility("teacher",`
      import {rpc,vcs,panelTree,contextId as actualContextId} from "@workspace/runtime";
      import {prepareManagedPublication,qualifyManagedPublication} from "@workspace-skills/system-testing/publication-preflight-managed";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Publication qualification belongs to another context");
      const panel=panelTree.get(input.panelId);
      const prepared=await prepareManagedPublication(rpc,vcs,panel,input);
      const utilityValue=await qualifyManagedPublication(rpc,vcs,panel,prepared);
    `) as Awaited<ReturnType<ManagedPublicationReceiver["qualifyManagedPublication"]>>;
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
      if(prepared.firstCase) {
        const program=await natlang.describe("skills/vibestudio-workflows/runWorkflow.nl");
        if(!program.functions.some(({name})=>name==="reviewLiveCleanup")) throw new Error("The shared Natlang workflow is missing Testkit cleanup");
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
      if(prepared.firstCase) {
        const program=await natlang.describe("skills/vibestudio-workflows/runWorkflow.nl");
        if(!program.functions.some(({name})=>name==="reviewLiveReplay")) throw new Error("The shared Natlang workflow is missing live session replay");
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

  private gardenReviewBindings(input: GardenReviewInput): string {
    return `
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareGardenReview} from "@workspace-skills/examples-review-fixtures/live-garden";
      import {managedGrimoireWorlds} from "@workspace-skills/system-testing/grimoire-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Garden belongs to another context");
      const world=managedGrimoireWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown Grimoire world");
      const prepared=prepareGardenReview(input.garden,input.before,world.request.claims,world.expected,world.actions.map(action=>action.toLowerCase()));
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews owned Spectrolite document and actual preview evidence."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedSpectroliteTeacher(input: SpectroliteInput & {executorModel:string}): ReturnType<ManagedSpectroliteReceiver["runManagedSpectroliteTeacher"]> {
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

  private spectroliteBindings(input: SpectroliteInput): string {
    return `
      import {panelTree,contextId as actualContextId} from "@workspace/runtime";
      import {prepareSpectroliteReview} from "@workspace-skills/spectrolite-review-fixtures/live";
      import {managedSpectroliteWorlds,spectrolitePanel,spectroliteVault} from "@workspace-skills/system-testing/spectrolite-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("Spectrolite review belongs to another context");
      const world=managedSpectroliteWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown Spectrolite assignment");
      const panel=panelTree.get(input.panelId);
      const panelState=await panel.observe();
      if(panelState.source!==spectrolitePanel || panelState.contextId!==input.contextId || panelState.requestedRef!=="ctx:"+input.contextId || panelState.kind!=="workspace") throw new Error("Spectrolite panel belongs to another assignment");
      const prepared=prepareSpectroliteReview(panel,actualContextId,spectroliteVault,world,input.navigation);
      const assignedServices=prepared.services;
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the owned News participant and its exact schedule owners."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedNewsTeacher(input: NewsInput & {executorModel:string}): ReturnType<ManagedNewsReceiver["runManagedNewsTeacher"]> {
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
      import {contextId as actualContextId} from "@workspace/runtime";
      import {prepareLiveNews} from "@workspace/news-live-evidence/live";
      import {managedNewsWorlds} from "@workspace-skills/system-testing/news-worlds";
      const input=${JSON.stringify(input)};
      if(actualContextId!==input.contextId) throw new Error("News review belongs to another context");
      const world=managedNewsWorlds.find(world=>world.id===input.caseId);
      if(!world) throw new Error("Unknown News assignment");
      const prepared=prepareLiveNews(input,world);
    `;
  }

  @rpc({website:{kind:"closed",reason:"Reviews the owned Google setup panel and account readiness."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedGoogleSetupTeacher(input: GoogleSetupInput & {executorModel:string}): ReturnType<ManagedGoogleSetupReceiver["runManagedGoogleSetupTeacher"]> {
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

  private googleSetupBindings(input: GoogleSetupInput): string {
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
      const prepared=prepareGoogleSetupJourney(panel,actualContextId,world);
      const assignedServices=prepared.services;
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

  private async logAuditBindings(input: LogAuditInput): Promise<string> {
    const world=managedLogAuditWorlds.find(({id})=>id===input.caseId);
    if (!world) throw new Error("Unknown host log audit assignment");
    const {contextId}=await this.integrationFixtureIdentity();
    if (contextId!==input.contextId) throw new Error("Host log fixture belongs to another context");
    const marker=`natlang-host-log-${crypto.randomUUID()}`;
    const initial=await this.rpc.call("main",mainRpcMethods["serverLog.query"],[{contains:marker,limit:1}]);
    const seed={marker,boot:initial.serverBootId,workspaceId:initial.workspaceId,start:initial.latestSeq,steps:[] as number[]};
    for (const [index,line] of world.lines.entries()) {
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
      work:{kind:"domain",domain:"agenticDevelopment",operation:"planProblemDraft",input:{goal:"Plan the assigned agentic change"}},
      inputCode:"prepared.request",
      bindingCode:this.managedProblemDraftBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedProblemDraftReceiver["runManagedProblemDraftTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live local report writes without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedProblemDraft(input: {contextId:string;caseId:string}): ReturnType<ManagedProblemDraftReceiver["qualifyManagedProblemDraft"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.managedProblemDraftBindings(input)}
      await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedProblemDraftReceiver["qualifyManagedProblemDraft"]>>;
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

  @rpc({website:{kind:"closed",reason:"Captures assigned host preflight and scope comparison."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async runManagedAuthorityReviewTeacher(input: {contextId:string;caseId:string;executorModel:string}): ReturnType<ManagedAuthorityReviewReceiver["runManagedAuthorityReviewTeacher"]> {
    return await this.runHarnessUtility("teacher",runId=>`${domainTeacherCode({
      executorModel:input.executorModel,
      work:{kind:"domain",domain:"agenticDevelopment",operation:"planAuthorityReview",input:{goal:"Plan the assigned agentic change"}},
      inputCode:"prepared.request",
      bindingCode:this.managedAuthorityReviewBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedAuthorityReviewReceiver["runManagedAuthorityReviewTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies real host preflight observations without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedAuthorityReview(input: {contextId:string;caseId:string}): ReturnType<ManagedAuthorityReviewReceiver["qualifyManagedAuthorityReview"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.managedAuthorityReviewBindings(input)}
      await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedAuthorityReviewReceiver["qualifyManagedAuthorityReview"]>>;
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
      work:{kind:"domain",domain:"agenticDevelopment",operation:"planAgenticChange",input:{goal:"Plan the assigned agentic change"}},
      inputCode:"prepared.request",
      bindingCode:this.managedAgenticChangeBindings(input),
    },runId)}
      utilityValue={contextId:actualContextId,teacher:utilityValue,verification:await prepared.verify(utilityValue.report)};
    `) as Awaited<ReturnType<ManagedAgenticChangeReceiver["runManagedAgenticChangeTeacher"]>>;
  }

  @rpc({website:{kind:"closed",reason:"Qualifies live agentic stack source observations without a model."},requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async qualifyManagedAgenticChange(input: {contextId:string;caseId:string}): ReturnType<ManagedAgenticChangeReceiver["qualifyManagedAgenticChange"]> {
    return await this.runHarnessUtility("teacher",`
      ${this.managedAgenticChangeBindings(input)}
      await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
      const utilityValue=await prepared.qualify();
    `) as Awaited<ReturnType<ManagedAgenticChangeReceiver["qualifyManagedAgenticChange"]>>;
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

  @rpc({website:{kind:"closed",reason:"Harness seeds its owned local VCS exercise without publishing."}, requires:SYSTEM_TEST_OPERATOR,effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async prepareWorkspaceIntegrationFixture(input:IntegrationFixtureInput) {
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
    },input.seed,input.worldId);
    const {cleanup,...stored}=world;
    this.sql.exec("INSERT OR REPLACE INTO state(key,value) VALUES (?,?)", "__integration_fixture",JSON.stringify(stored));
    const before=(await vcs.status()).workingHead;
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
    const handle = createEvalRunHandle(createMainRpcCaller(this.rpc), {
      runId: systemTestEvalRunId(config.runId),
      scope: { key: config.runId, lifecycle: "finite" },
      source: {
        kind: "inline",
        code: systemTestEvalCode(config, this.rpcSelfId),
        syntax: "typescript",
      },
    });
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
