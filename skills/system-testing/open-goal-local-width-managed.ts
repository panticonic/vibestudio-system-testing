import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["effects","survey","finding"],["handoffText"]);
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { localModelsExtensionMethods, type LocalModelEntry } from "@workspace/model-catalog/localModels";
import type { RuntimeFs, VcsClient } from "@workspace/runtime";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { LocalWidthWorld, ScopeVariant, WidthDisposition } from "./open-goal-local-width-worlds.js";

type Ports = { contextId: string; fs: RuntimeFs; vcs: Pick<VcsClient, "status">; readBytes(path: string, limit: number): Promise<Uint8Array> };
type Scope = { machine: string; boot: string; configuration: string };
type Lane = "main" | "utility";
type Provider = { id: string; ref: string; scope: Scope; selectable: boolean; tools: boolean; contextWindow: number; lane: Lane };
type Server = { id: string; scope: Scope; lane: Lane; modelRefs: string[]; advertisedWidth: number; running: boolean };
type Witness = { id: string; scope: Scope; provider: string; ref: string; lane: Lane; intervals: {
  id: string; start: number; end: number; contextTokens: number; usedTools: boolean; terminal: string;
}[] };
type Need = { requestedRef: string; alternativesAllowed: boolean; lanes: number; minimumContext: number; tools: boolean };
type Survey = { scope: Scope; requirement: Need; providers: Provider[]; servers: Server[];
  inventory: { ref: string; tools: boolean; contextWindow: number; lane: Lane }[];
  witnesses: Omit<Witness, "intervals">[]; release: LocalWidthWorld["release"] };
type Facts = { disposition: WidthDisposition; ref: string | null; provider: string | null;
  advertisedWidth: number | null; witnessedWidth: number | null; witness: string | null };
type Finding = Facts & { reason: string };
type ReadinessLine = { ref: string; usable: boolean; state: string; detail: string; failure?: string };
type Readiness = { models: ReadinessLine[]; executor: Omit<ReadinessLine, "failure">; preferred: string | null; advice: string[] };
type Handoff = { path: string; bytes: number; sha256: string };
type Outcome = { survey: Survey; readiness: Readiness; finding: Finding; handoff: Handoff | null };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const local = (model: string) => "local:" + model;
const inventoried = (row: LocalModelEntry) => row.state === "ready" || row.state === "startable";
const names = [local("qwen3.8-27b"), local("lfm3-1.7b"), local("lfm2.5-2.6b")];
const outputName = /^evidence-handoff-[a-f0-9]{32}$/u;
const stateRank: WidthDisposition[] = ["verified", "short-width", "unproven-width", "startable", "incompatible", "provider-unavailable", "model-unavailable"];

function evaluateWidth(need: Need, receipt: Witness) {
  const seen = new Set<string>();
  const complete = receipt.intervals.filter(interval => {
    if (interval.terminal !== "complete" || interval.end <= interval.start ||
        interval.contextTokens < need.minimumContext || (need.tools && !interval.usedTools) || seen.has(interval.id))
      return false;
    seen.add(interval.id);
    return true;
  });
  if (!complete.length) return null;
  return Math.max(...complete.map(({ start }) => complete.filter(interval => interval.start <= start && start < interval.end).length));
}

