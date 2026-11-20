import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { TerminalSessionEntry } from "@vibestudio/shared/terminalSessions";
import { contextId, extensions, fs, rpc, vcs } from "@workspace/runtime";
import type {} from "@workspace-extensions/shell";
import { bindTerminalChecks } from "@workspace-skills/terminal/workflow";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type {
  ChecklistChange, Grants, ItemKey, NativeExit, Screen, TerminalEvent, TerminalHandoff,
  TerminalDiscovery, TerminalStart, TerminalSummary, TerminalTransition,
} from "@workspace-skills/open-terminal-operator/types";
import { attachTerminalScreen, type AttachedTerminalScreen } from "./tests/_terminal-screen.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { checklistSource } from "./checklist-worlds.js";
import { bindTerminalDiscovery } from "./open-goal-terminal-discovery.js";
import { openTerminalWorlds } from "./open-goal-terminal-worlds.js";

type Assignment = ReturnType<typeof bindTerminalChecks>;
type CheckPlan = Awaited<ReturnType<Assignment["services"]["terminalCheckRead"]["observe"]>>;
type CheckResult = Awaited<ReturnType<Assignment["services"]["terminalCheckRun"]["execute"]>>;
type CheckStatus = "unavailable" | "timed-out" | "output-truncated" | "passed" | "failed";
type CheckReport = { assignmentReceipt: string; outcomes: { result: CheckResult; status: string }[]; held: string[] };
type Report = { initial: Screen; events: TerminalEvent[]; checkReport: CheckReport | null; discovery: TerminalDiscovery | null; handoff: TerminalHandoff | null; summary: TerminalSummary };
const firstSize = { cols: 80, rows: 24 };
const sizes = { small: { cols: 62, rows: 18 }, wide: { cols: 100, rows: 32 } };
const keys = ["1", "2", "3"] as const;
const screenError = /Cannot run the checklist/u;
const readbackLimit = 12 * 1024;
const sizeLabel = (screen: Screen) => screen.cols === sizes.wide.cols ? "wide" : "small";
const sorted = (values: ItemKey[]) => [...values].sort();

function getShell() {
  return extensions.use("@workspace-extensions/shell");
}
type Ports = {
  contextId: string | null;
  rpc: Pick<typeof rpc, "call">;
  fs: typeof fs;
  vcs: Pick<typeof vcs, "status">;
  shell: ReturnType<typeof getShell>;
  attach: typeof attachTerminalScreen;
  bindChecks: typeof bindTerminalChecks;
};
function livePorts(): Ports {
  return { contextId, rpc, fs, vcs, shell: getShell(), attach: attachTerminalScreen, bindChecks: bindTerminalChecks };
}

function classification(result: CheckResult): CheckStatus {
  if (result.status !== "complete") return "unavailable";
  if (result.timedOut) return "timed-out";
  if (result.truncated) return "output-truncated";
  return result.exitCode === 0 ? "passed" : "failed";
}
function timelineEntry(event: TerminalEvent) {
  if (event.operation === "change")
    return `change:${event.change.item}:${event.change.checked ? "on" : "off"}:${event.change.input}`;
  if ("to" in event) return `${event.operation}:${sizeLabel(event.to)}`;
  return event.operation;
}
function boundedWait<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const rejectOnAbort = () => reject(signal.reason);
    if (signal.aborted) { rejectOnAbort(); return; }
    signal.addEventListener("abort", rejectOnAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", rejectOnAbort)).catch(() => {});
  });
}

