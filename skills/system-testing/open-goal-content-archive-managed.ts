import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { sha256Hex, sha256HexSyncText } from "@vibestudio/content-addressing";
import type { VcsEditChange } from "@vibestudio/service-schemas/vcs";
import { blobstore, contextId, vcs } from "@workspace/runtime";
import type { ContentArchiveWorld as World } from "./open-goal-content-archive-worlds.js";

type Ports = { contextId: string; vcs: typeof vcs;
  blobs: Pick<typeof blobstore, "putBytes" | "putPathTree" | "listTree" | "readFileAtTree" | "getBytes"> };
type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type BlobFile = { path: string; digest: string; mode: number };
type Edition = { ref: string; available: boolean; rootTreeHash: string | null; edition: string | null;
  repository: string | null; manifestDigest: string | null; files: BlobFile[]; coherent: boolean };
type Working = { path: string; fileId: string | null; digest: string | null; mode: number | null;
  state: World["working"][number] };
type Plan = { action: World["expected"]["action"]; paths: string[]; reason: string };
type Receipt = { status: "restored" | "state-changed"; workingRevision: string;
  application: { id: string; changes: string[] } | null; files: Working[] };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
const encode = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });
const revision = (state: State) => JSON.stringify(state);
const approvedMode = 0o644;
const archiveIndex = "archive-index.json";
const notePath = "docs/working-note.md";
const neighborPath = "README.md";
const raceNote = "A newer collaboration note records a pending review.";
const js = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const textContent = (text: string) => ({ kind: "text" as const, text });
const bytesContent = (bytes: Uint8Array) => ({ kind: "bytes" as const, base64: btoa(String.fromCharCode(...bytes)) });

