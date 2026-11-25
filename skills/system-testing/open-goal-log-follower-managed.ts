import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { readEventWatchRecords } from "@vibestudio/shared/events";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, runtime } from "@workspace/runtime";
import { hostWorkerdLogTag } from "./log-audit-worlds.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { LogFixtureLine, LogFollowerWorld, LogOperationState } from "./open-goal-log-follower-worlds.js";

type Header = { workspaceId: string; serverBootId: string; latestSeq: number };
type NativeRow = { seq: number; message: string; tag?: string };
type NativeQuery = { sinceSeq?: number; untilSeq?: number; contains: string; tag: string; limit: number };
type RawEventResponse = Parameters<typeof readEventWatchRecords>[0];
type Ports = {
  contextId: string | null;
  query(input: NativeQuery): Promise<Header & { records: NativeRow[] }>;
  stats(): Promise<{ oldestSeq: number | null }>;
  watch(id: string, signal: AbortSignal): Promise<RawEventResponse>;
  emit(input: LogBatch): Promise<void>;
  scratch: { directory(): Promise<string>; write(path: string, data: string): Promise<void>;
    read(path: string): Promise<Uint8Array>; entries(path: string): Promise<string[]> };
};
type LogBatch = { marker: string; phase: "ready" | "catchup" | "final"; messages: string[] };
const writerMethods = createReceiverRpcMethods<{ appendBatch(input: LogBatch): Promise<void> }>(["appendBatch"]);
async function livePorts(owner: string) {
  if (owner !== contextId) throw new Error("Log fixture belongs to another context");
  const entity = await runtime.createEntity({ kind: "do", contextId: owner,
    execution: { surface: "code", source: "workers/log-follow-fixture" },
    className: "LogFollowFixtureDO", key: "log-follower-" + crypto.randomUUID() });
  const close = () => runtime.retireEntity({ id: entity.id });
  if (entity.kind !== "do" || entity.contextId !== owner) {
    await close();
    throw new Error("Scoped log writer has wrong native identity");
  }
  const target = entity.targetId;
  const ports: Ports = { contextId,
    query: query => rpc.call("main", mainRpcMethods["serverLog.query"], [query]),
    stats: () => rpc.call("main", mainRpcMethods["serverLog.stats"], []),
    watch: (id, signal) => rpc.streamReadable("main", mainRpcMethods["events.watch"], [["server-log:append"], id], { signal }),
    emit: batch => rpc.call(target, writerMethods.appendBatch, [batch]),
    scratch: { directory: () => fs.mkdtemp("native-log-follower"),
      write: async (path, text) => { await fs.writeFile(path, text); }, read: path => readWorkspaceBytes(rpc, path, 20000),
      entries: path => fs.readdir(path) } };
  return { ports, close };
}
type EvidenceRow = { seq: number; lane: string; request: string; state: LogOperationState; detail: string };
type Capture = { boot: string; workspace: string; epoch: string; opened: boolean; canceled: boolean; start: number; oldest: number | null;
  catchupThrough: number; witnessedThrough: number; lastSeen: number | null; overflow: boolean; query: EvidenceRow[]; live: EvidenceRow[] };
type Continuity = LogFollowerWorld["expected"]["continuity"] | "hold-expired" | "hold-conflict";
type Join = { continuity: Continuity; boot: string; through: number | null; rows: EvidenceRow[]; duplicates: number[] };
type Decision = { state: LogFollowerWorld["expected"]["state"]; citations: number[]; stage: boolean };
type Receipt = { path: string; bytes: number; sha256: string };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };

type Input = { contextId: string; caseId: string };
export async function prepareLogFollower(input: Input, world: LogFollowerWorld, replayPorts?: Ports) {
  if (replayPorts) return bindLogFollower(input, world, replayPorts);
  const { ports, close } = await livePorts(input.contextId);
  try { return { ...await bindLogFollower(input, world, ports), close }; }
  catch (error) { await close(); throw error; }
}