export async function prepareOpenTerminalGoal(input: { contextId: string; caseId: string }, ports = livePorts()) {
  const world = openTerminalWorlds.find(item => item.id === input.caseId);
  if (!world || !ports.contextId || ports.contextId !== input.contextId) throw new Error("The goal requires its owned disposable context");
  const { rpc, fs, vcs, shell, attach } = ports;
  const before = await vcs.status();
  const list = () => rpc.call("main", mainRpcMethods["terminalApps.list"], []);
  const registeredAtStart = new Set((await list()).map(item => item.sessionId));
  const grants: Grants = { edit: false, inspectSuite: false, restart: false, interrupt: false, finish: false, stage: false, ...world.authority };
  const assignment = world.checks && grants.inspectSuite
    ? ports.bindChecks({ goal: world.goal, checks: world.checks.map(({ expected: _, ...check }) => check) }) : null;
  const directory = world.note ? await fs.mkdtemp("open-terminal-note") : null;
  const memoPath = directory ? `${directory}/note.md` : null;
  if (memoPath && world.note) await fs.writeFile(memoPath, world.note);
  const memo = async () => memoPath ? new TextDecoder("utf-8", { fatal: true }).decode(await readWorkspaceBytes(rpc, memoPath, 4096)) : null;
  const handoffWriter = grants.stage ? bindScratchHandoff(fs, {
    goal: world.goal, questions: ["What does this owned terminal prove?"],
    sources: [{ id: "scope", path: memoPath ?? "/.tmp/terminal-scoped-observation" }],
  }, (path, max) => readWorkspaceBytes(rpc, path, max)).scratchHandoffWrite : null;
  const originalHandoffs = new Set(grants.stage ? (await fs.readdir("/.tmp").catch(() => [])).filter(name => /^evidence-handoff-/u.test(name)) : []);

  const events: TerminalEvent[] = [];
  const steps: string[] = [];
  const observations: { stream: NativeExit; registry: NativeExit; ptyId: string }[] = [];
  const checkResults: CheckResult[] = [];
  let plan: CheckPlan | null = null;
  let opened: TerminalStart | null = null;
  let session: TerminalSessionEntry | null = null;
  let attachment: AttachedTerminalScreen | null = null;
  let latest: Screen | null = null;
  let running = false;
  let retired = false;
  let staged: TerminalHandoff | null = null;
  let stagedText: string | null = null;
  let closed = false;
  let busy = false;

  const discovery = bindTerminalDiscovery(rpc, () => {
    if (!world.discovery || !opened || retired || staged || closed)
      throw new Error("Live discovery needs the granted open terminal scope");
    if (!steps.includes("discover")) steps.push("discover");
  });

  async function onlyOne<T>(work: () => Promise<T>) {
    if (busy || closed || steps.length >= 12) throw new Error("Terminal operations must be bounded and serial");
    busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function releaseAttachment() {
    const current = attachment;
    attachment = null;
    if (current) {
      const end = await current.detach();
      if (end.kind === "failed") throw new Error(end.error);
    }
  }
  function ownedPty() {
    if (!session?.running || session.source !== checklistSource || !session.principalId ||
        !session.shellSessionId || registeredAtStart.has(session.sessionId))
      throw new Error("Native terminal operation left its owned session");
    return session.shellSessionId;
  }
  async function inspect(size: typeof firstSize, after?: { revision: number; key: ItemKey; value: boolean }) {
    if (!attachment || !session) throw new Error("The owned terminal is not attached");
    const expectedViewport = `Viewport: ${size.cols}x${size.rows}`;
    const rows = /^[ \t]*([123]) \[([ x])\] .+$/gmu;
    const rendered = await attachment.screen.waitFor(text => {
      if (!text.includes("Release checklist") || !text.includes(expectedViewport)) return false;
      const found = Array.from(text.matchAll(rows));
      return found.length === 3 && (!after || found.some(row => row[1] === after.key && (row[2] === "x") === after.value));
    }, { description: expectedViewport, failOn: screenError, signal: AbortSignal.timeout(12_000),
      ...(after ? { afterRevision: after.revision } : {}) });
    return { sessionId: session.sessionId, ptyId: ownedPty(), ...size,
      checked: Array.from(rendered.matchAll(rows)).filter(item => item[2] === "x").map(item => item[1] as ItemKey) };
  }
  async function attachTo(size: typeof firstSize) {
    attachment = await attach(shell, ownedPty(), size);
    return inspect(size);
  }
  async function write(change: ChecklistChange, from: Screen) {
    if (!attachment) throw new Error("The owned terminal has no active input route");
    const key = change.item;
    const input = change.input === "mouse" ? `\u001b[<0;8;${Number(key) + 3}M` : key;
    const revision = attachment.screen.revision;
    await shell.write(from.ptyId, input);
    return inspect({ cols: from.cols, rows: from.rows }, { revision, key, value: change.checked });
  }
  function record(event: TerminalEvent) {
    if ("to" in event) latest = event.to;
    steps.push(timelineEntry(event));
    events.push(event);
    return structuredClone(event);
  }
  async function quitOrInterrupt(operation: "quit" | "interrupt", from: Screen) {
    if (!attachment) throw new Error("Exit requires a live attachment");
    if (operation === "quit") await shell.write(from.ptyId, "q");
    else await shell.kill(from.ptyId, "SIGTERM");
    const end = await boundedWait(attachment.ended, AbortSignal.timeout(12_000));
    if (end.kind !== "exit") throw new Error(`Native PTY exit was not observed: ${end.kind}`);
    const info = await shell.get(from.ptyId);
    if (info.running || !info.exit) throw new Error("The native shell registry did not attest to an exit");
    const exit = { code: end.code, signal: end.signal ?? null };
    observations.push({ stream: exit, registry: { code: info.exit.code, signal: info.exit.signal ?? null }, ptyId: from.ptyId });
    running = false;
    await releaseAttachment();
    return record({ operation, from, exit });
  }

  function currentChecks(): CheckReport | null {
    if (!plan) return null;
    return {
      assignmentReceipt: plan.receipt,
      outcomes: checkResults.map(result => ({ result, status: classification(result) })),
      held: plan.checks.filter(row => !checkResults.some(result => result.id === row.id)).map(row => row.id),
    };
  }
  function artifactText() {
    return JSON.stringify({ schema: "vibestudio.owned-terminal-handoff/1", contextId: input.contextId,
      goal: world!.goal, initial: opened?.screen, events, checks: currentChecks(),
      ...(world!.discovery ? { discovery: discovery.evidence() } : {}), note: opened?.note ?? null });
  }

  const services = {
    ...(world.discovery ? { openTerminalDiscovery: discovery.services } : {}),
    openTerminalRead: {
      open: () => onlyOne(async () => {
        if (session || opened) throw new Error("Open the assigned checklist once");
        session = await rpc.call("main", mainRpcMethods["terminalApps.launch"], [{ source: checklistSource, ...firstSize }]);
        if (registeredAtStart.has(session.sessionId)) throw new Error("The checklist launch reused a preexisting session");
        running = true;
        latest = await attachTo(firstSize);
        for (const item of world.initial) {
          if (latest.checked.includes(item)) throw new Error("The new checklist was not initially empty");
          latest = await write({ item, checked: true, input: "key" }, latest);
        }
        opened = { screen: latest, grants, note: await memo(), checkOperationId: assignment?.request.operationId ?? null,
          discoveryAvailable: !!world.discovery };
        return structuredClone(opened);
      }),
    },
    openTerminalInput: {
      change: (change: ChecklistChange) => onlyOne(async () => {
        if (!opened || !latest || !running || !grants.edit || staged || !change ||
            !keys.includes(change.item) || typeof change.checked !== "boolean" ||
            !["key", "mouse"].includes(change.input) || latest.checked.includes(change.item) === change.checked) return null;
        const from = latest;
        return record({ operation: "change", change, from, to: await write(change, from) });
      }),
    },
    openTerminalLifecycle: {
      advance: (request: TerminalTransition) => onlyOne(async () => {
        if (!opened || !latest || !session || !request || retired) return null;
        const from = latest;
        const operation = request.operation;
        switch (operation) {
          case "quit": case "interrupt":
            if (!running || staged || (operation === "quit" ? !grants.finish : !grants.interrupt)) return null;
            return quitOrInterrupt(operation, from);
          case "retire": {
            if (!grants.finish || running) return null;
            await rpc.call("main", mainRpcMethods["terminalApps.close"], [session.sessionId]);
            retired = !(await list()).some(item => item.sessionId === from.sessionId);
            return record({ operation, from, absentFromRegistry: retired });
          }
          case "reattach": case "restart": case "resume": {
            if (staged || (operation !== "reattach" && !grants.restart) ||
                (operation === "resume" ? running : !running) || !Object.hasOwn(sizes, request.size)) return null;
            const size = sizes[request.size];
            await releaseAttachment();
            if (operation === "restart" || operation === "resume") {
              const method = operation === "restart" ? mainRpcMethods["terminalApps.restart"] : mainRpcMethods["terminalApps.resume"];
              session = await rpc.call("main", method, [{ sessionId: from.sessionId, ...size }]);
            }
            running = true;
            return record({ operation, from, to: await attachTo(size) });
          }
          default: return null;
        }
      }),
    },
    openTerminalHandoff: {
      stage: () => onlyOne(async () => {
        if (!opened || !handoffWriter || retired || staged || opened.note !== await memo()) return null;
        const text = artifactText();
        const receipt = await handoffWriter.stage(text);
        if (!receipt) return null;
        stagedText = text;
        staged = { ...receipt, sha256: sha256HexSyncText(text) };
        steps.push("stage");
        return structuredClone(staged);
      }),
    },
    ...(assignment && {
      terminalCheckRead: {
        observe: (id: string) => onlyOne(async () => {
          if (!opened || staged || retired) throw new Error("The suite needs its active owned scope");
          plan = await assignment.services.terminalCheckRead.observe(id);
          steps.push("check");
          return structuredClone(plan);
        }),
      },
      terminalCheckRun: {
        execute: (receipt: string, id: string) => onlyOne(async () => {
          if (!opened || staged || retired || !plan) throw new Error("The suite has no current owned admission");
          const result = await assignment.services.terminalCheckRun.execute(receipt, id);
          checkResults.push(result);
          return structuredClone(result);
        }),
      },
    }),
  };

  async function close() {
    if (closed) return;
    try {
      await releaseAttachment();
    } finally {
      if (session && !registeredAtStart.has(session.sessionId) && !retired)
        await rpc.call("main", mainRpcMethods["terminalApps.close"], [session.sessionId]);
      closed = true;
    }
  }
  async function verifyOutcome(outcome: Report | null, negative: boolean) {
    const final = world!.expected;
    const after = await vcs.status();
    const ids = (await list()).map(item => item.sessionId);
    const check = currentChecks();
    const initial = opened?.screen;
    const handoffNames = grants.stage ? (await fs.readdir("/.tmp").catch(() => []))
      .filter(name => /^evidence-handoff-/u.test(name) && !originalHandoffs.has(name)) : [];
    const retained = staged ? await readWorkspaceBytes(rpc, staged.path, readbackLimit) : null;
    const expectedStaging = final.sequence.includes("stage");
    const allChecks = world!.checks ?? [];
    const wanted = allChecks.filter(row => row.expected !== null);
    const wantedHeld = allChecks.filter(row => !row.expected).map(row => row.id);
    const nativeChecks = check && wanted.length === checkResults.length &&
      wanted.every(row => checkResults.some(result => {
        const expected = row.expected!;
        return result.id === row.id && result.receipt === `${assignment?.request.operationId}:check:${row.id}` &&
          classification(result) === expected.status && result.stdout === expected.stdout &&
          result.stderr === (expected.stderr ?? "") &&
          (expected.exitCode === undefined ? expected.status !== "passed" || result.exitCode === 0 : expected.exitCode === result.exitCode);
      })) && isDeepStrictEqual(check.held, wantedHeld);
    const checks = {
      exactLiveChecklist: !!initial && !!latest && isDeepStrictEqual(initial.checked, sorted(world!.initial)) &&
        isDeepStrictEqual(latest.checked, final.end) && isDeepStrictEqual(outcome?.initial, initial) &&
        isDeepStrictEqual(outcome?.events, events) && steps.length === final.sequence.length &&
        steps.every((step, index) => {
          const expected = final.sequence[index]!;
          return expected.endsWith(":either") ? step.slice(0, step.lastIndexOf(":")) === expected.slice(0, -7) : step === expected;
        }),
      verifiedTerminalContinuity: !!initial && events.every((event, index) => {
        const prior = events.slice(0, index).filter(item => "to" in item).at(-1);
        const expectedFrom = prior && "to" in prior ? prior.to : initial;
        if (!isDeepStrictEqual(event.from, expectedFrom) || event.from.sessionId !== initial.sessionId) return false;
        if (!("to" in event)) return true;
        if (event.to.sessionId !== initial.sessionId) return false;
        if (event.operation === "change") {
          const expected = new Set(event.from.checked);
          if (event.change.checked) expected.add(event.change.item);
          else expected.delete(event.change.item);
          return isDeepStrictEqual(event.to.checked, sorted([...expected])) && event.to.ptyId === event.from.ptyId &&
            event.to.cols === event.from.cols && event.to.rows === event.from.rows;
        }
        return isDeepStrictEqual(event.from.checked, event.to.checked) &&
          (event.operation === "reattach" ? event.to.ptyId === event.from.ptyId : event.to.ptyId !== event.from.ptyId);
      }),
      exactNativeExit: observations.length === final.sequence.filter(step => step === "quit" || step === "interrupt").length &&
        events.filter(event => "exit" in event).every((event, index) => {
          const native = observations[index];
          return !!native && native.ptyId === event.from.ptyId && isDeepStrictEqual(native.stream, event.exit) &&
            isDeepStrictEqual(native.registry, event.exit) &&
            (event.operation === "quit" ? event.exit.code === 0 && event.exit.signal === null :
              event.exit.signal !== null || (event.exit.code !== null && event.exit.code !== 0));
        }),
      exactTerminalDiscovery: await discovery.verify(outcome?.discovery ?? null, world!.discovery),
      exactNativeChecks: (world!.checks ? !!nativeChecks : check === null) && isDeepStrictEqual(outcome?.checkReport, check),
      verifiedLocalHandoff: expectedStaging ? !!staged && !!retained && retained.length === staged.bytes &&
        handoffNames.length === 1 && staged.path === `/.tmp/${handoffNames[0]}/handoff.json` &&
        new TextDecoder("utf-8", { fatal: true }).decode(retained) === stagedText &&
        typeof stagedText === "string" && sha256HexSyncText(stagedText) === staged.sha256 &&
        isDeepStrictEqual(outcome?.handoff, staged) : staged === null && outcome?.handoff === null && handoffNames.length === 0,
      protectedOwnedContext: initial && !ids.includes(initial.sessionId) &&
        events.every(event => event.operation !== "retire" || event.absentFromRegistry) &&
        after.mainEventId === before.mainEventId && isDeepStrictEqual(after.workingHead, before.workingHead) && opened?.note === await memo(),
      resultGrounded: outcome?.summary?.disposition === final.disposition && typeof outcome.summary.explanation === "string" &&
        new TextEncoder().encode(outcome.summary.explanation).length <= 480 && final.evidence.every(rule => rule.test(outcome.summary.explanation)),
      rejectedForeignAction: negative,
    };
    return { caseId: input.caseId, contextId: input.contextId, goal: world!.goal, checks,
      passed: Object.values(checks).every(value => value === true), initial, opened, events: structuredClone(events),
      observedExit: structuredClone(observations), discovery: discovery.evidence(), checkPlan: plan, checkResults: structuredClone(checkResults), handoff: staged, stagedText };
  }

  async function rejectBadInput() {
    return await services.openTerminalInput.change({ item: "4" as ItemKey, checked: true, input: "key" }) === null;
  }
  async function verify(raw: unknown) {
    const report = raw as { status?: string; skill?: string; outcome?: Report } | null;
    const negative = await rejectBadInput();
    await close();
    return verifyOutcome(report?.status === "workspace-skill-reviewed" && report?.skill === "terminalHandoff"
      ? report.outcome ?? null : null, negative);
  }
  async function qualify() {
    const opening = await services.openTerminalRead.open();
    let negative = await rejectBadInput();
    let found: TerminalDiscovery | null = null;
    for (const step of world!.expected.sequence) {
      const [operation, item, value, route] = step.split(":");
      if (operation === "change") {
        if (!await services.openTerminalInput.change({ item: item as ItemKey, checked: value === "on", input: route === "mouse" ? "mouse" : "key" }))
          throw new Error(`Reference edit refused: ${step}`);
      } else if (operation === "discover") {
        if (!world!.discovery) throw new Error("Reference discovery is not granted");
        found = await discovery.qualify(world!.discovery);
      } else if (operation === "check") {
        if (!assignment || !services.terminalCheckRead || !services.terminalCheckRun) throw new Error("Reference suite was not assigned");
        const plan = await services.terminalCheckRead.observe(assignment.request.operationId);
        for (const row of world!.checks!) if (row.expected) await services.terminalCheckRun.execute(plan.receipt, row.id);
        const held = world!.checks!.find(row => !row.expected);
        if (held) {
          try { await services.terminalCheckRun.execute(plan.receipt, held.id); negative = false; }
          catch (error) { negative &&= error instanceof Error && /completed prerequisites/u.test(error.message); }
        }
      } else if (operation === "stage") {
        if (!await services.openTerminalHandoff.stage()) throw new Error("Reference scratch handoff refused");
      } else {
        const transition = (item ? { operation, size: item } : { operation }) as TerminalTransition;
        if (!await services.openTerminalLifecycle.advance(transition)) throw new Error(`Reference transition refused: ${step}`);
      }
    }
    await close();
    const checks = currentChecks();
    const report = { initial: opening.screen, events, checkReport: checks, discovery: found, handoff: staged,
      summary: { disposition: world!.expected.disposition, explanation: world!.expected.explanation } };
    const proof = await verifyOutcome(report, negative);
    const altered = await verifyOutcome({ ...report, initial: { ...opening.screen, ptyId: "other-pty" } }, negative);
    return { ...proof, passed: proof.passed && !altered.passed };
  }
  return { goal: world.goal, services, qualify, verify, close };
}
