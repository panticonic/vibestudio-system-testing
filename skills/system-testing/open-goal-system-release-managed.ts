import {systemReleaseHandoffProtocol} from "./system-release-handoff-protocol.js";
import {systemReleaseGoalContract} from "./open-goal-review-contracts.js";
import {maxScratchArtifactBytes as maximumArtifact} from "@workspace-skills/scratch-handoff-bindings";
import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["assignment", "runs", "cases", "effects", "handoffProtocol"], ["handoff", "handoffText"]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { buildProvenanceSchema } from "@vibestudio/service-schemas/build";
import { systemTestRunnerRpcMethods, systemTestRunSummarySchema } from "@vibestudio/service-schemas/systemTestRunner";
import { contextId, fs, rpc } from "@workspace/runtime";
import { isUnexpectedToolFailure } from "./tool-failure-classification.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { SystemTestRunRecord } from "./cli.js";
import type { TestSuiteResultEntry } from "./types.js";
import type { SeededRelease } from "./open-goal-system-release-records.js";
import type { SystemReleaseWorld } from "./open-goal-system-release-worlds.js";

type RunEvidence = {
  id: string; context: "same" | "other" | "unavailable"; status: "running" | "completed" | "cancelled" | "errored" | "missing";
  terminalSaved: boolean; buildKey: string | null; effectiveVersion: string | null; declared: string[]; unavailable: string[]; total: number;
};
type RunPair = { current: RunEvidence; earlier: RunEvidence };
type Choice = { runId: string | null; blocker: "hold-context" | "hold-build" | "hold-active" | "hold-cancelled" | "hold-missing-run" | null };
type Case = {
  name: string; digest: string | null; rank: "retained" | "missing" | "not-installed"; passed: boolean | null; exactWitness: boolean;
  primary: { kind: "runtime" | "delivery" | "validator" | "assertion" | "unexpected-tool"; code: string; detail: string } | null;
  cleanup: string[]; expectedToolFailures: string[];
};
type Assessment = { disposition: SystemReleaseWorld["expected"]["outcome"]; reason: string; decisive: string[] };
type Receipt = { path: string; bytes: number; sha256: string };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Ports = {
  contextId: string;
  inspect(runId: string): Promise<unknown>;
  read(runId: string, testName: string, offset: number, limit: number): Promise<{ length: number; encoding: string; chunk: string }>;
  artifact: {
    directory(): Promise<string>;
    write(path: string, text: string): Promise<void>;
    read(path: string, limit: number): Promise<Uint8Array>;
    entries(path: string): Promise<string[]>;
  };
};
const pageSize = 4096;
const maximumTrajectory = 65536;
const hash = sha256HexSyncText;
const decode = new TextDecoder("utf-8", { fatal: true });

function livePorts(target: string): Ports {
  return {
    contextId,
    inspect: runId => rpc.call(target, systemTestRunnerRpcMethods.inspectSystemTestRun, [runId]),
    read: (runId, name, offset, limit) => rpc.call(target, systemTestRunnerRpcMethods.readSystemTestTrajectoryPage, [runId, name, true, offset, limit]),
    artifact: {
      directory: () => fs.mkdtemp("system-release-evidence"),
      write: async (path, text) => { await fs.writeFile(path, text); },
      read: (path, limit) => readWorkspaceBytes(rpc, path, limit),
      entries: path => fs.readdir(path),
    },
  };
}

