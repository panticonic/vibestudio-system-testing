import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { createEvalExecutor, evalResultReceiptSchema, type EvalResultReceipt, type EvalStartInput } from "@vibestudio/service-schemas/eval";
import { createMainRpcCaller, mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc } from "@workspace/runtime";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { SmokeWorld } from "./open-goal-workspace-smoke-worlds.js";

const packageName = "@workspace/omnibox-core";
const actions = {
  inline: "parseInlineCommand", session: "reduceArgSession", suggestions: "buildCommandSuggestions",
  completion: "completeWebAddress", launcher: "parseLauncherInput",
} as const;
const missingExport = "legacySmokeRunner";
const limit = 16384;
const hash = sha256HexSyncText;
const decoder = new TextDecoder("utf-8", { fatal: true });
type Matches = { matches: { file: string; line: string; lineNumber: number }[]; matchCount: number; truncated: boolean };
type Ports = { contextId: string | null;
  dir(prefix: string): Promise<string>;
  grep(path: string, token: string): Promise<Matches>;
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  entries(path: string): Promise<string[]>;
  run(scopeKey: string, runId: string, code: string): Promise<EvalResultReceipt>;
  retained(scopeKey: string, runId: string): Promise<EvalResultReceipt | null>;
  dispose(scopeKey: string): Promise<unknown>;
};
function livePorts(): Ports {
  const call = createMainRpcCaller(rpc), execute = createEvalExecutor(call);
  async function retained(scopeKey: string, runId: string) {
    const route = { scopeKey, runId };
    const native = await call("eval.receipt", [route]);
    if (!native) return null;
    const parsed = evalResultReceiptSchema.parse(native);
    const state = await call("eval.get", [route]);
    if (parsed.runId !== runId || state.status !== "done" || !isDeepStrictEqual(state.result, parsed.result))
      throw new Error("Smoke result has a mismatched EvalDO receipt");
    return parsed;
  }
  return {
    contextId, dir: prefix => fs.mkdtemp(prefix),
    grep: (path, token) => rpc.call("main", mainRpcMethods["fs.grep"], [token, { path, glob: "*.json", maxMatches: 16 }]),
    write: async (path, text) => { await fs.writeFile(path, text); },
    read: path => readWorkspaceBytes(rpc, path, limit),
    entries: path => fs.readdir(path),
    async run(scopeKey, runId, code) {
      const request: EvalStartInput = { scope: { key: scopeKey, lifecycle: "finite" }, runId,
        source: { kind: "inline", syntax: "typescript", code } };
      const result = await execute(request), exact = await retained(scopeKey, runId);
      if (!exact || !isDeepStrictEqual(result, exact.result)) throw new Error("Runtime smoke lacks exact result attestation");
      return exact;
    },
    retained, dispose: scopeKey => call("eval.dispose", [{ scopeKey }]),
  };
}
type SourceDoc = { marker: string; context: string; revision: string; subject: string;
  exportName: string; probe: SmokeWorld["probe"]; input: SmokeWorld["input"]; accepted: unknown };
type Plan = Omit<SourceDoc, "marker"> & { path: string; digest: string };
type Source = { matches: number; truncated: boolean; plans: Plan[] };
type Runtime = { packageName: string; exportName: string; callable: boolean; value: unknown; runDigest: string };
type Receipt = { path: string; bytes: number; sha256: string };

