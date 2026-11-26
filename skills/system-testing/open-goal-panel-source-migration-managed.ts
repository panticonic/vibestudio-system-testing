import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["assignment", "observed", "current", "move", "identity", "consumers", "effects", "nativeFacts"], []);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { createPanelLocationLink, parsePanelLocationLink, type PanelLocation } from "@vibestudio/shared/panelLocation";
import { validateStateArgs } from "@vibestudio/shared/stateArgsValidator";
import { BUILDABLE_UNIT_DIRS, expectedBuildUnitName, isTerminalAppLocation } from "@vibestudio/workspace-contracts/sourceDirs";
import { contextId, rpc, vcs } from "@workspace/runtime";
import type { PanelSourceMigrationWorld as World } from "./open-goal-panel-source-migration-worlds.js";

type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type Manifest = { name: string; version: string; private: boolean; type: string;
  vibestudio: { title: string; entry: string; stateArgs: Parameters<typeof validateStateArgs>[1] };
  dependencies: Record<string, string> };
type Entry = { id: string; href: string };
type Guide = { note: string; entries: Entry[] };
type Ports = { contextId: string; vcs: typeof vcs;
  panel(source: string, ref: string): Promise<{ source: string; title: string; stateArgs?: unknown } | null> };
type Decision = "hold-collision" | "hold-layout" | "hold-contract" | "hold-scope" |
  "inspect-only" | "keep-current" | "move-source" | "update-consumers" | "move-and-update" | "align-build" | "align-and-update";
type Assignment = { id: string; goal: string; title: string; original: string; destination: string; repository: string;
  authority: { mode: "local" | "inspect"; destination: string; revision: string } };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
const revision = (state: State) => JSON.stringify(state);
const hash = sha256HexSyncText;
const collaborativeNote = "Maintainer already approved the summary workflow. Keep this annotation.";
const concurrentNote = "A colleague recorded an updated route note after the review began.";
const guidePath = "launch-guide.json";
const manifestPath = "package.json";
const appEntry = "index.tsx";
const makeContent = (text: string) => ({ kind: "text" as const, text });
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const ownedFiles = (files: [string, string][]) => files.map(([path, text]) => ({ path, mode: 420, content: makeContent(text) }));

async function readFile(client: typeof vcs, state: State, repositoryId: string, path: string) {
  const file = await client.readFile({ state, repositoryId, file: { kind: "path", path } });
  if (!file || file.repositoryId !== repositoryId || file.path !== path || file.content.kind !== "text")
    throw new Error("Could not read the exact owned migration source " + path);
  return { id: file.fileId, text: file.content.text, digest: file.contentHash };
}

