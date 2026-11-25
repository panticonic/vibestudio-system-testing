import {assessObservedApplicationOutcome} from "@workspace/application-outcomes/observed-application-outcome";
import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { RuntimeFs, VcsClient } from "@workspace/runtime";
import { bindEvalRecovery } from "@workspace-skills/eval-recovery-bindings";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type {
  EvalAttemptCard, EvalHandoffArtifact, EvalHandoffGoalReport, EvalRecoveryResult, EvalJobCard, EvalTrial, OpenEvalObservation, OpenEvalReview,
} from "@workspace-skills/open-eval-handoff/types";
import { wroteOutput, type openEvalHandoffNative, type EvalRetryGate, type OwnedEvalRun } from "./open-goal-eval-handoff-native.js";
import type { EvalHandoffWorld, EvalSeed } from "./open-goal-eval-handoff-worlds.js";

type Ports = {
  contextId: string;
  fs: RuntimeFs;
  vcs: Pick<VcsClient, "status">;
  native: ReturnType<typeof openEvalHandoffNative>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
type Binding = ReturnType<typeof bindEvalRecovery>;
type AttemptEvidence = Awaited<ReturnType<Binding["services"]["evalRecoveryJournal"]["observe"]>>;
type Readback = Awaited<ReturnType<Binding["services"]["evalRecoveryReadback"]["read"]>>;
type Retained = { seed: EvalSeed; native: OwnedEvalRun; card: EvalAttemptCard; bound: Binding };
const encoder = new TextEncoder();

function measureEffect(attempt: AttemptEvidence, readback: Readback | null) {
  const mismatch = attempt.stores.length > 1 || attempt.stores.some(store =>
    store.digest !== attempt.expectedDigest || store.contentDigest !== attempt.expectedDigest || store.size !== attempt.expectedSize);
  const journal = mismatch ? "mismatch" : attempt.journal !== "complete" ? "incomplete" : attempt.stores.length ? "matched" : "absent";
  const effect = !readback ? "unchecked" : readback.observedDigest === null ? "missing" :
    readback.digest === attempt.expectedDigest && readback.observedDigest === attempt.expectedDigest &&
      readback.size === attempt.expectedSize ? "confirmed" : "different";
  const next = journal === "mismatch" || effect === "missing" || effect === "different" ? "inspect-integrity" :
    journal === "incomplete" ? "recover-journal" : journal === "absent" ? "inspect-original-attempt" :
      effect === "confirmed" ? "continue-with-effect" : "confirm-effect";
  return { journal, effect, next } as const;
}

export async function prepareOpenEvalHandoff(input: { contextId: string; caseId: string }, world: EvalHandoffWorld, ports: Ports) {
  if (ports.contextId !== input.contextId || world.id !== input.caseId) throw new Error("Eval recovery needs its owned workspace context");
  const { fs, vcs, native } = ports;
  const before = await vcs.status();
  const directory = await fs.mkdtemp("eval-handoff-notes");
  const jobId = crypto.randomUUID();
  const metadataPath = `${directory}/job.json`;
  const records = new Map<string, Retained>();
  const trials = new Map<string, OpenEvalObservation>();
  const operations = new Map<string, Retained>();
  const journalReads = new Map<string, AttemptEvidence>();
  const blobReads = new Map<string, Readback>();
  const originalOrder: string[] = [];
  let observedCatalog: EvalJobCard[] | null = null;
  let admittedRetry: { originalRunId: string; newRunId: string; sourceDigest: string } | null = null;
  let retrying = false;
  let staging = false;
  let artifact: EvalHandoffArtifact | null = null;
  let written: string | null = null;

  async function capture(seed: EvalSeed) {
    const runId = `system-test-open-eval-handoff:${crypto.randomUUID()}`;
    const text = `${seed.text}\nOwned workspace ${input.contextId}.\n`;
    const gatePath = `${directory}/retry-prerequisite.txt`;
    const original = seed.role === "retry" ? [...records.values()].find(record => record.seed.role === "latest") : null;
    const retryGate: EvalRetryGate | undefined = original?.native?.request?.retryGate ??
      (world.allowRetry && seed.role === "latest" ? { path: gatePath, blocked: seed.mode === "cancelled-empty" ? "park" : "reject" } : undefined);
    if (retryGate && seed.role === "latest") await fs.writeFile(retryGate.path, "pending");
    const run = await native.run({ contextId: input.contextId, runId, text, mode: seed.mode, ...(retryGate ? { retryGate } : {}) });
    if (retryGate && seed.role === "latest") await fs.writeFile(retryGate.path, "ready");
    const card: EvalAttemptCard = { runId, role: seed.role, label: seed.label, authority: seed.authority };
    const bound = bindEvalRecovery({ goal: world.goal, contextId: input.contextId, runId,
      result: { success: run.terminal === "returned", operationJournal: run.receipt?.result?.operationJournal }, expectedText: text,
      allowReadback: seed.allowReadback && seed.authority === "approved" && run.terminal !== "cancelled" });
    const record = { seed, native: run, card, bound };
    records.set(runId, record);
    return record;
  }
  const catalog: EvalJobCard[] = [{ id: jobId, title: world.title, summary: world.summary,
    state: world.seeds.length ? "active" : "archived", attempts: [] },
    { id: crypto.randomUUID(), state: "archived", title: world.title, summary: "Archived sibling job.", attempts: [] }];
  try {
    for (const seed of world.seeds) catalog[0]!.attempts.push((await capture(seed)).card);
    await fs.writeFile(metadataPath, JSON.stringify(catalog));
  } catch (error) {
    try { await native.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Eval handoff seed and owned scope cleanup failed"); }
    throw error;
  }
  const scratch = bindScratchHandoff(fs, { goal: world.goal,
    questions: ["Which owned output was recovered?"], sources: [{ id: jobId, path: metadataPath }] }, ports.readBytes);

  function retryIsSafe(record: Retained) {
    if (!world.allowRetry || record.seed.role !== "latest" || record.seed.authority !== "approved" || record.native.physicallyStored) return false;
    if (record.native.terminal === "cancelled") return record.seed.mode === "cancelled-empty";
    const journal = record.native.receipt?.result?.operationJournal;
    return record.native.terminal === "failed" && !!journal && !journal.truncated && !journal.entries.some(entry =>
      entry["type"] === "blob-text.observation" && (entry["receipt"] as { method?: string } | undefined)?.method === "putText");
  }
  function opened(record: Retained): OpenEvalObservation {
    const observed = { jobId, attempt: record.card, terminal: record.native.terminal, runDigest: record.native.runDigest,
      resultDigest: record.native.receipt?.resultDigest ?? null, request: record.bound.request,
      exactRetryAuthorized: retryIsSafe(record) };
    trials.set(record.card.runId, observed);
    operations.set(observed.request.operationId, record);
    return structuredClone(observed);
  }

  const services = {
    openEvalCatalog: {
      async discover() {
        const visible = JSON.parse(String(await fs.readFile(metadataPath, "utf8"))) as EvalJobCard[];
        if (!isDeepStrictEqual(visible, catalog)) throw new Error("The owned eval catalog lost its identity");
        observedCatalog = visible;
        return structuredClone(visible);
      },
      async open(selectedJob: string, runId: string) {
        const job = observedCatalog?.find(card => card.id === selectedJob && card.state === "active");
        const record = records.get(runId);
        if (!job || !record || trials.has(runId) || !job.attempts.some(card => card.runId === runId) || !await native.retained(record.native)) return null;
        originalOrder.push(runId);
        return opened(record);
      },
    },
    evalRecoveryJournal: {
      async observe(operationId: string) {
        const record = operations.get(operationId);
        if (!record) throw new Error("Observe an issued bound original native attempt");
        const value = await record.bound.services.evalRecoveryJournal.observe(operationId);
        journalReads.set(value.runId, value);
        return structuredClone(value);
      },
    },
    evalRecoveryReadback: {
      async read(operationId: string, digest: string) {
        const record = operations.get(operationId);
        if (!record) throw new Error("Use the exact owned eval recovery readback");
        const value = await record.bound.services.evalRecoveryReadback.read(operationId, digest);
        blobReads.set(record.card.runId, value);
        return structuredClone(value);
      },
    },
    openEvalReentry: {
      async retry(selectedJob: string, runId: string) {
        const record = records.get(runId);
        if (selectedJob !== jobId || !record || !trials.get(runId)?.exactRetryAuthorized || !journalReads.has(runId) || admittedRetry || retrying || artifact)
          return null;
        retrying = true;
        try {
          if (!await native.retained(record.native) || await native.readText(sha256HexSyncText(record.native.request.text)) !== null) return null;
          const retried = await capture({ ...record.seed, role: "retry", label: `Authorized retry of ${record.seed.label}`, mode: "returned-store" });
          if (retried.native.request.text !== record.native.request.text || retried.native.runDigest === record.native.runDigest ||
              !isDeepStrictEqual(retried.native.admission.source, record.native.admission.source) || retried.native.admission.source.kind !== "inline")
            throw new Error("Retry must reuse the exact source and input in a distinct owned admission");
          admittedRetry = { originalRunId: runId, newRunId: retried.card.runId, sourceDigest: sha256HexSyncText(retried.native.admission.source.code) };
          return opened(retried);
        } finally {
          retrying = false;
        }
      },
    },
    openEvalHandoff: {
      async stage(selectedJob: string, runId: string) {
        const record = records.get(runId);
        const readback = blobReads.get(runId);
        const attempt = journalReads.get(runId);
        if (selectedJob !== jobId || !world.allowHandoff || !record || !readback || !attempt || !record.native.receipt ||
            record.native.terminal === "cancelled" || record.seed.authority !== "approved" ||
            measureEffect(attempt, readback).effect !== "confirmed" || artifact || staging || retrying) return null;
        staging = true;
        try {
          if (!await native.retained(record.native)) return null;
          const text = await native.readText(readback.digest);
          if (text !== record.native.request.text) return null;
          written = JSON.stringify({ schema: "vibestudio.eval-recovery-handoff/1", contextId: input.contextId, jobId,
            runId, runDigest: record.native.runDigest, resultDigest: record.native.receipt.resultDigest,
            output: { digest: readback.digest, bytes: encoder.encode(text).length, text } }, null, 2) + "\n";
          const receipt = await scratch.scratchHandoffWrite.stage(written);
          if (!receipt) return null;
          artifact = { ...receipt, runId, sha256: sha256HexSyncText(written) };
          return structuredClone(artifact);
        } finally {
          staging = false;
        }
      },
    },
  };

  async function verifyOutcome(outcome: EvalRecoveryResult | null, negative: boolean,nativeOnly=false,invocation?:InvocationObservations) {
    const reported = outcome?.status === "reviewed" ? outcome : null;
    const expected = world.expected;
    const admitted = [...records.values()];
    const post = await vcs.status();
    const ownedCases = [...trials.values()];
    const currentText = async (record: Retained) => native.readText(sha256HexSyncText(record.native.request.text));
    const originals = await Promise.all(admitted.map(async record => {
      const { native: original, seed } = record;
      return await native.retained(original) && original.physicallyStored === wroteOutput(seed.mode) &&
        original.terminal === (seed.mode.startsWith("cancelled-") ? "cancelled" : seed.mode.startsWith("failed-") ? "failed" : "returned");
    }));
    const replayed = await Promise.all(admitted.map(record => native.replay(record.native)));
    const observedMatches = ownedCases.length === expected.observations.length && ownedCases.every((observation, index) => {
      const target = expected.observations[index]!;
      const attempt = journalReads.get(observation.attempt.runId);
      const readback = blobReads.get(observation.attempt.runId) ?? null;
      if (!attempt) return false;
      const actual = measureEffect(attempt, readback);
      const settled = target.journal === "cancelled-native" ? observation.terminal === "cancelled" && readback === null : actual.journal === target.journal;
      return settled && observation.attempt.role === target.role && actual.effect === target.effect;
    });
    const perReviewChecks=ownedCases.map((observation,index)=>{
      const attempt=journalReads.get(observation.attempt.runId),readback=blobReads.get(observation.attempt.runId)??null,candidate=reported?.reviews[index];
      if(!attempt||!candidate)return false;
      const actual=measureEffect(attempt,readback);
      return candidate.runId===attempt.runId&&candidate.cell===attempt.cell&&candidate.journal===actual.journal&&candidate.effect===actual.effect&&candidate.next===actual.next&&isDeepStrictEqual(candidate.readback,readback)&&Boolean(candidate.reason?.trim());
    });
    const expectedRun = admitted.find(record => record.seed.role === expected.use);
    const expectedDecision = expectedRun ? { action: "use", runId: expectedRun.card.runId } : { action: "hold", reason: expected.hold };
    const retried = admitted.find(record => record.seed.role === "retry");
    const latest = admitted.find(record => record.seed.role === "latest");
    const checks:Record<string,boolean> = {
      discoveredOwnedEvalJobs: isDeepStrictEqual(observedCatalog, catalog),
      keptOriginalEvalReceipts: originals.every(Boolean) && originalOrder.length === expected.observations.filter(item => item.role !== "retry").length &&
        journalReads.size === expected.observations.length && new Set(admitted.map(record => record.native.runDigest)).size === admitted.length,
      boundIndependentBlobReadback: observedMatches && blobReads.size === expected.observations.filter(item => item.effect === "confirmed").length,
      replayedSameNativeIdentity: replayed.every(Boolean) && negative,
      authorizedExactEvalRetry: expected.use === "retry" ? !!admittedRetry && !!retried && !!latest &&
        admittedRetry.originalRunId === latest.card.runId && admittedRetry.newRunId === retried.card.runId &&
        latest.native.request.text === retried.native.request.text && !latest.native.physicallyStored &&
        isDeepStrictEqual(latest.native.admission.source, retried.native.admission.source) && await currentText(retried) === retried.native.request.text :
        admittedRetry === null && !retried,
      verifiedRetainedEvalScratch: false,
      protectedOwnedEvalContext: post.mainEventId === before.mainEventId && isDeepStrictEqual(post.workingHead, before.workingHead) &&
        String(await fs.readFile(metadataPath, "utf8")) === JSON.stringify(catalog),
    };
    const staged = artifact;
    if (expected.stage && staged && written && expectedRun) {
      const bytes = await ports.readBytes(staged.path, staged.bytes);
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const saved = JSON.parse(body) as { runId: string; runDigest: string; resultDigest: string; output: { text: string } };
      checks.verifiedRetainedEvalScratch = body === written && bytes.length === staged.bytes && staged.sha256 === sha256HexSyncText(body) &&
        saved.runId === expectedRun.card.runId && saved.runDigest === expectedRun.native.runDigest &&
        saved.resultDigest === expectedRun.native.receipt?.resultDigest && saved.output.text === expectedRun.native.request.text;
    } else if (!expected.stage) {
      checks.verifiedRetainedEvalScratch = staged === null;
    }
    if(!nativeOnly){
      const selected=expectedRun?ownedCases.find(observation=>observation.attempt.runId===expectedRun.card.runId):null;
      const readback=selected?blobReads.get(selected.attempt.runId):null;
      const expectedResult=selected&&readback&&selected.resultDigest?{jobId:selected.jobId,runId:selected.attempt.runId,runDigest:selected.runDigest,resultDigest:selected.resultDigest,readback}:null;
      checks.returnedEvalReviews=expected.active ? Array.isArray(reported?.reviews) && reported.reviews.length===ownedCases.length : reported===null && ownedCases.length===0;
      for(const [index,passed] of perReviewChecks.entries())checks[`returnedEvalReview${index}`]=passed;
      checks.reconciledEvalHandoff=expected.active ? reported?.jobId===jobId&&reported.reviews.length===expected.observations.length&&isDeepStrictEqual(reported.decision,expectedDecision) : outcome?.status==="unresolved"&&outcome.reason==="job-unavailable"&&trials.size===0;
      checks.returnedEvalResult=isDeepStrictEqual(reported?.result??null,expectedResult);
      checks.returnedEvalArtifact=isDeepStrictEqual(reported?.artifact??null,artifact);
    }
    const contract:SemanticOutcomeContract={effects:{checks:["discoveredOwnedEvalJobs", "keptOriginalEvalReceipts", "boundIndependentBlobReadback", "replayedSameNativeIdentity", "authorizedExactEvalRetry", "verifiedRetainedEvalScratch", "protectedOwnedEvalContext"],rationale:"Independent native observations, exact authority and persisted state establish application effects."},returnedValue:{checks:nativeOnly?[]:["returnedEvalReviews", "reconciledEvalHandoff", "returnedEvalResult", ...perReviewChecks.map((_,index)=>`returnedEvalReview${index}`)],required:!nativeOnly,rationale:"Requested findings and verified result handles are required for query goals; completed mutation effects stand independently."},incidentalValues:{checks:nativeOnly?[]:["returnedEvalArtifact"],rationale:"Returned receipt presentation is optional; actual artifacts and receipts are verified from native state."}};
    return assessObservedApplicationOutcome({ caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      attempts: ownedCases, originalRuns: admitted.map(record => ({ card: record.card, terminal: record.native.terminal, runDigest: record.native.runDigest,
        resultDigest: record.native.receipt?.resultDigest ?? null,
        sourceDigest: record.native.admission.source.kind === "inline" ? sha256HexSyncText(record.native.admission.source.code) : null,
        physicallyStored: record.native.physicallyStored })),
      journals: [...journalReads], readbacks: [...blobReads], retry: admittedRetry, artifact: staged, artifactText: staged ? written : null },contract,outcome,invocation,[...perReviewChecks.map((_,index)=>({checks:[`returnedEvalReview${index}`],rootPath:["reviews",index],producerSourceSuffix:"workOnEvalHandoffGoal/reviewer/reviewEvalRecovery.nl",producerPath:[]})),{checks:["reconciledEvalHandoff"],rootPath:["decision"],producerSourceSuffix:"workOnEvalHandoffGoal/decideEvalHandoff.nl",producerPath:[]}]);
  }

  async function refuseForeign() {
    const unmatched = `unobserved-${crypto.randomUUID()}`;
    return await services.openEvalCatalog.open(jobId, unmatched) === null && await services.openEvalReentry.retry(jobId, unmatched) === null &&
      await services.openEvalHandoff.stage(jobId, unmatched) === null;
  }

  async function qualify() {
    await services.openEvalCatalog.discover();
    let negative = await refuseForeign();
    if (!world.expected.active) return verifyOutcome({ status: "unresolved", reason: "job-unavailable" }, negative);
    const observed: EvalTrial[] = [];
    for (const expected of world.expected.observations) {
      const seeded = [...records.values()].find(record => record.seed.role === expected.role);
      const observation = expected.role === "retry" ? await services.openEvalReentry.retry(jobId, originalOrder[0]!) :
        seeded ? await services.openEvalCatalog.open(jobId, seeded.card.runId) : null;
      if (!observation) throw new Error("The reference path could not observe its owned native attempt");
      const id = observation.request.operationId;
      const attempt = await services.evalRecoveryJournal.observe(id);
      const journal = measureEffect(attempt, null).journal;
      const readback = journal === "matched" && attempt.allowReadback ? await services.evalRecoveryReadback.read(id, attempt.expectedDigest) : null;
      const rejected = await services.evalRecoveryReadback.read(id, "f".repeat(64)).then(() => false, () => true);
      negative &&= rejected;
      const review: OpenEvalReview = { runId: attempt.runId, cell: attempt.cell, ...measureEffect(attempt, readback), readback,
        reason: "Resolve the exact native journal and scoped readback before using output." };
      observed.push({ observation, review });
    }
    const chosen = observed.find(({ observation }) => observation.attempt.role === world.expected.use);
    const decision = chosen ? { action: "use" as const, runId: chosen.observation.attempt.runId } :
      { action: "hold" as const, reason: world.expected.hold! };
    const staged = world.expected.stage && chosen ? await services.openEvalHandoff.stage(jobId, chosen.observation.attempt.runId) : null;
    const readback=chosen?.review?.readback;
    const output=chosen&&readback&&readback.observedDigest!==null&&readback.size!==null&&chosen.observation.resultDigest ? {jobId,runId:chosen.observation.attempt.runId,runDigest:chosen.observation.runDigest,resultDigest:chosen.observation.resultDigest,readback:{digest:readback.digest,observedDigest:readback.observedDigest,size:readback.size}}:null;
    return verifyOutcome({ status: "reviewed", jobId, reviews:observed.map(trial=>trial.review),decision,result:output, artifact: staged }, negative);
  }
  return { services, qualify, close: native.close,
    async verifyObserved(){return verifyOutcome(null,await refuseForeign(),true);},
    async verify(report: unknown,invocation?:InvocationObservations) {
      const value = report as EvalRecoveryResult | null;
      return verifyOutcome(value ?? null, await refuseForeign(),false,invocation);
    } };
}

export { openEvalHandoffNative } from "./open-goal-eval-handoff-native.js";
