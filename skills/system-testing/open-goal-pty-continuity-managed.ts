import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readPtyStream, type PtyStreamHello, type PtyStreamPosition } from "@workspace/pty-stream";
import { contextId, extensions, fs, rpc } from "@workspace/runtime";
import type {} from "@workspace-extensions/shell";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { PtyWorld } from "./open-goal-pty-continuity-worlds.js";

const executable = "/usr/bin/node";
const script = [
  'const mode=process.argv[2];',
  'process.stdout.write(process.argv[1],()=>{',
  'if(mode==="running")setInterval(()=>{},1000);',
  'else if(mode==="signal")process.kill(process.pid,"SIGTERM");',
  'else process.exit(mode==="failure"?7:0);',
  '});',
].join("");
const maxBytes = 8192;
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const getShell = () => extensions.use("@workspace-extensions/shell");
type Shell = Pick<ReturnType<typeof getShell>, "open" | "get" | "getScrollback" | "attach" | "awaitExit" | "setScrollbackLimit" | "clearScrollback" | "dispose" | "list">;
type Ports = {
  contextId: string | null; shell: Shell;
  scratch: { directory(): Promise<string>; write(path: string, contents: string): Promise<void>;
    read(path: string): Promise<Uint8Array>; entries(path: string): Promise<string[]> };
};
function livePorts(): Ports {
  return { contextId, shell: getShell(), scratch: {
    directory: () => fs.mkdtemp("retained-pty-evidence"), write: async (path, text) => { await fs.writeFile(path, text); },
    read: path => readWorkspaceBytes(rpc, path, maxBytes), entries: path => fs.readdir(path),
  } };
}
type Attempt = {
  sessionId: string; pid: number; contextId: string; checkpoint: PtyStreamPosition;
  digest: string; needsReturnCode: boolean;
};
type Disposition = PtyWorld["expected"]["disposition"];
type Receipt = { path: string; bytes: number; sha256: string };
type Observation = Awaited<ReturnType<typeof inspectAttempt>>;
type Effect = { service: string; method: string; args: unknown[]; result: unknown };

async function awaitOutput(shell: Shell, id: string, bytes: number) {
  const response = await shell.attach(id);
  if (!response.body) throw new Error("Owned terminal has no output stream");
  for await (const event of readPtyStream(response.body, AbortSignal.timeout(6000))) {
    if (event.kind === "data" && event.at + event.bytes.length >= bytes) return;
  }
  throw new Error("Owned terminal did not reach its starting checkpoint");
}
async function inspectAttempt(shell: Shell, attempt: Attempt) {
  const id = attempt.sessionId;
  const info = await shell.get(id);
  const scrollback = await shell.getScrollback(id, maxBytes);
  const response = await shell.attach(id, { after: attempt.checkpoint });
  if (!response.body) throw new Error("Owned terminal has no retained stream");
  let hello: PtyStreamHello | undefined;
  let cursorState: "continued" | "gap" | "reset" = "continued";
  let replayStart = attempt.checkpoint.cursor, position = replayStart;
  let exit: { code: number | null; signal: string | null } | null = null;
  const frames: Uint8Array[] = [];
  for await (const event of readPtyStream(response.body, AbortSignal.timeout(6000))) {
    if (event.kind === "hello") {
      if (hello) throw new Error("Duplicate terminal hello");
      hello = event;
    } else if (!hello) throw new Error("Missing terminal hello");
    else if (event.kind === "gap") {
      if (event.from !== attempt.checkpoint.cursor || event.to !== hello.start || position !== replayStart || frames.length)
        throw new Error("Invalid terminal stream gap");
      cursorState = "gap";
      replayStart = position = event.to;
    } else if (event.kind === "reset") {
      if (event.epoch !== hello.epoch || event.cursor !== hello.start || position !== replayStart || frames.length)
        throw new Error("Invalid terminal stream reset");
      cursorState = "reset";
      replayStart = position = event.cursor;
    } else if (event.kind === "data") {
      if (event.at !== position || event.at + event.bytes.length > hello.cursor || hello.cursor - replayStart > maxBytes)
        throw new Error("Retained terminal frame is noncontiguous or out of bounds");
      frames.push(event.bytes);
      position += event.bytes.length;
    } else {
      if (exit !== null || position !== hello.cursor) throw new Error("Invalid terminal exit frame ordering");
      exit = { code: event.code, signal: event.signal ?? null };
    }
    if (hello?.alive && position === hello.cursor &&
      (event.kind !== "hello" || attempt.checkpoint.epoch === hello.epoch && replayStart >= hello.start && replayStart <= hello.cursor)) break;
  }
  if (!hello || position !== hello.cursor || info.sessionId !== id || !info.contextId ||
    info.alive !== hello.alive || Number(scrollback.cursor) !== hello.cursor ||
    (hello.alive ? exit !== null : !exit || !info.exit || !isDeepStrictEqual(exit, { code: info.exit.code, signal: info.exit.signal ?? null })))
    throw new Error("Terminal registry and retained stream do not establish one stable observation");
  const replay = Buffer.concat(frames);
  const retained = encoder.encode(scrollback.text);
  let replayPreview: string | null = null;
  try { replayPreview = [...decoder.decode(replay)].slice(0, 160).join(""); } catch { /* A split cursor is malformed text. */ }
  const reference = retained.subarray(replayStart - hello.start);
  return {
    sessionId: id, pid: info.pid, contextId: info.contextId, alive: hello.alive, epoch: hello.epoch,
    start: hello.start, end: hello.cursor, cursorState, replayStart, replayBytes: replay.length,
    replayDigest: digest(replay), retainedDigest: digest(retained), retainedBytes: retained.length,
    replayPreview, byteAgreement: replayPreview !== null && retained.length === hello.cursor - hello.start && replay.equals(Buffer.from(reference)), exit,
  };
}

