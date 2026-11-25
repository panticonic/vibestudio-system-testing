import {type ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["assignment", "review", "candidate", "history", "decision", "effects"], ["dossierText"]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { BuildMetadataWire } from "@vibestudio/service-schemas/build";
import type { ExtensionStatus } from "@vibestudio/service-schemas/extensions";
import type { RuntimeSupervisionReleaseVersions } from "@vibestudio/service-schemas/runtime";
import { extensionUnitManifestDescriptor, UnitManifestError, validateUnitManifest } from "@vibestudio/shared/unitManifest";
import { contextId, extensions, fs, rpc, vcs } from "@workspace/runtime";
import { bindExtensionRelease } from "@workspace-skills/extensiondev/workflow";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { ExtensionDossierWorld as World } from "./open-goal-extension-dossier-worlds.js";

type Binder = ReturnType<typeof bindExtensionRelease>;
type Source = Awaited<ReturnType<Binder["services"]["extensionReleaseRead"]["source"]>>;
type Runtime = Awaited<ReturnType<Binder["services"]["extensionReleaseRead"]["runtime"]>>;
type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type Candidate = { delta: Awaited<ReturnType<typeof manifestDelta>>; compatibility:
  "invalid" | "authority-review" | "verification-needed" | "published-package" };
type Owner = { name: string; source: string; candidateTree: string | null; grant: World["grant"]; retainedBuild: string | null };
type Assignment = { request: Binder["request"]; owner: Owner; purpose: World["purpose"] };
type Decision = "stale-owner-scope" | "outside-local-scope" | "candidate-incompatible" | "authority-review-required" |
  "verify-local-candidate" | "release-evidence-conflict" | "wait-for-release" | "record-current-comparison" |
  "rollback-not-retained" | "record-retained-rollback";
type Dossier = { path: string; bytes: number; sha256: string };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Ports = {
  contextId: string; vcs: typeof vcs; fs: typeof fs; binder: typeof bindExtensionRelease;
  extensionStatus(name: string): Promise<ExtensionStatus>;
  versions(name: string): Promise<RuntimeSupervisionReleaseVersions>;
  metadata(key: string): Promise<BuildMetadataWire | null>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
type Rule = { website?: { kind?: string; reason?: string; rationale?: string }; effect?: { kind?: string } };
type Package = { name: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>;
  vibestudio: { entry?: string; sourcemap?: boolean; authority?: { requests?: unknown[]; provides?: unknown[]; serviceRequests?: unknown[] };
    extension: { activationEvents?: string[]; dependencyMode?: string; methodAuthority?: Record<string, Rule> } } };
type ManifestRead = { config: Package; digest: string };
const decoder = new TextDecoder("utf-8", { fatal: true });
const scratchNames = /^evidence-handoff-[a-f0-9]{32}$/u;

async function packageAt(client: typeof vcs, state: State, world: World): Promise<ManifestRead> {
  const repo = await client.resolveRepository({ state, repoPath: world.source });
  const file = repo && await client.readFile({ state, repositoryId: repo.repositoryId,
    file: { kind: "path", path: "package.json" } });
  if (!repo || !file || file.repositoryId !== repo.repositoryId || file.path !== "package.json" || file.content.kind !== "text")
    throw new Error("Could not read the assigned extension package");
  const config = JSON.parse(file.content.text) as Package;
  if (config.name !== world.name) throw new Error("Extension package name differs from its owned assignment");
  return { config, digest: file.contentHash };
}
function keys<T>(left: Record<string, T>, right: Record<string, T>) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
}
function manifestDelta(working: ManifestRead, published: ManifestRead) {
  const left = published.config.vibestudio, right = working.config.vibestudio;
  let candidateValidationError: string | null = null;
  try { validateUnitManifest(extensionUnitManifestDescriptor, right, { unitName: working.config.name }); }
  catch (error) {
    if (!(error instanceof UnitManifestError)) throw error;
    candidateValidationError = error.code;
  }
  const before = left.extension.methodAuthority ?? {}, after = right.extension.methodAuthority ?? {};
  const methodChanges = keys(before, after).flatMap(method => {
    const old = before[method], fresh = after[method];
    if (isDeepStrictEqual(old, fresh)) return [];
    const change = !old ? "added" as const : !fresh ? "removed" as const : "changed" as const;
    return [{ method, change, accessExpansion: Boolean(fresh && (
      fresh.website?.kind === "eligible" && old?.website?.kind !== "eligible" ||
      old && old.effect?.kind !== "open" && fresh.effect?.kind === "open")) }];
  });
  const dependencyChanges = (["dependencies", "optionalDependencies"] as const).flatMap(field => {
    const was = published.config[field] ?? {}, now = working.config[field] ?? {};
    return keys(was, now).filter(name => was[name] !== now[name]).map(name => field + ":" + name);
  });
  if (left.extension.dependencyMode !== right.extension.dependencyMode) dependencyChanges.push("extension:dependencyMode");
  const requestLists = (config: Package["vibestudio"]) => ["requests", "provides", "serviceRequests"].flatMap(
    key => (config.authority?.[key as keyof NonNullable<typeof config.authority>] ?? [])
      .map(row => key + ":" + sha256HexSyncText(JSON.stringify(row))));
  const was = requestLists(left), now = requestLists(right);
  const capabilityChanges = [...was.filter(row => !now.includes(row)), ...now.filter(row => !was.includes(row))].sort();
  return {
    workingDigest: working.digest, publishedDigest: published.digest, candidateValidationError,
    activation: { working: right.extension.activationEvents ?? [], published: left.extension.activationEvents ?? [] },
    dependencyChanges, methodChanges, capabilityChanges, expandedCapabilities: now.some(row => !was.includes(row)),
  };
}

async function seedCandidate(world: World, ports: Ports, state: State) {
  if (world.change === "none") return;
  const client = ports.vcs;
  const { config } = await packageAt(client, state, world);
  const repository = await client.resolveRepository({ state, repoPath: world.source });
  if (!repository) throw new Error("Missing assigned extension repository");
  const file = await client.readFile({ state, repositoryId: repository.repositoryId,
    file: { kind: "path", path: world.change === "implementation" ? config.vibestudio.entry ?? "index.ts" : "package.json" } });
  if (!file || file.repositoryId !== repository.repositoryId || file.content.kind !== "text") throw new Error("Missing candidate source");
  const block = config.vibestudio.extension;
  const method = block.methodAuthority?.[world.method];
  if (!method) throw new Error("Missing assigned candidate method");
  switch (world.change) {
    case "implementation": break;
    case "dependency": block.dependencyMode = block.dependencyMode === "bundle" ? "auto" : "bundle"; break;
    case "startup": block.activationEvents = ["*"]; break;
    case "invalid-activation": block.activationEvents = ["manual-review"]; break;
    case "invalid-sourcemap": config.vibestudio.sourcemap = false; break;
    case "widen-method": method.website = { kind: "eligible", rationale: "Candidate would allow a caller-supplied web request." }; break;
    case "close-method": method.website = { kind: "closed", reason: "Candidate restricts this method to the internal reviewer." }; break;
    case "remove-method": delete block.methodAuthority![world.method]; break;
  }
  const text = world.change === "implementation" ? file.content.text + "\n// Local extension verification candidate.\n"
    : JSON.stringify(config, null, 2) + "\n";
  await client.edit({ contextId: ports.contextId, expectedWorkingHead: state, commandId: "extension-dossier-" + crypto.randomUUID(),
    intentSummary: "Prepare one disposable local extension candidate for release review",
    changes: [{ kind: "content-replace", repositoryId: repository.repositoryId, fileId: file.fileId, content: { kind: "text", text } }] });
}

const dispositions = {
  "waiting-approval": "wait-for-approval", building: "wait-for-build", failed: "inspect-failure",
  cold: "await-activation", "live-method": "observed-live", "method-not-observed": "inspect-active-contract",
} as const;
function expectedReview(source: Source, runtime: Runtime, method: string) {
  const sourceDisposition = !source.working ? "missing-manifest" : !source.published || source.publishedTree !== source.workingTree
    ? "unpublished-candidate" : source.working.methods.includes(method) ? "published-method" : "undeclared-method";
  const runtimeDisposition = runtime.pendingApproval || runtime.status === "pending-approval" ? "waiting-approval" :
    runtime.status === "building" ? "building" : runtime.status === "error" || runtime.hasError ? "failed" :
      runtime.status !== "running" || !runtime.identity || !runtime.activeEv ? "cold" :
        runtime.methods.includes(method) ? "live-method" : "method-not-observed";
  const decision = sourceDisposition === "missing-manifest" ? "inspect-manifest" :
    sourceDisposition === "unpublished-candidate" ? "verify-and-publish-candidate" :
      sourceDisposition === "undeclared-method" ? "declare-method" : dispositions[runtimeDisposition];
  return { source: { observation: source, disposition: sourceDisposition }, runtime: { observation: runtime, disposition: runtimeDisposition }, decision };
}

export async function prepareExtensionDossier(input: { contextId: string; caseId: string }, world: World, ports: Ports = {
  contextId, vcs, fs, binder: bindExtensionRelease, extensionStatus: name => extensions.status(name),
  versions: name => rpc.call("main", mainRpcMethods["runtime.supervision.versions"], [{kind: "extension", releaseId: name}]),
  metadata: key => rpc.call("main", mainRpcMethods["build.getBuildMetadata"], [key]),
  readBytes: (path, limit) => readWorkspaceBytes(rpc, path, limit),
}) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Wrong extension dossier assignment");
  const { contextId: ownerContext, vcs: client, fs: files, readBytes } = ports;
  const initial = await client.status({ contextId: ownerContext });
  await seedCandidate(world, ports, initial.workingHead);
  const assigned = await client.status({ contextId: ownerContext });
  const published = { kind: "event", eventId: assigned.mainEventId } as const;
  const bind = () => ports.binder({ ...world, contextId: ownerContext });
  const bound = bind();
  const readBound = async () => {
    const fresh = bind();
    const source = await fresh.services.extensionReleaseRead.source(fresh.request.operationId);
    const runtime = await fresh.services.extensionReleaseRead.runtime(fresh.request.operationId);
    return expectedReview({ ...source, operationId: bound.request.operationId }, { ...runtime, operationId: bound.request.operationId }, world.method);
  };
  const baselineReview = await readBound();
  const baseline = baselineReview.source.observation;
  const originalVersions = await ports.versions(world.name);
  const retainedBuild = world.purpose !== "rollback" ? null :
    world.rollback === "latest-retained" ? originalVersions.previous[0]?.buildKey ?? null :
      world.rollback === "active-version" ? originalVersions.current?.buildKey ?? null : "evicted-" + crypto.randomUUID();
  const scope: Owner = {
    name: world.receipt === "different-unit" ? "@workspace-extensions/image-service" : world.name,
    source: world.receipt === "different-unit" ? "extensions/image-service" : world.source,
    candidateTree: world.receipt === "old-tree" ? baseline.publishedTree : baseline.workingTree,
    grant: world.grant, retainedBuild,
  };
  const directory = await files.mkdtemp("extension-owner-scope");
  const scopePath = directory + "/decision.json";
  const scopeBytes = JSON.stringify(scope);
  await files.writeFile(scopePath, scopeBytes);
  const getScope = async (): Promise<Owner> => JSON.parse(decoder.decode(await readBytes(scopePath, 24 * 1024)));
  const preexisting = (await listOwnedScratchEntries(files)).filter(name => scratchNames.test(name));
  const scratch = bindScratchHandoff(files, { goal: world.goal, sources: [{ id: "retained-owner-scope", path: scopePath }],
    questions: ["Which local release review can be preserved under this exact owner scope?"] }, readBytes);

  const currentAssignment = async () => ({ request: bound.request, purpose: world.purpose, owner: await getScope() });
  const currentCandidate = async (basis: Awaited<ReturnType<typeof readBound>>): Promise<Candidate> => {
    const [working, main] = await Promise.all([packageAt(client, assigned.workingHead, world), packageAt(client, published, world)]);
    const delta = manifestDelta(working, main);
    const { workingTree, publishedTree } = basis.source.observation;
    const expansion = delta.expandedCapabilities || delta.methodChanges.some(item => item.accessExpansion) ||
      delta.activation.working[0] === "*" && delta.activation.published[0] !== "*";
    return { delta, compatibility: delta.candidateValidationError ? "invalid" : expansion ? "authority-review" :
      workingTree !== publishedTree ? "verification-needed" : "published-package" };
  };
  const currentHistory = async (owner: Owner) => {
    const [status, versions] = await Promise.all([ports.extensionStatus(world.name), ports.versions(world.name)]);
    const requested = owner.retainedBuild && owner.name === world.name && owner.source === world.source
      ? versions.previous.find(row => row.buildKey === owner.retainedBuild && row.releaseId === world.name) ?? null : null;
    const metadata = requested && await ports.metadata(requested.buildKey);
    function record(version: RuntimeSupervisionReleaseVersions["current"]) {
      return version ? { buildKey: version.buildKey, effectiveVersion: version.effectiveVersion, version: version.version } : null;
    }
    return {
      current: record(versions.current), previous: versions.previous.filter(row => row.releaseId === world.name).slice(0, 12).map(row => record(row)!),
      retentionLimit: versions.retentionLimit, requested: record(requested),
      requestedBuildVerified: Boolean(metadata && requested && metadata.kind === "extension" && metadata.name === world.name &&
        metadata.sourcePath === world.source && metadata.buildKey === requested.buildKey && metadata.ev === requested.effectiveVersion),
      receiverMatches: status.name === world.name && status.source === world.source &&
        (!status.identity || status.identity.entityId === world.name) &&
        (!versions.current || versions.current.releaseId === world.name) &&
        versions.previous.every(row => row.releaseId === world.name) &&
        (versions.current?.buildKey ?? null) === status.activeBundleKey && (versions.current?.effectiveVersion ?? null) === status.activeEv,
    };
  };

  type Review = Awaited<ReturnType<typeof readBound>>;
  type History = Awaited<ReturnType<typeof currentHistory>>;
  type Outcome = { assignment: Assignment; review: Review; candidate: Candidate; history: History;
    finding: { decision: Decision; reason: string }; dossier: Dossier | null };
  let discovery: Assignment | undefined;
  let source: Source | undefined;
  let runtime: Runtime | undefined;
  let candidate: Candidate | undefined;
  let history: History | undefined;
  let stored: Dossier | null = null;
  const effects: Effect[] = [];
  function capture<T>(service: Effect["service"], method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }
  function decisionFor(assignment: Assignment, review: Review, candidate: Candidate, history: History): Decision {
    const { owner, purpose } = assignment;
    const observed = review.source.observation;
    if (owner.name !== observed.name || owner.source !== observed.source || owner.candidateTree !== observed.workingTree)
      return "stale-owner-scope";
    if (owner.grant === "withdrawn" || owner.grant === "publish" || purpose === "rollback" && owner.grant !== "local-rollback-dossier")
      return "outside-local-scope";
    if (purpose === "rollback") {
      if (!history.receiverMatches) return "release-evidence-conflict";
      return history.requestedBuildVerified ? "record-retained-rollback" : "rollback-not-retained";
    }
    if (candidate.compatibility === "invalid") return "candidate-incompatible";
    if (candidate.compatibility === "authority-review") return "authority-review-required";
    if (candidate.compatibility === "verification-needed") return "verify-local-candidate";
    if (!history.receiverMatches) return "release-evidence-conflict";
    if (["waiting-approval", "building", "failed"].includes(review.runtime.disposition)) return "wait-for-release";
    return "record-current-comparison";
  }
  function canStage(assignment: Assignment, decision: Decision) {
    return assignment.owner.grant === "local-rollback-dossier" ? decision === "record-retained-rollback" :
      assignment.owner.grant === "local-verification" && ["verify-local-candidate", "record-current-comparison"].includes(decision);
  }
  function bodyFor(assignment: Assignment, review: Review, candidate: Candidate, history: History, decision: Decision) {
    return JSON.stringify({ schema: "local-extension-release-dossier/1", assignment, review, candidate, history, decision }, null, 2) + "\n";
  }
  function requireObserved(id: string) {
    if (!source || !runtime || bound.request.operationId !== id || !discovery)
      throw new Error("Observe the exact installed extension before its package or release history");
    return expectedReview(source, runtime, world.method);
  }

  const services = {
    extensionReleaseRead: {
      async source(id: string) {
        if (id !== bound.request.operationId) throw new Error("Read the exact owned extension release");
        discovery ??= await currentAssignment();
        if (source) return structuredClone(source);
        source = await bound.services.extensionReleaseRead.source(id);
        return capture("extensionReleaseRead", "source", [id], source);
      },
      async runtime(id: string) {
        runtime = await bound.services.extensionReleaseRead.runtime(id);
        return capture("extensionReleaseRead", "runtime", [id], runtime);
      },
    },
    extensionDossierRead: {
      async discover() {
        if (discovery) return structuredClone(discovery);
        discovery = await currentAssignment();
        return capture("extensionDossierRead", "discover", [], discovery);
      },
      async candidate(id: string) {
        if (id !== bound.request.operationId) throw new Error("Read the exact owned extension candidate");
        discovery ??= await currentAssignment();
        // The candidate is bound to the assigned immutable heads. Reading it
        // does not require an earlier actor read of unrelated runtime status.
        candidate = await currentCandidate(baselineReview);
        return capture("extensionDossierRead", "candidate", [id], candidate.delta);
      },
      async history(id: string) {
        if (id !== bound.request.operationId) throw new Error("Read the exact owned release history");
        discovery ??= await currentAssignment();
        history = await currentHistory(discovery!.owner);
        return capture("extensionDossierRead", "history", [id], history);
      },
    },
    extensionDossierWrite: {
      async stage(decision: Decision) {
        const report = requireObserved(bound.request.operationId);
        const assignment = await currentAssignment();
        const head = await client.status({ contextId: ownerContext });
        if (stored || !candidate || !history || !isDeepStrictEqual(assignment, discovery) || !canStage(assignment, decision) ||
            decisionFor(assignment, report, candidate, history) !== decision || head.mainEventId !== assigned.mainEventId ||
            !isDeepStrictEqual(head.workingHead, assigned.workingHead) || !isDeepStrictEqual(await readBound(), report) ||
            !isDeepStrictEqual(await currentHistory(assignment.owner), history))
          return capture("extensionDossierWrite", "stage", [decision], null);
        const body = bodyFor(assignment, report, candidate, history, decision);
        const receipt = await scratch.scratchHandoffWrite.stage(body);
        if (receipt) stored = { ...receipt, sha256: sha256HexSyncText(body) };
        return capture("extensionDossierWrite", "stage", [decision], stored);
      },
    },
  };

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["respectedLocalReleaseDecision"],"rootPath":["finding"],"producerSourceSuffix":"reviewExtensionDossier/decideDossier.nl","producerPath":[]}];
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
    const found = await currentAssignment();
    const [review, active, after, afterOutputs, originalScope] = await Promise.all([
      readBound(), currentHistory(found.owner), client.status({contextId: ownerContext}), listOwnedScratchEntries(files), readBytes(scopePath, 24 * 1024),
    ]);
    const compared = await currentCandidate(review);
    const decision = decisionFor(found, review, compared, active);
    const shouldStage = canStage(found, decision);
    const added = afterOutputs.filter(name => scratchNames.test(name) && !preexisting.includes(name));
    const artifactCount = effects.filter(effect => effect.service === "extensionDossierWrite").length;
    let dossierText:string|null = null;
    let note = !shouldStage && stored === null && added.length === 0 && artifactCount === 0;
    if (shouldStage && stored && added.length === 1 && artifactCount === 1) {
      const bytes = await readBytes(stored.path, stored.bytes);
      const body = decoder.decode(bytes);
      dossierText = body;
      note = stored.path === "/.tmp/" + added[0] + "/handoff.json" && bytes.length === stored.bytes &&
        sha256HexSyncText(body) === stored.sha256 && body === bodyFor(found, review, compared, active, decision);
    }
    const expectedMethods = ["discover", "source", "runtime", "candidate", "history", ...(shouldStage ? ["stage"] : [])];
    const checks = {
      boundOriginalOwnerScope: decoder.decode(originalScope) === scopeBytes && isDeepStrictEqual(discovery, found) &&
        sameEvidenceMembers(effects.map(effect => effect.method), expectedMethods),
      usedExactInstalledReleaseReview: isDeepStrictEqual(source, review.source.observation) &&
        isDeepStrictEqual(runtime, review.runtime.observation),
      verifiedPackageDifference: isDeepStrictEqual(candidate, compared) &&
        compared.delta.workingDigest === review.source.observation.working?.hash &&
        compared.delta.publishedDigest === review.source.observation.published?.hash,
      reconciledNativeReleaseHistory: isDeepStrictEqual(history, active),
      respectedLocalReleaseDecision: isDeepStrictEqual(outcome?.dossier,stored)&&outcome?.finding?.decision === decision && typeof outcome.finding.reason === "string" &&
        outcome.finding.reason.trim().length > 0,
      verifiedExactDossier: note && preexisting.every(name => afterOutputs.includes(name)),
      preservedProtectedSourceAndRuntime: after.mainEventId === initial.mainEventId &&
        isDeepStrictEqual(after.workingHead, assigned.workingHead) && baselineReview.runtime.observation.activeEv === review.runtime.observation.activeEv &&
        baselineReview.runtime.observation.identity === review.runtime.observation.identity,
    };
    return {
      outcomeContract:{
        effects:{checks:["boundOriginalOwnerScope", "usedExactInstalledReleaseReview", "verifiedPackageDifference", "reconciledNativeReleaseHistory", "verifiedExactDossier", "preservedProtectedSourceAndRuntime"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["respectedLocalReleaseDecision"],required:!shouldStage,rationale:"The requested analysis is application data; a redundant result copy is optional once the requested native artifact or operation exists."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}},
      incorrectReturnValues:[],
 caseId: input.caseId, contextId: ownerContext, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      assignment: found, review, candidate: compared, history: active, decision, dossier: stored, dossierText, effects: structuredClone(effects) };
  }

  async function qualify() {
    const assignment = await services.extensionDossierRead.discover();
    const id = assignment.request.operationId;
    const [, source, runtime, history] = await Promise.all([
      services.extensionDossierRead.candidate(id),
      services.extensionReleaseRead.source(id),
      services.extensionReleaseRead.runtime(id),
      services.extensionDossierRead.history(id),
    ]);
    const review = expectedReview(source, runtime, world.method);
    if (!candidate) throw new Error("Reference candidate was not observed");
    const decision = decisionFor(assignment, review, candidate, history);
    const dossier = canStage(assignment, decision) ? await services.extensionDossierWrite.stage(decision) : null;
    const result = {finding:{decision,reason:"Exact package, current release and retained owner scope."},dossier};
    const proof = await verify(result);
    const rejectedInventedApplicationValue = !(await verify({...result,finding:{decision:"invented",reason:"invented"}})).outcomeDimensions.returnedValue.passed;
    const checks = {...proof.checks,rejectedInventedApplicationValue};
    return {...proof,checks,passed:Object.values(checks).every(Boolean),result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedInventedApplicationValue"]}}};
  }

  return { services, verify, qualify };
}
