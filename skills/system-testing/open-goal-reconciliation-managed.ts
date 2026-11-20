import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";
import type { RuntimeFs, VcsClient, rpc as RuntimeRpc } from "@workspace/runtime";
import { createWorkspaceIntegration } from "@workspace/natlang-services";
import type {
  EvidenceReceipt, IntegrationResult, ReconcileDecision, ReconcileEdit, ReconcileEffect, ReconcileResult,
} from "@workspace-skills/open-local-reconciliation/types";
import { bindManagedScratchHandoff, readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { verifyWorkspaceIntegration } from "./vcs-integration-oracle.js";
import type { OwnedIntegrationWorld } from "./vcs-integration-fixture-contract.js";
import { seedReconciliationArchive } from "./reconciliation-archive.js";
import type { ReconciliationWorld } from "./open-goal-reconciliation-worlds.js";

type Ports = { fs: RuntimeFs; rpc: Pick<typeof RuntimeRpc, "call">; vcs: VcsClient };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Excerpt = { sourceId: string; firstLine: number; lastLine: number; text: string };
type Window = ReconciliationWorld["assignment"]["companion"];
const stageName = /^evidence-handoff-[a-f0-9]{32}$/u;
const token = (state: VcsStateNodeRef) => JSON.stringify(state);
const quoted = (text: string) => text.trimEnd().split(/\r?\n/u);

export async function prepareOpenReconciliation(
  input: { contextId: string; caseId: string }, scenario: ReconciliationWorld,
  world: OwnedIntegrationWorld, { vcs, fs, rpc }: Ports,
) {
  const { contextId } = input;
  if (input.caseId !== scenario.id || world.fixture.contextId !== contextId || !world.companion)
    throw new Error("A reconciliation needs its owned target and approval repository");
  const companion = world.companion;
  const fixture = structuredClone(world.fixture);
  if (fixture.source.kind !== "event") throw new Error("Reconciliation requires a committed incoming revision");
  const incoming = { kind: "event" as const, eventId: fixture.source.eventId };
  const status = () => vcs.status({ contextId });
  const read = async (state: VcsStateNodeRef, repositoryId: string, path: string) => {
    const actual = await vcs.readFile({ state, repositoryId, file: { kind: "path", path } });
    if (!actual || actual.repositoryId !== repositoryId || actual.path !== path || actual.content.kind !== "text")
      throw new Error("A scoped reconciliation file no longer matches its assignment");
    return { id: actual.fileId, text: actual.content.text };
  };
  const before = await status();
  const scratchBefore: string[] = await listOwnedScratchEntries(fs);
  const native = createWorkspaceIntegration({ vcs, contextId, source: fixture.source, files: world.files });
  const effects: Effect[] = [];
  const remember = <T>(service: string, method: string, args: unknown[], result: T) => {
    effects.push({ service, method, args, result: structuredClone(result) });
    return result;
  };
  const readWindow = async (state: VcsStateNodeRef) => {
    const parsed = JSON.parse((await read(state, companion.repositoryId, companion.path)).text) as Window;
    if (parsed.title !== scenario.assignment.companion.title || !["open", "pending", "closed"].includes(parsed.window))
      throw new Error("Review window has invalid ownership or disposition");
    return { ...parsed, head: token(state) };
  };
  const sourcePairs = [...new Set(scenario.evidence.map(item => item.path))].map((path, index) => {
    const assignment = world.files.find(item => item.path === path);
    if (!assignment) throw new Error("Handoff source is outside this project");
    return { relative: path, id: "review-" + (index + 1), path: "/" + assignment.workspacePath };
  });
  const request = {
    goal: "Retain exact current settings evidence for the authorized local handoff.",
    questions: scenario.evidence.map(item => item.question),
    sources: sourcePairs.map(({ id, path }) => ({ id, path })),
  };
  const scratch = sourcePairs.length ? bindManagedScratchHandoff(fs, rpc, request) : null;
  let release: string | null = null;
  let race: { kind: "peer-edit" | "close-window"; before: string; after: string; changeIds: string[] } | null = null;
  let mergeHead: string | null = null;
  const assignedPaths = new Set(world.files.map(item => item.workspacePath));
  const readNative = async (state: VcsStateNodeRef, setting: string) =>
    (await read(state, fixture.repositoryId, setting)).text;
  const archive = scenario.archive ? await seedReconciliationArchive(scenario.archive.entries, {
    baseline: fixture.commonSeedEvent, local: before.workingHead, incoming,
  }, fs, rpc, readNative) : null;
  const initialFiles = await Promise.all(world.files.map(async item => (await read(before.workingHead, item.repositoryId, item.path)).text));
  const journal = await Promise.all(world.files.map(async item => ({
    path: item.workspacePath,
    baseline: (await read(fixture.commonSeedEvent, item.repositoryId, item.path)).text,
    incoming: (await read(incoming, item.repositoryId, item.path)).text,
  })));
  const inject = async (kind: "peer-edit" | "close-window", workingHead: VcsStateNodeRef) => {
    const change = scenario.race;
    if (race || !change || change.kind !== kind) return null;
    const repositoryId = change.kind === "peer-edit" ? fixture.repositoryId : companion.repositoryId;
    const path = change.kind === "peer-edit" ? change.path : companion.path;
    const prior = await read(workingHead, repositoryId, path);
    const parsed = JSON.parse(prior.text);
    const next = change.kind === "peer-edit" ? { ...parsed, [change.field]: change.text } : { ...parsed, window: "closed", note: change.note };
    const result = await vcs.edit({
      contextId, commandId: crypto.randomUUID(), expectedWorkingHead: workingHead,
      changes: [{ kind: "text-edit", repositoryId, fileId: prior.id, edits: [{ start: 0, end: prior.text.length, text: JSON.stringify(next) + "\n" }] }],
    });
    if (!result.changeIds.length) throw new Error("Concurrent desk change did not yield a native edit event");
    race = { kind, before: token(workingHead), after: token(result.workingHead), changeIds: result.changeIds };
    if (change.kind === "peer-edit") {
      const required = fixture.files.find(item => item.path === change.path);
      if (!required) throw new Error("Desk change names an unassigned file");
      required.expected[change.field] = change.text;
    }
    return race.after;
  };

  const services = {
    reconciliationArchive: {
      async list() {
        return remember("reconciliationArchive", "list", [], archive?.list() ?? []);
      },
      async read(id: string) {
        return remember("reconciliationArchive", "read", [id], await archive?.read(id) ?? null);
      },
      async readCurrent(id: string, head: string) {
        const { workingHead } = await status();
        const observed = archive && token(workingHead) === head ? await archive.current(id, workingHead) : null;
        return remember("reconciliationArchive", "readCurrent", [id, head], observed);
      },
    },
    reconciliationWindow: {
      async read() {
        return remember("reconciliationWindow", "read", [], await readWindow((await status()).workingHead));
      },
      async release(head: string) {
        const current = await status();
        const reachable = scratch && token(current.workingHead) === head && head === mergeHead &&
          (await readWindow(current.workingHead)).window === "open";
        const comparison = reachable ? await vcs.compare({ target: current.workingHead, source: incoming }) : null;
        const complete = comparison?.resolution.complete && comparison.resolution.concluded &&
          comparison.resolution.remainingCoordinateCount === 0 && token((await status()).workingHead) === head;
        if (complete) release = head;
        return remember("reconciliationWindow", "release", [head], complete ? request : null);
      },
    },
    reconciliationNative: {
      async observe() {
        const actual = await native.observe();
        const pages = actual.evidence.map(page => JSON.parse(page) as Awaited<ReturnType<VcsClient["compare"]>>);
        const choices = pages.flatMap(page => page.coordinates.flatMap(item => {
          if (item.coordinate.kind !== "file" || !actual.remaining.some(remaining => remaining.id === item.coordinate.id)) return [];
          const fileId = item.coordinate.id;
          const file = fixture.files.find(entry => entry.fileId === fileId);
          const path = file && world.files.find(entry => entry.path === file.path)?.workspacePath;
          return path ? [{ path, id: fileId, options: item.resolutions }] : [];
        }));
        return remember("reconciliationNative", "observe", [], {
          head: actual.head, source: actual.source, baseline: token(fixture.commonSeedEvent), choices,
          window: await readWindow(JSON.parse(actual.head) as VcsStateNodeRef),
          files: journal.map(row => ({ ...row, local: actual.files.find(item => item.path === row.path)?.text ?? "" })),
        });
      },
      async apply(head: string, edits: ReconcileEdit[]): Promise<ReconcileEffect> {
        if (!edits.length || edits.some(edit => !assignedPaths.has(edit.path)))
          throw new Error("Edit only the observed integration files");
        const { workingHead } = await status();
        if (token(workingHead) !== head)
          return remember("reconciliationNative", "apply", [head, edits], { status: "changed", head: token(workingHead) });
        if ((await readWindow(workingHead)).window !== "open")
          return remember("reconciliationNative", "apply", [head, edits], { status: "held", head });
        const newer = scenario.race?.kind === "close-window" && scenario.race.at === "apply"
          ? await inject("close-window", workingHead) : await inject("peer-edit", workingHead);
        if (newer) return remember("reconciliationNative", "apply", [head, edits], { status: "changed", head: newer });
        const applied = await native.apply(head, edits);
        return remember("reconciliationNative", "apply", [head, edits], { status: "accepted", head: applied.head });
      },
      async merge(head: string, decisions: ReconcileDecision[]): Promise<ReconcileEffect> {
        const { workingHead } = await status();
        if (token(workingHead) !== head)
          return remember("reconciliationNative", "merge", [head, decisions], { status: "changed", head: token(workingHead) });
        if ((await readWindow(workingHead)).window !== "open")
          return remember("reconciliationNative", "merge", [head, decisions], { status: "held", head });
        const result = await native.merge(head, decisions);
        mergeHead = result.head;
        return remember("reconciliationNative", "merge", [head, decisions], { status: "accepted", head: result.head });
      },
    },
    scratchHandoffRead: {
      async read(id: string) {
        const { workingHead } = await status();
        const current = scratch && release === token(workingHead) && (await readWindow(workingHead)).window === "open";
        return remember("scratchHandoffRead", "read", [id], current ? await scratch.scratchHandoffRead.read(id) : null);
      },
    },
    scratchHandoffWrite: {
      async stage(body: string) {
        const { workingHead } = await status();
        const current = scratch && release === token(workingHead) && (await readWindow(workingHead)).window === "open";
        if (!current || (scenario.race?.kind === "close-window" && scenario.race.at === "handoff"
          && await inject("close-window", workingHead)))
          return remember("scratchHandoffWrite", "stage", [body], null);
        const receipt = await scratch.scratchHandoffWrite.stage(body);
        if (receipt && token((await status()).workingHead) !== release) {
          await fs.rm(receipt.path.slice(0, -"/handoff.json".length), { recursive: true, force: true });
          return remember("scratchHandoffWrite", "stage", [body], null);
        }
        return remember("scratchHandoffWrite", "stage", [body], receipt);
      },
    },
  };

  async function verify(value: unknown) {
    const report = value as { skill?: string; status?: string; outcome?: ReconcileResult } | null;
    const outcome = report?.outcome;
    const integration = outcome?.integration;
    const handoff = outcome?.handoff;
    const current = await status();
    const window = await readWindow(current.workingHead);
    const result = scenario.expected.status === "integrated" ? await verifyWorkspaceIntegration(vcs, fixture) : null;
    const finalFiles = await Promise.all(world.files.map(async item => (await read(current.workingHead, item.repositoryId, item.path)).text));
    const nativeWindow = await read(current.workingHead, companion.repositoryId, companion.path);
    const expectedWindow = scenario.race?.kind === "close-window"
      ? { ...scenario.assignment.companion, window: "closed", note: scenario.race.note }
      : scenario.assignment.companion;
    const canary = await read(current.workingHead, companion.repositoryId, companion.canaryPath);
    const originalSourceUntouched = (await Promise.all(world.files.map(async item => (await read(incoming, item.repositoryId, item.path)).text)))
      .every((text, index) => text === journal[index]?.incoming);
    const traces = (service: string, method: string) => effects.filter(entry => entry.service === service && entry.method === method);
    const stages = traces("scratchHandoffWrite", "stage");
    const src = new Map(await Promise.all(sourcePairs.map(async ({ relative, id }) =>
      [relative, { id, lines: quoted((await read(current.workingHead, fixture.repositoryId, relative)).text) }] as const)));
    const dirs = (await listOwnedScratchEntries(fs)).filter(name => stageName.test(name) && !scratchBefore.includes(name));
    let artifact: EvidenceReceipt & { sha256: string } | null = null;
    let evidenceMatches = !dirs.length && handoff?.artifact === null;
    if (scenario.expected.handoff === "staged" && dirs.length === 1) {
      const path = "/.tmp/" + dirs[0] + "/handoff.json";
      try {
        const bytes = await readWorkspaceBytes(rpc, path, 64 * 1024);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const { answers } = JSON.parse(text) as { answers: { question: string; evidence: Excerpt[] }[] };
        artifact = { path, bytes: bytes.length, sha256: sha256HexSyncText(text) };
        evidenceMatches = isDeepStrictEqual(await fs.readdir("/.tmp/" + dirs[0]), ["handoff.json"]) &&
          stages.length === 1 && stages[0]?.args[0] === text && handoff?.artifact?.path === path &&
          handoff.artifact.bytes === bytes.length && answers.length === scenario.evidence.length &&
          scenario.evidence.every(({ question, path: source, keys }, index) => {
            const found = src.get(source);
            const answer = answers[index];
            return found && answer?.question === question && answer.evidence.length === 1 &&
              answer.evidence[0]?.sourceId === found.id && answer.evidence[0].firstLine === 1 &&
              answer.evidence[0].lastLine === found.lines.length && answer.evidence[0].text === found.lines.join("\n") &&
              keys.every(key => Object.hasOwn(JSON.parse(found.lines.join("\n")), key));
          });
      } catch { evidenceMatches = false; }
    }
    const stagedReads = traces("scratchHandoffRead", "read");
    const expectedStatus = scenario.expected.status;
    const observedRace = race;
    const closedAtEdit = scenario.race?.kind === "close-window" && scenario.race.at === "apply";
    const observedStaleWrite = observedRace && traces("reconciliationNative", "apply").some(entry =>
      entry.args[0] === observedRace.before && isDeepStrictEqual(entry.result, { status: "changed", head: observedRace.after }));
    const archiveRecheck = archive && scenario.archive
      ? await archive.verify(scenario.archive.selected, outcome?.archive, current.workingHead) : null;
    const checkedArchive = archiveRecheck
      ? archiveRecheck.passed && traces("reconciliationArchive", "list").length > 0 &&
        traces("reconciliationArchive", "readCurrent").some(entry =>
          entry.args[0] === archiveRecheck.sourceId && entry.args[1] === integration?.head && entry.result !== null)
      : !scenario.archive;
    const checks = {
      recoveredRetainedReconciliation: checkedArchive,
      observedOwnedIntegration: traces("reconciliationWindow", "read").length > 0 &&
        traces("reconciliationNative", "observe").length > 0 && originalSourceUntouched,
      verifiedNativeIntegration: expectedStatus === "integrated"
        ? Boolean(result?.passed && mergeHead && integration?.head === mergeHead)
        : !mergeHead && current.clean === before.clean && isDeepStrictEqual(finalFiles, initialFiles) &&
          token(current.workingHead) === (closedAtEdit ? observedRace?.after : token(before.workingHead)) &&
          integration?.head === token(current.workingHead),
      protectedNeighborAndMain: current.mainEventId === before.mainEventId &&
        isDeepStrictEqual(current.committed, before.committed) && canary.text === companion.canaryText &&
        nativeWindow.text === JSON.stringify(expectedWindow) + "\n",
      honoredRevisionOrWindowRace: scenario.race ? observedRace?.kind === scenario.race.kind &&
        (observedRace.kind === "peer-edit" ? Boolean(observedStaleWrite)
          : window.window === "closed" && (closedAtEdit ? Boolean(observedStaleWrite) : stages.some(entry => entry.result === null)))
        : observedRace === null,
      retainedVerifiedIntegrationEvidence: evidenceMatches &&
        (scenario.expected.handoff === "none" ? stages.length === 0 && release === null
          : Boolean(release && stagedReads.length && sourcePairs.every(pair =>
              stagedReads.some(entry => entry.args[0] === pair.id && entry.result)))) &&
        (scenario.expected.handoff === "staged" ? artifact !== null : artifact === null),
      matchedReconciliationHandoff: report?.status === "workspace-skill-reviewed" && report.skill === "localReconciliation" &&
        integration?.status === expectedStatus && handoff?.status === scenario.expected.handoff &&
        isDeepStrictEqual(outcome?.window, window) &&
        scenario.expected.reason.every(term => typeof integration.reason === "string" && integration.reason.toLowerCase().includes(term)),
    };
    return {
      contextId, caseId: input.caseId, goal: scenario.goal, passed: Object.values(checks).every(Boolean), checks,
      effects, window, race, release, mergeHead, artifact, nativeHead: token(current.workingHead), archiveRecheck,
      integrationOracle: result ? { passed: result.passed, reasons: result.reasons, verificationPaths: result.verificationPaths } : null,
    };
  }

  async function qualify() {
    await services.reconciliationWindow.read();
    let view = await services.reconciliationNative.observe();
    let foreignDenied = false;
    try {
      await services.reconciliationNative.apply(view.head, [{ path: companion.repoPath + "/" + companion.path, before: "", after: "" }]);
    } catch { foreignDenied = true; }
    const stale = await services.reconciliationNative.merge("foreign-head", []);
    const snapshots = scenario.archive ? await Promise.all((await services.reconciliationArchive.list()).map(card =>
      services.reconciliationArchive.read(card.id))) : [];
    let progress: IntegrationResult = { status: "held", head: view.head, reason: scenario.expected.reason.join(" ") };
    const testRetiredWindow = scenario.race?.kind === "close-window" && scenario.race.at === "apply";
    if (scenario.expected.status === "integrated" || testRetiredWindow) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const edits = view.files.map(row => {
          const match = fixture.files.find(item => world.files.some(file => file.path === item.path && file.workspacePath === row.path));
          if (!match) throw new Error("Reference cannot resolve owned settings");
          return { path: row.path, before: row.local, after: JSON.stringify(match.expected) + "\n" };
        });
        const applied = await services.reconciliationNative.apply(view.head, edits);
        view = await services.reconciliationNative.observe();
        if (applied.status === "changed") {
          if (view.window.window === "open") continue;
          progress = { status: "held", head: view.head, reason: "The review window closed before the old revision could be edited." };
          break;
        }
        if (applied.status !== "accepted") throw new Error("Reference expected an authorized edit");
        const decisions = view.choices.map(({ id, options }): ReconcileDecision => ({
          coordinate: { kind: "file", id },
          resolution: options.includes("current") ? "current" : "composed",
          rationale: "The observed current file contains both authorized intentions.",
        }));
        const merged = await services.reconciliationNative.merge(view.head, decisions);
        if (merged.status !== "accepted") throw new Error("Reference expected a native merge");
        view = await services.reconciliationNative.observe();
        progress = { status: "integrated", head: view.head, reason: "The native merge and current assigned file readback are consistent." };
        break;
      }
    }
    const historicalId = scenario.archive ? archive?.referenceId(scenario.archive.selected) : null;
    const older = snapshots.find(entry => entry?.id === historicalId);
    const current = older && await services.reconciliationArchive.readCurrent(older.id, progress.head);
    const comparison = older && current ? {
      prior: older, current, relation: current.exists && isDeepStrictEqual(current.value, older.value) ? "matches" : "changed",
    } : null;
    let artifact: EvidenceReceipt | null = null;
    if (scenario.evidence.length && progress.status === "integrated") {
      const assignment = await services.reconciliationWindow.release(progress.head);
      if (!assignment) throw new Error("Reference could not release the authorized review");
      const answers = await Promise.all(scenario.evidence.map(async item => {
        const source = sourcePairs.find(pair => pair.relative === item.path);
        if (!source) throw new Error("Unassigned reference evidence");
        const snapshot = await services.scratchHandoffRead.read(source.id);
        if (!snapshot || !item.keys.every(key => Object.hasOwn(JSON.parse(snapshot.lines.join("\n")), key))) return null;
        return { question: item.question, evidence: [{ sourceId: source.id, firstLine: 1, lastLine: snapshot.lines.length, text: snapshot.lines.join("\n") }] };
      }));
      if (answers.every(Boolean)) artifact = await services.scratchHandoffWrite.stage(JSON.stringify({ answers }, null, 2) + "\n");
    }
    const handoff = { status: artifact ? "staged" : scenario.evidence.length ? "held" : "none", artifact };
    const window = await services.reconciliationWindow.read();
    const result = await verify({ status: "workspace-skill-reviewed", skill: "localReconciliation", outcome: { integration: progress, handoff, window, archive: comparison } });
    const scope = foreignDenied && stale.status === "changed";
    return { ...result, passed: result.passed && scope, checks: { ...result.checks, rejectedInvalidIntegrationScope: scope } };
  }
  return { goal: scenario.goal, services, verify, qualify };
}
