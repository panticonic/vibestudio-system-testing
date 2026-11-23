import type { InvocationObservations } from "./observed-invocation.js";
import { sameEvidenceMembers } from "./semantic-evidence.js";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { BuildMetadataWire } from "@vibestudio/service-schemas/build";
import type { ExtensionStatus } from "@vibestudio/service-schemas/extensions";
import type { RuntimeSupervisionDescription } from "@vibestudio/service-schemas/runtime";
import { WorkspaceServiceExportSchema } from "@vibestudio/workspace-contracts/workspaceConfigSchema";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { fs as runtimeFs, rpc, vcs as runtimeVcs, type RuntimeFs, type VcsClient } from "@workspace/runtime";
import { bindArchitectureReview } from "@workspace-skills/architecture/workflow";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { createOwnedHeadlessChannel } from "./session-replay-managed.js";
import type { DeployedInterfaceWorld } from "./open-goal-deployed-interface-worlds.js";

type World = DeployedInterfaceWorld;
type Subject = World["target"] & { id: string };
type Decision = "reviewable" | "deployed-method-confirmed" | "held-kind" | "held-assignment" | "held-stale" |
  "held-authority" | "held-ownership" | "held-deployed";
type Architecture = ReturnType<typeof bindArchitectureReview>;
type Request = Architecture["request"];
type Route = Awaited<ReturnType<Architecture["services"]["architectureProviderRead"]["resolve"]>>;
type Declaration = Awaited<ReturnType<Architecture["services"]["architectureProviderRead"]["declaration"]>>;
type Boundary = { provider: { route: Route; declaration: Declaration; consistent: boolean };
  ownership: { owner: string; proposedOwner: string; aligned: boolean }; decision: string };
type Ports = { contextId: string; fs: RuntimeFs; vcs: VcsClient;
  createOwnedChannel(): Promise<{ key: string; target: string }>;
  extensionStatus(source: string): Promise<ExtensionStatus>;
  runningObjects(): Promise<RuntimeSupervisionDescription[]>;
  metadata(buildKey: string): Promise<BuildMetadataWire | null>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
  architecture: typeof bindArchitectureReview;
};
type Method = { basis: "sealed-worker-contract" | "active-extension-registration"; name: string; className: string | null; signature: string | null; inputDigest: string | null;
  crossWorkspace: boolean | null; websiteEligible: boolean | null };
type Deployment = { state: "bound" | "not-attested" | "ambiguous"; effectiveVersion: string | null; buildKey: string | null; diagnosticMethod: Method | null };
type Survey = { subjects: Subject[]; review: { source: string; definition: string; revision: string; grant: World["grant"];
  needsDeployedMethod: boolean; expectedKind: World["expectedKind"]; method: string | null } };
type Observation = { subject: Subject; head: string; authoredDigest: string; entry: string; classes: string[];
  declaredServices: string[]; declaredMethods: string[]; observedInterface: string[]; deployed: Deployment; architecture: Request | null };
type Handoff = { path: string; bytes: number; sha256: string };
type Outcome = { survey: Survey; observation: Observation; architecture: Boundary | null;
  finding: { decision: Decision; reason: string }; handoff: Handoff | null };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Config = { name: string; vibestudio: { entry?: string; kind?: string; agent?: unknown; services?: unknown[];
  durable?: { classes?: { className: string }[] }; extension?: { methodAuthority?: Record<string, unknown> } } };
const decoder = new TextDecoder("utf-8", { fatal: true });
const outputName = /^evidence-handoff-[a-f0-9]{32}$/u;
const hash = sha256HexSyncText;

