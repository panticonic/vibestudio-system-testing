import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type {
  EvalHandoffGoalReport, EvalTrial, OpenEvalObservation, OpenEvalReview,
} from "@workspace-skills/open-eval-handoff/types";
import { prepareOpenEvalHandoff } from "./open-goal-eval-handoff-managed.js";
import type { CompoundRecoveryWorld, CompoundStatus } from "./open-goal-compound-recovery-worlds.js";

type Ports = Parameters<typeof prepareOpenEvalHandoff>[2];
type Position = { revision: number; recipient: string; disposition: CompoundRecoveryWorld["disposition"]; questions: string[] };
type Scratch = ReturnType<typeof bindScratchHandoff>;
type Receipt = NonNullable<Awaited<ReturnType<Scratch["scratchHandoffWrite"]["stage"]>>>;
type Readback = NonNullable<Awaited<ReturnType<Scratch["scratchHandoffRead"]["read"]>>>;
type HandoffResult = {
  status: Exclude<CompoundStatus, "held-policy" | "held-eval">;
  artifact: Receipt | null;
  missingSources: string[];
  unanswered: string[];
};
type Outcome = {
  status: CompoundStatus;
  handoff: HandoffResult | null;
  reason: string;
};
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Preparation = { directive: Position; request: Parameters<typeof bindScratchHandoff>[1] | null };
type Accepted = NonNullable<Preparation["request"]>;
type Evidence = { sourceId: string; firstLine: number; lastLine: number; text: string };
const decoder = new TextDecoder("utf-8", { fatal: true });
const scratchEntry = /^evidence-handoff-[a-f0-9]{32}$/u;