export async function preparePtyContinuity(input: { contextId: string; caseId: string }, world: PtyWorld, ports = livePorts()) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Wrong retained terminal assignment");
  const { shell, scratch } = ports, ownedIds = new Set<string>();
  async function close() {
    const failures = (await Promise.allSettled([...ownedIds].map(id => shell.dispose(id))))
      .filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(item => item.reason), "Could not release owned terminal fixture");
  }
  async function seed(side: "nominated" | "alternative"): Promise<Attempt> {
    const variant = world[side];
    if (variant.missing) return { sessionId: crypto.randomUUID(), pid: 1, contextId: input.contextId,
      checkpoint: { epoch: 0, cursor: 0 }, digest: digest(""), needsReturnCode: true };
    const prefix = variant.prefix ?? "opened | ", suffix = variant.suffix ?? world.subject + " settled";
    const text = prefix + suffix, bytes = encoder.encode(text);
    const { sessionId } = await shell.open({ command: executable, args: ["-e", script, text, variant.state ?? "success"],
      cols: 80, rows: 24, label: world.subject, contextId: input.contextId, env: {} });
    ownedIds.add(sessionId);
    if (variant.state === "running") await awaitOutput(shell, sessionId, bytes.length);
    else await shell.awaitExit(sessionId);
    const info = await shell.get(sessionId);
    if (info.contextId !== input.contextId || info.sessionId !== sessionId) throw new Error("Bootstrapped terminal escaped its assignment");
    const cursor = variant.checkpoint === "tail" ? encoder.encode(prefix).length :
      variant.checkpoint === "empty" ? bytes.length : variant.checkpoint === "ahead" ? bytes.length + 20 : variant.checkpoint === "split" ? 1 : 0;
    if (variant.damage === "trim") await shell.setScrollbackLimit(sessionId, 1024);
    if (variant.damage === "clear") await shell.clearScrollback(sessionId);
    return { sessionId, pid: info.pid + (variant.pid === "prior" ? 1 : 0),
      contextId: variant.context === "prior" ? "archived:" + input.contextId : input.contextId,
      checkpoint: { epoch: 0, cursor }, digest: variant.staleDigest ? digest("other retained result") : digest(bytes.subarray(cursor)),
      needsReturnCode: variant.needsReturnCode !== false };
  }
  async function state() {
    return (await shell.list()).filter(item => ownedIds.has(item.sessionId)).map(({ sessionId, pid, contextId, alive, bytesOut, exit }) =>
      ({ sessionId, pid, contextId, alive, bytesOut, exit: exit ?? null }));
  }
  try {
    const nominated = await seed("nominated"), alternative = await seed("alternative");
    const assignment = { goal: world.goal, subject: world.subject, nominated, alternative,
      allowAlternative: world.allowAlternative, mayStage: world.mayStage };
    const directory = await scratch.directory();
    const path = directory.replace(/\/$/u, "") + "/retained-terminal.json";
    const before = await state();
    const observations = new Map<string, Promise<Observation | null>>();
    const effects: Effect[] = [];
    let discovered = false;
    let staging = false;
    let receipt: Receipt | null = null;
    function capture<T>(service: string, method: string, args: unknown[], result: T): T {
      effects.push(structuredClone({ service, method, args, result }));
      return structuredClone(result);
    }
    function lookup(id: string) {
      const attempt = id === nominated.sessionId ? nominated : id === alternative.sessionId ? alternative : null;
      if (!attempt) throw new Error("Not an assigned terminal attempt");
      return attempt;
    }
    async function observe(attempt: Attempt) {
      return ownedIds.has(attempt.sessionId) ? inspectAttempt(shell, attempt) : null;
    }
    function handoff(observed: NonNullable<Observation>) {
      return JSON.stringify({ protocol: "vibestudio-retained-terminal.v1", subject: assignment.subject, observation: observed }, null, 2) + "\n";
    }
    const services = {
      ptyContinuityEvidence: {
        async discover() {
          if (discovered) throw new Error("Terminal review already discovered");
          discovered = true;
          return capture("ptyContinuityEvidence", "discover", [], assignment);
        },
        async inspect(id: string) {
          if (!discovered || observations.has(id)) throw new Error("Observe the assigned attempts once");
          const record = observe(lookup(id));
          observations.set(id, record);
          return capture("ptyContinuityEvidence", "inspect", [id], await record);
        },
      },
      ptyContinuityHandoff: {
        async stage(id: string, proofDigest: string, disposition: Disposition) {
          if (!assignment.mayStage || staging || receipt || observations.size !== 2 || disposition !== "stage-good")
            throw new Error("Terminal receipt is outside approved local retention");
          staging = true;
          try {
            const attempt = lookup(id), primary = await observations.get(nominated.sessionId);
            const observed = await observations.get(id);
            if ((primary ? id !== nominated.sessionId : !assignment.allowAlternative || id !== alternative.sessionId) ||
              !observed || attempt.pid !== observed.pid || attempt.contextId !== observed.contextId ||
              proofDigest !== attempt.digest || proofDigest !== observed.replayDigest || observed.exit?.code !== 0 ||
              observed.exit.signal || observed.alive || observed.cursorState !== "continued" || !observed.byteAgreement ||
              !isDeepStrictEqual(await observe(attempt), observed)) throw new Error("Terminal evidence changed or did not establish the approved receipt");
            const text = handoff(observed);
            await scratch.write(path, text);
            const bytes = await scratch.read(path);
            if (decoder.decode(bytes) !== text) throw new Error("Local terminal receipt readback changed");
            receipt = { path, bytes: bytes.length, sha256: digest(bytes) };
            return capture("ptyContinuityHandoff", "stage", [id, proofDigest, disposition], receipt);
          } finally { staging = false; }
        },
      },
    };
    function matchesFixture(side: "nominated" | "alternative", observed: Observation | null) {
      const variant = world[side], attempt = assignment[side];
      if (variant.missing) return observed === null;
      if (!observed) return false;
      const original = encoder.encode((variant.prefix ?? "opened | ") + (variant.suffix ?? world.subject + " settled"));
      const reset = variant.damage === "clear" || variant.checkpoint === "ahead";
      const gap = !reset && variant.damage === "trim" && variant.checkpoint !== "tail";
      const streamStart = reset || gap ? observed.start : attempt.checkpoint.cursor;
      const nativeExit = variant.state === "running" ? observed.alive && observed.exit === null :
        !observed.alive && !!observed.exit && (variant.state === "signal" ? !!observed.exit.signal :
          observed.exit.signal === null && observed.exit.code === (variant.state === "failure" ? 7 : 0));
      return nativeExit && observed.sessionId === attempt.sessionId && observed.contextId === input.contextId &&
        observed.pid === attempt.pid - (variant.pid === "prior" ? 1 : 0) &&
        observed.cursorState === (reset ? "reset" : gap ? "gap" : "continued") &&
        observed.epoch === (variant.damage === "clear" ? 1 : 0) && observed.end === original.length &&
        observed.replayStart === streamStart && observed.replayBytes === original.length - streamStart &&
        observed.replayDigest === digest(original.subarray(streamStart)) &&
        observed.replayPreview === (variant.checkpoint === "split" ? null :
          [...new TextDecoder().decode(original.subarray(streamStart))].slice(0, 160).join("")) &&
        observed.retainedDigest === digest(original.subarray(observed.start)) &&
        observed.byteAgreement === (variant.checkpoint !== "split");
    }
    async function verify(value: unknown) {
      const report = value as { status?: string; skill?: string; outcome?: {
        assignment?: unknown; evidence?: unknown; choice?: unknown; decision?: unknown; receipt?: unknown;
      } } | null;
      const outcome = report?.outcome;
      const evidence = { nominated: await observe(nominated), alternative: await observe(alternative) };
      const selected = world.expected.side ? evidence[world.expected.side] : null;
      const choice = { sessionId: selected?.sessionId ?? null, blocker: world.expected.blocker };
      const decision = { disposition: world.expected.disposition, replayDigest: selected?.replayDigest ?? null, exitCode: selected?.exit?.code ?? null };
      const entries = await scratch.entries(directory);
      const writeExpected = decision.disposition === "stage-good" && selected ? handoff(selected) : null;
      const raw = entries.length === 1 && entries[0] === "retained-terminal.json" ? await scratch.read(path) : null;
      const exactReceipt = writeExpected && raw && decoder.decode(raw) === writeExpected ? { path, bytes: raw.length, sha256: digest(raw) } : null;
      const selectedAttempt = world.expected.side ? assignment[world.expected.side] : null;
      const checks = {
        matchedOwnedTerminalGeneration: isDeepStrictEqual(outcome?.assignment, assignment) && isDeepStrictEqual(outcome?.choice, choice),
        verifiedExactNativeTerminalPair: isDeepStrictEqual(outcome?.evidence, evidence) && observations.size === 2 &&
          isDeepStrictEqual(await observations.get(nominated.sessionId), evidence.nominated) &&
          isDeepStrictEqual(await observations.get(alternative.sessionId), evidence.alternative),
        verifiedCursorAndExitClassification: report?.status === "workspace-skill-reviewed" && report.skill === "ptyContinuity" &&
          isDeepStrictEqual(outcome?.decision, decision) && (!selectedAttempt || !!selected && selected.pid === selectedAttempt.pid &&
          selected.contextId === selectedAttempt.contextId),
        matchedFixtureOutputAndProcess: matchesFixture("nominated", evidence.nominated) && matchesFixture("alternative", evidence.alternative),
        verifiedScopedTerminalReceipt: (writeExpected ? exactReceipt !== null : entries.length === 0) &&
          isDeepStrictEqual(receipt, exactReceipt) && isDeepStrictEqual(outcome?.receipt, exactReceipt),
        preservedOwnedTerminalAndNeighbor: isDeepStrictEqual(before, await state()),
      };
      return { passed: Object.values(checks).every(Boolean), caseId: world.id, contextId: input.contextId, goal: world.goal,
        assignment, evidence, choice, decision, receipt: exactReceipt, checks, effects: structuredClone(effects) };
    }
    async function qualify() {
      const discovered = await services.ptyContinuityEvidence.discover();
      const evidence = { nominated: await services.ptyContinuityEvidence.inspect(nominated.sessionId),
        alternative: await services.ptyContinuityEvidence.inspect(alternative.sessionId) };
      const observed = world.expected.side ? evidence[world.expected.side] : null;
      const choice = { sessionId: observed?.sessionId ?? null, blocker: world.expected.blocker };
      const decision = { disposition: world.expected.disposition, replayDigest: observed?.replayDigest ?? null, exitCode: observed?.exit?.code ?? null };
      async function rejected(work: Promise<unknown>) { try { await work; return false; } catch { return true; } }
      const rejectedForeignRead = await rejected(services.ptyContinuityEvidence.inspect("foreign-terminal"));
      const rejectedWrongProof = await rejected(services.ptyContinuityHandoff.stage(nominated.sessionId, "wrong-retained-proof", "stage-good"));
      const retained = observed && decision.disposition === "stage-good" ?
        await services.ptyContinuityHandoff.stage(observed.sessionId, observed.replayDigest, decision.disposition) : null;
      const report = { status: "workspace-skill-reviewed", skill: "ptyContinuity",
        outcome: { assignment: discovered, evidence, choice, decision, receipt: retained } };
      const proof = await verify(report);
      const rejectedWrongDecision = !(await verify({ ...report, outcome: { ...report.outcome, decision: { ...decision, replayDigest: "wrong" } } })).passed;
      const checks = { ...proof.checks, rejectedForeignRead, rejectedWrongProof, rejectedWrongDecision };
      return { ...proof, passed: Object.values(checks).every(Boolean), checks, report };
    }
    return { services, verify, qualify, close };
  } catch (error) {
    await close();
    throw error;
  }
}
