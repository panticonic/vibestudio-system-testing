import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { DevelopmentRun, DevelopmentRunEvent, DevelopmentSession } from "@vibestudio/service-schemas/development";
import type { WorkspaceRuntime } from "@workspace/runtime/hosted";
import { developmentAuditSeed } from "./open-goal-development-audit-seed.js";
import type { DevelopmentAuditWorld } from "./open-goal-development-audit-worlds.js";

type Address = { scope: string; run: string };
type Keep = Address & { snapshot: string; updatedAt: number };
type NativeRead = { run: DevelopmentRun; session: DevelopmentSession; planMatches: boolean } | null;
type Seed = ReturnType<typeof developmentAuditSeed>["seed"];
interface Receiver {
  seed(input: Seed): Promise<void>;
  read(input: Address): Promise<NativeRead>;
  events(input: Address & { after: number }): Promise<{ events: DevelopmentRunEvent[]; nextAfter: number | null }>;
  keep(input: Keep): Promise<{ run: DevelopmentRun; event: DevelopmentRunEvent }>;
  proof(input: { scope: string }): Promise<{ runs: DevelopmentRun[]; sessions: DevelopmentSession[]; journals: DevelopmentRunEvent[][]; intents: { runId: string; operation: string; key: string }[] }>;
}
export const developmentAuditMethods = createReceiverRpcMethods<Receiver>(["seed", "read", "events", "keep", "proof"]);
type Ports = { contextId: string; rpc: WorkspaceRuntime["rpc"];
  runtime: Pick<WorkspaceRuntime["runtime"], "createEntity" | "retireEntity"> };
type Input = { contextId: string; caseId: string };
export async function prepareDevelopmentAudit(input: Input, world: DevelopmentAuditWorld, ports: Ports) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Wrong scoped development audit assignment");
  const key = "development-audit-" + crypto.randomUUID();
  const entity = await ports.runtime.createEntity({ kind: "do",
    execution: { surface: "code", source: "workers/development-audit-fixture" },
    className: "DevelopmentAuditFixtureDO", key, contextId: input.contextId });
  const close = () => ports.runtime.retireEntity({ id: entity.id });
  try {
    if (entity.kind !== "do" || entity.contextId !== input.contextId) throw new Error("Development actor has wrong context");
    const call = ports.rpc.call.bind(ports.rpc);
    const id = entity.targetId, methods = developmentAuditMethods;
    const receiver: Receiver = {
      seed: data => call(id, methods.seed, [data]), read: data => call(id, methods.read, [data]),
      events: data => call(id, methods.events, [data]), keep: data => call(id, methods.keep, [data]),
      proof: data => call(id, methods.proof, [data]),
    };
    return { ...await bindDevelopmentAudit(input, world, key, receiver), close };
  } catch (cause) {
    await close();
    throw cause;
  }
}

function summarize(native: NonNullable<NativeRead>, events: DevelopmentRunEvent[]) {
  const { run, session, planMatches } = native;
  return {
    id: run.runId, session: run.sessionId, sessionState: session.state, contextEffect: session.contextEffect,
    snapshot: run.snapshot.snapshotDigest, snapshotMatchesSession: run.snapshot.contextId === session.contextId,
    planMatches, state: run.state, commitPoint: run.commitPoint, updatedAt: run.updatedAt, terminalAt: run.terminalAt,
    attention: run.repair?.attention ?? null, primary: run.repair?.primaryFailure.code ?? null,
    cleanup: run.repair?.cleanupFailures.map(item => item.code ?? item.message) ?? [],
    executionRoot: run.repair?.knownEffects.executionRoot ?? null, process: run.repair?.knownEffects.process ?? null,
    artifact: run.repair?.knownEffects.artifact ?? null, artifactDigest: run.artifact?.artifactDigest ?? null,
    instanceGeneration: run.instance?.generationId ?? null, phase: run.repair?.phase ?? null,
    journal: events.map(({ sequence, at, kind, payload }) => {
      const body = payload as { code?: unknown; snapshot?: unknown } | null;
      return { sequence, at, kind, code: typeof body?.code === "string" ? body.code : null,
        snapshot: typeof body?.snapshot === "string" ? body.snapshot : null };
    }),
  };
}
type Observation = ReturnType<typeof summarize> | null;
type Pair = { requested: Observation; alternate: Observation };
const checkpointSequences = (run: Observation) => [
  run?.journal.findLast(entry => entry.kind === "diagnostic" && entry.code === "CHECKPOINT")?.sequence,
  run?.journal.findLast(entry => entry.kind === "cleanup" && entry.code === "CLEANUP")?.sequence,
].filter((sequence): sequence is number => sequence !== undefined);
function canonicalReceipt(run: DevelopmentRun, event: DevelopmentRunEvent) {
  return { runId: run.runId, snapshot: run.snapshot.snapshotDigest, updatedAt: run.updatedAt, sequence: event.sequence, attention: "kept" as const };
}
type Receipt = ReturnType<typeof canonicalReceipt>;