export async function prepareContentArchive(input: { contextId: string; caseId: string }, world: World,
    ports: Ports = { contextId, vcs, blobs: blobstore }) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Content archive request is outside its owned assignment");
  const { contextId: owner, vcs: client, blobs } = ports;
  const status = () => client.status({ contextId: owner });
  const initial = await status();
  const token = crypto.randomUUID().slice(0, 12);
  const project = "projects/archive-recovery-" + token, neighbor = "projects/archive-neighbor-" + token;
  const edition = "approved-edition-" + token, priorEdition = "previous-edition-" + token;
  const paths = ["README.md", "docs/review-notes.md", "attachments/measurements.bin"];
  const allowedPaths = world.scope.map(index => paths[index]);
  const text = (i: number, version: string) => i === 0 ?
    "# " + world.subject + "\n\n" + version + "\n\nRead the [review notes](docs/review-notes.md) and [measurements](attachments/measurements.bin).\n" :
    "# Review notes\n\n" + world.subject + " — " + version + "\n";
  function content(i: number, variant: "approved" | "older" | "editor") {
    if (i < 2) return encode.encode(text(i, variant === "approved" ? "Reviewed local handover" :
      variant === "older" ? "Earlier handover" : "A colleague recorded a new unresolved action"));
    return Uint8Array.from([0, 253, 12, 0, variant === "approved" ? 41 : variant === "older" ? 25 : 99, 255]);
  }
  const contentAt = (i: number, bytes: Uint8Array) => i === 2 ? bytesContent(bytes) : textContent(decode.decode(bytes));
  const approved = paths.map((path, index) => ({ path, digest: sha256Hex(content(index, "approved")), mode: approvedMode }));
  const historical = paths.map((path, index) => ({ path, digest: sha256Hex(content(index, "older")), mode: approvedMode }));
  const note = world.independentNote ? "The existing editor note must stay with this project." : "Preserve the project’s ongoing work.";
  const files = [
    { path: notePath, mode: approvedMode, content: textContent(note) },
    ...world.working.flatMap((drift, index) => drift === "missing" ? [] : [
      { path: drift === "collision" ? paths[index] + "/protected-note.txt" : paths[index],
        mode: drift === "mode" ? 0o755 : approvedMode,
        content: drift === "collision" ? textContent("An existing collection owns this location.") :
          contentAt(index, content(index, drift === "old" ? "older" : drift === "coedit" ? "editor" : "approved")),
      },
    ]),
  ];
  await client.edit({ contextId: owner, commandId: "archive-seed-" + token, expectedWorkingHead: initial.workingHead,
    intentSummary: "Retain one previously authored project and its independent review notes",
    changes: [
      { kind: "repository-create", repoPath: project, files },
      { kind: "repository-create", repoPath: neighbor, files: [{ path: neighborPath, mode: approvedMode,
        content: textContent("Unrelated neighboring workspace project.") }] },
    ],
  });
  const seeded = await status();
  const [target, other] = await Promise.all([
    client.resolveRepository({ state: seeded.workingHead, repoPath: project }),
    client.resolveRepository({ state: seeded.workingHead, repoPath: neighbor }),
  ]);
  if (!target || !other) throw new Error("Could not seed the exact semantic projects");
  const repository = target.repositoryId;
  const approvedIndex = { edition, repository, files: approved };
  const manifestDigest = sha256HexSyncText(js(approvedIndex));
  type ArchiveKind = World["primary"];
  async function seedArchive(kind: ArchiveKind): Promise<string> {
    if (kind === "missing") return "manifest:" + "0".repeat(64);
    const old = kind === "older", entries = old ? historical : approved;
    const manifest = kind === "forged-index" ? { ...approvedIndex, files: entries.map((row, i) =>
      i === 1 ? { ...row, digest: "a".repeat(64) } : row) } :
      { edition: old ? priorEdition : edition, repository: kind === "wrong-project" ? other.repositoryId : repository, files: entries };
    const members = await Promise.all(entries.map(async (row, i) => ({
      ...row, mode: kind === "mode" && i === 2 ? 33261 as const : 33188 as const,
      digest: (await blobs.putBytes(content(i, old ? "older" : "approved"))).digest,
    })));
    const tree = await blobs.putPathTree(Object.fromEntries([
      [archiveIndex, js(manifest)],
      ...members.flatMap(({ path, digest, mode }, index) =>
        kind === "missing-file" && index === 1 ? [] :
          [[kind === "path-alias" && index === 1 ? path.replace("review", "Review") : path, { digest, mode }]]),
    ]), { root: true });
    if (!tree.stateHash) throw new Error("Expected an immutable archived content-state pointer");
    return tree.stateHash;
  }
  const [primary, previous] = await Promise.all([seedArchive(world.primary), seedArchive(world.previous)]);
  const assignment = {
    id: crypto.randomUUID(), goal: world.goal, project, repository, edition, primary, previous,
    previousAllowed: world.previousAllowed, manifestDigest, paths, permitted: allowedPaths,
    approval: { repository: world.grant === "wrong-owner" ? other.repositoryId : repository,
      workingRevision: revision(world.grant === "old-revision" ? initial.workingHead : seeded.workingHead),
      mode: world.grant === "inspect" ? "inspect" as const : "local" as const },
  };

  async function list(state: State, id: string) {
    const page = await client.listFiles({ state, repositoryId: id, limit: 20 });
    if (page.repositoryId !== id || !isDeepStrictEqual(page.state, state) || page.nextCursor !== null)
      throw new Error("Could not inspect the exact complete owned project file list");
    return page.files;
  }
  async function archive(ref: string): Promise<Edition> {
    const empty: Edition = { ref, available: false, rootTreeHash: null, edition: null, repository: null,
      manifestDigest: null, files: [], coherent: false };
    let cursor: string | undefined, root: string | undefined;
    const seen = new Set<string>();
    const listing = new Map<string, BlobFile>();
    for (let count = 0; count < 16; count++) {
      const page = await blobs.listTree(ref, { prefix: "", limit: 2, ...(cursor ? { cursor } : {}) });
      if (!page && count === 0) return empty;
      if (!page || page.basis.ref !== ref || page.basis.prefix !== "" || page.basis.order !== "tree-preorder-v1" ||
          root && root !== page.basis.rootTreeHash || page.entries.length > 2)
        throw new Error("Archive tree paging crossed an immutable basis");
      root = page.basis.rootTreeHash;
      for (const entry of page.entries) {
        if (seen.has(entry.path)) throw new Error("Archive paging repeated a retained tree path");
        seen.add(entry.path);
        if (entry.kind === "file")
          listing.set(entry.path, { path: entry.path, digest: entry.contentHash, mode: entry.mode & 0o777 });
      }
      if (page.completeness === "complete") { cursor = undefined; break; }
      if (cursor === page.nextCursor || !page.entries.length) throw new Error("Archive paging did not advance");
      cursor = page.nextCursor;
    }
    if (!root || cursor) throw new Error("Archive tree listing did not settle within the assigned bound");
    const visible = { ...empty, available: true, rootTreeHash: root, files: [...listing.values()].filter(row => row.path !== archiveIndex) };
    const index = await blobs.readFileAtTree(ref, archiveIndex);
    if (!index || index.contentHash !== listing.get(archiveIndex)?.digest || (index.mode & 0o777) !== approvedMode)
      return visible;
    const bytes = await blobs.getBytes(index.contentHash);
    if (!bytes || bytes.length > 10000 || sha256Hex(bytes) !== index.contentHash) return visible;
    const manifest = JSON.parse(decode.decode(bytes)) as typeof approvedIndex;
    const coherent = typeof manifest.repository === "string" && typeof manifest.edition === "string" &&
      Array.isArray(manifest.files) && manifest.files.length === paths.length &&
      isDeepStrictEqual(manifest.files.map(item => item.path), paths) &&
      manifest.files.every(item => item.mode === approvedMode && isDeepStrictEqual(item, listing.get(item.path)));
    const exactPaths = coherent && await Promise.all(paths.map(async path => {
      const member = await blobs.readFileAtTree(ref, path);
      const row = listing.get(path);
      if (!member || row?.digest !== member.contentHash || row.mode !== (member.mode & 0o777)) return false;
      const retained = await blobs.getBytes(member.contentHash);
      return retained !== null && retained.length <= 20000 && sha256Hex(retained) === member.contentHash;
    }));
    return { ...visible, edition: manifest.edition, repository: manifest.repository,
      manifestDigest: index.contentHash, coherent: exactPaths !== false && exactPaths.every(Boolean) };
  }

  async function working(state: State, rows?: Awaited<ReturnType<typeof list>>): Promise<Working[]> {
    const current = rows ?? await list(state, repository);
    return paths.map((path, i) => {
      const item = current.find(file => file.path === path);
      const drift = !item ? current.some(file => file.path.startsWith(path + "/") || path.startsWith(file.path + "/")) ? "collision" : "missing" :
        item.contentHash === approved[i].digest ? item.mode === approvedMode ? "current" : "mode" :
          item.contentHash === historical[i].digest && item.mode === approvedMode ? "old" : "coedit";
      return { path, fileId: item?.fileId ?? null, digest: item?.contentHash ?? null, mode: item?.mode ?? null, state: drift };
    });
  }
  async function observe() {
    const checkpoint = await status();
    const [first, second, files] = await Promise.all([
      archive(primary), primary === previous ? archive(primary) : archive(previous), working(checkpoint.workingHead),
    ]);
    return { workingRevision: revision(checkpoint.workingHead), mainRevision: checkpoint.mainEventId,
      repository, primary: first, previous: second, working: files };
  }
  type Observation = Awaited<ReturnType<typeof observe>>;
  const initialRows = await list(seeded.workingHead, repository);
  const initialNeighbor = await list(seeded.workingHead, other.repositoryId);
  let discovered = false, busy = false;
  let observed: Observation | null = null;
  let storedReceipt: Receipt | null = null;
  const effects: Effect[] = [];
  function capture<T>(service: string, method: string, args: unknown[], value: T): T {
    effects.push(structuredClone({ service, method, args, result: value }));
    return structuredClone(value);
  }
  function choose(observation: Observation) {
    const matches = (e: Edition) => e.available && e.coherent && e.repository === repository &&
      e.edition === edition && e.manifestDigest === manifestDigest;
    if (matches(observation.primary)) return observation.primary.ref;
    if (!observation.primary.available && world.previousAllowed && matches(observation.previous)) return observation.previous.ref;
    return null;
  }
  function plan(observation: Observation, ref: string | null): Pick<Plan, "action" | "paths"> {
    const hold = (action: Plan["action"]) => ({ action, paths: [] });
    if (!ref) return hold("hold-archive");
    const allowed = observation.working.filter(row => assignment.permitted.includes(row.path));
    if (allowed.some(row => row.state === "collision")) return hold("hold-collision");
    if (allowed.some(row => row.state === "coedit")) return hold("hold-coedit");
    const edits = allowed.filter(row => row.state !== "current").map(row => row.path);
    if (!edits.length) return hold("keep-current");
    if (assignment.approval.mode === "inspect") return hold("inspect-only");
    if (assignment.approval.repository !== repository) return hold("hold-scope");
    if (assignment.approval.workingRevision !== observation.workingRevision) return hold("hold-revision");
    return { action: "restore", paths: edits };
  }

  const services = {
    contentArchiveEvidence: {
      async discover() {
        if (discovered) return structuredClone(assignment);
        discovered = true;
        return capture("contentArchiveEvidence", "discover", [], assignment);
      },
      async inspect(id: string) {
        if (id === assignment.id && observed) return structuredClone(observed);
        if (busy || id !== assignment.id) throw new Error("Inspect only the exact assigned archive and project");
        busy = true;
        try { observed = await observe(); return capture("contentArchiveEvidence", "inspect", [id], observed); }
        finally { busy = false; }
      },
    },
    contentArchiveChange: {
      async restore(id: string, ref: string | null, head: string, selected: string[]) {
        if (!observed || busy || storedReceipt || id !== assignment.id || !ref || ref !== choose(observed) || head !== observed.workingRevision)
          throw new Error("Restore only the approved immutable archive and exact review basis");
        const approvedPlan = plan(observed, ref);
        if (approvedPlan.action !== "restore" || !isDeepStrictEqual(approvedPlan.paths, selected))
          throw new Error("Restore exactly the scoped atomic set without coeditor paths");
        busy = true;
        try {
          const record = (receipt: Receipt) => {
            storedReceipt = receipt;
            return capture("contentArchiveChange", "restore", [id, ref, head, selected], receipt);
          };
          const stale = async (known?: Awaited<ReturnType<typeof status>>) => {
            const latest = known ?? await status();
            return record({ status: "state-changed", workingRevision: revision(latest.workingHead),
              application: null, files: await working(latest.workingHead) });
          };
          const checkpoint = await status();
          if (head !== revision(checkpoint.workingHead) || checkpoint.mainEventId !== observed.mainRevision) return stale(checkpoint);
          if (world.race) {
            const note = initialRows.find(row => row.path === notePath)!;
            await client.edit({ contextId: owner, commandId: crypto.randomUUID(), expectedWorkingHead: checkpoint.workingHead,
              intentSummary: "Retain the coeditor’s newer local working note",
              changes: [{ kind: "content-replace", repositoryId: repository, fileId: note.fileId, content: textContent(raceNote) }] });
            return stale();
          }
          const changes: VcsEditChange[] = [];
          for (const path of selected) {
            const index = paths.indexOf(path);
            const member = await blobs.readFileAtTree(ref, path);
            if (!member || member.contentHash !== approved[index].digest || (member.mode & 0o777) !== approvedMode)
              throw new Error("The immutable approved member did not match its reviewed digest and mode");
            const bytes = await blobs.getBytes(member.contentHash);
            if (!bytes || bytes.length > 20000 || sha256Hex(bytes) !== member.contentHash)
              throw new Error("The exact approved archive bytes are unavailable");
            const current = observed.working[index];
            const body = contentAt(index, bytes);
            changes.push(current.fileId ? { kind: "content-replace", repositoryId: repository, fileId: current.fileId, content: body, mode: approvedMode } :
              { kind: "file-create", repositoryId: repository, path, content: body, mode: approvedMode });
          }
          let applied: Awaited<ReturnType<typeof vcs.edit>>;
          try {
            applied = await client.edit({ contextId: owner, commandId: crypto.randomUUID(), expectedWorkingHead: checkpoint.workingHead,
              intentSummary: "Restore the exact admitted immutable members as one local project edit", changes });
          } catch (error) {
            const current = await status();
            if (revision(current.workingHead) !== head || current.mainEventId !== checkpoint.mainEventId) return stale(current);
            throw error;
          }
          if (applied.changeIds.length !== selected.length) throw new Error("The archive edit did not commit the exact scoped set");
          return record({ status: "restored", workingRevision: revision(applied.workingHead),
            application: { id: applied.applicationId, changes: applied.changeIds }, files: await working(applied.workingHead) });
        } finally { busy = false; }
      },
    },
  };
  
  async function verify(report: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(report,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedScopedLocalPlan"],"rootPath":["action"],"producerSourceSuffix":"recoverContentArchive/planRestoration.nl","producerPath":["action"]},{"checks":["matchedScopedLocalPlan"],"rootPath":["reason"],"producerSourceSuffix":"recoverContentArchive/planRestoration.nl","producerPath":["reason"]}];
    const contributions=authored.filter(binding=>{
      let current:unknown=report;
      for(const key of binding.rootPath){
        if(current===null||typeof current!=="object"||!Object.hasOwn(current,key))return false;
        current=(current as Record<string|number,unknown>)[key];
      }
      return true;
    });
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,report,invocation,contributions);
    // Preserve every original native observation for qualification and callers
    // that add their own checks before the final outcome projection.
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
async function verifyNativeApplication(report: unknown, invocation?: InvocationObservations) {
    const envelope = report as {
      action:Plan["action"];reason:string;receipt:Receipt|null;
    } | null;
    const checkpoint = await status();
    const out = envelope;
    const [rows, neighboring, exactRepo, first, second] = await Promise.all([
      list(checkpoint.workingHead, repository), list(checkpoint.workingHead, other.repositoryId),
      client.resolveRepository({ state: checkpoint.workingHead, repoPath: project }), archive(primary), archive(previous),
    ]);
    const restored = world.expected.restored.map(index => paths[index]);
    const intended = world.expected.action === "restore" ? world.scope.filter(index => world.working[index] !== "current").map(index => paths[index]) : [];
    const expectedRef = world.expected.edition ? assignment[world.expected.edition] : null;
    const changed = new Set([...restored, ...(world.race ? [notePath] : [])]);
    const stable = rows.filter(row => !changed.has(row.path));
    const corresponding = initialRows.filter(row => !changed.has(row.path));
    const expectedRestore = world.expected.action === "restore";
    const counts = !!storedReceipt?.application?.id && storedReceipt.application.changes.length === restored.length;
    const final = await working(checkpoint.workingHead, rows);
    const recovered = await Promise.all(restored.map(path =>
      client.readFile({ state: checkpoint.workingHead, repositoryId: repository, file: { kind: "path", path } })));
    const checks = {
      exactArchiveTreesAndBasis: observed !== null && isDeepStrictEqual(observed.primary, first) &&
        isDeepStrictEqual(observed.previous, second),
      matchedApprovedEdition: !!observed&&choose(observed)===expectedRef,
      matchedScopedLocalPlan: out?.action===world.expected.action&&typeof out?.reason==="string"&&!!out.reason.trim()&&isDeepStrictEqual(out?.receipt,storedReceipt),
      restoredExactAddressedMembers: restored.every((path, i) => {
        const b = approved[paths.indexOf(path)];
        const row = rows.find(file => file.path === path);
        const before = initialRows.find(file => file.path === path);
        const body = recovered[i];
        if (!body || body.repositoryId !== repository || body.path !== path || body.fileId !== row?.fileId) return false;
        const bytes = body.content.kind === "text" ? encode.encode(body.content.text) :
          Uint8Array.from(atob(body.content.base64), character => character.charCodeAt(0));
        return sha256Hex(bytes) === b.digest && row.contentHash === b.digest && row.mode === b.mode &&
          (!before || row.fileId === before.fileId);
      }),
      verifiedAtomicReceipt: (expectedRestore ? world.race ?
        storedReceipt?.status === "state-changed" && storedReceipt.application === null :
        storedReceipt?.status === "restored" && counts : storedReceipt === null) &&
        (!storedReceipt || storedReceipt.workingRevision === revision(checkpoint.workingHead) && isDeepStrictEqual(storedReceipt.files, final)) &&
        sameEvidenceMembers(effects.map(item => item.method), expectedRestore ? ["discover", "inspect", "restore"] : ["discover", "inspect"]),
      preservedWorkingProjectAndNeighbor: exactRepo?.repositoryId === repository && isDeepStrictEqual(stable, corresponding) &&
        isDeepStrictEqual(neighboring, initialNeighbor) && checkpoint.mainEventId === initial.mainEventId &&
        (!world.race || rows.find(file => file.path === notePath)?.contentHash === sha256HexSyncText(raceNote)) &&
        (expectedRestore ? revision(checkpoint.workingHead) !== revision(seeded.workingHead) : revision(checkpoint.workingHead) === revision(seeded.workingHead)),
    };
    return {
      outcomeContract:{effects:{checks:["exactArchiveTreesAndBasis", "matchedApprovedEdition", "restoredExactAddressedMembers", "verifiedAtomicReceipt", "preservedWorkingProjectAndNeighbor"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["matchedScopedLocalPlan"],required:world.expected.action!=="restore",rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],
 caseId: world.id, contextId: owner, goal: world.goal, assignment, observation: observed,
      action: out?.action, reason: out?.reason, receipt: storedReceipt, effects: structuredClone(effects),
      checks, passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    const assigned = await services.contentArchiveEvidence.discover();
    const observation = await services.contentArchiveEvidence.inspect(assigned.id);
    const ref = choose(observation);
    const drafted = { ...plan(observation, ref), reason: "Inspect exact pinned material, working conflicts and local scope." };
    const receipt = drafted.action === "restore" ?
      await services.contentArchiveChange.restore(assigned.id, ref, observation.workingRevision, drafted.paths) : null;
    return verify({
      action:drafted.action,reason:drafted.reason,receipt,
    });
  }
  return { services, qualify, verify };
}