export async function prepareCompoundRecoveryHandoff(
  input: { contextId: string; caseId: string }, world: CompoundRecoveryWorld, ports: Ports,
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id || world.eval.allowHandoff)
    throw new Error("Compound recovery needs an owned workspace and scratch-only release");
  const { fs, vcs, native, readBytes } = ports;
  const vcsBefore = await vcs.status();
  const outputs = async () => (await listOwnedScratchEntries(fs)).filter(name => scratchEntry.test(name)).sort();
  const outputBefore = await outputs();
  const directory = await fs.mkdtemp("compound-handoff-input");
  const directivePath = directory + "/request.json";
  const policyPath = directory + "/operating-directive.txt";
  const recoveredPath = directory + "/recovered-output.txt";
  const initial: Position = {
    revision: 1, recipient: world.recipient, disposition: world.disposition,
    questions: world.questions.map(({ text }) => text),
  };
  await fs.writeFile(directivePath, JSON.stringify(initial));
  if (world.policyText !== null) await fs.writeFile(policyPath, world.policyText);
  const recovery = await prepareOpenEvalHandoff(input, world.eval, ports);

  const effects: Effect[] = [];
  const opened = new Map<string, OpenEvalObservation>();
  const inspected = new Set<string>();
  const readbacks = new Map<string, string>();
  const observedSources = new Map<string, Readback | null>();
  let rejectionBeforeDependency = false;
  let advanced = false;
  let cachedPosition: Position | null = null;
  let accepted: Accepted | null = null;
  let binding: Scratch | null = null;
  let usedDigest: string | null = null;
  let stored: Receipt | null = null;

  const effect = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };

  const readDirective = async (): Promise<Position> => JSON.parse(String(await fs.readFile(directivePath, "utf8")));
  const changedPosition = (): Position => world.change === "replace-recipient-before-write"
    ? { ...initial, revision: 2, recipient: "superseding local desk" }
    : { ...initial, revision: 2, disposition: "cancelled" };

  async function changeDirective() {
    if (advanced) return;
    advanced = true;
    await fs.writeFile(directivePath, JSON.stringify(changedPosition()));
  }

  function acceptObservation(observation: OpenEvalObservation | null) {
    if (observation) opened.set(observation.request.operationId, observation);
    return observation;
  }

  const evalServices = recovery.services;
  const services = {
    openEvalCatalog: {
      async discover() {
        return effect("openEvalCatalog", "discover", [], await evalServices.openEvalCatalog.discover());
      },
      async open(jobId: string, runId: string) {
        return effect("openEvalCatalog", "open", [jobId, runId], acceptObservation(await evalServices.openEvalCatalog.open(jobId, runId)));
      },
    },
    openEvalReentry: {
      async retry(jobId: string, runId: string) {
        return effect("openEvalReentry", "retry", [jobId, runId], acceptObservation(await evalServices.openEvalReentry.retry(jobId, runId)));
      },
    },
    openEvalHandoff: {
      async stage(jobId: string, runId: string) {
        // The recovery branch supplies evidence to the operating-note skill.
        return effect("openEvalHandoff", "stage", [jobId, runId], null);
      },
    },
    evalRecoveryJournal: {
      async observe(operationId: string) {
        const value = await evalServices.evalRecoveryJournal.observe(operationId);
        if (value.journal === "complete" && value.stores.length === 1 &&
            value.stores[0]?.digest === value.expectedDigest && value.stores[0]?.contentDigest === value.expectedDigest &&
            value.stores[0]?.size === value.expectedSize)
          inspected.add(operationId);
        return effect("evalRecoveryJournal", "observe", [operationId], value);
      },
    },
    evalRecoveryReadback: {
      async read(operationId: string, digest: string) {
        const value = await evalServices.evalRecoveryReadback.read(operationId, digest);
        if (value.digest === digest && value.observedDigest === digest && typeof value.size === "number")
          readbacks.set(operationId, digest);
        return effect("evalRecoveryReadback", "read", [operationId, digest], value);
      },
    },
    recoveryHandoffLink: {
      async discover() {
        cachedPosition = await readDirective();
        return effect("recoveryHandoffLink", "discover", [], cachedPosition);
      },
      async prepare(jobId: string, runId: string, runDigest: string, resultDigest: string, digest: string, directive: Position): Promise<Preparation> {
        const args = [jobId, runId, runDigest, resultDigest, digest, directive];
        const observed = [...opened.values()].find(item => item.attempt.runId === runId && item.jobId === jobId);
        const reject = (position: Position) => effect("recoveryHandoffLink", "prepare", args, { directive: position, request: null });
        const live = await readDirective();
        if (!observed || observed.runDigest !== runDigest || observed.resultDigest !== resultDigest ||
            observed.terminal === "cancelled" || observed.attempt.authority !== "approved" ||
            !inspected.has(observed.request.operationId) || readbacks.get(observed.request.operationId) !== digest) {
          rejectionBeforeDependency = true;
          return reject(live);
        }
        if (live.disposition !== "requested" || live.recipient !== world.requestedRecipient ||
            !isDeepStrictEqual(directive, cachedPosition) || !isDeepStrictEqual(directive, live) || accepted)
          return reject(live);
        if (world.change === "cancel-before-acquire") {
          await changeDirective();
          return reject(await readDirective());
        }
        const text = await native.readText(digest);
        if (text === null || sha256HexSyncText(text) !== digest) throw new Error("Recovered bytes ceased to match the independently verified digest");
        await fs.writeFile(recoveredPath, text);
        usedDigest = digest;
        accepted = {
          goal: world.goal, questions: live.questions,
          sources: [{ id: "recovered-result", path: recoveredPath }, { id: "operating-directive", path: policyPath }],
        };
        binding = bindScratchHandoff(fs, accepted, readBytes);
        return effect("recoveryHandoffLink", "prepare", args, { directive: live, request: accepted });
      },
    },
    scratchHandoffRead: {
      async read(id: string) {
        if (!binding || !accepted?.sources.some(source => source.id === id)) {
          rejectionBeforeDependency = true;
          return effect("scratchHandoffRead", "read", [id], null);
        }
        const source = await binding.scratchHandoffRead.read(id);
        observedSources.set(id, source);
        return effect("scratchHandoffRead", "read", [id], source);
      },
    },
    scratchHandoffWrite: {
      async stage(body: string) {
        if (!binding || !accepted?.sources.every(source => observedSources.get(source.id))) {
          rejectionBeforeDependency = true;
          return effect("scratchHandoffWrite", "stage", [body], null);
        }
        if (world.change === "cancel-before-write" || world.change === "replace-recipient-before-write") await changeDirective();
        const live = await readDirective();
        if (!isDeepStrictEqual(live, initial) || !usedDigest ||
            sha256HexSyncText(decoder.decode(await readBytes(recoveredPath, 24 * 1024))) !== usedDigest)
          return effect("scratchHandoffWrite", "stage", [body], null);
        const receipt = await binding.scratchHandoffWrite.stage(body);
        if (receipt) stored = receipt;
        return effect("scratchHandoffWrite", "stage", [body], receipt);
      },
    },
  };

  function exactAnswers(body: string, recovered: string) {
    const texts = new Map<string, string[]>([
      ["recovered-result", recovered.split(/\r?\n/u)], ["operating-directive", (world.policyText ?? "").split(/\r?\n/u)],
    ]);
    let answers: { question: string; evidence: Evidence[] }[];
    try { ({ answers } = JSON.parse(body)); } catch { return false; }
    if (!Array.isArray(answers) || answers.length !== world.questions.length) return false;
    return world.questions.every(({ text, exact }, index) => {
      const answer = answers[index];
      if (answer?.question !== text || !Array.isArray(answer.evidence) || !answer.evidence.length || answer.evidence.length > 4) return false;
      const actual = new Set<string>();
      for (const { sourceId, firstLine, lastLine, text } of answer.evidence) {
        const lines = texts.get(sourceId);
        if (!lines || !Number.isInteger(firstLine) || !Number.isInteger(lastLine) || firstLine < 1 ||
            lastLine < firstLine || lastLine > lines.length || lastLine - firstLine >= 8 ||
            text !== lines.slice(firstLine - 1, lastLine).join("\n")) return false;
        for (let line = firstLine; line <= lastLine; line++) {
          const coordinate = sourceId + ":" + line;
          if (actual.has(coordinate)) return false;
          actual.add(coordinate);
        }
      }
      return isDeepStrictEqual(actual, new Set(exact.map(([sourceId, line]) => sourceId + ":" + line)));
    });
  }

  async function verify(value: unknown) {
    const report = value as Outcome | null;
    const outcome = report;
    const evalProof = await recovery.verifyObserved();
    const actualPosition = await readDirective();
    const target = world.expected.status;
    const nativeChoice = evalProof.originalRuns.find(candidate => candidate.card.role === world.eval.expected.use);
    const nativeRead = nativeChoice ? readbacks.get([...opened.values()].find(o => o.attempt.runId === nativeChoice.card.runId)?.request.operationId ?? "") : null;
    const actualRecovered = nativeRead ? await native.readText(nativeRead) : null;
    const candidate = outcome?.handoff;
    const stageCalls = effects.filter(row => row.service === "scratchHandoffWrite" && row.method === "stage");
    const exactPreparedBody = !stageCalls.length || stageCalls.some(call =>
      typeof call.args[0] === "string" && actualRecovered !== null && exactAnswers(call.args[0], actualRecovered));
    const allOutputs = await outputs();
    const addedOutputs = allOutputs.filter(name => !outputBefore.includes(name));
    const expectedReads = !["held-eval", "held-policy"].includes(target);
    const neededPolicy = ["staged", "unverified", "unanswered", "source-unavailable"].includes(target);
    const intendedChange = Boolean(world.change);
    let exactArtifact = false;
    if (target === "staged" && stored && actualRecovered) {
      const bytes = await readBytes(stored.path, stored.bytes);
      exactArtifact = bytes.length === stored.bytes && isDeepStrictEqual(candidate?.artifact, stored) &&
        addedOutputs.length === 1 && stored.path === "/.tmp/" + addedOutputs[0] + "/handoff.json" &&
        exactAnswers(decoder.decode(bytes), actualRecovered);
    } else if (target !== "staged") exactArtifact = stored === null && addedOutputs.length === 0 && !candidate?.artifact;

    const post = await vcs.status();
    const checks = {
      joinedExactNativeRecovery: evalProof.passed && (!neededPolicy || (actualRecovered !== null && usedDigest === nativeRead &&
        decoder.decode(await readBytes(recoveredPath, 24 * 1024)) === actualRecovered)),
      honoredPrerequisiteAndOrder: !rejectionBeforeDependency && exactPreparedBody && (expectedReads ? !!accepted && observedSources.size === 2 :
        !accepted && !observedSources.size) && (target === "staged" || target === "unverified" ? stageCalls.length > 0 : stageCalls.length === 0) &&
        !effects.some(effect => effect.service === "openEvalHandoff" && effect.method === "stage"),
      preservedCurrentDirective: advanced === intendedChange && isDeepStrictEqual(actualPosition, intendedChange ? changedPosition() : initial) ,
      checkedIndependentSource: !expectedReads || (world.policyText === null ? observedSources.get("operating-directive") === null :
        decoder.decode(await readBytes(policyPath, 24 * 1024)) === world.policyText && !!observedSources.get("operating-directive")),
      verifiedExactOperationalHandoff: exactArtifact && outputBefore.every(name => allOutputs.includes(name)),
      protectedWorkingMain: post.mainEventId === vcsBefore.mainEventId && isDeepStrictEqual(post.workingHead, vcsBefore.workingHead),
      exactCompoundDisposition: outcome?.status === target && Boolean(outcome.reason?.trim()) &&
        (expectedReads ? candidate?.status === target &&
          isDeepStrictEqual(candidate.missingSources, target === "source-unavailable" ? ["operating-directive"] : []) &&
          isDeepStrictEqual(candidate.unanswered, target === "unanswered" ? world.questions.filter(q => !q.exact.length).map(q => q.text) : []) :
          candidate === null),
    };
    return { caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks,
      passed: Object.values(checks).every(Boolean), effects, status: target, directive: actualPosition, artifact: stored, evalProof };
  }

  async function qualify() {
    const catalog = await services.openEvalCatalog.discover();
    const job = catalog.find(record => record.state === "active");
    if (!job) throw new Error("Missing assigned native recovery job");
    const trials: EvalTrial[] = [];
    for (const expected of world.eval.expected.observations) {
      const seed = job.attempts.find(item => item.role === expected.role);
      const latest = trials.find(item => item.observation.attempt.role === "latest");
      const observation = expected.role === "retry" && latest ? await services.openEvalReentry.retry(job.id, latest.observation.attempt.runId) :
        seed ? await services.openEvalCatalog.open(job.id, seed.runId) : null;
      if (!observation) throw new Error("Reference failed to open the scoped native recovery attempt");
      const attempt = await services.evalRecoveryJournal.observe(observation.request.operationId);
      const mismatch = attempt.stores.length > 1 || attempt.stores.some(store =>
        store.digest !== attempt.expectedDigest || store.contentDigest !== attempt.expectedDigest || store.size !== attempt.expectedSize);
      const journal = mismatch ? "mismatch" : attempt.journal !== "complete" ? "incomplete" : attempt.stores.length ? "matched" : "absent";
      const readback = journal === "matched" && attempt.allowReadback
        ? await services.evalRecoveryReadback.read(observation.request.operationId, attempt.expectedDigest) : null;
      const effect = readback?.observedDigest === attempt.expectedDigest && readback.size === attempt.expectedSize ? "confirmed" : "unchecked";
      const next = journal === "mismatch" ? "inspect-integrity" : journal === "incomplete" ? "recover-journal" :
        journal === "absent" ? "inspect-original-attempt" : effect === "confirmed" ? "continue-with-effect" : "confirm-effect";
      const review: OpenEvalReview = { runId: attempt.runId, cell: attempt.cell, reason: "Verified original native attempt",
        journal, effect, next, readback };
      trials.push({ observation, review });
    }
    const selected = trials.find(item => item.observation.attempt.role === world.eval.expected.use);
    let position = await services.recoveryHandoffLink.discover();
    let status: CompoundStatus = selected ? "held-policy" : "held-eval";
    let handoff: HandoffResult | null = null;
    if (selected?.observation.resultDigest && selected.review.readback && position.disposition === "requested" &&
        position.recipient === world.requestedRecipient) {
      const { observation, review } = selected;
      const acquisition = await services.recoveryHandoffLink.prepare(job.id, observation.attempt.runId,
        observation.runDigest, observation.resultDigest!, review.readback!.digest, position);
      position = acquisition.directive;
      if (acquisition.request) {
        const lines = new Map<string, string[]>();
        const missingSources: string[] = [];
        for (const source of acquisition.request.sources) {
          const content = await services.scratchHandoffRead.read(source.id);
          if (content) lines.set(source.id, content.lines);
          else missingSources.push(source.id);
        }
        const unanswered = missingSources.length ? [] : world.questions.filter(q => !q.exact.length).map(q => q.text);
        let artifact: Receipt | null = null;
        if (missingSources.length) status = "source-unavailable";
        else if (unanswered.length) status = "unanswered";
        else {
          const answers = world.questions.map(({ text, exact }) => ({
            question: text, evidence: exact.map(([sourceId, line]) => ({
              sourceId, firstLine: line, lastLine: line, text: lines.get(sourceId)![line - 1],
            })),
          }));
          artifact = await services.scratchHandoffWrite.stage(JSON.stringify({ answers }, null, 2) + "\n");
          status = artifact ? "staged" : "unverified";
        }
        position = await services.recoveryHandoffLink.discover();
        handoff = { status, artifact, missingSources, unanswered };
      }
    }
    return verify({
      status, handoff, reason: "Resolved current native recovery and the exact local release scope",
    });
  }

  return { services, verify, qualify, close: recovery.close };
}