function inspectCandidate(ref: string, survey: Survey, rows: LocalModelEntry[], receipts: Witness[]) {
  const row = rows.find(item => local(item.slug) === ref);
  const fact: Facts = { ref, provider: null, advertisedWidth: null, witnessedWidth: null, witness: null, disposition: "model-unavailable" };
  if (!row || !inventoried(row)) return { fact, candidates: [] };
  const provider = survey.providers.find(entry => entry.ref === ref && entry.selectable && entry.lane === row.server &&
    isDeepStrictEqual(entry.scope, survey.scope));
  if (!provider) return { fact: { ...fact, disposition: "provider-unavailable" } as Facts, candidates: [] };
  fact.provider = provider.id;
  const need = survey.requirement;
  if (Math.min(row.contextWindow, provider.contextWindow) < need.minimumContext || (need.tools && !(row.toolsCapable && provider.tools)))
    return { fact: { ...fact, disposition: "incompatible" } as Facts, candidates: [] };
  const server = survey.servers.find(entry => entry.lane === provider.lane && isDeepStrictEqual(entry.scope, survey.scope));
  fact.advertisedWidth = server?.advertisedWidth ?? null;
  if (row.state === "startable") return { fact: { ...fact, disposition: "startable" } as Facts, candidates: [] };
  fact.disposition = "unproven-width";
  if (!server?.running || !server.modelRefs.includes(ref)) return { fact, candidates: [] };
  const candidates = receipts.filter(entry => entry.ref === ref && entry.provider === provider.id && entry.lane === provider.lane &&
    isDeepStrictEqual(entry.scope, survey.scope));
  const ordered = candidates.map(entry => ({ entry, width: evaluateWidth(need, entry) }))
    .filter(candidate => candidate.width !== null)
    .sort((left, right) => right.width! - left.width! || left.entry.id.localeCompare(right.entry.id));
  const best = ordered[0];
  if (best?.width != null) {
    fact.witnessedWidth = best.width;
    fact.witness = best.entry.id;
    fact.disposition = best.width >= need.lanes ? "verified" : "short-width";
  }
  return { fact, candidates };
}

function factOnly(finding: Finding): Facts {
  const { disposition, ref, provider, advertisedWidth, witnessedWidth, witness } = finding;
  return { disposition, ref, provider, advertisedWidth, witnessedWidth, witness };
}

