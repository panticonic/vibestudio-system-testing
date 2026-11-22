import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  createEvalExecutor, createEvalRunHandle, evalResultReceiptSchema, evalStartInputSchema,
  type EvalCall, type EvalResultReceipt, type EvalStartInput,
} from "@vibestudio/service-schemas/eval";
import { createMainRpcCaller } from "@vibestudio/service-schemas/mainRpc";
import { contextId, rpc } from "@workspace/runtime";
import type { SameTurnDecision, SameTurnWorld } from "./open-goal-same-turn-eval-worlds.js";

const hash = (value: unknown) => sha256HexSyncText(JSON.stringify(value));
const HEADER = 16_504;
const TAIL = 18_000;
const PAGE = 4093;
const maxText = 64 * 1024;
const checkpointKey = "sameTurnCheckpoint";
const spillKey = "$lastLargeReturn";
const sourceKey = "sameTurnSource";
type Result = { request: string; revision: string; count: number; detail: string };
type Packet = { useful: Result; complete: boolean; digest: string };
type Candidate = { request: string; revision: string; complete: boolean; digest: string };
type Status = "unadmitted" | "failed" | "timed-out" | "completed";
type Evidence = { runId: string; scopeId: string; status: Status; runDigest: string | null; failureCode: string | null;
  diagnostic: string | null; returnKind: "none" | "compact" | "window"; checkpoint: Candidate | null;
  window: Candidate | null; compact: Candidate | null };