function nativeProbe(plan: Plan) {
  return [
    'import * as lib from "@workspace/omnibox-core";',
    `const data=${JSON.stringify(plan.input)};`,
    `const exportName=${JSON.stringify(plan.exportName)};`,
    'const fn=lib[exportName];',
    'if(typeof fn!=="function")return {exportName,callable:false,value:null};',
    'const ctx={platform:"desktop",openPanels:{entries:[]}};',
    'const commands=(data.commands??[]).map(({visibility,...spec})=>({...spec,section:"Workspace",surfaces:["desktop"],',
    '  availability:()=>visibility==="hidden"?"hidden":visibility==="disabled"?false:true}));',
    'let value;',
    `switch(${JSON.stringify(plan.probe)}) {`,
    ' case "inline": { const p=fn(data.query,commands,ctx); value=p?{id:p.command.id,head:p.head,filled:p.filled,residual:p.residual,complete:p.complete}:null; break; }',
    ' case "session": { let p=lib.startArgSession(commands[0],{prefilled:data.seed,seedQuery:data.seedQuery,restoreQuery:data.query});',
    '  for(const action of data.actions??[]){if(p.kind!=="session")break; p=fn(p.session,action);}',
    '  value=p.kind==="session"?{kind:p.kind,at:lib.activeArgSpec(p.session)?.name,filled:p.session.filled,query:p.session.query,error:p.session.error}:',
    '   p.kind==="execute"?{kind:p.kind,filled:p.args}:{kind:p.kind,restoreQuery:p.restoreQuery}; break; }',
    ' case "suggestions": value=fn({query:data.query,commands,ctx,limit:data.limit}).map(r=>({id:r.command.id,disabled:r.disabled===true})); break;',
    ' case "completion": value=fn(data.query,data.url); break;',
    ' case "launcher": value=fn(data.query); break;',
    ' default: throw new Error("Unknown authored smoke probe");',
    '}',
    'return {exportName,callable:true,value};',
  ].join("\n");
}