export async function prepareLocalWidthGoal(input: { contextId: string; caseId: string }, world: LocalWidthWorld, ports: Ports) {
  if (!input.contextId || input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Local width requires the assigned owned workspace");
  const { fs, vcs, readBytes } = ports;
  const before = await vcs.status();
  const outputs = async () => (await listOwnedScratchEntries(fs)).filter(name => outputName.test(name)).sort();
  const baselineOutputs = await outputs();
  const directory = await fs.mkdtemp("retained-local-width");
  const scope: Scope = { machine: world.machine, boot: crypto.randomUUID(), configuration: "saved-local-config-8" };
  function scopeFor(variant: ScopeVariant): Scope {
    if (variant === "previous-boot") return { ...scope, boot: "earlier-boot" };
    if (variant === "previous-config") return { ...scope, configuration: "saved-local-config-5" };
    if (variant === "other-machine") return { ...scope, machine: world.machine + " spare" };
    return scope;
  }
  const requirement: Need = { requestedRef: local(world.desired.model), alternativesAllowed: world.desired.alternate,
    lanes: world.desired.lanes, minimumContext: world.desired.context, tools: world.desired.tools };
  const inventory = world.models.map(row => ({
    slug: row.model, displayName: row.model, baseUrl: "https://owned-local-model-record.invalid/", server: row.lane,
    contextWindow: row.context, maxTokens: row.context, toolsCapable: row.tools, reasoningCapable: false,
    fit: { fit: "cpu-only", estTokensPerSec: null, contextLength: row.context, gpuLayers: 0, notes: [] },
    measuredTokensPerSec: null, state: row.state,
    download: row.state === "downloading" ? { progress: 0.75, phase: "active", receivedBytes: 3, totalBytes: 4 } : null,
    errorMessage: row.state === "error" ? "llama-server smoke test failed" : null,
  }));
  const providers = world.providers.map(row => ({ id: row.key, ref: local(row.model), scope: scopeFor(row.scope),
    lane: row.lane, contextWindow: row.context, tools: row.tools, selectable: row.selectable }));
  const serverFiles = world.servers.map(entry => ({
    id: crypto.randomUUID(), scope: scopeFor(entry.scope), lane: entry.lane, advertisedWidth: entry.width,
    native: { role: "attached", owner: null, hardware: null, engine: null,
      servers: { utility: { state: "stopped" }, main: { state: "stopped" }, [entry.lane]: entry.running ?
        { state: "running", port: 12345, loadedModels: entry.models, uptimeMs: 60_000 } : { state: "stopped" } },
      fallback: { ready: false, warm: false, modelRef: local("lfm2.5-2.6b"), downloadSizeBytes: 0, reason: null },
      downloads: [], storageRoot: "/owned/retained-inventory", diskFreeBytes: 0 },
  }));
  const witnesses: Witness[] = world.receipts.map(entry => ({
    id: crypto.randomUUID(), scope: scopeFor(entry.scope), provider: entry.provider, lane: entry.lane, ref: local(entry.model),
    intervals: entry.intervals.map(interval => ({ id: interval.id, start: interval.start, end: interval.end,
      contextTokens: interval.context, usedTools: interval.tools, terminal: interval.terminal })),
  }));
  const files = new Map<string, string>();
  async function save(name: string, payload: unknown) {
    const path = directory + "/" + name + ".json";
    const text = JSON.stringify(payload);
    await fs.writeFile(path, text);
    files.set(path, text);
    return path;
  }
  const catalogPath = await save("inventory", inventory);
  const providerPath = await save("providers", { scope, requirement, providers, release: world.release });
  const serverPath = await save("servers", serverFiles);
  const witnessPaths = new Map<string, string>();
  for (const entry of witnesses) witnessPaths.set(entry.id, await save(entry.id, entry));
  const read = async <T>(path: string): Promise<T> => JSON.parse(decoder.decode(await readBytes(path, 32 * 1024)));
  const readInventory = async () => localModelsExtensionMethods.listModels.result.parse(await read(catalogPath));
  async function readSurvey(): Promise<Survey> {
    const retained = await read<{ scope: Scope; requirement: Need; providers: Provider[]; release: Survey["release"] }>(providerPath);
    const servers: Server[] = (await read<typeof serverFiles>(serverPath)).map(({ id, scope, lane, advertisedWidth, native }) => {
      const status = localModelsExtensionMethods.status.result.parse(native).servers[lane];
      return { id, scope, lane, advertisedWidth, running: status.state === "running",
        modelRefs: status.state === "running" ? status.loadedModels.map(local) : [] };
    });
    const receipts = await Promise.all([...witnessPaths.values()].map(path => read<Witness>(path)));
    return { ...retained, servers, inventory: (await readInventory()).map(row => ({
      ref: local(row.slug), tools: row.toolsCapable, contextWindow: row.contextWindow, lane: row.server,
    })), witnesses: receipts.map(({ intervals: _intervals, ...identity }) => identity) };
  }
  const scratch = bindScratchHandoff(fs, { goal: world.goal, questions: ["Review the retained local execution evidence."],
    sources: [{ id: "owned-provider-scope", path: providerPath }] }, readBytes);
  const effects: Effect[] = [];
  const lookedUp = new Set<string>();
  let inventoryReads = 0;
  let stored: Handoff | null = null;
  let stagedText: string | null = null;
  const remember = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };

  async function evidence() {
    const rows = await readInventory();
    const survey = await readSurvey();
    const retained = await Promise.all([...witnessPaths.values()].map(path => read<Witness>(path)));
    const refs = [requirement.requestedRef, ...(requirement.alternativesAllowed ? names.filter(ref => ref !== requirement.requestedRef) : [])];
    const scores = refs.map(ref => inspectCandidate(ref, survey, rows, retained));
    // Preserve the request's first choice when results have equal assurance.
    const selected = scores.reduce((best, candidate) => stateRank.indexOf(best.fact.disposition) <=
      stateRank.indexOf(candidate.fact.disposition) ? best : candidate);
    return { survey, rows, retained, selected,
      expectedWitnesses: new Set(scores.flatMap(score => score.candidates.map(candidate => candidate.id))) };
  }

  const packet = (actual: Awaited<ReturnType<typeof evidence>>, reason: string) => JSON.stringify({
    schema: "vibestudio.local-width-handoff/1", scope: actual.survey.scope, need: actual.survey.requirement,
    finding: actual.selected.fact, reason,
    witness: actual.retained.find(row => row.id === actual.selected.fact.witness) ?? null,
  }, null, 2) + "\n";

  const services = {
    localModels: {
      async listModels() {
        inventoryReads++;
        const rows = await readInventory();
        return remember("localModels", "listModels", [], rows.map(({ slug, displayName, state, fit, download, errorMessage }) =>
          ({ slug, displayName, state, fit: { fit: fit.fit, estTokensPerSec: fit.estTokensPerSec },
            download: download ? { progress: download.progress, phase: download.phase } : null, errorMessage })));
      },
    },
    localWidthEvidence: {
      async discover() {
        return remember("localWidthEvidence", "discover", [], await readSurvey());
      },
      async readWitness(id: string) {
        const path = witnessPaths.get(id);
        if (!path) throw new Error("Discover and read only the assigned retained witness");
        lookedUp.add(id);
        return remember("localWidthEvidence", "readWitness", [id], await read<Witness>(path));
      },
    },
    localWidthHandoff: {
      async stage(finding: Finding) {
        const current = await evidence();
        const post = await vcs.status();
        const authorized = current.survey.release === "include-hold" ||
          (current.survey.release === "verified" && current.selected.fact.disposition === "verified");
        const { fact } = current.selected;
        if (!inventoryReads || stored || !authorized || !isDeepStrictEqual(before.workingHead, post.workingHead) ||
            !isDeepStrictEqual(factOnly(finding), fact) || (fact.witness && !lookedUp.has(fact.witness)) ||
            typeof finding.reason !== "string" || !finding.reason.trim())
          return remember("localWidthHandoff", "stage", [finding], null);
        const text = packet(current, finding.reason);
        const saved = await scratch.scratchHandoffWrite.stage(text);
        if(saved)stagedText=text;
        if (saved) stored = { ...saved, sha256: sha256HexSyncText(text) };
        return remember("localWidthHandoff", "stage", [finding], stored);
      },
    },
  };

  function matchesReadiness(actual: Readiness | undefined, rows: LocalModelEntry[]) {
    const expectedPreferred = names.find(ref => rows.some(row => local(row.slug) === ref && inventoried(row))) ?? null;
    const executor = rows.find(row => local(row.slug) === names[1]);
    const usable = executor ? inventoried(executor) : false;
    return actual?.preferred === expectedPreferred && actual.executor?.ref === names[1] &&
      actual.executor.state === (executor?.state ?? "absent") && actual.executor.usable === usable &&
      Boolean(actual.executor.detail?.trim()) && Array.isArray(actual.advice) &&
      actual.advice.every(line => typeof line === "string" && Boolean(line.trim())) &&
      actual.models?.length === rows.length && rows.every((row, index) => {
        const checked = actual.models[index];
        return checked?.ref === local(row.slug) && checked.state === row.state && checked.usable === inventoried(row) &&
          checked.failure === (row.state === "error" ? "engine" : undefined) && Boolean(checked.detail?.trim());
      });
  }

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["exactEvidenceDisposition"],"rootPath":["finding"],"producerSourceSuffix":"reviewLocalExecutionWidth/assessExecution.nl","producerPath":[]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=value;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,value,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations) {
    const report = value as Outcome | null;
    const outcome = report;
    const actual = await evidence();
    const { fact } = actual.selected;
    const post = await vcs.status();
    const afterOutputs = await outputs();
    const added = afterOutputs.filter(name => !baselineOutputs.includes(name));
    const filesIntact = await Promise.all([...files].map(async ([path, text]) =>
      decoder.decode(await readBytes(path, 32 * 1024)) === text));
    const stageCount = effects.filter(effect => effect.service === "localWidthHandoff" && effect.method === "stage" && effect.result !== null).length;
    const shouldStage = world.release === "include-hold" || (world.release === "verified" && world.expected === "verified");
    let handoffText:string|null=null;
    let handoff = !shouldStage && stored === null && !added.length && !stageCount;
    if (shouldStage && stored && added.length === 1 && stageCount === 1) {
      const bytes = await readBytes(stored.path, stored.bytes);
      const body = decoder.decode(bytes);
      handoffText=body;
      handoff = stored.path === "/.tmp/" + added[0] + "/handoff.json" && body === stagedText &&
        bytes.length === stored.bytes && sha256HexSyncText(body) === stored.sha256;
    }
    const checks = {
      retainedExactMachineScope: filesIntact.every(Boolean),
      appliedInstalledReadiness: inventoryReads >= 1&&effects.some(effect=>effect.service==="localModels"&&matchesReadiness(effect.result,actual.rows)),
      boundActualProviderAndWidth: isDeepStrictEqual(lookedUp, actual.expectedWitnesses),
      exactEvidenceDisposition: isDeepStrictEqual(outcome?.handoff,stored)&&Boolean(outcome?.finding&&isDeepStrictEqual(factOnly(outcome.finding),fact))&&outcome?.finding?.disposition === world.expected && Boolean(outcome.finding.reason?.trim()),
      verifiedExactLocalHandoff: handoff &&
        baselineOutputs.every(name => afterOutputs.includes(name)),
      preservedWorkspaceState: before.mainEventId === post.mainEventId && isDeepStrictEqual(before.workingHead, post.workingHead),
    };
    return {
      outcomeContract:{
        effects:{checks:["retainedExactMachineScope", "appliedInstalledReadiness", "boundActualProviderAndWidth", "verifiedExactLocalHandoff", "preservedWorkspaceState"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["exactEvidenceDisposition"],required:!shouldStage,rationale:"The requested analysis is application data; a redundant result copy is optional once the requested native artifact or operation exists."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}},
      incorrectReturnValues:[],
 caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      effects, survey: actual.survey, finding: fact, handoff: stored, handoffText };
  }

  async function qualify() {
    const survey = await services.localWidthEvidence.discover();
    const inventory = await services.localModels.listModels();
    const models = inventory.map(row => ({ ref: local(row.slug), state: row.state,
      usable: row.state === "ready" || row.state === "startable", detail: row.state,
      ...(row.state === "error" ? { failure: "engine" } : {}) }));
    const usableExecutor = models.find(item => item.ref === names[1]);
    const readiness: Readiness = { models,
      executor: { ref: names[1]!, state: usableExecutor?.state ?? "absent", usable: usableExecutor?.usable ?? false, detail: "Retained inventory" },
      preferred: names.find(ref => models.some(item => item.ref === ref && item.usable)) ?? null,
      advice: usableExecutor?.usable ? [] : ["Hosted low-tier executor is billed when the local executor is unavailable."],
    };
    const { selected, expectedWitnesses } = await evidence();
    for (const id of expectedWitnesses) await services.localWidthEvidence.readWitness(id);
    const finding = { ...selected.fact, reason: "Compare exact current selectable model and verified execution evidence." };
    const handoff = world.release === "include-hold" || (world.release === "verified" && finding.disposition === "verified")
      ? await services.localWidthHandoff.stage(finding) : null;
    const result = {finding,handoff};
    const proof = await verify(result);
    const rejectedInventedApplicationValue = !(await verify({...result,finding:{...finding,disposition:"invented"}})).outcomeDimensions.returnedValue.passed;
    const checks = {...proof.checks,rejectedInventedApplicationValue};
    return assessNativeQualification({...proof,checks,passed:Object.values(checks).every(Boolean),result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedInventedApplicationValue"]}}});
  }

  return { services, verify, qualify };
}
