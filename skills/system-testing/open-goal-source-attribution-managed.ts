import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
import {groundedSourceConclusion,groundedSourceEvidence} from "./source-attribution-grounding.js";
const assessObservedApplicationOutcome=bindObservedContentReview(["assignment","files","evidence","effects","native"],["receipt","retainedText"]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import {exactReceiptReplay} from "./exact-receipt-replay.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { VcsBlameSpan, VcsSemanticNodeRef, VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";
import { blobstore, contextId, fs, rpc, vcs, type VcsClient } from "@workspace/runtime";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { SourceAttributionWorld } from "./open-goal-source-attribution-worlds.js";

type TraceSpan = { id: string; start: number; end: number; boundary: VcsBlameSpan["stop"];
  intentTier: "stated" | "trigger" | "mechanical" | null; paths: string[]; work: string | null; command: string; externalSource: string | null };
type Root = { ref: string; kind: string; label: string; intent: string | null; tier: string | null; externalSource: string | null };
type Selection = { candidate: string; fragment: string };
type Claim = { fragment: string; span: string; origin: "external" | "native" | "unresolved"; intent: string | null; refs: string[] };
type Conclusion = { disposition: SourceAttributionWorld["complete"]; claims: Claim[] };
type Receipt = { state: string; status: "retained" | "authority-closed" | "stale"; path: string | null; sha256: string | null };
type Ports = { contextId: string | null;
  vcs: Pick<VcsClient, "status" | "mainState" | "importSnapshot" | "edit" | "copy" | "move" | "commit" | "resolveRepository" | "readFile" | "blame" | "inspect">;
  upload: (text: string) => Promise<string>;
  dir: (prefix: string) => Promise<string>;
  entries: (path: string) => Promise<string[]>;
  write: (path: string, text: string) => Promise<void>;
  read: (path: string) => Promise<Uint8Array>;
};
const maxBytes = 16_384;
const hash = sha256HexSyncText;
const scopeFile = "review-window.json";
const stateKey = (state: VcsStateNodeRef) => JSON.stringify(state);
function livePorts(): Ports {
  return { contextId, vcs, upload: async text => (await blobstore.putText(text)).digest,
    dir: prefix => fs.mkdtemp(prefix), entries: path => fs.readdir(path),
    write: async (path, text) => { await fs.writeFile(path, text); },
    read: path => readWorkspaceBytes(rpc, path, maxBytes) };
}

/** Seed only the disposable receiver's local source from a generated snapshot before the policy executes. */
export async function prepareSourceAttribution(input: { contextId: string; caseId: string }, world: SourceAttributionWorld, ports = livePorts()) {
  const context = input.contextId;
  if (input.caseId !== world.id || ports.contextId !== context) throw new Error("Source attribution requires its owned context");
  const owner = ports.vcs;
  const status = () => owner.status({ contextId: context });
  const initial = await status(), mainBefore = await owner.mainState();
  if (!initial.clean) throw new Error("Source attribution requires a clean context");
  const repoPath = "projects/source-attribution-" + crypto.randomUUID();
  const source = { kind: "generated" as const, uri: `system-test://${world.id}/${repoPath}`,
    snapshotRevision: `fixture:${hash(JSON.stringify(world.files))}` };
  const importFiles = await Promise.all([...world.files, { path: scopeFile, text: JSON.stringify({ open: world.gates !== "closed" }) + "\n" }]
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(async ({ path, text }) => ({ path, mode: 0o644, contentHash: await ports.upload(text) })));
  const imported = await owner.importSnapshot({ contextId: context, commandId: crypto.randomUUID(), expectedWorkingHead: initial.workingHead,
    source, repositories: [{ repoPath, files: importFiles }], message: "Admit owned source for provenance review" });
  const repositoryId = imported.importedRepositoryIds[0];
  if (!repositoryId || imported.importedRepositoryIds.length !== 1) throw new Error("Native source import did not return the owned repository");
  let working: VcsStateNodeRef = { kind: "event", eventId: imported.eventId };
  const importedState = working;
  const latestText = new Map(world.files.map(({ path, text }) => [path, text]));
  const authoredChanges: string[] = [];
  const readFile = (state: VcsStateNodeRef, path: string) => owner.readFile({ state, repositoryId, file: { kind: "path", path } });
  const requireOwnedText = async (state: VcsStateNodeRef, path: string) => {
    const bytes = await readFile(state, path);
    if (!bytes || bytes.repositoryId !== repositoryId || bytes.path !== path || bytes.content.kind !== "text" ||
        Buffer.byteLength(bytes.content.text) > maxBytes) throw new Error("Source file is outside the controlled current text bounds");
    return { fileId: bytes.fileId, text: bytes.content.text };
  };
  for (const action of world.actions) {
    const current = await requireOwnedText(working, action.path);
    const base = { contextId: context, commandId: crypto.randomUUID(), expectedWorkingHead: working };
    if (action.kind === "edit") {
      const index = current.text.indexOf(action.before);
      if (index < 0 || current.text.indexOf(action.before, index + action.before.length) >= 0) throw new Error("Fixture edit is ambiguous");
      const change = await owner.edit({ ...base,
        ...(action.intent ? { intentSummary: action.intent } : {}), changes: [{ kind: "text-edit", repositoryId, fileId: current.fileId,
          edits: [{ start: index, end: index + action.before.length, text: action.after }] }] });
      if (!change.changeIds.length) throw new Error("Native edit did not retain a distinct source event");
      authoredChanges.push(...change.changeIds);
      working = change.workingHead;
      latestText.set(action.path, current.text.slice(0, index) + action.after + current.text.slice(index + action.before.length));
      continue;
    }
    const result = action.kind === "copy" ? await owner.copy({ ...base, copies: [{
      source: { state: working, repositoryId, fileId: current.fileId }, destination: { repositoryId, path: action.destination } }] }) :
      await owner.move({ ...base, moves: [{ kind: "file", repositoryId, fileId: current.fileId,
        destinationRepositoryId: repositoryId, destinationPath: action.destination }] });
    if (!result.changeIds.length) throw new Error("Native transfer did not establish source lineage");
    const placed = await requireOwnedText(result.workingHead, action.destination);
    if ((action.kind === "move") !== (placed.fileId === current.fileId) || placed.text !== current.text)
      throw new Error("Native transfer file identity or bytes did not match its declared effect");
    if (action.kind === "move") latestText.delete(action.path);
    latestText.set(action.destination, current.text);
    working = result.workingHead;
  }
  const observed = world.actions.length ? (await owner.commit({ contextId: context, commandId: crypto.randomUUID(),
    expectedWorkingHead: working, message: "Commit owned source decisions for review" })).event : importedState;
  const workspace = await status();
  const repo = await owner.resolveRepository({ state: observed, repoPath });
  if (repo?.repositoryId !== repositoryId || !workspace.clean || !isDeepStrictEqual(workspace.workingHead, observed))
    throw new Error("Native review context has no exact owned committed input");
  const directory = (await ports.dir("owned-source-attribution")).replace(/\/$/u, "");
  const output = directory + "/source-attribution.json";
  const candidates = [...new Set(world.candidates ?? [...latestText.keys()])].sort().map((path, i) => ({ id: `source-${i+1}`, path, name: path }));
  const assignment = { id: crypto.randomUUID(), goal: world.goal, scope: repoPath, mayRetain: world.mayRetain, candidates };
  function textFragments(text: string) {
    let offset = 0;
    return text.split(/\n/u).flatMap((line, index) => {
      const start = offset;
      offset += line.length + 1;
      return line ? [{ id: `line-${index+1}`, start, end: start + line.length, text: line }] : [];
    });
  }
  const readView = async (candidate: typeof candidates[number]) => {
    const actual = await readFile(observed, candidate.path);
    if (!actual) return null;
    const { fileId, text } = await requireOwnedText(observed, candidate.path);
    return { candidate, state: stateKey(observed), file: fileId, coordinateKind: "utf16" as const, digest: hash(text), fragments: textFragments(text) };
  };
  type View = NonNullable<Awaited<ReturnType<typeof readView>>>;
  const readbacks = new Map<string, View | null>();
  const roots = new Map<string, VcsSemanticNodeRef>();
  const inspected = new Map<string, Root>();
  function ref(root: VcsSemanticNodeRef) {
    const prior = [...roots].find(([, existing]) => isDeepStrictEqual(existing, root));
    if (prior) return prior[0];
    const id = "root-" + (roots.size + 1);
    roots.set(id, root);
    return id;
  }
  const traceReads = new Map<string, { view: View; selected: Selection; spans: VcsBlameSpan[]; trace: {
    file: string; state: string; fragment: string; spans: TraceSpan[]; truncated: boolean } }>();
  const effects: { service: string; method: string; args: unknown[]; result: unknown }[] = [];
  let discovered = false;
  let staging = false;
  const pendingReads = new Set<string>();
  const pendingTraces = new Set<string>();
  let receipt: Receipt | null = null;
  const replayRetain=exactReceiptReplay<[string,string,Conclusion],Receipt>();
  let staleHead: VcsStateNodeRef | null = null;
  function capture<T>(service: string, method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }
  function admission(id: string) {
    if (id !== assignment.id) throw new Error("Source attribution assignment is outside scoped discovery");
  }
  function getCandidate(id: string) {
    const candidate = candidates.find(item => item.id === id);
    if (!candidate) throw new Error("Source candidate is outside the current local review");
    return candidate;
  }
  async function traceNative(view: View, fragmentId: string) {
    const fragment = view.fragments.find(item => item.id === fragmentId);
    if (!fragment) throw new Error("Source fragment is not in the observed file");
    const request = { state: observed, repositoryId, fileId: view.file, range: { start: fragment.start, end: fragment.end }, limit: 30 };
    const result = await owner.blame(request);
    if (!isDeepStrictEqual(result.state, observed) || result.fileId !== view.file || result.coordinateKind !== view.coordinateKind ||
        result.spans.some(span => span.start < fragment.start || span.end > fragment.end)) throw new Error("Native trace missed the exact source frame");
    return result;
  }
  async function inspectRoot(root: VcsSemanticNodeRef, id: string): Promise<Root> {
    const result = await owner.inspect({ node: root, edgeLimit: 8 });
    if (result.node.kind !== root.kind || !isDeepStrictEqual(result.root, root)) throw new Error("Native provenance read returned a different root");
    const { node } = result;
    if (node.kind === "work-unit") {
      const intent = node.value.intent;
      return { ref: id, kind: node.kind, label: node.value.kind, tier: intent.tier,
        intent: intent.tier === "mechanical" ? null : intent.text, externalSource: node.value.externalSnapshot?.sourceUri ?? null };
    }
    if (node.kind !== "command") throw new Error("Source origin can inspect only its admitted work and commands");
    return { ref: id, kind: node.kind, label: "semantic-command", tier: null, intent: null, externalSource: null };
  }
  const pickSpan = (fragment: string, span: TraceSpan, evidence: Root[]): Claim => {
    const root = evidence.find(item => item.ref === span.work);
    const origin = span.boundary === "authored" ? "native" : "external";
    return { fragment, span: span.id, origin, intent: origin === "native" ? root?.intent ?? null : null,
      refs: span.work ? [span.work] : [span.command] };
  };
  function reportConclusion(): Conclusion {
    const claims = [...traceReads.values()].flatMap(({ selected, trace }) => trace.spans.map(span => pickSpan(selected.fragment, span, [...inspected.values()])));
    return { disposition: world.complete, claims };
  }
  function validateEvidence() {
    if(!discovered||readbacks.size===0)return false;
    if ([...readbacks].some(([id, view]) => Boolean(view) !== latestText.has(getCandidate(id).path))) return false;
    const actual=assembleReport();
    return groundedSourceEvidence(actual.files,actual.evidence);
  }

  const services = {
    sourceOriginEvidence: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return capture("sourceOriginEvidence", "discover", [], assignment);
      },
      async read(id: string, candidateId: string) {
        admission(id);
        const candidate = getCandidate(candidateId);
        if (pendingReads.has(candidateId)) throw new Error("Source candidate observation is in progress");
        pendingReads.add(candidateId);
        try {
          const view = await readView(candidate);
          readbacks.set(candidateId, view);
          return capture("sourceOriginEvidence", "read", [id, candidateId], view);
        } finally { pendingReads.delete(candidateId); }
      },
    },
    sourceOriginGraph: {
      async trace(id: string, state: string, candidate: string, fragment: string) {
        admission(id);
        const view = readbacks.get(candidate), key = `${candidate}:${fragment}`;
        if (!view || view.state !== state || pendingTraces.has(key)) throw new Error("Source range was not admitted by its current read");
        pendingTraces.add(key);
        try {
          const result = await traceNative(view, fragment);
          const spans = result.spans.map((span, i): TraceSpan => ({ id: `${key}:${i+1}`, start: span.start, end: span.end,
            boundary: span.stop, intentTier: "tier" in span ? span.tier : null, paths: span.path.map(edge => edge.kind),
            work: "workUnit" in span ? ref(span.workUnit) : null, command: ref(span.command), externalSource: "source" in span ? span.source.uri : null }));
          const trace = { file: view.file, state, fragment, spans, truncated: result.nextCursor !== null };
          traceReads.set(key, { view, selected: { candidate, fragment }, spans: result.spans, trace });
          return capture("sourceOriginGraph", "trace", [id, state, candidate, fragment], trace);
        } finally { pendingTraces.delete(key); }
      },
      async inspect(id: string, rootId: string) {
        admission(id);
        const root = roots.get(rootId);
        if (!root) throw new Error("Precise root must come from a native source trace");
        const view = inspected.get(rootId) ?? await inspectRoot(root, rootId);
        inspected.set(rootId, view);
        return capture("sourceOriginGraph", "inspect", [id, rootId], view);
      },
    },
    sourceOriginReceipt: {
      async retain(id: string, state: string, conclusion: Conclusion) {
        admission(id);
        return replayRetain([id,state,conclusion],async()=>{
          if(!receipt||!assignment.mayRetain||state!==stateKey(observed)||!groundedSourceConclusion(conclusion,assembleReport().evidence)||!validateEvidence())return false;
          const current=await status();
          if(!isDeepStrictEqual(current.workingHead,staleHead??observed))return false;
          if(receipt.status!=="retained")return true;
          return receipt.path===output&&hash(Buffer.from(await ports.read(output)).toString("utf8"))===receipt.sha256;
        },async()=>{
        if (!assignment.mayRetain || receipt || staging || state !== stateKey(observed) || !groundedSourceConclusion(conclusion,assembleReport().evidence) ||
            !validateEvidence()) throw new Error("Review receipt is outside its exact owned evidence and authority");
        staging = true;
        try {
          if (world.gates === "stale") {
            const before = await requireOwnedText(observed, scopeFile);
            const result = await owner.edit({ contextId: context, commandId: crypto.randomUUID(), expectedWorkingHead: observed,
              intentSummary: "Coordinator advanced the authorized review window", changes: [{ kind: "text-edit", repositoryId, fileId: before.fileId,
                edits: [{ start: 0, end: before.text.length, text: '{"open":true,"window":"next"}\n' }] }] });
            staleHead = result.workingHead;
          }
          const now = await status();
          if (!isDeepStrictEqual(now.workingHead, observed)) receipt = { state, status: "stale", path: null, sha256: null };
          else if (!JSON.parse((await requireOwnedText(now.workingHead, scopeFile)).text).open)
            receipt = { state, status: "authority-closed", path: null, sha256: null };
          else {
            const text = JSON.stringify({ assignment: id, scope: repoPath, state, conclusion }) + "\n";
            await ports.write(output, text);
            if (!Buffer.from(await ports.read(output)).equals(Buffer.from(text))) throw new Error("Owned source review receipt failed exact byte readback");
            receipt = { state, status: "retained", path: output, sha256: hash(text) };
          }
          return capture("sourceOriginReceipt", "retain", [id, state, conclusion], receipt);
        } finally { staging = false; }
        });
      },
    },
  };
  async function reference() {
    await services.sourceOriginEvidence.discover();
    for (const path of new Set(world.questions.map(question => question.path).concat(world.candidates ?? []))) {
      const candidate = candidates.find(item => item.path === path)!;
      await services.sourceOriginEvidence.read(assignment.id, candidate.id);
    }
    for (const { path, text } of world.questions) {
      const candidate = candidates.find(item => item.path === path)!;
      const view = readbacks.get(candidate.id)!;
      const fragment = view.fragments.find(item => item.text === text)!;
      if (traceReads.has(`${candidate.id}:${fragment.id}`)) continue;
      const trace = await services.sourceOriginGraph.trace(assignment.id, view.state, candidate.id, fragment.id);
      for (const span of trace.spans) {
        if (span.work && !inspected.has(span.work)) await services.sourceOriginGraph.inspect(assignment.id, span.work);
        if (span.boundary !== "authored" && !inspected.has(span.command)) await services.sourceOriginGraph.inspect(assignment.id, span.command);
      }
    }
    const conclusion = reportConclusion();
    if (world.mayRetain && conclusion.claims.length) await services.sourceOriginReceipt.retain(assignment.id, stateKey(observed), conclusion);
    return assembleReport();
  }
  function assembleReport() {
    return { assignment, files: [...readbacks.values()].filter((value): value is View => value !== null),
      evidence: [...traceReads.values()].map(({ selected, trace }) => ({ selected, trace,
        roots: [...new Set(trace.spans.flatMap(span => [span.work, span.command]))].flatMap(id => {
          const item = id ? inspected.get(id) : null;
          return item ? [item] : [];
        }) })), conclusion: reportConclusion(), receipt };
  }
  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedSourceAttributionReport"],"rootPath":["conclusion"],"producerSourceSuffix":"reviewSourceAttribution/explainSourceOrigin.nl","producerPath":[]}];
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
    const report = value as ReturnType<typeof assembleReport> | null;
    const after = await status(), mainAfter = await owner.mainState();
    const entries = await ports.entries(directory);
    const retainedText=receipt?.status==="retained"?Buffer.from(await ports.read(output)).toString("utf8"):null;
    const rechecked = await Promise.all([...latestText].map(async ([path, text]) => (await requireOwnedText(after.workingHead, path)).text === text));
    const rereadGraph = await Promise.all([...traceReads.values()].map(async ({ view, selected, spans }) =>
      isDeepStrictEqual((await traceNative(view, selected.fragment)).spans, spans)));
    const rereadRoots = await Promise.all([...inspected].map(async ([id, retained]) =>
      isDeepStrictEqual(await inspectRoot(roots.get(id)!, id), retained)));
    const checks = {
      readExactCurrentSource: validateEvidence(),
      tracedExactGraphOwner: rereadGraph.every(Boolean) && rereadRoots.every(Boolean),
      preservedWorkspaceSources: rechecked.every(Boolean) && isDeepStrictEqual(mainBefore, mainAfter) &&
        after.clean === !Boolean(staleHead) && isDeepStrictEqual(after.workingHead, staleHead ?? observed),
      verifiedOwnedSourceReceipt: receipt?.status === "retained" ?
        isDeepStrictEqual(entries, ["source-attribution.json"]) && receipt?.path === output &&
        retainedText!==null&&receipt.sha256 === hash(retainedText) : entries.length === 0,
      matchedSourceAttributionReport: Boolean(report&&groundedSourceConclusion(report.conclusion,assembleReport().evidence)&&isDeepStrictEqual(report.receipt,receipt)),
    };
    const proof = { ...assembleReport(), retainedText,effects: structuredClone(effects), native: { repositoryId, importedState, observed, authoredChanges, source, after: after.workingHead } };
    return {
      incorrectReturnValues:[],
 passed: Object.values(checks).every(Boolean), caseId: world.id, contextId: context, goal: world.goal, checks, actualResult:value,...proof,
      outcomeContract: {
        effects: {checks:["readExactCurrentSource", "tracedExactGraphOwner", "preservedWorkspaceSources", "verifiedOwnedSourceReceipt"],rationale:"The independent native observations, persisted artifacts and unchanged neighboring state establish these facts."},
        returnedValue: {checks:["matchedSourceAttributionReport"],required:world.requestedReturnRequired!==false,rationale:"A requested query conclusion is application data. Note-only goals are judged by their actual retained evidence or authorized hold, without requiring an extra root result copy."},
        incidentalValues: {checks:[],rationale:"Known incorrect emitted values are masked using their actual invocation definition."},
      }
    };
  }
  async function qualify() {
    const working = await reference();
    const report = {conclusion:working.conclusion,receipt:working.receipt};
    const proof = await verify(report);
    async function rejected(run: () => Promise<unknown>) {
      try { await run(); return false; } catch { return true; }
    }
    const rejectedForeignRoot = await rejected(() => services.sourceOriginGraph.inspect(assignment.id, "other-root"));
    const rejectedStaleState = await rejected(() => services.sourceOriginReceipt.retain(assignment.id, "older-state", report.conclusion));
    const altered = { ...report, conclusion: { ...report.conclusion,
      claims: report.conclusion.claims.length ? report.conclusion.claims.map(item => ({ ...item, span: "older-span" })) :
        [{fragment:"unissued-fragment",span:"unissued-span",origin:"native",intent:null,refs:["unissued-root"]}] } };
    const rejectedWrongLineage = !(await verify(altered)).outcomeDimensions.returnedValue.passed;
    const checks = { ...proof.checks, rejectedForeignRoot, rejectedStaleState, rejectedWrongLineage };
    return assessNativeQualification({ ...proof, outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedForeignRoot","rejectedStaleState","rejectedWrongLineage"]}}, passed: Object.values(checks).every(Boolean), checks, report });
  }
  return { services, qualify, verify };
}