export async function preparePanelSourceMigration(input: { contextId: string; caseId: string }, world: World, ports: Ports = {
  contextId, vcs,
  panel: (source, ref) => rpc.call("main", mainRpcMethods["build.getPanelMetadata"], [source, ref]),
}) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Panel migration requires the owned workspace context");
  const { vcs: client, contextId: ownerContext } = ports;
  const status = () => client.status({ contextId: ownerContext });
  const initial = await status();
  const token = crypto.randomUUID().slice(0, 12);
  const original = "panels/pre-move-" + token;
  const destination = (world.destination === "terminal" ? "terminal-apps" : world.destination === "project" ? "projects" : "panels") + "/relocated-" + token;
  const parking = "projects/parked-" + token;
  const consumerPath = "projects/launcher-guide-" + token;
  const neighborPath = "projects/neighbor-guide-" + token;
  const contextRef = "ctx:" + ownerContext;
  const panelManifest: Manifest = {
    name: expectedBuildUnitName(original)!, version: "0.1.0", private: true, type: "module",
    vibestudio: { title: world.name, entry: appEntry, stateArgs: {
      type: "object", properties: { view: { type: "string", enum: ["summary", "table"] }, page: { type: "integer", minimum: 1 } },
      required: ["view"], additionalProperties: false,
    } },
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
  };
  const javascript = 'export default function ExistingPanel() { return <main data-panel-live="true">Existing local panel</main>; }\n';
  const loc = (source: string, overrides: Partial<PanelLocation> = {}): PanelLocation => ({
    source, contextId: ownerContext, ref: contextRef, stateArgs: { view: "table", page: 2 },
    title: world.name, focus: false, disposition: "child", slug: "working-guide", ...overrides,
  });
  const direct = world.links === "updated" || world.links === "foreign-mix" && world.layout === "moved" ? destination : original;
  const linkGuide: Guide = { note: world.coedit ? collaborativeNote : "Maintain the installed panel and its approved callers.",
    entries: [
      { id: "active-menu", href: createPanelLocationLink(loc(direct)) },
      { id: "active-review", href: world.links === "broken-link" ? "vibestudio://panel?source=%" :
        createPanelLocationLink(loc(world.links === "split" ? destination : direct, {
          stateArgs: world.links === "incompatible" ? { view: "removed-view", page: 2 } : { view: "summary" },
          slug: "review-guide",
        }), "https") },
      { id: "pinned-release", href: createPanelLocationLink(loc(original, {
        ref: world.links === "historical" ? "state:" + "a".repeat(64) : "main", slug: "release-guide",
      })) },
      ...(world.links === "foreign-mix" ? [{ id: "neighbor-workspace", href: createPanelLocationLink(loc(original, {
        workspace: { id: "other-workspace-" + token }, slug: "neighbor-guide", ref: undefined,
      }), "https") }] : []),
    ],
  };
  const untouched = JSON.stringify({ neighbor: world.name, notes: ["Keep the neighboring work untouched."] }) + "\n";
  await client.edit({ contextId: ownerContext, commandId: "seed-panel-relocation-" + token, expectedWorkingHead: initial.workingHead,
    intentSummary: "Establish an owned previously authored panel, its caller guide, and a neighboring repository",
    changes: [
      { kind: "repository-create", repoPath: original, files: ownedFiles([[manifestPath, json(panelManifest)], [appEntry, javascript]]) },
      { kind: "repository-create", repoPath: consumerPath, files: ownedFiles([[guidePath, json(linkGuide)]]) },
      { kind: "repository-create", repoPath: neighborPath, files: ownedFiles([[guidePath, untouched]]) },
      ...(world.layout !== "occupied" ? [] : [{ kind: "repository-create" as const, repoPath: destination, files: ownedFiles([
        [manifestPath, json({ ...panelManifest, name: expectedBuildUnitName(destination)! })], [appEntry, javascript],
      ]) }]),
    ],
  });
  const seeded = await status();
  const repoAt = (state: State, repoPath: string) => client.resolveRepository({ state, repoPath });
  const [owned, consumer, neighbor, collision] = await Promise.all([
    repoAt(seeded.workingHead, original), repoAt(seeded.workingHead, consumerPath),
    repoAt(seeded.workingHead, neighborPath), repoAt(seeded.workingHead, destination),
  ]);
  if (!owned || !consumer || !neighbor) throw new Error("Could not seed the stable owned migration repositories");
  const repository = owned.repositoryId, consumerId = consumer.repositoryId, neighborId = neighbor.repositoryId;
  const [baselineManifest, baselineEntry, originalGuide, neighborBefore] = await Promise.all([
    readFile(client, seeded.workingHead, repository, manifestPath), readFile(client, seeded.workingHead, repository, appEntry),
    readFile(client, seeded.workingHead, consumerId, guidePath), readFile(client, seeded.workingHead, neighborId, guidePath),
  ]);
  async function moveRepo(state: State, destinationPath: string, intentSummary: string) {
    const result = await client.move({ contextId: ownerContext, commandId: crypto.randomUUID(), expectedWorkingHead: state,
      intentSummary, moves: [{ kind: "repository", repositoryId: repository, destinationPath }] });
    if (result.changeIds.length !== 1) throw new Error("Expected one exact semantic repository move");
    return result;
  }
  const destinationManifest = { ...panelManifest, name: expectedBuildUnitName(destination)! };
  const collisionManifest = collision && await readFile(client, seeded.workingHead, collision.repositoryId, manifestPath);
  async function writeManifest(state: State, expectedId: string, intentSummary: string) {
    const result = await client.edit({ contextId: ownerContext, commandId: crypto.randomUUID(), expectedWorkingHead: state,
      intentSummary, changes: [{ kind: "content-replace", repositoryId: repository, fileId: expectedId,
        content: makeContent(json(destinationManifest)) }] });
    if (result.changeIds.length !== 1) throw new Error("Expected one exact semantic package identity change");
    return result;
  }
  if (world.layout === "moved" || world.layout === "parked") {
    const relocated = await moveRepo(seeded.workingHead, world.layout === "moved" ? destination : parking, "Retain the workspace's previous partial relocation");
    if (world.layout === "moved" && !world.identityPending)
      await writeManifest(relocated.workingHead, baselineManifest.id, "Retain the workspace's already aligned package identity");
  }
  const prepared = await status();
  const assignment: Assignment = { id: crypto.randomUUID(), goal: world.goal, title: world.name, original, destination, repository,
    authority: { mode: world.grant === "inspect" ? "inspect" : "local",
      destination: world.grant === "wrong-destination" ? "panels/other-review-" + token : destination,
      revision: world.grant === "stale" ? revision(initial.workingHead) : revision(prepared.workingHead),
    },
  };
  const targetKind = BUILDABLE_UNIT_DIRS.find(unit => unit.dir === destination.split("/")[0])?.kind;
  const destinationPanel = targetKind === "panel" && !isTerminalAppLocation(destination);
  async function observe() {
    const before = await status();
    const [old, next, alternative, document, manifest] = await Promise.all([
      repoAt(before.workingHead, original), repoAt(before.workingHead, destination), repoAt(before.workingHead, parking),
      readFile(client, before.workingHead, consumerId, guidePath), readFile(client, before.workingHead, repository, manifestPath),
    ]);
    const layout = old?.repositoryId === repository ? "original" as const : next?.repositoryId === repository ? "moved" as const :
      alternative?.repositoryId === repository ? "parked" as const : "missing" as const;
    const location = layout === "original" ? original : layout === "moved" ? destination : layout === "parked" ? parking : null;
    const metadata = location && layout !== "parked" ? await ports.panel(location, contextRef) : null;
    const guard = await status();
    if (guard.mainEventId !== before.mainEventId || !isDeepStrictEqual(guard.workingHead, before.workingHead))
      throw new Error("The source and build metadata crossed workspace revisions");
    const selected = JSON.parse(manifest.text) as Manifest;
    const buildIdentity = layout === "moved" && manifest.digest === baselineManifest.digest ? "needs-alignment" as const :
      layout === "moved" && manifest.text === json(destinationManifest) ||
      layout === "original" && manifest.digest === baselineManifest.digest ? "current" as const : "unexpected" as const;
    const compatiblePanel = buildIdentity === "current" && metadata !== null && metadata.source === location && metadata.title === selected.vibestudio.title &&
      isDeepStrictEqual(metadata.stateArgs, selected.vibestudio.stateArgs);
    const knownArgumentSchema = compatiblePanel || buildIdentity === "needs-alignment" && metadata === null;
    const source = JSON.parse(document.text) as Guide;
    const links = source.entries.map(({ id, href }) => {
      const parsed = parsePanelLocationLink(href);
      if (parsed.kind === "error") return { id, value: href, carrier: null, source: null, scope: "invalid" as const, compatible: false };
      const value = parsed.location;
      const scope = value.workspace !== undefined || value.contextId !== ownerContext ? "foreign" as const :
        value.ref !== contextRef ? "historical" as const : "working" as const;
      const compatible = scope !== "working" || (value.source === original || value.source === destination) &&
        knownArgumentSchema && validateStateArgs(value.stateArgs, selected.vibestudio.stateArgs).success;
      return { id, value: href, carrier: parsed.carrier, source: value.source, scope, compatible };
    });
    const observation = { id: assignment.id, workingRevision: revision(before.workingHead), mainRevision: before.mainEventId,
      repository, location, layout, destinationOwner: next?.repositoryId ?? null, destinationPanel, compatiblePanel,
      actualSource: metadata?.source ?? null, contractDigest: metadata ? hash(JSON.stringify(metadata.stateArgs ?? null)) : null,
      buildIdentity, manifestDigest: manifest.digest, consumerDigest: document.digest, consumerLinks: links,
    };
    return { observation, before, document, source, manifest };
  }

  type Snapshot = Awaited<ReturnType<typeof observe>>;
  type Observation = Snapshot["observation"];
  type Mutation = Awaited<ReturnType<typeof moveRepo>>;
  type Receipt = { operation: Pick<Mutation, "applicationId" | "changeIds"> | null; status: "moved" | "aligned" | "updated" | "state-changed" | "not-authorized"; workingRevision: string; observation: Observation };
  type Outcome = { assignment: Assignment; observed: Observation; finding: string;
    move: Receipt | null; identity: Receipt | null; consumers: Receipt | null; current: Observation };
  function staleLinks(observation: Observation) {
    return observation.consumerLinks.filter(link => link.scope === "working" && link.source === original);
  }
  function decisionFor(observation: Observation): Decision {
    if (observation.destinationOwner && observation.destinationOwner !== repository) return "hold-collision";
    const eligibleIdentity = observation.compatiblePanel || observation.buildIdentity === "needs-alignment" && observation.actualSource === null;
    if (!observation.destinationPanel || !eligibleIdentity) return "hold-layout";
    if (observation.consumerLinks.some(link => link.scope === "invalid" || link.scope === "working" && !link.compatible)) return "hold-contract";
    const needsLinks = staleLinks(observation).length > 0, needsMove = observation.layout === "original";
    const needsIdentity = observation.buildIdentity === "needs-alignment";
    if (!needsMove && !needsLinks && !needsIdentity) return "keep-current";
    if (assignment.authority.mode === "inspect") return "inspect-only";
    if (assignment.authority.destination !== destination || assignment.authority.revision !== observation.workingRevision) return "hold-scope";
    if (needsMove) return needsLinks ? "move-and-update" : "move-source";
    if (needsIdentity) return needsLinks ? "align-and-update" : "align-build";
    return "update-consumers";
  }
  function admittedInitial(observation: Observation) {
    return assignment.authority.mode === "local" && assignment.authority.destination === destination &&
      assignment.authority.revision === observation.workingRevision && observation.destinationPanel &&
      (!observation.destinationOwner || observation.destinationOwner === repository) &&
      !observation.consumerLinks.some(link=>link.scope === "invalid" || link.scope === "working"&&!link.compatible);
  }
  function moveAdmitted(observation: Observation) {
    return admittedInitial(observation)&&observation.layout === "original"&&observation.compatiblePanel;
  }
  function alignAdmitted(observation: Observation) {
    return admittedInitial(observation)&&observation.layout === "moved"&&observation.buildIdentity === "needs-alignment"&&observation.actualSource === null;
  }
  function updateAdmitted(observation: Observation) {
    return admittedInitial(observation)&&observation.layout === "moved"&&observation.compatiblePanel&&staleLinks(observation).length>0;
  }
  async function editGuide(snapshot: Snapshot, guide: Guide, intentSummary: string) {
    const result = await client.edit({ contextId: ownerContext, commandId: crypto.randomUUID(), expectedWorkingHead: snapshot.before.workingHead,
      intentSummary, changes: [{ kind: "content-replace", repositoryId: consumerId, fileId: snapshot.document.id, content: makeContent(json(guide)) }] });
    if (result.changeIds.length !== 1) throw new Error("Expected exactly one caller guide change");
    if (guide.note === concurrentNote) coeditApplied = true;
    return result;
  }
  const effects: Effect[] = [];
  let discovered = false;
  let first: Observation | null = null;
  let moved: Receipt | null = null;
  let aligned: Receipt | null = null;
  let updated: Receipt | null = null;
  let pending = false;
  let coeditApplied = false;
  const capture = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  const receipt = (status: Receipt["status"], snapshot: Snapshot, mutation?: Mutation): Receipt => ({
    status: mutation && !isDeepStrictEqual(snapshot.before.workingHead, mutation.workingHead) ? "state-changed" : status,
    observation: snapshot.observation, workingRevision: snapshot.observation.workingRevision,
    operation: mutation ? { applicationId: mutation.applicationId, changeIds: mutation.changeIds } : null,
  });
  const services = {
    panelMigrationEvidence: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return capture("panelMigrationEvidence", "discover", [], assignment);
      },
      async inspect(id: string) {
        if (id !== assignment.id) throw new Error("Inspect the exact assigned panel and caller guide");
        const current = (await observe()).observation;
        first ??= structuredClone(current);
        return capture("panelMigrationEvidence", "inspect", [id], current);
      },
    },
    panelMigrationChange: {
      async move(id: string, head: string) {
        if (!first || id !== assignment.id || moved?.operation || pending) throw new Error("Move only the assigned semantic repository once");
        pending = true;
        try {
          const basis = await observe();
          const record = (status: Receipt["status"], state: Snapshot, mutation?: Mutation) => {
            moved = receipt(status, state, mutation);
            return capture("panelMigrationChange", "move", [id, head], moved);
          };
          if (head !== first.workingRevision || !moveAdmitted(first))
            return record("not-authorized", basis);
          if (!isDeepStrictEqual(basis.observation, first)) return record("state-changed", basis);
          if (world.race === "before-move") {
            await editGuide(basis, { ...basis.source, note: concurrentNote }, "Keep the collaborator's current source review");
            return record("state-changed", await observe());
          }
          let mutation: Mutation;
          try { mutation = await moveRepo(basis.before.workingHead, destination, "Move the approved existing panel repository"); }
          catch (error) {
            const fresh = await observe();
            if (fresh.observation.workingRevision === head) throw error;
            return record("state-changed", fresh);
          }
          return record("moved", await observe(), mutation);
        } finally {
          pending = false;
        }
      },
      async align(id: string, head: string, manifestDigest: string) {
        if (!first || pending || aligned?.operation || id !== assignment.id) throw new Error("Align the assigned package identity once");
        pending = true;
        try {
          const approved = alignAdmitted(first) ? first :
            moveAdmitted(first) && moved?.status === "moved" ? moved.observation : null;
          const record = (status: Receipt["status"], state: Snapshot, mutation?: Mutation) => {
            aligned = receipt(status, state, mutation);
            return capture("panelMigrationChange", "align", [id, head, manifestDigest], aligned);
          };
          const basis = await observe();
          if (!approved || head !== approved.workingRevision || manifestDigest !== approved.manifestDigest ||
              approved.buildIdentity !== "needs-alignment" || approved.actualSource !== null)
            return record("not-authorized", basis);
          if (!isDeepStrictEqual(basis.observation, approved)) return record("state-changed", basis);
          if (world.race === "before-identity") {
            await editGuide(basis, { ...basis.source, note: concurrentNote }, "Preserve a coedit before updating the panel package name");
            return record("state-changed", await observe());
          }
          let mutation: Mutation;
          try { mutation = await writeManifest(basis.before.workingHead, basis.manifest.id, "Align the moved panel's package identity"); }
          catch (error) {
            const fresh = await observe();
            if (fresh.observation.workingRevision === head) throw error;
            return record("state-changed", fresh);
          }
          const complete = await observe();
          if (isDeepStrictEqual(complete.before.workingHead, mutation.workingHead) && !complete.observation.compatiblePanel)
            throw new Error("Build V2 did not confirm the aligned source");
          return record("aligned", complete, mutation);
        } finally {
          pending = false;
        }
      },
      async update(id: string, head: string, guideDigest: string) {
        if (!first || pending || updated?.operation || id !== assignment.id) throw new Error("Update the assigned caller guide once");
        pending = true;
        try {
          const approved = updateAdmitted(first) ? first :
            (moveAdmitted(first)||alignAdmitted(first)) && aligned?.status === "aligned" ? aligned.observation : null;
          const record = (status: Receipt["status"], state: Snapshot, mutation?: Mutation) => {
            updated = receipt(status, state, mutation);
            return capture("panelMigrationChange", "update", [id, head, guideDigest], updated);
          };
          const basis = await observe();
          if (!approved || head !== approved.workingRevision || guideDigest !== approved.consumerDigest)
            return record("not-authorized", basis);
          if (!isDeepStrictEqual(basis.observation, approved)) return record("state-changed", basis);
          if (world.race === "after-move" || world.race === "before-links") {
            await editGuide(basis, { ...basis.source, note: concurrentNote }, "Preserve the collaborator's newer launcher-guide revision");
            return record("state-changed", await observe());
          }
          const accepted = new Set(staleLinks(basis.observation).map(link => link.id));
          if (basis.observation.layout !== "moved" || !basis.observation.compatiblePanel || !accepted.size)
            return record("not-authorized", basis);
          const entries = basis.source.entries.map(entry => {
            if (!accepted.has(entry.id)) return entry;
            const parsed = parsePanelLocationLink(entry.href);
            if (parsed.kind !== "ok") throw new Error("The exact scoped consumer link became invalid");
            return { ...entry, href: createPanelLocationLink({ ...parsed.location, source: destination }, parsed.carrier) };
          });
          let mutation: Mutation;
          try { mutation = await editGuide(basis, { ...basis.source, entries }, "Update only the approved working panel links"); }
          catch (error) {
            const fresh = await observe();
            if (fresh.observation.workingRevision === head) throw error;
            return record("state-changed", fresh);
          }
          return record("updated", await observe(), mutation);
        } finally {
          pending = false;
        }
      },
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedLocalMigrationPlan"],"rootPath":["finding"],"producerSourceSuffix":"migratePanelSource.nl","producerPath":["finding"]}];
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
    const envelope = value as Outcome | null;
    const outcome = envelope;
    const last = await observe();
    const current = last.observation;
    const [manifest, entry, neighbor, finalCollision] = await Promise.all([
      readFile(client, last.before.workingHead, repository, manifestPath),
      readFile(client, last.before.workingHead, repository, appEntry),
      readFile(client, last.before.workingHead, neighborId, guidePath),
      repoAt(last.before.workingHead, destination),
    ]);
    // Actual native effects determine safety/custody; requested completion is independently reviewed.
    const shouldMove = moved?.operation != null;
    const shouldUpdate = updated?.operation != null;
    const alignedAtEnd = aligned?.operation != null || world.layout === "moved" && !world.identityPending;
    const declaredLayout = world.layout === "occupied" ? "original" : world.layout;
    const changes = last.source.entries.length === linkGuide.entries.length && linkGuide.entries.every((originalLink, index) => {
      const next = last.source.entries[index];
      if (!next || originalLink.id !== next.id) return false;
      const baselineLink = parsePanelLocationLink(originalLink.href);
      const shouldChange = shouldUpdate && first?.consumerLinks.some(link => link.id === originalLink.id && link.scope === "working" && link.source === original);
      if (!shouldChange) return originalLink.href === next.href;
      const finalLink = parsePanelLocationLink(next.href);
      if (baselineLink.kind !== "ok" || finalLink.kind !== "ok" || baselineLink.carrier !== finalLink.carrier ||
          finalLink.location.source !== destination) return false;
      const { source: previousSource, ...before } = baselineLink.location;
      const { source: currentSource, ...after } = finalLink.location;
      return previousSource === original && currentSource === destination && isDeepStrictEqual(before, after);
    });
    const expectedNote = coeditApplied ? concurrentNote : linkGuide.note;
    const checks = {
      matchedStableSourceIdentity: current.repository === repository &&
        manifest.id === baselineManifest.id && manifest.text === (alignedAtEnd ? json(destinationManifest) : baselineManifest.text) &&
        entry.id === baselineEntry.id && entry.digest === baselineEntry.digest,
      verifiedExactPlacement: current.layout === (shouldMove ? "moved" : declaredLayout) &&
        (current.layout === "original" || alignedAtEnd ? current.compatiblePanel : current.actualSource === null) &&
        (current.layout !== "moved" || alignedAtEnd && current.actualSource === destination ||
          !alignedAtEnd && current.buildIdentity === "needs-alignment") &&
        (!collision || finalCollision?.repositoryId === collision.repositoryId &&
          isDeepStrictEqual(await readFile(client, last.before.workingHead, collision.repositoryId, manifestPath), collisionManifest)),
      verifiedCompatibleCallerLinks: changes && last.document.id === originalGuide.id &&
        (!shouldUpdate || !staleLinks(current).length) && last.source.note === expectedNote,
      matchedLocalMigrationPlan: typeof outcome?.finding === "string" && Boolean(outcome.finding.trim()),
      authenticMutationCopies: outcome == null || ["move","identity","consumers"].every(key=>
        outcome[key as "move"|"identity"|"consumers"] == null || isDeepStrictEqual(outcome[key as "move"|"identity"|"consumers"],
          key === "move" ? moved : key === "identity" ? aligned : updated)),
      verifiedExactMutationReceipts: [moved,aligned,updated].every(record=>{
        if(record===null||record.status==="not-authorized")return record?.operation==null;
        if(record.status==="state-changed"&&record.operation==null)return true;
        return Boolean(record.operation?.applicationId&&record.operation.changeIds.length===1);
      }),
      preservedCoeditsAndNeighbors: neighbor.id === neighborBefore.id && neighbor.digest === neighborBefore.digest &&
        last.before.mainEventId === initial.mainEventId &&
        ([moved, aligned, updated].some(value => value?.operation != null) || coeditApplied
          ? current.workingRevision !== revision(prepared.workingHead) : current.workingRevision === revision(prepared.workingHead)),
    };
    return {
      outcomeContract:{effects:{checks:["matchedStableSourceIdentity", "verifiedExactPlacement", "verifiedCompatibleCallerLinks", "verifiedExactMutationReceipts", "preservedCoeditsAndNeighbors"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["matchedLocalMigrationPlan"],required:world.requestedReturnRequired,rationale:"Literal requested questions remain required even beside effects. A local grant alone does not request an operation."},
        incidentalValues:{checks:["authenticMutationCopies"],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],
 caseId: world.id, contextId: ownerContext, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      assignment, observed: first, current, move: moved, identity: aligned, consumers: updated, effects: structuredClone(effects),
      nativeFacts:{destination:{path:destination,kind:targetKind??null,browserPanel:destinationPanel},
        original:{repository,manifest:{id:baselineManifest.id,text:baselineManifest.text},entry:{id:baselineEntry.id,text:baselineEntry.text},guide:{id:originalGuide.id,text:originalGuide.text}},
        final:{manifest:{id:manifest.id,text:manifest.text},entry:{id:entry.id,text:entry.text},guide:{id:last.document.id,text:last.document.text}},
        coeditApplied,actorReadbacks:effects.filter(row=>row.service==="panelMigrationEvidence"),
        protocol:"Current source metadata compatibility is not proposed destination eligibility. A local grant permits only exact native operations; refused attempts are diagnostics, not mutations. Actual requested completion and explanations require independent meaning review."} };

  }
  async function qualify() {
    const assignment = await services.panelMigrationEvidence.discover();
    const observed = await services.panelMigrationEvidence.inspect(assignment.id);
    const decision = decisionFor(observed);
    const move = decision === "move-source" || decision === "move-and-update"
      ? await services.panelMigrationChange.move(observed.id, observed.workingRevision) : null;
    const relocated = move?.observation ?? observed;
    const identity = move?.status === "moved" || decision === "align-build" || decision === "align-and-update"
      ? await services.panelMigrationChange.align(relocated.id, relocated.workingRevision, relocated.manifestDigest) : null;
    const next = identity?.observation ?? relocated;
    const consumers = decision === "update-consumers" ||
      (decision === "move-and-update" || decision === "align-and-update") && identity?.status === "aligned"
      ? await services.panelMigrationChange.update(next.id, next.workingRevision, next.consumerDigest) : null;
    const proof = await verify({
      assignment, observed, finding: "Compare existing panel identity, argument compatibility, exact authority and current working links.",
      move, identity, consumers, current: consumers?.observation ?? identity?.observation ?? move?.observation ?? observed,
    });
    const expectedMove = ["move-source","move-and-update"].includes(decision);
    const expectedIdentity = expectedMove&&move?.status==="moved" || ["align-build","align-and-update"].includes(decision);
    const expectedConsumers = decision === "update-consumers" || ["move-and-update","align-and-update"].includes(decision)&&identity?.status==="aligned";
    const referenceRequiredEffects = (!expectedMove || move?.status === (world.race === "before-move"?"state-changed":"moved")) &&
      (!expectedIdentity || identity?.status === (world.race === "before-identity"?"state-changed":"aligned")) &&
      (!expectedConsumers || consumers?.status === (["after-move","before-links"].includes(world.race)?"state-changed":"updated"));
    return assessNativeQualification({...proof,passed:proof.passed&&referenceRequiredEffects,checks:{...proof.checks,referenceRequiredEffects},outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"referenceRequiredEffects"]}}});
  }
  return { services, qualify, verify };
}