type Delivery = { observation: Result; scopeId: string; resultDigest: string; recoveryRun: string | null; pages: number };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Ports = { contextId: string | null; call: EvalCall; deadline?: number };
const literal = (value: unknown) => JSON.stringify(value);
function packet(useful: Result, complete: boolean): Packet {
  return { useful, complete, digest: hash(useful) };
}
function candidate(value: unknown): Candidate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Packet;
  const result = item.useful;
  if (!result || typeof result.request !== "string" || typeof result.revision !== "string" || !Number.isSafeInteger(result.count) ||
    typeof result.detail !== "string" || typeof item.complete !== "boolean" || item.digest !== hash(result)) return null;
  return { request: result.request, revision: result.revision, complete: item.complete, digest: item.digest };
}
function outputPacket(result: EvalResultReceipt["result"]) {
  const payload = result.returnValue as { packet?: unknown } | null;
  return payload?.packet ?? null;
}
function isWindow(result: EvalResultReceipt["result"]) {
  const view = result.returnValue as { truncated?: unknown; scopeKey?: unknown; originalChars?: unknown } | null;
  return view?.truncated === true && view.scopeKey === spillKey && typeof view.originalChars === "number";
}
export async function prepareSameTurnEval(input: { contextId: string; caseId: string }, world: SameTurnWorld,
    ports: Ports = { contextId, call: createMainRpcCaller(rpc) }) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Same-turn eval is outside the current owned context");
  const { call } = ports, execute = createEvalExecutor(call);
  const scopeId = "same-turn-eval-" + crypto.randomUUID();
  const runIds = {
    seed: scopeId + ":seed", attempt: scopeId + ":attempt", diagnostic: scopeId + ":diagnostic",
    recover: scopeId + ":recover",
  };
  const assignment = { id: crypto.randomUUID(), goal: world.goal, subject: world.subject, request: world.request,
    revision: "current-" + crypto.randomUUID(), mayNarrow: world.mayNarrow,
    mayUseCheckpoint: world.mayUseCheckpoint, mayUseWindow: world.mayUseWindow };
  const wanted: Result = { request: assignment.request, revision: assignment.revision, count: world.count, detail: world.detail };
  const earlier = { ...wanted, revision: "earlier-" + assignment.revision, count: wanted.count + 1 };
  const incidental = { ...wanted, request: "neighbor-" + assignment.request, detail: "separate retained troubleshooting request" };
  const initial = packet(wanted, true), stale = packet(earlier, true), partial = packet({ ...wanted, count: wanted.count - 1 }, false);
  const checkpoint = world.checkpoint === "exact" ? initial : world.checkpoint === "prior" ? stale :
    world.checkpoint === "partial" ? partial : null;
  const effects: Effect[] = [];
  let closed = false, scopeOpened = false, discovered = false, inspecting = false, resolving = false;
  let evidence: Evidence | null = null, delivery: Delivery | null = null;
  let admittedAttempt: EvalResultReceipt | null = null, admittedDiagnostic: EvalResultReceipt | null = null, recovery: EvalResultReceipt | null = null;
  const initialProbe = {
    seed: `scope[${literal(sourceKey)}] = ${literal(JSON.stringify(initial))};
      scope[${literal(checkpointKey)}] = ${literal(world.checkpoint === "partial" || !checkpoint ? null : JSON.stringify(checkpoint))};
      return { accepted: true };`,
    recovered: `const packet=JSON.parse(scope[${literal(sourceKey)}]); return { packet };`,
    oversize: (result: Packet) => `const head="a".repeat(${HEADER}); const tail="z".repeat(${TAIL});
      return { head, packet:${literal(result)}, tail };`,
    inspect: `let checkpoint=null,window=null;
      if(typeof scope[${literal(checkpointKey)}]==="string") checkpoint=JSON.parse(scope[${literal(checkpointKey)}]);
      if(typeof scope[${literal(spillKey)}]==="string") window=JSON.parse(scope[${literal(spillKey)}]).packet;
      const meta=(packet)=>packet?{useful:{request:packet.useful.request,revision:packet.useful.revision},complete:packet.complete,digest:packet.digest}:null;
      return { checkpoint:meta(checkpoint), window:meta(window) };`,
  };
  function metadata(value: unknown): Candidate | null {
    if (!value) return null;
    const row = value as { useful: { request: string; revision: string }; complete: boolean; digest: string };
    if (!row.useful || typeof row.useful.request !== "string" || typeof row.useful.revision !== "string" ||
      typeof row.complete !== "boolean" || !/^[0-9a-f]{64}$/u.test(row.digest)) throw new Error("Malformed native recovery metadata");
    return { request: row.useful.request, revision: row.useful.revision, complete: row.complete, digest: row.digest };
  }
  function admission(runId: string, code: string, timeoutMs?: number): EvalStartInput {
    return { runId, scope: { key: scopeId, lifecycle: "finite" }, source: { kind: "inline", code, syntax: "typescript" },
      ...(timeoutMs ? { timeoutMs } : {}) };
  }
  async function retained(runId: string) {
    const route = { scopeKey: scopeId, runId };
    const state = await call("eval.get", [route]);
    const native = await call("eval.receipt", [route]);
    if (state.status === "unknown" && native === null) return null;
    const receipt = evalResultReceiptSchema.parse(native);
    if (!["done", "cancelled"].includes(state.status) || !("result" in state) ||
      receipt.runId !== runId || !isDeepStrictEqual(receipt.result, state.result)) throw new Error("Native EvalDO terminal receipt disagrees with current status");
    return receipt;
  }
  async function run(runId: string, code: string, timeoutMs?: number) {
    const request = admission(runId, code, timeoutMs);
    const visible = await execute(request);
    const receipt = await retained(runId);
    if (!receipt || !isDeepStrictEqual(visible, receipt.result)) throw new Error("Eval action lost its terminal receipt");
    return receipt;
  }
  async function text(key: string) {
    let offset = 0, length: number | undefined;
    const chunks: Buffer[] = [];
    do {
      const page = await call("eval.readScopeTextPage", [{ scopeKey: scopeId, key, offset, limit: PAGE }]);
      if (page.encoding !== "utf16le-base64" || !Number.isSafeInteger(page.length) || page.length < 0 || page.length > maxText ||
        length !== undefined && length !== page.length) throw new Error("Owned recovery text changed length or exceeded its byte window");
      length = page.length;
      const bytes = Buffer.from(page.chunk, "base64");
      if (bytes.length !== 2 * Math.min(PAGE, length - offset)) throw new Error("Owned scope page was incomplete");
      offset += bytes.length / 2;
      chunks.push(bytes);
    } while (offset < length);
    return { data: Buffer.concat(chunks).toString("utf16le"), pages: chunks.length };
  }
  function capture<T>(service: string, method: string, args: unknown[], value: T): T {
    effects.push(structuredClone({ service, method, args, result: value }));
    return structuredClone(value);
  }
  async function setup() {
    scopeOpened = true;
    const seeded = await run(runIds.seed, initialProbe.seed);
    if (!seeded.result.success) throw new Error("Native eval did not retain the assigned task source: " + (seeded.result.error?.message ?? seeded.result.failureCode));
    const partialWrite = world.checkpoint === "partial" ?
      `scope[${literal(checkpointKey)}]=${literal(JSON.stringify(partial))};` : "";
    const mode = world.mode;
    let diagnostic: string | null = null;
    if (mode === "invalid") {
      const malformed = { ...admission(runIds.attempt, initialProbe.recovered), unsupportedField: true };
      const parsed = evalStartInputSchema.safeParse(malformed);
      if (parsed.success || await retained(runIds.attempt)) throw new Error("Malformed eval request reached a native run");
      diagnostic = parsed.error.issues.map(issue => issue.message).join("; ").slice(0, 180);
    } else {
      const code = mode === "throw" ? partialWrite + "throw new Error('The owned tool transformation failed');" :
        mode === "syntax" ? "return { property: };" :
        mode === "missing-file" ? `return await fs.readFile(${literal(scopeId + "-missing.txt")}, "utf8");` :
        mode === "timeout" ? partialWrite + "await new Promise(() => {});" :
        mode === "compact" ? partialWrite + initialProbe.recovered : initialProbe.oversize(initial);
      admittedAttempt = await run(runIds.attempt, code, mode === "timeout" ? ports.deadline ?? 1400 : undefined);
      diagnostic = admittedAttempt.result.error?.message?.slice(0, 180) ?? null;
    }
    // An unrelated large diagnostic supersedes the reserved spill, while the
    // tiny metadata cell below preserves any earlier span that still owns it.
    admittedDiagnostic = await run(runIds.diagnostic, mode === "wide-replaced" ? initialProbe.oversize(packet(incidental, true)) :
      initialProbe.inspect);
    if (!admittedDiagnostic.result.success) throw new Error("Could not inspect the owned same-turn scope");
    const snapshot = mode === "wide-replaced" ? await run(runIds.diagnostic + ":metadata", initialProbe.inspect) : admittedDiagnostic;
    if (!snapshot.result.success) throw new Error("Could not read exact bounded EvalDO metadata");
    const meta = snapshot.result.returnValue as { checkpoint?: unknown; window?: unknown };
    const native = admittedAttempt?.result;
    return { runId: runIds.attempt, scopeId, status: !native ? "unadmitted" : native.success ? "completed" :
      native.failureCode === "eval_deadline_exceeded" ? "timed-out" : "failed",
      runDigest: admittedAttempt?.runDigest ?? null, failureCode: native?.failureCode ?? (native ? null : "invalid_tool_arguments"),
      diagnostic, returnKind: native && isWindow(native) ? "window" : native && candidate(outputPacket(native)) ? "compact" : "none",
      checkpoint: metadata(meta.checkpoint), window: metadata(meta.window), compact: native ? candidate(outputPacket(native)) : null } satisfies Evidence;
  }
  const service = {
    sameTurnEvalEvidence: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return capture("sameTurnEvalEvidence", "discover", [], assignment);
      },
      async observe(id: string) {
        if (discovered && id === assignment.id && evidence) return structuredClone(evidence);
        if (id !== assignment.id || !discovered || inspecting) throw new Error("Read the admitted owned same-turn evidence once");
        inspecting = true;
        try { evidence = await setup(); return capture("sameTurnEvalEvidence", "observe", [id], evidence); }
        finally { inspecting = false; }
      },
    },
    sameTurnEvalRecovery: {
      async resolve(id: string, runId: string, decision: SameTurnDecision) {
        if (!evidence || id !== assignment.id || runId !== evidence.runId || delivery || resolving || decision === "held")
          throw new Error("Recovery must match the exact owned same-turn tool attempt");
        resolving = true;
        try {
          const exact = (value: Candidate | null) =>
            !!value && value.complete && value.request === assignment.request && value.revision === assignment.revision;
          const canUseCheckpoint = assignment.mayUseCheckpoint && exact(evidence.checkpoint);
          const canUseWindow = assignment.mayUseWindow && evidence.returnKind === "window" && exact(evidence.window);
          const canUseCompact = admittedAttempt?.result.success === true && exact(evidence.compact);
          let value: unknown, pages = 0;
          if (decision === "checkpoint" && canUseCheckpoint) {
            const read = await text(checkpointKey);
            value = JSON.parse(read.data); pages = read.pages;
          } else if (decision === "window" && canUseWindow) {
            const read = await text(spillKey);
            value = JSON.parse(read.data).packet; pages = read.pages;
          } else if (decision === "compact" && admittedAttempt && canUseCompact) {
            value = outputPacket(admittedAttempt.result);
          } else if (decision === "narrow" && assignment.mayNarrow && !canUseCompact && !canUseCheckpoint && !canUseWindow) {
            recovery = await run(runIds.recover, initialProbe.recovered);
            if (!recovery.result.success) throw new Error("Bounded same-turn inspection did not finish");
            value = outputPacket(recovery.result);
          } else throw new Error("The requested candidate is stale, partial, or unapproved");
          if (!exact(candidate(value))) throw new Error("The recovered EvalDO packet is not the exact useful current result");
          const observation = (value as Packet).useful;
          delivery = { observation, scopeId, resultDigest: hash(observation), recoveryRun: recovery?.runId ?? null, pages };
          return capture("sameTurnEvalRecovery", "resolve", [id, runId, decision], delivery);
        } finally { resolving = false; }
      },
    },
  };
  async function verify(value: unknown) {
    const report = value as { status?: string; skill?: string; outcome?: {
      assignment?: unknown; evidence?: unknown; pick?: unknown; recovery?: unknown;
    } } | null;
    const outcome = report?.outcome, pick = world.expected, native = admittedAttempt?.result;
    const expectedStatus: Status = world.mode === "invalid" ? "unadmitted" : world.mode === "timeout" ? "timed-out" :
      ["missing-file", "syntax", "throw"].includes(world.mode) ? "failed" : "completed";
    const expectedWindow = world.mode === "wide" ? candidate(initial) :
      world.mode === "wide-replaced" ? candidate(packet(incidental, true)) : null;
    const expectedPageCount = pick.decision === "window" ? Math.ceil(JSON.stringify({ head: "a".repeat(HEADER),
      packet: initial, tail: "z".repeat(TAIL) }, null, 2).length / PAGE) : pick.decision === "checkpoint" ? 1 : 0;
    const expectedRecovery = pick.decision === "held" ? null : { observation: wanted, scopeId,
      resultDigest: hash(wanted), recoveryRun: pick.decision === "narrow" ? runIds.recover : null, pages: expectedPageCount };
    const actualSource = evidence ? await text(sourceKey) : null;
    const actualCheckpoint = checkpoint && evidence ? await text(checkpointKey) : null;
    const currentReceipt = evidence ? await retained(runIds.attempt) : null;
    const actualRecovery = evidence ? await retained(runIds.recover) : null;
    const diagnosticStable = admittedDiagnostic &&
      isDeepStrictEqual(admittedDiagnostic, await retained(runIds.diagnostic));
    const failureVisible = expectedStatus === "completed" ? native?.success === true :
      typeof evidence?.diagnostic === "string" && evidence.diagnostic.length > 0 &&
      (expectedStatus === "unadmitted" ? evidence.failureCode === "invalid_tool_arguments" :
        native?.success === false && (expectedStatus !== "timed-out" || evidence.failureCode === "eval_deadline_exceeded"));
    const checks = {
      matchedSameTurnAssignment: isDeepStrictEqual(outcome?.assignment, assignment) && evidence?.scopeId === scopeId,
      verifiedExactNativeAttempt: !!evidence && isDeepStrictEqual(outcome?.evidence, evidence) &&
        isDeepStrictEqual(admittedAttempt, currentReceipt) && evidence.status === expectedStatus && failureVisible,
      verifiedRetainedCheckpointAndWindow: !!evidence && isDeepStrictEqual(evidence.checkpoint, candidate(checkpoint)) &&
        isDeepStrictEqual(evidence.window, expectedWindow) && isDeepStrictEqual(evidence.compact, world.mode === "compact" ? candidate(initial) : null) &&
        evidence.returnKind === (expectedWindow ? "window" : world.mode === "compact" ? "compact" : "none"),
      matchedAuthorizedSameTurnRecovery: report?.status === "workspace-skill-reviewed" && report.skill === "sameTurnEval" &&
        isDeepStrictEqual(outcome?.pick, pick),
      verifiedUsefulResultAndBoundedRetry: isDeepStrictEqual(outcome?.recovery, expectedRecovery) &&
        isDeepStrictEqual(delivery, expectedRecovery) && isDeepStrictEqual(recovery, actualRecovery) &&
        (pick.decision === "narrow" ? !!actualRecovery && candidate(outputPacket(actualRecovery.result))?.digest === hash(wanted) : !actualRecovery),
      preservedExactOwnedScope: !!diagnosticStable && actualSource?.data === JSON.stringify(initial) &&
        (checkpoint ? actualCheckpoint?.data === JSON.stringify(checkpoint) : actualCheckpoint === null),
    };
    return { passed: Object.values(checks).every(Boolean), caseId: world.id, contextId: input.contextId, goal: world.goal, checks,
      assignment, evidence, pick, recovery: expectedRecovery, effects: structuredClone(effects) };
  }
  async function qualify() {
    const assigned = await service.sameTurnEvalEvidence.discover();
    const evidence = await service.sameTurnEvalEvidence.observe(assigned.id);
    async function rejects(work: Promise<unknown>) { try { await work; return false; } catch { return true; } }
    const rejectedWrongScope = await rejects(service.sameTurnEvalEvidence.observe("other-task"));
    const rejectedWrongAttempt = await rejects(service.sameTurnEvalRecovery.resolve(assigned.id, "other-run", "narrow"));
    const pick = world.expected;
    const rejectedUnneededRetry = pick.decision === "narrow" ||
      await rejects(service.sameTurnEvalRecovery.resolve(assigned.id, evidence.runId, "narrow"));
    const recovery = pick.decision === "held" ? null : await service.sameTurnEvalRecovery.resolve(assigned.id, evidence.runId, pick.decision);
    const report = { status: "workspace-skill-reviewed", skill: "sameTurnEval", outcome: { assignment: assigned, evidence, pick, recovery } };
    const verified = await verify(report);
    const rejectedWrongRevision = !(await verify({ ...report, outcome: { ...report.outcome, assignment: {
      ...assigned, revision: "different-revision",
    } } })).passed;
    const checks = { ...verified.checks, rejectedWrongScope, rejectedWrongAttempt, rejectedUnneededRetry, rejectedWrongRevision };
    return { ...verified, passed: Object.values(checks).every(Boolean), checks, report };
  }
  async function close() {
    if (!scopeOpened || closed) return;
    await call("eval.dispose", [{ scopeKey: scopeId }]);
    closed = true;
  }
  return { services: service, qualify, verify, close };
}