export async function prepareSystemRelease(input: { contextId: string; caseId: string }, world: SystemReleaseWorld,
    seed: SeededRelease, target: string, ports = livePorts(target)) {
  if (input.contextId !== ports.contextId || seed.contextId !== ports.contextId || input.caseId !== world.id || seed.caseId !== world.id)
    throw new Error("System release review is outside its owned assignment");
  const { contextId: owner, artifact } = ports;
  const assigned = { id: crypto.randomUUID(), goal: world.goal, subject: world.subject, contextId: owner,
    buildKey: seed.buildKey, effectiveVersion: seed.effectiveVersion, current: seed.current, earlier: seed.earlier,
    required: [...world.required], allowEarlier: world.allowEarlier, grant: world.grant };
  type Outcome = { assignment: typeof assigned; runs: RunPair; choice: Choice; cases: Case[];
    assessment: Assessment; handoff: Receipt | null };
  const directory = await artifact.directory();
  const outputPath = directory.replace(/\/$/u, "") + "/release-evidence.json";
  const effects: Effect[] = [];
  let issued = false;
  let compared: RunPair | null = null;
  let reviewedId: string | null = null;
  let receipt: Receipt | null = null;
  let pending = false;
  const reads: Case[] = [];
  const caseReads = new Map<string, Promise<Case>>();
  function capture<T>(service: string, method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }

  async function readRun(id: string): Promise<RunEvidence> {
    let value: SystemTestRunSummaryShape;
    try { value = await ports.inspect(id) as SystemTestRunSummaryShape; }
    catch (error) {
      if (!String(error).includes("No durable system-test record exists for " + id)) throw error;
      return { id, context: "unavailable", status: "missing", terminalSaved: false, buildKey: null,
        effectiveVersion: null, declared: [], unavailable: [], total: 0 };
    }
    const { config, provenance, startedAt: _started, updatedAt: _updated, completedAt, diagnostics: _diagnostics, ...body } = value;
    const summary = systemTestRunSummarySchema.parse(body);
    if (summary.runId !== id || typeof config.contextId !== "string" || !Array.isArray(config.names))
      throw new Error("Retained System test header has a mismatched identity");
    const build = buildProvenanceSchema.safeParse(provenance.systemTestingBuild);
    const buildProof = build.success && build.data.found && build.data.source === "@workspace-skills/system-testing" ? build.data : null;
    const context = config.contextId === owner ? "same" : "other";
    return { id, context, status: summary.status, terminalSaved: typeof completedAt === "string",
      buildKey: buildProof?.buildKeys?.production ?? null, effectiveVersion: buildProof?.effectiveVersion ?? null,
      declared: context === "same" ? config.names : [], unavailable: context === "same" ? summary.notInstalled.map(row => row.name) : [],
      total: context === "same" ? summary.total : 0 };
  }
  type SystemTestRunSummaryShape = SystemTestRunRecord["summary"] &
    Pick<SystemTestRunRecord, "config" | "provenance" | "startedAt" | "updatedAt" | "completedAt"> & { diagnostics: unknown };

  const exact = (run: RunEvidence) => run.context === "same" && run.buildKey === assigned.buildKey && run.effectiveVersion === assigned.effectiveVersion;
  function choose(runs: RunPair): Choice {
    const { current, earlier } = runs;
    const hold = (blocker: Choice["blocker"]) => ({ runId: null, blocker });
    const use = (runId: string) => ({ runId, blocker: null });
    if (current.context === "other") return hold("hold-context");
    if (current.status !== "missing" && !exact(current)) return hold("hold-build");
    if (current.status === "cancelled") return hold("hold-cancelled");
    if (current.terminalSaved && (current.status === "completed" || current.status === "errored")) return use(current.id);
    if ((current.status === "missing" || current.status === "running") && assigned.allowEarlier && exact(earlier) && earlier.terminalSaved && earlier.status === "completed" &&
        assigned.required.every(name => earlier.declared.includes(name) && !earlier.unavailable.includes(name)))
      return use(earlier.id);
    return hold(current.status === "missing" ? "hold-missing-run" : "hold-active");
  }
  function assess(cases: Case[]): Pick<Assessment, "disposition" | "decisive"> {
    const gaps = cases.filter(item => item.rank !== "retained" || item.passed && !item.exactWitness);
    if (gaps.length) return { disposition: "hold-evidence", decisive: gaps.map(item => item.name) };
    const faults = cases.filter(item => item.primary || item.cleanup.length);
    if (faults.length) {
      const allowed = assigned.grant === "both" || assigned.grant === "diagnose-only";
      return { disposition: allowed ? "stage-diagnostics" : faults.some(item => item.primary) ? "hold-failure" : "hold-cleanup",
        decisive: faults.map(item => item.name) };
    }
    return { disposition: assigned.grant === "both" || assigned.grant === "accept-only" ? "stage-acceptance" : "report-only",
      decisive: cases.map(item => item.name) };
  }

  async function readCase(run: RunEvidence, name: string): Promise<Case> {
    const unavailable = (rank: "missing" | "not-installed"): Case => ({ name, digest: null, rank, passed: null,
      exactWitness: false, primary: null, cleanup: [], expectedToolFailures: [] });
    if (run.unavailable.includes(name)) return unavailable("not-installed");
    if (!run.declared.includes(name)) return unavailable("missing");
    let text = "", total: number | undefined;
    try {
      do {
        const page = await ports.read(run.id, name, text.length, pageSize);
        total ??= page.length;
        if (page.length !== total || !Number.isSafeInteger(total) || total < 1 || total > maximumTrajectory ||
            page.encoding !== "plain-string" || !page.chunk.length || page.chunk.length > pageSize ||
            text.length + page.chunk.length > total)
          throw new Error("Incomplete or unstable retained System test trajectory page");
        text += page.chunk;
      } while (text.length < total);
    } catch (error) {
      if (text.length || !String(error).includes("Run " + run.id + " has no test named " + name)) throw error;
      return unavailable("missing");
    }
    const value = JSON.parse(text) as TestSuiteResultEntry;
    if (value.test?.name !== name || value.execution?.provenance?.contextId !== owner ||
        typeof value.result?.passed !== "boolean")
      throw new Error("Retained case is outside the exact release context or test");
    const witness = value.result.details?.releaseWitness as {
      runId?: string; contextId?: string; buildKey?: string; test?: string; operationId?: string; terminal?: string;
    } | undefined;
    const exactWitness = witness?.runId === run.id && witness.contextId === owner && witness.buildKey === assigned.buildKey &&
      witness.test === name && typeof witness.operationId === "string" && witness.operationId.trim().length > 0 &&
      witness.terminal === "acknowledged";
    const unexpected = (value.execution.toolFailures ?? []).find(isUnexpectedToolFailure);
    const delivery = value.execution.diagnostics?.channelDeliveryLatency as { violations?: string[] } | undefined;
    const failure = value.execution.failure?.error;
    const reason = value.result.reason ?? "Required resulting state was not verified.";
    const primary: Case["primary"] = value.execution.validationFailure ?
      { kind: "validator", code: failure?.code ?? "VALIDATION_EXCEPTION", detail: failure?.message ?? reason } :
      failure || value.execution.error ?
        { kind: "runtime", code: failure?.code ?? "RUNTIME_FAILURE", detail: failure?.message ?? value.execution.error! } :
      delivery?.violations?.length ?
        { kind: "delivery", code: "DELIVERY_LATENCY", detail: delivery.violations[0] } :
      unexpected ?
        { kind: "unexpected-tool", code: unexpected.failureCode ?? "UNEXPECTED_TOOL_FAILURE", detail: unexpected.error ?? unexpected.name } :
      !value.result.passed ? { kind: "assertion", code: "OUTCOME_MISMATCH", detail: reason } : null;
    return { name, digest: hash(text), rank: "retained", passed: value.result.passed, exactWitness,
      primary, cleanup: (value.execution.cleanupErrors ?? []).map(text => String(text).slice(0, 320)),
      expectedToolFailures: (value.execution.toolFailures ?? []).filter(item => !isUnexpectedToolFailure(item)).map(item => item.failureCode ?? item.name) };
  }

  function dossier(disposition: Assessment["disposition"], runId: string, cases: Case[]) {
    return JSON.stringify({
      protocol: "vibestudio-local-system-release-review.v1", contextId: assigned.contextId, subject: assigned.subject,
      buildKey: assigned.buildKey, effectiveVersion: assigned.effectiveVersion, runId, disposition, cases,
    }, null, 2) + "\n";
  }
  const services = {
    systemReleaseEvidence: {
      async discover() {
        if (issued) return structuredClone(assigned);
        issued = true;
        return capture("systemReleaseEvidence", "discover", [], assigned);
      },
      async compare(id: string) {
        if (!issued || pending || id !== assigned.id) throw new Error("Compare only the two assigned checkpoint headers");
        pending = true;
        try {
          const [current, earlier] = await Promise.all([readRun(assigned.current), readRun(assigned.earlier)]);
          compared = { current, earlier };
          return capture("systemReleaseEvidence", "compare", [id], compared);
        } finally { pending = false; }
      },
      async inspectCase(id: string, runId: string | null, name: string) {
        if (!compared || !runId || pending || id !== assigned.id || runId !== choose(compared).runId ||
            (reviewedId !== null && reviewedId !== runId) || !assigned.required.includes(name))
          throw new Error("Read a required case from the exact selected System run");
        const key = JSON.stringify([runId, name]);
        const existing = caseReads.get(key);
        if (existing) return structuredClone(await existing);
        const run = runId === compared.current.id ? compared.current : compared.earlier;
        const request = (async () => {
          const proof = await readCase(run, name);
          reviewedId = runId;
          const prior = reads.findIndex(row => row.name === name);
          if (prior < 0) reads.push(proof);
          else reads[prior] = proof;
          reads.sort((a,b)=>assigned.required.indexOf(a.name)-assigned.required.indexOf(b.name));
          return capture("systemReleaseEvidence", "inspectCase", [id, runId, name], proof);
        })();
        caseReads.set(key, request);
        try { return await request; }
        finally { caseReads.delete(key); }
      },
    },
    systemReleaseHandoff: {
      async stage(id: string, runId: string | null, disposition: Assessment["disposition"], cases: Case[]) {
        if (!runId || runId !== reviewedId || pending || caseReads.size > 0 || receipt || id !== assigned.id ||
            reads.length !== assigned.required.length || !sameEvidenceMembers(cases, reads) ||
            !["stage-acceptance", "stage-diagnostics"].includes(disposition) || assess(reads).disposition !== disposition)
          throw new Error("Stage only the authorized handoff for the complete exact selected run evidence");
        pending = true;
        try {
          const [current, earlier] = await Promise.all([readRun(assigned.current), readRun(assigned.earlier)]);
          if (!isDeepStrictEqual(compared, { current, earlier }))
            throw new Error("Retained run coordinates changed before the local handoff");
          const canonical = dossier(disposition, runId, reads);
          if(new TextEncoder().encode(canonical).byteLength>maximumArtifact)return null;
          await artifact.write(outputPath, canonical);
          const stored = await artifact.read(outputPath, maximumArtifact);
          if (decode.decode(stored) !== canonical) throw new Error("Local release handoff did not retain exact bytes");
          receipt = { path: outputPath, bytes: stored.length, sha256: hash(canonical) };
          return capture("systemReleaseHandoff", "stage", [id, runId, disposition, cases], receipt);
        } finally { pending = false; }
      },
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedReleaseDisposition"],"rootPath":["assessment"],"producerSourceSuffix":"reviewSystemRelease/evaluateCases.nl","producerPath":["assessment"]}];
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
    const [current, earlier] = await Promise.all([readRun(assigned.current), readRun(assigned.earlier)]);
    const finalPair = { current, earlier };
    const selectedChoice = choose(finalPair);
    const selected = selectedChoice.runId === current.id ? current : selectedChoice.runId === earlier.id ? earlier : null;
    const nativeCases = selected ? await Promise.all(reads.map(row => readCase(selected, row.name))) : [];
    const entries = await artifact.entries(directory);
    const raw = entries.length === 1 && entries[0] === "release-evidence.json" ? await artifact.read(outputPath, maximumArtifact) : null;
    const stage = effects.find(row => row.service === "systemReleaseHandoff" && row.method === "stage");
    const retainedBytes = stage && selected ? dossier(stage.args[2] as Assessment["disposition"], selected.id, nativeCases) : null;
    const checks = {
      retainedNativeRunPair: compared === null || isDeepStrictEqual(compared, finalPair),
      matchedOwnedBuildAndAttempt: reviewedId === null || reviewedId === (selected?.id ?? null),
      exactRequiredCaseEvidence: sameEvidenceMembers(reads, nativeCases),
      matchedReleaseDisposition: typeof value === "string" && value.trim().length > 0,
      verifiedPrivateHandoff: retainedBytes ? raw !== null && decode.decode(raw) === retainedBytes && !!receipt &&
        receipt.path === outputPath && receipt.bytes === raw.length && receipt.sha256 === hash(retainedBytes) : entries.length === 0 && receipt === null,
      noSuiteRerunOrUnassignedCase: effects.every(item => item.service === "systemReleaseEvidence" && ["discover","compare","inspectCase"].includes(item.method) || item.service === "systemReleaseHandoff" && item.method === "stage"),
    };
    return {
      outcomeContract:systemReleaseGoalContract(world),
      incorrectReturnValues:[],
 actualResult:value, caseId: world.id, contextId: owner, goal: world.goal, assignment: assigned, runs: finalPair, choice: selectedChoice,
      cases: nativeCases, assessment: stage ? {disposition:stage.args[2]} : null, handoffProtocol:systemReleaseHandoffProtocol({contextId:owner,verifiedPrivateHandoff:checks.verifiedPrivateHandoff,receipt,text:raw?decode.decode(raw):null}), handoff: receipt, handoffText: raw ? decode.decode(raw) : null, effects: structuredClone(effects),
      checks, passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    await services.systemReleaseEvidence.discover();
    const runs = await services.systemReleaseEvidence.compare(assigned.id);
    const choice = choose(runs), cases = [];
    if (choice.runId)
      cases.push(...await Promise.all(assigned.required.map(name => services.systemReleaseEvidence.inspectCase(assigned.id, choice.runId, name))));
    const assessment = { ...(choice.blocker ? { disposition: choice.blocker, decisive: [] } : assess(cases)),
      reason: JSON.stringify({subject:assigned.subject,selectedRun:choice.runId,blocker:choice.blocker,current:runs.current,earlier:runs.earlier,cases}) };
    const handoff = ["stage-acceptance", "stage-diagnostics"].includes(assessment.disposition) ?
      await services.systemReleaseHandoff.stage(assigned.id, choice.runId, assessment.disposition, cases) : null;
    const result = JSON.stringify({assessment,handoff});
    const proof = await verify(result);
    let rejectedForeignNativeScope=false;
    try {await services.systemReleaseEvidence.inspectCase(assigned.id,"foreign-retained-run",assigned.required[0]!);} catch {rejectedForeignNativeScope=true;}
    const rejectedMissingRequestedAnswer = !world.requestedReturnRequired || !(await verify(undefined)).outcomeDimensions.returnedValue.passed;
    const referenceNativeHandoff = !["stage-acceptance","stage-diagnostics"].includes(world.expected.outcome) || handoff !== null;
    const referenceCaseCoverage = choice.runId === null || cases.length === assigned.required.length;
    const checks = {...proof.checks,rejectedForeignNativeScope,rejectedMissingRequestedAnswer,referenceNativeHandoff,referenceCaseCoverage};
    return assessNativeQualification({...proof,checks,passed:Object.values(checks).every(Boolean),result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedForeignNativeScope","rejectedMissingRequestedAnswer","referenceNativeHandoff","referenceCaseCoverage"]}}});
  }
  return { services, qualify, verify };
}