export async function prepareWorkspaceSmoke(input: { contextId: string; caseId: string }, world: SmokeWorld, ports = livePorts()) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Workspace smoke scope does not match");
  const marker = "workspace-smoke-" + crypto.randomUUID(), revision = "approved-" + crypto.randomUUID();
  const assignment = { id: crypto.randomUUID(), context: input.contextId, revision, goal: world.goal,
    subject: world.subject, mayStage: world.mayStage };
  const sourceDirectory = (await ports.dir("workspace-smoke-source")).replace(/\/$/u, "");
  const outputDirectory = (await ports.dir("workspace-smoke-evidence")).replace(/\/$/u, "");
  const output = outputDirectory + "/runtime-smoke.json";
  const scopeKey = marker + "-eval", runId = marker + "-outcome";
  const records: Record<string, string> = {};
  const owned: SourceDoc = { marker, context: assignment.context, revision, subject: world.subject,
    exportName: world.unavailableExport ? missingExport : actions[world.probe], probe: world.probe, input: world.input, accepted: world.accepted };
  function define(name: string, doc: SourceDoc | { unrelated: string }) {
    records[sourceDirectory + "/" + name + ".json"] = JSON.stringify(doc, null, 2) + "\n";
  }
  define("neighbor", { ...owned, context: "another-context" });
  define("archive", { ...owned, revision: "archive-" + revision });
  define("unrelated", { unrelated: "Different local verification suite" });
  if (world.source === "unique" || world.source === "ambiguous") define("accepted", owned);
  if (world.source === "ambiguous") define("peer-accepted", { ...owned, accepted: { alternative: true } });
  if (world.source === "missing") define("new-revision-other-feature", { ...owned, subject: "Different scope" });
  await Promise.all(Object.entries(records).map(([path, text]) => ports.write(path, text)));
  const effects: { service: string; method: string; args: unknown[]; result: unknown }[] = [];
  let discovered = false, inFlight = false, opened = false, closed = false;
  let source: Source | null = null, runtime: Runtime | null = null, native: EvalResultReceipt | null = null, receipt: Receipt | null = null;
  function capture<T>(service: string, method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }
  async function observe() {
    const found = await ports.grep(sourceDirectory, marker);
    const plans: Plan[] = [];
    const paths = [...new Set(found.matches.map(row => row.file))].sort();
    for (const path of paths) {
      if (!path.startsWith(sourceDirectory + "/") || !(path in records)) throw new Error("Unowned native smoke file");
      const text = decoder.decode(await ports.read(path));
      const { marker: foundMarker, ...doc } = JSON.parse(text) as SourceDoc;
      if (foundMarker !== marker) throw new Error("Native content search and file read disagree");
      plans.push({ ...doc, path, digest: hash(text) });
    }
    if (found.matches.length !== found.matchCount ||
      found.matches.some(row => row.lineNumber !== 2 || !row.line.includes(marker))) throw new Error("Native smoke search did not retain exact source coordinates");
    return { matches: found.matchCount, truncated: found.truncated, plans };
  }
  function current(view: Source | null) {
    return (view?.plans ?? []).filter(plan => plan.context === assignment.context && plan.revision === assignment.revision && plan.subject === assignment.subject);
  }
  function dossier(plan: Plan, runtime: Runtime) {
    return JSON.stringify({ protocol: "vibestudio-workspace-smoke.v1", subject: assignment.subject, revision, planDigest: plan.digest, runtime }, null, 2) + "\n";
  }
  const services = {
    workspaceSmokeEvidence: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return capture("workspaceSmokeEvidence", "discover", [], assignment);
      },
      async scan(id: string) {
        if (id !== assignment.id || inFlight) throw new Error("Search only the assigned owned smoke directory");
        if (source) return structuredClone(source);
        inFlight = true;
        try { source = await observe(); return capture("workspaceSmokeEvidence", "scan", [id], source); }
        finally { inFlight = false; }
      },
    },
    workspaceSmokeRuntime: {
      async run(id: string, path: string, digest: string) {
        const candidates = current(source), plan = candidates[0];
        if (id !== assignment.id || !source || source.truncated || inFlight || opened || candidates.length !== 1 || plan.path !== path ||
          plan.digest !== digest || (plan.exportName !== actions[plan.probe] && plan.exportName !== missingExport))
          throw new Error("Only one exact approved smoke plan may enter the native evaluator");
        inFlight = true; opened = true;
        try {
          if (hash(decoder.decode(await ports.read(path))) !== digest) throw new Error("Smoke contract changed before native execution");
          native = await ports.run(scopeKey, runId, nativeProbe(plan));
          const value = native.result.returnValue as Omit<Runtime,"packageName"|"runDigest"> | null;
          if (!native.result.success || !value || value.exportName !== plan.exportName || typeof value.callable !== "boolean")
            throw new Error("Installed smoke execution failed: " + (native.result.error?.message ?? value?.exportName ?? "no result"));
          runtime = { packageName, ...value, runDigest: native.runDigest };
          return capture("workspaceSmokeRuntime", "run", [id, path, digest], runtime);
        } finally { inFlight = false; }
      },
    },
    workspaceSmokeHandoff: {
      async stage(id: string, path: string, runDigest: string) {
        const [plan] = current(source);
        if (!plan || !runtime?.callable || id !== assignment.id || path !== plan.path || runDigest !== runtime.runDigest ||
          !assignment.mayStage || !isDeepStrictEqual(runtime.value, plan.accepted) || receipt || inFlight)
          throw new Error("Stage only approved successful exact installed smoke evidence");
        inFlight = true;
        try {
          const text = dossier(plan, runtime);
          await ports.write(output, text);
          const bytes = await ports.read(output);
          if (decoder.decode(bytes) !== text) throw new Error("Exact smoke receipt readback changed");
          receipt = { path: output, bytes: bytes.length, sha256: hash(text) };
          return capture("workspaceSmokeHandoff", "stage", [id, path, runDigest], receipt);
        } finally { inFlight = false; }
      },
    },
  };

  async function verify(value: unknown, invocation?: InvocationObservations) {
    const report = value as {
      assignment?: unknown; source?: unknown; selection?: unknown; runtime?: unknown; decision?: unknown; receipt?: unknown;
    } | null;
    const outcome = report, reread = await observe(), candidates = current(reread);
    const plan = candidates.length === 1 ? candidates[0] : null;
    const blocker = plan ? null : candidates.length > 1 ? "hold-ambiguity" : "hold-source";
    const selection = { plan, blocker };
    const decision = { disposition: world.expected, mayRetain: world.expected === "accepted" && assignment.mayStage };
    const entries = await ports.entries(outputDirectory);
    const data = entries.length === 1 && entries[0] === "runtime-smoke.json" ? await ports.read(output) : null;
    const exactText = decision.mayRetain && plan && runtime ? dossier(plan,runtime) : null;
    const expectedReceipt = data && exactText && decoder.decode(data) === exactText ? { path: output, bytes: data.length, sha256: hash(exactText) } : null;
    const original = await Promise.all(Object.entries(records).map(async ([path, text]) => decoder.decode(await ports.read(path)) === text));
    const exactPaths = Object.entries(records).filter(([,body]) => body.includes(marker)).map(([path]) => path).sort();
    const checks = {
      matchedExactSmokeAssignment: source!==null,
      verifiedNativeSearchAndSource: !reread.truncated && isDeepStrictEqual(source, reread) &&
        isDeepStrictEqual(reread.plans.map(plan => plan.path), exactPaths),
      selectedApprovedSmokeContract: !plan||plan.digest===source?.plans.find(row=>row.path===plan.path)?.digest,
      verifiedInstalledExportAndRuntime: (plan ?
        runtime?.packageName === packageName && runtime.exportName === plan.exportName && runtime.callable === !world.unavailableExport &&
        isDeepStrictEqual(runtime.value, world.unavailableExport ? null : world.runtime) &&
        isDeepStrictEqual(native, await ports.retained(scopeKey, runId)) : runtime === null && !opened),
      returnedSmokeResolution: isDeepStrictEqual(outcome?.decision,decision)&&isDeepStrictEqual(outcome?.receipt,expectedReceipt),
      matchedExactSmokeOutcome: (runtime?.callable ?
          (isDeepStrictEqual(runtime.value, plan?.accepted) ? "accepted" : "regression") === world.expected : true),
      verifiedPrivateSmokeReceipt: (exactText ? expectedReceipt !== null : entries.length === 0) &&
        isDeepStrictEqual(receipt, expectedReceipt) && original.every(Boolean),
    };
    return {
      outcomeContract: {
        effects: {checks:["matchedExactSmokeAssignment", "verifiedNativeSearchAndSource", "selectedApprovedSmokeContract", "verifiedInstalledExportAndRuntime", "matchedExactSmokeOutcome", "verifiedPrivateSmokeReceipt"],rationale:"The independent native observations, persisted artifacts and unchanged neighboring state establish these facts."},
        returnedValue: {checks:["returnedSmokeResolution"],required:!exactText,rationale:"A requested read-only conclusion is application data; an extra result copy is optional after its native effect is established."},
        incidentalValues: {checks:[],rationale:"Known incorrect emitted values are masked using their actual invocation definition."},
      },
      incorrectReturnValues: value!==undefined&&!(checks.returnedSmokeResolution) ? [{required:!exactText,
        definition:invocation?.calls.find(call=>call.parentCallId===null)?.definition??{name:"reviewWorkspaceSmoke",source:"reviewWorkspaceSmoke.nl"},value}] : [],
 passed: Object.values(checks).every(Boolean), caseId: world.id, contextId: input.contextId, goal: world.goal, checks,
      assignment, source: reread, selection, runtime, decision, receipt: expectedReceipt, effects: structuredClone(effects) };
  }
  async function qualify() {
    const discovered = await services.workspaceSmokeEvidence.discover();
    const source = await services.workspaceSmokeEvidence.scan(discovered.id);
    const candidates = current(source), plan = candidates.length === 1 ? candidates[0] : null;
    const selection = { plan, blocker: plan ? null : candidates.length > 1 ? "hold-ambiguity" : "hold-source" };
    async function rejected(work: Promise<unknown>) { try { await work; return false; } catch { return true; } }
    const rejectedWrongDigest = await rejected(services.workspaceSmokeRuntime.run(discovered.id, plan?.path ?? "unowned", "old-digest"));
    const runtime = plan ? await services.workspaceSmokeRuntime.run(discovered.id, plan.path, plan.digest) : null;
    const decision = { disposition: world.expected, mayRetain: world.expected === "accepted" && assignment.mayStage };
    const rejectedWrongRuntime = await rejected(services.workspaceSmokeHandoff.stage(discovered.id, plan?.path ?? "unowned", "old-build"));
    const receipt = decision.mayRetain && plan && runtime ? await services.workspaceSmokeHandoff.stage(discovered.id,plan.path,runtime.runDigest) : null;
    const report = { decision, receipt };
    const proof = await verify(report);
    const rejectedWrongSource = !(await verify({ ...report, decision: { ...decision, disposition: "invented" } })).passed;
    const checks = { ...proof.checks, rejectedWrongDigest, rejectedWrongRuntime, rejectedWrongSource };
    return { ...proof, outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedWrongDigest","rejectedWrongRuntime","rejectedWrongSource"]}}, passed: Object.values(checks).every(Boolean), checks, report };
  }
  async function close() { if (opened && !closed) { await ports.dispose(scopeKey); closed = true; } }
  return { services, qualify, verify, close };
}
