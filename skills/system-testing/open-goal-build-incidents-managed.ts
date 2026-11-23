import type { InvocationObservations } from "./observed-invocation.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { compareUtf16CodeUnits, sha256HexSyncText } from "@vibestudio/content-addressing";
import { expectedBuildUnitName } from "@vibestudio/workspace-contracts/sourceDirs";
import type { BuildMetadataWire, BuildPerformanceProfileWire } from "@vibestudio/service-schemas/build";
import type { VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";
import type { RuntimeFs, VcsClient } from "@workspace/runtime";
import { observeBuildProfile } from "@workspace/testkit";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { BuildIncidentWorld } from "./open-goal-build-incidents-worlds.js";

type Ports = {
  contextId: string; fs: RuntimeFs; vcs: VcsClient;
  blobstore: { putText(text: string): Promise<{ digest: string }> };
  profile(source: string, ref: string): Promise<BuildPerformanceProfileWire>;
  metadata(key: string): Promise<BuildMetadataWire | null>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
type Slot = BuildIncidentWorld["slots"][number];
type Focus = BuildIncidentWorld["focus"];
type Blocker = BuildIncidentWorld["expected"]["blocker"];
type Profile = ReturnType<typeof observeBuildProfile>;
type Review = {
  observation: Profile;
  execution: { state: string; repeat: string; phase: string };
  payload: { budget: string; largestInitialInput: { source: string; bytes: number } | null } | null;
  next: { action: string; reason: string };
};
type Card = { id: string; label: string; source: string; owner: string; revision: string; stateHash: string | null; complete: boolean; released: boolean };
type TraceStamp = { startedAt: number; reportDigest: string };
type Diagnostic = { source: string; file: string; line: number; column: number; message: string };
type Checkpoint = {
  card: Card; head: VcsStateNodeRef; repositoryId: string; sourceDigest: string;
  observation: Profile | null; trace: TraceStamp | null; diagnostic: Diagnostic | null;
};
type Ticket = { operationId: string; goal: string; initialBudgetBytes?: number };
type Selection = { checkpoint: Card; trace: TraceStamp | null; diagnostic: Diagnostic | null; review: Review };
type Receipt = { path: string; bytes: number; sha256: string; checkpoints: string[] };
type Subject = { title: string; source: string; owner: string; revision: string };
type Outcome = { subject: Subject; focus: Focus; current: Selection | null; baseline: Selection | null;
  disposition: { finding: string; blocker: Blocker; reason: string }; handoff: Receipt | null };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
const decoder = new TextDecoder("utf-8", { fatal: true });
const sourcePath = "index.tsx";
const scratchDirectory = /^evidence-handoff-[a-f0-9]{32}$/u;
const digest = (text: string) => sha256HexSyncText(text);
const revision = (head: VcsStateNodeRef) => JSON.stringify(head);

function panelSource(content: BuildIncidentWorld["content"], title: string, revisionName: string) {
  const text = title + " / " + revisionName + (content === "rich"
    ? Array.from({ length: 1500 }, (_, index) => " | segment " + index.toString(36) + " binds release narrative").join("") : "");
  const expression = content === "broken" ? "const label = ;" : "const label = " + JSON.stringify(text) + ";";
  return `import React from "react";
// Exact authored edition: ${revisionName}.
${expression}
export default function App() {
  return <main><output>{label}</output><button onClick={() => void import("./details.js")}>Open note</button></main>;
}`;
}

function fixtureFiles(source: string, title: string, content: string) {
  return {
    [sourcePath]: content,
    "details.ts": "export const message = 'Detailed local build note. ';\nconsole.info(message);",
    "package.json": JSON.stringify({
      name: expectedBuildUnitName(source), version: "0.0.0", private: true, type: "module",
      vibestudio: { title, entry: sourcePath, authority: { requests: [], serviceRequests: [], provides: [] },
        exposeModules: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"] },
      dependencies: { "@workspace/runtime": "workspace:*", react: "^19.0.0", "react-dom": "^19.0.0" },
    }),
  };
}

function judge(observation: Profile, focus: Focus, budget: number | undefined): Review {
  const built = observation.first.cacheState === "built-during-profile";
  const phaseTimes = observation.first.phases;
  const phases = phaseTimes ? [
    { time: phaseTimes.bundlingMs, phase: "bundling" }, { time: phaseTimes.validationMs, phase: "validation" },
    { time: phaseTimes.otherMs, phase: "other" },
  ].sort((left, right) => right.time - left.time) : [];
  const dominant = phases[0];
  const workloadOk = observation.status === "ok";
  const execution = workloadOk ? {
    state: built ? "built" : observation.first.cacheState,
    repeat: observation.repeat?.sameBuildKeys && observation.targets.length ? "verified" :
      observation.repeat?.sameBuildKeys === false ? "different-keys" : "unavailable",
    phase: built && dominant && dominant.time > 0 ? dominant.time === phases[1]?.time ? "tied" : dominant.phase : "unavailable",
  } : { state: "unavailable", repeat: "unavailable", phase: "unavailable" };
  const measured = workloadOk ? observation.targets.find(item => item.target === "runtime")?.payload : null;
  const payload = measured ? { budget: budget === undefined ? "unassigned" : measured.initialBytes > budget ? "over" : "within",
    largestInitialInput: measured.largestInitialInputs.reduce<{ source: string; bytes: number } | null>(
      (largest, entry) => !largest || entry.bytes > largest.bytes ? entry : largest, null) } : null;
  const action = !workloadOk ? "diagnose-build" : payload?.budget === "over" ? "reduce-initial-payload" :
    execution.repeat === "different-keys" || (focus === "cache" && execution.repeat !== "verified") ? "establish-cache" :
    focus === "build-time" && ["bundling", "validation", "other"].includes(execution.phase) ? "measure-phase" : "record-baseline";
  return { observation, execution, payload, next: { action, reason: "Use the bounded native profile and exact retained scope." } };
}

export async function prepareRetainedBuildIncident(
  input: { contextId: string; caseId: string }, world: BuildIncidentWorld, ports: Ports,
) {
  if (!input.contextId || input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Retained build evidence needs an exact owned workspace context");
  const { fs, vcs, readBytes } = ports;
  const status = () => vcs.status({ contextId: input.contextId });
  const before = await status();
  const outputEntries = async () => (await listOwnedScratchEntries(fs)).filter(name => scratchDirectory.test(name)).sort();
  const scratchBefore = await outputEntries();
  const nonce = crypto.randomUUID().slice(0, 14);
  const primary = "panels/retained-build-" + nonce;
  const neighbor = primary + "-other";
  const oldMode = world.id === "retained-build-current-diagnostic-with-old-failure" ? "broken" : "compact";
  const oldText = panelSource(oldMode, world.title, "previous release");
  const nowText = panelSource(world.content, world.title, "current release");
  const needOld = world.slots.includes("baseline");
  const scopes = new Map([[primary, needOld ? oldText : nowText]]);
  if (world.slots.includes("neighbor")) scopes.set(neighbor, panelSource("compact", world.title, "other display"));
  const repositories = await Promise.all([...scopes].map(async ([source, text]) => ({
    repoPath: source,
    files: await Promise.all(Object.entries(fixtureFiles(source, world.title, text)).sort(([left], [right]) =>
      compareUtf16CodeUnits(left, right)).map(async ([path, content]) => ({
      path, contentHash: (await ports.blobstore.putText(content)).digest, mode: 0o644,
    }))),
  })));
  repositories.sort((left, right) => compareUtf16CodeUnits(left.repoPath, right.repoPath));
  const imported = await vcs.importSnapshot({ contextId: input.contextId, commandId: crypto.randomUUID(),
    expectedWorkingHead: before.workingHead, intentSummary: "Seed disposable build profile owners",
    message: "Seed disposable build profile owners", source: { kind: "generated", uri: "system-test://retained-build/" + nonce,
      snapshotRevision: "fixture:" + digest(JSON.stringify(repositories)) }, repositories,
  });
  const firstHead = (await status()).workingHead;
  if (firstHead.kind !== "event" || imported.eventId !== firstHead.eventId ||
      imported.importedRepositoryIds.length !== repositories.length)
    throw new Error("Native build fixtures were not attached to the owned context");
  const ids = new Map<string, string>();
  for (const source of scopes.keys()) {
    const linked = await vcs.resolveRepository({ state: firstHead, repoPath: source });
    if (!linked || !imported.importedRepositoryIds.includes(linked.repositoryId))
      throw new Error("Resolved build source outside the owned repositories");
    ids.set(source, linked.repositoryId);
  }

  async function nativeSource(head: VcsStateNodeRef, repositoryId: string) {
    const file = await vcs.readFile({ state: head, repositoryId, file: { kind: "path", path: sourcePath } });
    if (!file || file.repositoryId !== repositoryId || file.path !== sourcePath || file.content.kind !== "text")
      throw new Error("The native build source coordinates were lost");
    return { id: file.fileId, text: file.content.text };
  }

  const directory = await fs.mkdtemp("retained-build-checkpoints");
  const slots = new Map<Slot, { path: string; saved: Checkpoint }>();
  const contextRef = "ctx:" + input.contextId;
  const primaryId = ids.get(primary)!;
  async function capture(slot: Slot, head: VcsStateNodeRef) {
    const source = slot === "neighbor" ? neighbor : primary;
    const repositoryId = ids.get(source)!;
    const file = await nativeSource(head, repositoryId);
    if (!isDeepStrictEqual((await status()).workingHead, head)) throw new Error("The build context moved before capture");
    const native = slot === "incomplete" ? null : await ports.profile(source, contextRef);
    if (!isDeepStrictEqual((await status()).workingHead, head) ||
        (native && (native.source !== source || native.ref !== contextRef || native.report.repoPath !== source)))
      throw new Error("A retained native build profile does not belong to the observed context");
    const card: Card = { id: crypto.randomUUID(), label: slot === "baseline" ? "Earlier retained review" : "Desk measurement checkpoint",
      source, owner: world.owner, revision: revision(head), stateHash: native?.report.stateHash ?? null,
      released: slot !== "withdrawn", complete: native !== null };
    const firstError = native?.report.diagnostics.find(item => item.severity === "error");
    const diagnostic = firstError ? { source: firstError.source, file: firstError.file, line: firstError.line,
      column: firstError.column, message: firstError.message.slice(0, 600) } : null;
    const trace = native ? { startedAt: native.startedAt, reportDigest: digest(JSON.stringify(native.report)) } : null;
    const saved = { card, head, repositoryId, sourceDigest: digest(file.text), trace, diagnostic,
      observation: native ? observeBuildProfile(native) : null };
    const path = directory + "/" + card.id + ".json";
    await fs.writeFile(path, JSON.stringify(saved));
    slots.set(slot, { path, saved });
  }
  if (needOld) {
    await capture("baseline", firstHead);
    const present = await nativeSource(firstHead, primaryId);
    const edit = await vcs.edit({ contextId: input.contextId, commandId: crypto.randomUUID(), expectedWorkingHead: firstHead,
      changes: [{ kind: "text-edit", repositoryId: primaryId, fileId: present.id,
        edits: [{ start: 0, end: present.text.length, text: nowText }] }],
    });
    if (!edit.changeIds.length || isDeepStrictEqual(edit.workingHead, firstHead)) throw new Error("The fixture edit did not create a new native checkpoint");
  }
  const currentHead = (await status()).workingHead;
  for (const slot of world.slots) if (slot !== "baseline") await capture(slot, currentHead);
  const subject: Subject = { title: world.title, source: primary, owner: world.owner, revision: revision(currentHead) };
  const directoryRows = [...slots.values()].sort((left, right) => left.saved.card.id.localeCompare(right.saved.card.id));
  const scratch = bindScratchHandoff(fs, { goal: world.goal, questions: ["Verify exact retained build evidence."],
    sources: directoryRows.map(({ path, saved }) => ({ id: saved.card.id, path })),
  }, readBytes);
  const effects: Effect[] = [];
  const activated = new Map<string, { ticket: Ticket; path: string }>();
  const observed = new Map<string, Profile>();
  let stored: Receipt | null = null;

  const remember = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  const readCheckpoint = async (path: string): Promise<Checkpoint> => JSON.parse(decoder.decode(await readBytes(path, 96 * 1024)));

  function packet(focus: Focus, entries: Checkpoint[]) {
    return JSON.stringify({ schema: "vibestudio.retained-build-incident/1", subject, focus,
      checkpoints: entries.map(({ card, observation, trace, diagnostic, sourceDigest }) => ({ card, sourceDigest, observation, trace, diagnostic })),
    }, null, 2) + "\n";
  }

  const services = {
    buildIncidentCatalog: {
      async discover() {
        const checkpoints = await Promise.all(directoryRows.map(async ({ path }) => (await readCheckpoint(path)).card));
        return remember("buildIncidentCatalog", "discover", [], { subject, checkpoints, budgetBytes: world.budget ?? null,
          localHandoffAllowed: world.localHandoffAllowed });
      },
      async open(id: string) {
        const assigned = directoryRows.find(row => row.saved.card.id === id);
        if (!assigned) throw new Error("Discover the owned checkpoints before opening a scoped ID");
        const { card, observation, trace, diagnostic } = await readCheckpoint(assigned.path);
        const existing = activated.get(id);
        const ticket = card.source === primary && card.released && card.complete && observation ? existing?.ticket ??
          { operationId: crypto.randomUUID(), goal: world.goal,
            ...(world.budget !== undefined ? { initialBudgetBytes: world.budget } : {}) } : null;
        if (ticket) activated.set(id, { ticket, path: assigned.path });
        return remember("buildIncidentCatalog", "open", [id], {
          checkpoint: card, request: ticket, trace: ticket ? trace : null, diagnostic: ticket ? diagnostic : null,
        });
      },
    },
    buildPerformance: {
      async observe(operationId: string) {
        const match = [...activated].find(([, entry]) => entry.ticket.operationId === operationId);
        if (!match) throw new Error("Use only an issued owned profile operation");
        const { observation } = await readCheckpoint(match[1].path);
        if (!observation || observation.source !== primary) throw new Error("The retained profile has an invalid source");
        observed.set(match[0], observation);
        return remember("buildPerformance", "observe", [operationId], observation);
      },
    },
    buildIncidentHandoff: {
      async stage(checkpoints: string[], focus: Focus) {
        const matched = checkpoints.map(id => directoryRows.find(row => row.saved.card.id === id));
        const head = (await status()).workingHead;
        const entries = matched.every(Boolean) ? await Promise.all(matched.map(row => readCheckpoint(row!.path))) : [];
        const first = entries[0];
        const baseline = entries[1];
        if (!world.localHandoffAllowed || stored || !isDeepStrictEqual(head, currentHead) ||
            !first || first.card.revision !== revision(head) || focus !== world.focus || focus === "runtime-memory" ||
            entries.length !== (focus === "compare" ? 2 : 1) ||
            (focus === "compare" && (!baseline || baseline.card.revision === first.card.revision)) ||
            entries.some(entry => entry.card.source !== primary || !entry.card.released ||
              !isDeepStrictEqual(observed.get(entry.card.id), entry.observation) ||
              (entry.observation?.status !== "ok" && (focus !== "compiler" || !entry.diagnostic))))
          return remember("buildIncidentHandoff", "stage", [checkpoints, focus], null);
        const text = packet(focus, entries);
        const staged = await scratch.scratchHandoffWrite.stage(text);
        if (staged) stored = { ...staged, sha256: digest(text), checkpoints: [...checkpoints] };
        return remember("buildIncidentHandoff", "stage", [checkpoints, focus], stored);
      },
    },
  };

  async function verify(value: unknown, invocation?: InvocationObservations) {
    const report = value as Outcome | null;
    const outcome = report;
    const primaryEntry = world.expected.current ? slots.get("current") : null;
    const oldEntry = world.expected.baseline ? slots.get("baseline") : null;
    const expectedSaved = [primaryEntry, oldEntry].flatMap(entry => entry ? [entry.saved] : []);
    const immutable = await Promise.all(directoryRows.map(async ({ path, saved }) => {
      const checkpoint = await readCheckpoint(path);
      return isDeepStrictEqual(checkpoint, saved) &&
        checkpoint.sourceDigest === digest((await nativeSource(checkpoint.head, checkpoint.repositoryId)).text);
    }));
    const currentSources = await Promise.all([...ids].map(async ([source, id]) => ({
      source, text: (await nativeSource(currentHead, id)).text,
    })));
    const keys = new Map(directoryRows.flatMap(({ saved }) => saved.observation?.targets.map(target =>
      [target.buildKey, saved.card.source] as const) ?? []));
    const metadata = await Promise.all([...keys].map(async ([key, source]) => {
      const fresh = await ports.metadata(key);
      return { key, source, retained: !!fresh && fresh.buildKey === key && fresh.sourcePath === source &&
        fresh.name === expectedBuildUnitName(source) };
    }));
    function matched(actual: Selection | null | undefined, slot: Checkpoint | undefined) {
      if (!slot?.observation) return actual === null;
      const wanted = judge(slot.observation, world.focus, world.budget);
      return isDeepStrictEqual(actual?.checkpoint, slot.card) && isDeepStrictEqual(actual?.trace, slot.trace) &&
        isDeepStrictEqual(actual?.diagnostic, slot.diagnostic) && isDeepStrictEqual(actual?.review?.observation, wanted.observation) &&
        isDeepStrictEqual(actual?.review?.execution, wanted.execution) && isDeepStrictEqual(actual?.review?.payload, wanted.payload) &&
        (actual?.review?.next?.action === wanted.next.action ||
          (world.focus === "compare" && wanted.next.action === "record-baseline" && actual?.review?.next?.action === "measure-phase" &&
            ["bundling", "validation", "other"].includes(wanted.execution.phase))) && Boolean(actual?.review?.next?.reason?.trim());
    }
    const post = await status();
    const afterOutputs = await outputEntries();
    const added = afterOutputs.filter(name => !scratchBefore.includes(name));
    const stages = effects.filter(event => event.service === "buildIncidentHandoff" && event.method === "stage" && event.result !== null);
    let handoff = !world.expected.stage && stored === null && !added.length && !stages.length;
    if (world.expected.stage && stored && added.length === 1 && stages.length === 1) {
      const readback = await readBytes(stored.path, stored.bytes);
      const body = decoder.decode(readback);
      handoff = stored.path === "/.tmp/" + added[0] + "/handoff.json" && body === packet(world.focus, expectedSaved) &&
        stored.bytes === readback.length && stored.sha256 === digest(body) &&
        isDeepStrictEqual(stored.checkpoints, expectedSaved.map(entry => entry.card.id));
    }
    const measurements = expectedSaved.map(({ observation, diagnostic, card }) => ({
      diagnostic, selected: observed.get(card.id), observation,
    }));
    const actualCurrent = primaryEntry?.saved;
    const checks = {
      exactOwnedCheckpointCatalog: immutable.every(Boolean),
      nativeObservationAndProvenance: metadata.every(entry => entry.retained) &&
        expectedSaved.every(entry => observed.has(entry.card.id)) &&
        measurements.every(entry => isDeepStrictEqual(entry.selected, entry.observation)),
      verifiedPerformanceAndDiagnosis: (!actualCurrent || (world.content === "broken" ?
          actualCurrent.observation?.status === "failed" && Boolean(actualCurrent.diagnostic && actualCurrent.diagnostic.line > 0 &&
          (actualCurrent.diagnostic.file === sourcePath || actualCurrent.diagnostic.file.endsWith("/" + sourcePath))) :
          actualCurrent.observation?.status === "ok" && !!actualCurrent.observation.targets.length &&
          (world.focus !== "initial-payload" || actualCurrent.observation.targets.some(target => target.target === "runtime" && !!target.payload)))),
      exactFindingAndEvidenceBoundary: isDeepStrictEqual(outcome?.handoff,stored)&&matched(outcome?.current,actualCurrent)&&matched(outcome?.baseline,oldEntry?.saved)&&outcome?.disposition?.finding === (world.expected.blocker ? "held" : world.focus) &&
        outcome.disposition?.blocker === world.expected.blocker && Boolean(outcome.disposition?.reason?.trim()),
      exactLocalHandoff: handoff &&
        scratchBefore.every(name => afterOutputs.includes(name)),
      protectedWorkingAndMain: post.mainEventId === before.mainEventId && isDeepStrictEqual(post.workingHead, currentHead) &&
        currentSources.every(({ source, text }) => text === (source === primary ? nowText : scopes.get(source))),
    };
    return {
      outcomeContract:{
        effects:{checks:["exactOwnedCheckpointCatalog", "nativeObservationAndProvenance", "verifiedPerformanceAndDiagnosis", "exactLocalHandoff", "protectedWorkingAndMain"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["exactFindingAndEvidenceBoundary"],required:true,rationale:"The requested analysis is application data; a redundant result copy is optional once the requested native artifact or operation exists."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}},
      incorrectReturnValues:value!==undefined&&!(checks.exactFindingAndEvidenceBoundary)?[{required:true,definition:invocation?.calls.find(call=>call.parentCallId===null)?.definition??{name:"reviewRetainedBuildIncident",source:"reviewRetainedBuildIncident.nl"},value:value}]:[],
 caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      effects, subject, current: actualCurrent?.card ?? null, baseline: oldEntry?.saved.card ?? null, metadata, handoff: stored };
  }

  async function qualify() {
    await services.buildIncidentCatalog.discover();
    async function inspect(slot: "current" | "baseline") {
      const entry = slots.get(slot);
      if (!entry) return null;
      const opened = await services.buildIncidentCatalog.open(entry.saved.card.id);
      if (!opened.request) throw new Error("Expected independently usable native build evidence");
      const receipt = await services.buildPerformance.observe(opened.request.operationId);
      return { checkpoint: opened.checkpoint, trace: opened.trace, diagnostic: opened.diagnostic, review: judge(receipt, world.focus, world.budget) };
    }
    const current = world.expected.current ? await inspect("current") : null;
    const baseline = world.expected.baseline ? await inspect("baseline") : null;
    const handoff = world.expected.stage && current ? await services.buildIncidentHandoff.stage(
      [current.checkpoint.id, ...(baseline ? [baseline.checkpoint.id] : [])], world.focus) : null;
    return verify({
      focus: world.focus, subject, current, baseline, handoff,
      disposition: { finding: world.expected.blocker ? "held" : world.focus, blocker: world.expected.blocker,
        reason: "Bind the exact measurement and protect the ownership scope." },
    });
  }

  return { services, qualify, verify };
}