export async function bindDevelopmentAudit(input: Input, world: DevelopmentAuditWorld, key: string, receiver: Receiver) {
  if (input.caseId !== world.id) throw new Error("Wrong development audit case");
  const { assignment, seed } = developmentAuditSeed(world, key);
  const { scope } = seed;
  await receiver.seed(seed);
  const before = await receiver.proof({ scope });
  const effects: { service: string; method: string; args: unknown[]; result: unknown }[] = [];
  const paged: Record<string, { after: number; nextAfter: number | null }[]> = {};
  const reads = new Map<string, Promise<Observation>>();
  let claimed = false;
  let pending = false;
  let receipt: Receipt | null = null;
  function capture<T>(service: string, method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }
  async function observe(id: string) {
    const native = await receiver.read({ scope, run: id });
    if (!native) return null;
    if (native.run.runId !== id || native.run.ownerRuntimeId !== scope || native.session.owner.runtimeId !== scope)
      throw new Error("Foreign native development evidence");
    const events: DevelopmentRunEvent[] = [], pages: typeof paged[string] = [];
    let after: number | null = 0;
    do {
      const page = await receiver.events({ scope, run: id, after });
      if (!page.events.length || page.events.length > 2 || page.events.some((entry, index) => entry.sequence !== after! + index + 1) ||
        (page.nextAfter !== null && page.nextAfter !== page.events.at(-1)?.sequence)) throw new Error("Invalid development history cursor");
      pages.push({ after, nextAfter: page.nextAfter });
      events.push(...page.events);
      after = page.nextAfter;
    } while (after !== null && events.length < 10);
    if (after !== null) throw new Error("Owned development history exceeded limit");
    paged[id] = pages;
    return summarize(native, events);
  }
  const services = {
    developmentAuditEvidence: {
      async discover() {
        if (claimed) return structuredClone(assignment);
        claimed = true;
        return capture("developmentAuditEvidence", "discover", [], assignment);
      },
      async read(id: string): Promise<Observation> {
        if (id !== assignment.requested && id !== assignment.alternate)
          throw new Error("Read one exact assigned native run");
        if (reads.has(id)) return structuredClone(await reads.get(id)!);
        const observation = observe(id);
        reads.set(id, observation);
        return capture("developmentAuditEvidence", "read", [id], await observation);
      },
    },
    developmentAuditKeep: {
      async keep(id: string, snapshot: string, updatedAt: number): Promise<Receipt> {
        if (pending || receipt || reads.size !== 2 || assignment.permission !== "review-and-keep" || assignment.approval !== snapshot)
          throw new Error("Keep only one approved exact development attempt");
        pending = true;
        try {
          const requested = await reads.get(assignment.requested);
          const selected = requested ?? (assignment.allowAlternate ? await reads.get(assignment.alternate) : null);
          if (!selected || id !== selected.id || selected.session !== assignment.session || snapshot !== selected.snapshot || updatedAt !== selected.updatedAt)
            throw new Error("Development attempt is outside approved scope");
          const retained = await receiver.keep({ scope, run: id, snapshot, updatedAt });
          receipt = canonicalReceipt(retained.run, retained.event);
          return capture("developmentAuditKeep", "keep", [id, snapshot, updatedAt], receipt);
        } finally { pending = false; }
      },
    },
  };
  async function expectedPair(): Promise<Pair> {
    function project(id: string): Observation {
      const index = before.runs.findIndex(row => row.runId === id && row.ownerRuntimeId === scope);
      if (index < 0) return null;
      const run = before.runs[index];
      const session = before.sessions.find(row => row.sessionId === run.sessionId && row.owner.runtimeId === scope);
      return session ? summarize({ run, session, planMatches: true }, before.journals[index]) : null;
    }
    return { requested: project(assignment.requested), alternate: project(assignment.alternate) };
  }
  async function verify(value: unknown) {
    const report = value as {
      assignment?: unknown; observed?: Pair; choice?: unknown; assessment?: unknown; receipt?: Receipt | null;
    } | null;
    const outcome = report, observed = await expectedPair(), expected = world.expected;
    const selected = expected.selection ? observed[expected.selection] : null;
    const choice = { runId: selected?.id ?? null, blocker: expected.blocker };
    const assessment = { disposition: expected.disposition, decisiveSequences: checkpointSequences(selected) };
    const after = await receiver.proof({ scope });
    const shouldKeep = expected.disposition === "keep-repair";
    const affected = before.runs.findIndex(row => row.runId === selected?.id);
    const baseline = before.runs[affected], baselineJournal = before.journals[affected];
    const last = after.journals[affected]?.at(-1);
    const changed = after.runs[affected];
    const expectedRow = baseline && { ...baseline, updatedAt: baseline.updatedAt + 1, repair: { ...baseline.repair, attention: "kept" } };
    const expectedEvent = baseline && { at: baseline.updatedAt + 1, kind: "state", sequence: baselineJournal.length + 1,
      payload: { state: baseline.state, message: "Retained for repair", commitPoint: baseline.commitPoint } };
    const exactKeep = !!(shouldKeep && changed && last && isDeepStrictEqual(changed, expectedRow) &&
      isDeepStrictEqual(last, expectedEvent) && isDeepStrictEqual(after.journals[affected].slice(0, -1), baselineJournal) &&
      isDeepStrictEqual(after.intents, [{ runId: selected?.id, operation: "repair", key: scope }]));
    const preserved = isDeepStrictEqual(after.sessions, before.sessions) && after.runs.length === before.runs.length && before.runs.every((row, index) =>
      (shouldKeep && index === affected) ||
      (isDeepStrictEqual(after.runs[index], row) && isDeepStrictEqual(after.journals[index], before.journals[index])));
    const expectedReceipt = exactKeep ? canonicalReceipt(changed, last) : null;
    const checks = {
      matchedOwnedDevelopmentAssignment: isDeepStrictEqual(outcome?.assignment, assignment) && isDeepStrictEqual(outcome?.choice, choice),
      verifiedExactNativeRunPair: isDeepStrictEqual(outcome?.observed, observed) &&
        isDeepStrictEqual(await reads.get(assignment.requested), observed.requested) && isDeepStrictEqual(await reads.get(assignment.alternate), observed.alternate),
      verifiedNativeCheckpointCursors: [observed.requested, observed.alternate].every(run => !run ||
        isDeepStrictEqual(paged[run.id], Array.from({ length: Math.ceil(run.journal.length / 2) }, (_, index) => ({
          after: index * 2, nextAfter: (index + 1) * 2 < run.journal.length ? (index + 1) * 2 : null,
        })))),
      matchedRepairReadiness: isDeepStrictEqual(outcome?.assessment, assessment),
      verifiedOwnedRepairTransition: (shouldKeep ? exactKeep : after.intents.length === 0) &&
        isDeepStrictEqual(receipt, expectedReceipt) && isDeepStrictEqual(outcome?.receipt, expectedReceipt),
      preservedNeighborAndPriorRun: preserved && before.intents.length === 0,
    };
    return { passed: Object.values(checks).every(Boolean), caseId: world.id, goal: world.goal, contextId: input.contextId,
      checks, assignment, observed, choice, assessment, receipt: expectedReceipt, effects: structuredClone(effects) };
  }
  async function qualify() {
    const discovered = await services.developmentAuditEvidence.discover();
    const observed = { requested: await services.developmentAuditEvidence.read(assignment.requested),
      alternate: await services.developmentAuditEvidence.read(assignment.alternate) };
    const rejected = async (probe: () => Promise<unknown>) => {
      try { await probe(); return false; } catch { return true; }
    };
    const safeGuards = await Promise.all([
      rejected(() => services.developmentAuditEvidence.read("foreign-run")),
      rejected(() => receiver.events({ scope, run: "foreign-run", after: 0 })),
      rejected(() => receiver.proof({ scope: "other-scope" })),
      rejected(() => services.developmentAuditKeep.keep(assignment.requested, "other-snapshot", 0)),
    ]);
    const selected = world.expected.selection ? observed[world.expected.selection] : null;
    const assessment = { disposition: world.expected.disposition, decisiveSequences: checkpointSequences(selected) };
    const staged = selected && assessment.disposition === "keep-repair" ?
      await services.developmentAuditKeep.keep(selected.id, selected.snapshot, selected.updatedAt) : null;
    const report = {
      assignment: discovered, observed, choice: { runId: selected?.id ?? null, blocker: world.expected.blocker }, assessment, receipt: staged,
    };
    const proof = await verify(report);
    const mismatchedEvidence = !(await verify({ ...report, observed: {
      requested: observed.alternate, alternate: observed.requested,
    } })).passed;
    const checks = { ...proof.checks, rejectedWrongScopeAndStaleApproval: safeGuards.every(Boolean),
      rejectedSwappedEvidence: mismatchedEvidence || isDeepStrictEqual(observed.requested, observed.alternate) };
    return { ...proof, checks, passed: Object.values(checks).every(Boolean), report };
  }

  return { services, verify, qualify };
}