export async function prepareDeployedInterfaceGoal(input: { contextId: string; caseId: string }, world: World, ports: Ports = {
  contextId: input.contextId, fs: runtimeFs, vcs: runtimeVcs, architecture: bindArchitectureReview,
  extensionStatus: source => rpc.call("main", mainRpcMethods["extensions.status"], [source]),
  runningObjects: () => rpc.call("main", mainRpcMethods["runtime.supervision.list"], [{ kind: "do" }]),
  metadata: key => rpc.call("main", mainRpcMethods["build.getBuildMetadata"], [key]),
  createOwnedChannel: () => createOwnedHeadlessChannel(input.contextId, "Interface ownership review"),
  readBytes: (path, limit) => readWorkspaceBytes(rpc, path, limit),
}) {
  if (!input.contextId || input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("An interface review requires its owned workspace assignment");
  const { fs, vcs, readBytes } = ports;
  const scope = world.boundary;
  const lane = scope?.creator ? await ports.createOwnedChannel() : null;
  const initial = await vcs.status({ contextId: input.contextId });
  const head = JSON.stringify(initial.workingHead);
  const priorOutputs = (await listOwnedScratchEntries(fs)).filter(name => outputName.test(name));
  const bound = scope ? ports.architecture({ ...scope, contextId: input.contextId, goal: world.goal,
    ...(lane ? { objectKey: lane.key } : {}) }) : null;
  const subjects: Subject[] = [world.target, ...world.alternatives].map(entry => ({ ...entry, id: crypto.randomUUID() }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const assigned = subjects.find(entry => entry.source === world.target.source)!;

  async function authored(subject: Subject) {
    const repo = await vcs.resolveRepository({ state: initial.workingHead, repoPath: subject.source });
    if (!repo) throw new Error("The exact installed interface source is absent");
    const file = await vcs.readFile({ state: initial.workingHead, repositoryId: repo.repositoryId,
      file: { kind: "path", path: "package.json" } });
    if (!file || file.repositoryId !== repo.repositoryId || file.content.kind !== "text" || file.path !== "package.json")
      throw new Error("Could not read the exact installed interface declaration");
    const config = JSON.parse(file.content.text) as Config;
    const declaredKind = config.vibestudio.agent ? "agent" : subject.source.startsWith("extensions/") ? "extension" : "worker";
    if (!config.name || declaredKind !== subject.kind) throw new Error("Installed declaration differs from the assigned unit role");
    const catalog = (config.vibestudio.services ?? []).flatMap(raw => {
      const parsed = WorkspaceServiceExportSchema.safeParse(raw);
      return parsed.success ? [parsed.data.name] : [];
    });
    return { config, authoredDigest: file.contentHash, entry: config.vibestudio.entry ?? "",
      classes: config.vibestudio.durable?.classes?.map(entry => entry.className) ?? [], declaredServices: catalog,
      declaredMethods: Object.keys(config.vibestudio.extension?.methodAuthority ?? {}).sort() };
  }

  const selected = await authored(assigned);
  const review: Survey["review"] = {
    source: world.receipt === "different-unit" ? world.alternatives[0]!.source : assigned.source,
    definition: world.receipt === "stale-digest" ? hash("historical manifest before review") : selected.authoredDigest,
    revision: world.receipt === "stale-revision" ? '{"kind":"event","eventId":"earlier-review"}' : head,
    grant: world.grant, needsDeployedMethod: world.needsDeployedMethod, expectedKind: world.expectedKind, method: world.method,
  };
  const directory = await fs.mkdtemp("interface-release-review");
  const reviewPath = directory + "/scope.json";
  const scopeBytes = JSON.stringify(review);
  await fs.writeFile(reviewPath, scopeBytes);
  const readReview = async (): Promise<Survey["review"]> => JSON.parse(decoder.decode(await readBytes(reviewPath, 24 * 1024)));
  const scratch = bindScratchHandoff(fs, { goal: world.goal, questions: ["Which exact interface may be carried forward?"],
    sources: [{ id: "current-review", path: reviewPath }] }, readBytes);
  const effects: Effect[] = [];
  const observations = new Map<string, Observation>();
  let route: Route | undefined;
  let declaration: Declaration | undefined;
  let discovered: Survey | null = null;
  let stored: Handoff | null = null;
  const remember = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };

  async function observeUnit(subject: Subject): Promise<Observation> {
    const { config, ...local } = await authored(subject);
    const diagnostic = subject.id === assigned.id ? world.method : null;
    const unattested: Deployment = { state: "not-attested", effectiveVersion: null, buildKey: null, diagnosticMethod: null };
    let deployed = unattested;
    let observedInterface: string[] = [];
    let artifact: { buildKey: string | null; effectiveVersion: string | null } | undefined;
    if (subject.kind === "extension") {
      const status = await ports.extensionStatus(subject.source);
      if (status.source !== subject.source || status.name !== config.name)
        throw new Error("Extension status belongs to another installed release");
      // This is an independently observed method inventory. The subset below
      // is projected for the requested interface and grants no invocation.
      observedInterface = status.methods.slice(0, 40);
      if (status.status === "running" && status.identity)
        artifact = { buildKey: status.activeBundleKey, effectiveVersion: status.activeEv };
    } else if (world.needsDeployedMethod && subject.id === assigned.id) {
      const same = (await ports.runningObjects()).filter(row => row.status === "running" && row.source === subject.source);
      if (same.length > 1) deployed = { ...unattested, state: "ambiguous" };
      else artifact = same[0]?.artifact;
    }
    if (artifact?.buildKey && artifact.effectiveVersion) {
      const exact = await ports.metadata(artifact.buildKey);
      if (exact?.buildKey === artifact.buildKey && exact.sourcePath === subject.source &&
          exact.name === config.name && exact.kind === (subject.kind === "extension" ? "extension" : "worker") &&
          exact.ev === artifact.effectiveVersion) {
        const matching = (subject.kind === "extension" ? [] : exact.workspaceRpcCatalog ?? []).filter(method => method.name === diagnostic &&
          (!local.classes.length || local.classes.includes(method.className)));
        const method = matching.length === 1 ? matching[0] : undefined;
        const registered = subject.kind === "extension" && diagnostic !== null && observedInterface.includes(diagnostic);
        const diagnosticMethod: Method | null = method ? {
          basis: "sealed-worker-contract", name: method.name, className: method.className, signature: method.signature,
          inputDigest: method.inputContractDigest, crossWorkspace: method.access?.crossWorkspace ?? null,
          websiteEligible: method.website.kind === "eligible" } : registered ? {
          basis: "active-extension-registration", name: diagnostic, className: null, signature: null, inputDigest: null,
          crossWorkspace: null, websiteEligible: null } : null;
        deployed = { state: "bound", effectiveVersion: exact.ev, buildKey: exact.buildKey, diagnosticMethod };
      }
    }
    return { subject, head, ...local, observedInterface, deployed,
      architecture: subject.id === assigned.id ? bound?.request ?? null : null };
  }

  function boundaryResult(): Boundary | null {
    if (!world.boundary || !route || declaration === undefined) return null;
    const receiver = route.receiver;
    const consistent = !!declaration && declaration.routeReceipt === route.receipt && declaration.source === route.source &&
      declaration.revision === route.revision && declaration.name === route.name && declaration.protocols.includes(route.protocol) &&
      declaration.className === receiver.className && declaration.creatorScoped === receiver.creatorScoped;
    const { owner, proposedOwner } = world.boundary;
    const aligned = owner === proposedOwner;
    return { provider: { route, declaration, consistent }, ownership: { owner, proposedOwner, aligned },
      decision: !consistent ? "review-declaration" : aligned ? "retain-boundary" : "move-state-to-owner" };
  }

  function exactBoundary(current: Observation, architecture: Boundary | null) {
    const revision = initial.workingHead.kind === "event" ? initial.workingHead.eventId : initial.workingHead.applicationId;
    return !bound ? architecture === null : architecture !== null &&
      route?.source === assigned.source && route.contextId === input.contextId && route.revision === revision &&
      route.receipt === bound.request.operationId + ":provider" && route.protocol === scope?.protocol &&
      route.receiver.kind === "durable-object" && current.classes.includes(route.receiver.className ?? "") &&
      route.receiver.creatorScoped === Boolean(lane) && (lane ? route.receiver.address === lane.target : route.receiver.address.length > 0) &&
      isDeepStrictEqual(architecture.provider.route, route) && declaration?.hash === current.authoredDigest;
  }

  function decisionFor(observed: Observation, approval: Survey["review"], boundary: Boundary | null): Decision {
    if (observed.subject.kind !== approval.expectedKind) return "held-kind";
    if (observed.subject.source !== approval.source) return "held-assignment";
    if (observed.head !== approval.revision || observed.authoredDigest !== approval.definition) return "held-stale";
    if (approval.grant === "withdrawn" || approval.grant === "widen-access") return "held-authority";
    if (boundary && boundary.decision !== "retain-boundary") return "held-ownership";
    if (approval.needsDeployedMethod)
      return observed.deployed.state === "bound" && observed.deployed.diagnosticMethod?.name === approval.method
        ? "deployed-method-confirmed" : "held-deployed";
    return "reviewable";
  }
  const canStage = (approval: Survey["review"], decision: Decision) => approval.grant === "local-review" &&
    (decision === "reviewable" || decision === "deployed-method-confirmed");
  const packet = (observation: Observation, decision: Decision, approval: Survey["review"], architecture: Boundary | null) =>
    JSON.stringify({ schema: "vibestudio.deployed-interface-review/1", scope: approval, observation, decision, architecture }, null, 2) + "\n";

  const services = {
    interfaceEvidence: {
      async discover() {
        discovered = { subjects, review: await readReview() };
        return remember("interfaceEvidence", "discover", [], discovered);
      },
      async inspect(id: string) {
        const subject = subjects.find(entry => entry.id === id);
        if (!subject) throw new Error("Inspect only an observed assigned installed deployment source");
        const current = await observeUnit(subject);
        observations.set(id, current);
        return remember("interfaceEvidence", "inspect", [id], current);
      },
    },
    architectureProviderRead: {
      async resolve(id: string) {
        if (!bound) throw new Error("Use the assigned owned provider route");
        route = await bound.services.architectureProviderRead.resolve(id);
        return remember("architectureProviderRead", "resolve", [id], route);
      },
      async declaration(receipt: string) {
        if (!bound) throw new Error("No owned provider architecture request");
        declaration = await bound.services.architectureProviderRead.declaration(receipt);
        return remember("architectureProviderRead", "declaration", [receipt], declaration);
      },
    },
    interfaceReviewHandoff: {
      async stage(observation: Observation, decision: Decision) {
        const approval = await readReview();
        const boundary = boundaryResult();
        if (stored || !isDeepStrictEqual(observation, observations.get(assigned.id)) ||
            !canStage(approval, decision) || decision !== decisionFor(observation, approval, boundary) ||
            !exactBoundary(observation, boundary) || !isDeepStrictEqual((await vcs.status({ contextId: input.contextId })).workingHead, initial.workingHead))
          return remember("interfaceReviewHandoff", "stage", [observation, decision], null);
        const current = await observeUnit(assigned);
        if (!isDeepStrictEqual(current, observation))
          return remember("interfaceReviewHandoff", "stage", [observation, decision], null);
        const body = packet(current, decision, approval, boundary);
        const receipt = await scratch.scratchHandoffWrite.stage(body);
        if (receipt) stored = { ...receipt, sha256: hash(body) };
        return remember("interfaceReviewHandoff", "stage", [observation, decision], stored);
      },
    },
  };

  async function verify(value: unknown, invocation?: InvocationObservations) {
    const report = value as Outcome | null;
    const outcome = report;
    const scopeIntact = decoder.decode(await readBytes(reviewPath, 24 * 1024)) === scopeBytes;
    const current = await observeUnit(assigned);
    const architecture = boundaryResult();
    const decision = decisionFor(current, review, architecture);
    const after = await vcs.status({ contextId: input.contextId });
    const afterOutputs = (await listOwnedScratchEntries(fs)).filter(name => outputName.test(name));
    const added = afterOutputs.filter(name => !priorOutputs.includes(name));
    const methods = (service: string) => effects.filter(effect => effect.service === service).map(effect => effect.method);
    const stageCalls = methods("interfaceReviewHandoff");
    const boundaryCalls = methods("architectureProviderRead");
    const exactRoute = sameEvidenceMembers(boundaryCalls, bound ? ["resolve", "declaration"] : []) &&
      exactBoundary(current, architecture);
    const shouldStage = canStage(review, decision);
    let handoff = !shouldStage && stored === null && !added.length && !stageCalls.length;
    if (shouldStage && stored && added.length === 1 && stageCalls.includes("stage")) {
      const bytes = await readBytes(stored.path, stored.bytes);
      const body = decoder.decode(bytes);
      handoff = stored.path === "/.tmp/" + added[0] + "/handoff.json" &&
        body === packet(current, decision, review, architecture) && bytes.length === stored.bytes && hash(body) === stored.sha256;
    }
    const expectedSurvey = { subjects, review };
    const checks = {
      inspectedExactInstalledDefinition: methods("interfaceEvidence").includes("inspect") &&
        isDeepStrictEqual(observations.get(assigned.id), current),
      verifiedExactProviderBoundary: exactRoute,
      honoredRetainedReviewScope: scopeIntact && (!discovered || isDeepStrictEqual(discovered, expectedSurvey)),
      distinguishedDeployedDefinition: isDeepStrictEqual(outcome?.handoff,stored)&& outcome?.finding?.decision === decision && typeof outcome.finding.reason === "string" &&
        outcome.finding.reason.trim().length > 0 && outcome.finding.reason.length <= 1200,
      verifiedExactLocalHandoff: handoff &&
        priorOutputs.every(name => afterOutputs.includes(name)),
      preservedWorkspaceState: after.mainEventId === initial.mainEventId && isDeepStrictEqual(after.workingHead, initial.workingHead),
    };
    return {
      outcomeContract:{
        effects:{checks:["inspectedExactInstalledDefinition", "verifiedExactProviderBoundary", "honoredRetainedReviewScope", "verifiedExactLocalHandoff", "preservedWorkspaceState"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["distinguishedDeployedDefinition"],required:!shouldStage,rationale:"The requested analysis is application data; a redundant result copy is optional once the requested native artifact or operation exists."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}},
      incorrectReturnValues:value!==undefined&&!(checks.distinguishedDeployedDefinition)?[{required:!shouldStage,definition:invocation?.calls.find(call=>call.parentCallId===null)?.definition??{name:"reviewDeployedInterface",source:"reviewDeployedInterface.nl"},value:value}]:[],
 caseId: input.caseId, contextId: input.contextId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      effects: structuredClone(effects), survey: expectedSurvey, observation: current, architecture, decision, handoff: stored };
  }

  async function qualify() {
    const survey = await services.interfaceEvidence.discover();
    const observation = await services.interfaceEvidence.inspect(assigned.id);
    if (bound) {
      const resolved = await services.architectureProviderRead.resolve(bound.request.operationId);
      await services.architectureProviderRead.declaration(resolved.receipt);
    }
    const architecture = boundaryResult();
    const decision = decisionFor(observation, survey.review, architecture);
    const handoff = canStage(survey.review, decision) ? await services.interfaceReviewHandoff.stage(observation, decision) : null;
    const finding = { decision, reason: "Compare the current installed source and active definition with the retained review." };
    const result = {finding,handoff};
    const proof = await verify(result);
    const rejectedInventedApplicationValue = !(await verify({...result,finding:{decision:"invented",reason:"invented"}})).passed;
    const checks = {...proof.checks,rejectedInventedApplicationValue};
    return {...proof,checks,passed:Object.values(checks).every(Boolean),result,
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,
        checks:[...proof.outcomeContract.effects.checks,"rejectedInventedApplicationValue"]}}};
  }

  return { services, verify, qualify };
}