async function bindLogFollower(input: Input, world: LogFollowerWorld, ports: Ports) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id || world.lines.length > 16)
    throw new Error("Log follower case is outside the owned context");
  const marker = "natlang-follow-" + crypto.randomUUID(), channel = marker + "/row ", control = marker + "/barrier ";
  const target = { lane: world.subject, request: "assigned " + world.subject };
  const source = world.lines.map((line, index) => ({
    key: index, phase: line.phase, lane: line.neighbor ? "neighbor desk" : target.lane,
    request: line.prior ? "earlier " + world.subject : target.request,
    state: line.state, detail: line.detail,
  }));
  const captureLog = (text: string, sinceSeq?: number, untilSeq?: number, limit = 24) =>
    ports.query({ contains: text, tag: hostWorkerdLogTag, sinceSeq, untilSeq, limit });
  const initial = await captureLog(marker);
  const start = initial.latestSeq;
  const identity = async (text: string, since?: number, until?: number, limit?: number) => {
    const version = await captureLog(text, since, until, limit);
    if (version.workspaceId !== initial.workspaceId || version.serverBootId !== initial.serverBootId)
      throw new Error("Owned server log boot changed during bounded observation");
    return version;
  };
  async function awaitBarrier(label: string) {
    const prefix = control + label, stop = Date.now() + 7000;
    for (;;) {
      const { records } = await identity(prefix, start, undefined, 8);
      const found = records.find(row => row.message.includes(prefix));
      if (found) return found.seq;
      if (Date.now() >= stop) throw new Error("Server log missed owned " + label + " marker");
      await new Promise(resolve => setTimeout(resolve, 35));
    }
  }
  function emitRows(phase: LogFixtureLine["phase"], barrier: LogBatch["phase"]) {
    const rows = source.filter(row => row.phase === phase).map(({ phase: _phase, ...record }) => channel + JSON.stringify(record));
    return ports.emit({ marker, phase: barrier, messages: [...rows, control + barrier] });
  }
  function itemFromRow(row: NativeRow) {
    const line = row.message.split(/\r?\n/u).find(text => text.includes(channel));
    if (!line || row.tag !== hostWorkerdLogTag) return null;
    const value = JSON.parse(line.slice(line.indexOf(channel) + channel.length).trim()) as Omit<typeof source[number], "phase">;
    const known = source[value.key];
    if (!known || known.lane !== value.lane || known.request !== value.request || known.state !== value.state || known.detail !== value.detail)
      throw new Error("Native log row is outside exact seeded evidence");
    return { seq: row.seq, key: value.key, lane: value.lane, request: value.request, state: value.state, detail: value.detail };
  }
  const publicRow = ({ key: _key, ...row }: NonNullable<ReturnType<typeof itemFromRow>>): EvidenceRow => row;
  const fold = (rows: NativeRow[]) => rows.flatMap(row => itemFromRow(row) ?? []);
  const hold = (continuity: Continuity): Join => ({ continuity, boot: initial.serverBootId, through: null, rows: [], duplicates: [] });

  await emitRows("backlog", "ready");
  const beforeWatch = await awaitBarrier("ready");
  const backlog = fold((await identity(channel, start, beforeWatch)).records);
  const saved = { boot: world.checkpoint === "old-boot" ? "retired-" + crypto.randomUUID() : initial.serverBootId,
    seq: world.checkpoint === "future" ? Number.MAX_SAFE_INTEGER : world.checkpoint === "after-first" ? backlog[0]?.seq ?? start : start };
  const assignment = { id: marker, goal: world.goal, subject: world.subject, ...target, saved,
    limit: world.limit, allowFresh: world.allowFresh, mayStage: world.mayStage };
  const directory = await ports.scratch.directory();
  const path = directory.replace(/\/$/u, "") + "/retained-log-follow.json";
  const effects: Effect[] = [];
  let claimed = false, pending = false;
  let proof: Capture | null = null, expectedJoin: Join | null = null, expectedDecision: Decision | null = null;
  let exactNativeChannels = false, receipt: Receipt | null = null;
  let staged = false;
  function save<T>(service: string, method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }

  async function nativeCapture() {
    const controller = new AbortController();
    const expiry = setTimeout(() => controller.abort(new Error("Owned log follower expired")), 12000);
    let iterator: ReturnType<typeof readEventWatchRecords> | undefined;
    const watched: ReturnType<typeof fold> = [];
    let epoch = "", opened = false, canceled = false, lastSeen: number | null = null;
    function recordBatch(rows: NativeRow[]) {
      for (const row of rows) {
        if (row.tag !== hostWorkerdLogTag || row.seq <= beforeWatch || !row.message.includes(marker)) continue;
        const projected = itemFromRow(row);
        if (projected) watched.push(projected);
        lastSeen = row.seq;
        if (watched.length > 24) throw new Error("Owned event stream exceeded bounded evidence");
      }
    }
    async function until(sequence: number) {
      for (let count = 0; count < 150 && lastSeen !== sequence; count++) {
        const next = await iterator!.next();
        if (next.done) break;
        const frame = next.value;
        if (frame.kind !== "event" || frame.event !== "server-log:append") continue;
        const { records } = frame.payload as { records?: NativeRow[] };
        if (Array.isArray(records)) recordBatch(records);
        if (lastSeen !== null && lastSeen > sequence) throw new Error("Owned stream passed a required witness");
      }
    }
    let catchupThrough = 0, witnessedThrough = 0, query: ReturnType<typeof fold> = [];
    let oldest: number | null = null;
    const scopedStart = saved.boot === initial.serverBootId ? saved.seq : start;
    try {
      iterator = readEventWatchRecords(await ports.watch(marker, controller.signal));
      const head = await iterator.next();
      if (head.done || head.value.kind !== "watching" || !head.value.events.includes("server-log:append") || !head.value.epoch)
        throw new Error("Native log watcher never acknowledged its scope");
      epoch = head.value.epoch;
      opened = true;
      await emitRows("overlap", "catchup");
      catchupThrough = await awaitBarrier("catchup");
      oldest = (await ports.stats()).oldestSeq;
      query = fold((await identity(channel, scopedStart, catchupThrough, world.limit + 1)).records);
      await until(catchupThrough);
      if (world.interrupted) {
        await iterator.return();
        controller.abort();
        canceled = true;
      }
      await emitRows("live", "final");
      witnessedThrough = await awaitBarrier("final");
      if (!world.interrupted) await until(witnessedThrough);
    } finally {
      clearTimeout(expiry);
      try { await iterator?.return(); }
      finally { controller.abort(); canceled = !!iterator; }
    }
    const all = fold((await identity(channel, start, witnessedThrough)).records);
    const recovered = all.filter(row => row.seq > scopedStart);
    const truthQuery = recovered.filter(row => row.seq <= catchupThrough).slice(-(world.limit + 1));
    const truthLive = all.filter(row => row.seq > beforeWatch && row.seq <= (world.interrupted ? catchupThrough : witnessedThrough));
    exactNativeChannels = all.length === source.length && new Set(all.map(row => row.key)).size === source.length &&
      isDeepStrictEqual(query, truthQuery) && isDeepStrictEqual(watched, truthLive) && opened && canceled &&
      lastSeen === (world.interrupted ? catchupThrough : witnessedThrough);
    const wanted = world.expected;
    const ready = ["continued", "fresh"].includes(wanted.continuity);
    const overlap = truthQuery.filter(row => truthLive.some(item => item.seq === row.seq)).map(row => row.seq);
    expectedJoin = ready ? { continuity: wanted.continuity, boot: initial.serverBootId, through: witnessedThrough,
      rows: recovered.map(publicRow), duplicates: overlap } : hold(wanted.continuity);
    const ownRows = ready ? recovered.filter(row => row.lane === target.lane && row.request === target.request) : [];
    const actualState = ownRows.findLast(row => row.state !== "cleanup")?.state ?? "unobserved";
    const changedBoot = saved.boot !== initial.serverBootId;
    const actualContinuity = changedBoot && !assignment.allowFresh ? "hold-boot" :
      !changedBoot && saved.seq > catchupThrough ? "hold-future" :
      !changedBoot && oldest !== null && saved.seq < oldest - 1 ? "hold-expired" :
      query.length > world.limit ? "hold-window" : lastSeen !== witnessedThrough ? "hold-stream" :
      changedBoot ? "fresh" : "continued";
    exactNativeChannels &&= wanted.state === actualState && wanted.continuity === actualContinuity &&
      wanted.stage === (assignment.mayStage && actualState === "committed");
    expectedDecision = { state: wanted.state, citations: ownRows.map(row => row.seq), stage: wanted.stage };
    return { boot: initial.serverBootId, workspace: initial.workspaceId, epoch, opened, canceled, start, oldest, catchupThrough,
      witnessedThrough, lastSeen, overflow: query.length > world.limit, query: query.map(publicRow), live: watched.map(publicRow) };
  }
  function payload(joined: Join, decision: Decision) {
    return JSON.stringify({ protocol: "vibestudio-log-follower.v1", assignment: assignment.id, subject: assignment.subject, joined, decision }, null, 2) + "\n";
  }
  const services = {
    logFollowerEvidence: {
      async discover() {
        if (claimed) return structuredClone(assignment);
        claimed = true;
        return save("logFollowerEvidence", "discover", [], assignment);
      },
      async observe(id: string) {
        if (id !== assignment.id || pending) throw new Error("Observe the exact assigned log stream once");
        if (proof) return structuredClone(proof);
        pending = true;
        try { proof = await nativeCapture(); return save("logFollowerEvidence", "observe", [id], proof); }
        finally { pending = false; }
      },
    },
    logFollowerHandoff: {
      async stage(id: string, joined: Join, decision: Decision) {
        if (!proof || !exactNativeChannels || id !== assignment.id || !assignment.mayStage || receipt || staged ||
          !decision.stage || !isDeepStrictEqual(joined, expectedJoin) || !isDeepStrictEqual(decision, expectedDecision))
          throw new Error("Only the approved complete exact log observation may be kept");
        staged = true;
        const text = payload(joined, decision);
        await ports.scratch.write(path, text);
        const bytes = await ports.scratch.read(path);
        if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== text) throw new Error("Owned log receipt changed on readback");
        receipt = { path, bytes: bytes.length, sha256: sha256HexSyncText(text) };
        return save("logFollowerHandoff", "stage", [id, joined, decision], receipt);
      },
    },
  };
  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["classifiedExactOwnedRequest"],"rootPath":["decision"],"producerSourceSuffix":"reviewLogFollower/classifyLogOperation.nl","producerPath":[]}];
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
    const report = value as {
      assignment?: unknown; capture?: unknown; joined?: unknown; decision?: unknown; receipt?: unknown;
    } | null;
    const outcome = report;
    const entries = await ports.scratch.entries(directory);
    const body = world.expected.stage && expectedJoin && expectedDecision ? payload(expectedJoin, expectedDecision) : null;
    const raw = entries.length === 1 && entries[0] === "retained-log-follow.json" ? await ports.scratch.read(path) : null;
    const exactReceipt = raw && body && new TextDecoder().decode(raw) === body ?
      { path, bytes: raw.length, sha256: sha256HexSyncText(body) } : null;
    const checks = {
      matchedLogFollowerAssignment: proof!==null,
      verifiedIndependentlyCapturedChannels: exactNativeChannels && !!proof,
      verifiedClosedBoundedWatch: !!proof?.opened && proof.canceled && !!proof.epoch && (proof.boot === assignment.saved.boot) ===
        (world.checkpoint !== "old-boot") && (world.interrupted ? proof.lastSeen === proof.catchupThrough : proof.lastSeen === proof.witnessedThrough),
      mergedExactBootAndRecordIdentity: expectedJoin!==null,
      classifiedExactOwnedRequest: isDeepStrictEqual(outcome?.decision, expectedDecision)&&isDeepStrictEqual(outcome?.receipt,exactReceipt),
      verifiedScopedLogFollowReceipt: (body ? exactReceipt !== null : entries.length === 0) &&
        isDeepStrictEqual(receipt, exactReceipt),
    };
    return {
      outcomeContract: {
        effects: {checks:["matchedLogFollowerAssignment", "verifiedIndependentlyCapturedChannels", "verifiedClosedBoundedWatch", "mergedExactBootAndRecordIdentity", "verifiedScopedLogFollowReceipt"],rationale:"The independent native observations, persisted artifacts and unchanged neighboring state establish these facts."},
        returnedValue: {checks:["classifiedExactOwnedRequest"],required:!world.expected.stage,rationale:"A requested read-only conclusion is application data; an extra result copy is optional after its native effect is established."},
        incidentalValues: {checks:[],rationale:"Known incorrect emitted values are masked using their actual invocation definition."},
      },
      incorrectReturnValues:[],
 passed: Object.values(checks).every(Boolean), caseId: world.id, contextId: input.contextId, goal: world.goal, checks,
      assignment, capture: proof, joined: expectedJoin, decision: expectedDecision, receipt: exactReceipt, effects: structuredClone(effects) };
  }
  async function qualify() {
    const discovered = await services.logFollowerEvidence.discover();
    async function rejects(work: Promise<unknown>) { try { await work; return false; } catch { return true; } }
    const rejectedForeignWatch = await rejects(services.logFollowerEvidence.observe("other-watch"));
    const capture = await services.logFollowerEvidence.observe(discovered.id);
    const joined = expectedJoin!, decision = expectedDecision!;
    const rejectedWrongWindow = await rejects(services.logFollowerHandoff.stage(discovered.id, { ...joined, boot: "foreign-boot" }, decision));
    const stagedReceipt = decision.stage ? await services.logFollowerHandoff.stage(discovered.id, joined, decision) : null;
    const report = {
      decision, receipt: stagedReceipt,
    };
    const proof = await verify(report);
    const rejectedWrongReport = !(await verify({ ...report, decision: { ...decision, state: "invented" } })).outcomeDimensions.returnedValue.passed;
    const checks = { ...proof.checks, rejectedForeignWatch, rejectedWrongWindow, rejectedWrongReport };
    return assessNativeQualification({ ...proof, outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedForeignWatch","rejectedWrongWindow","rejectedWrongReport"]}}, checks, passed: Object.values(checks).every(Boolean), report });
  }
  return { services, verify, qualify };
}
