import { isDeepStrictEqual } from "node:util";
import { sha256Hex, sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { extensionUnitManifestDescriptor, readAndValidateUnitManifest, UnitManifestError } from "@vibestudio/shared/unitManifest";
import { contextId, extensions, rpc, vcs } from "@workspace/runtime";
import { bindExtensionDesign } from "@workspace-skills/extensiondev/unit-design";
import { bindUnitIdentity } from "@workspace-skills/unit-identity-bindings";
import { prepareUnitIcon, ProjectIconError } from "@workspace-skills/workspace-dev";
import type { OpenUnitHandoffWorld as World } from "./open-goal-unit-handoff-worlds.js";

type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type Unit = World["inventory"][number];
type Design = ReturnType<typeof bindExtensionDesign>;
type Identity = ReturnType<typeof bindUnitIdentity>;
type DesignObservation = Awaited<ReturnType<Design["services"]["extensionDesignRead"]["inspect"]>>;
type IdentityObservation = Awaited<ReturnType<Identity["services"]["unitIdentity"]["observe"]>>;
type Icon = Parameters<Identity["services"]["unitIdentity"]["resolve"]>[1];
type Candidate = Awaited<ReturnType<Identity["services"]["unitIdentity"]["resolve"]>>;
type Change = Awaited<ReturnType<Identity["services"]["unitIdentity"]["stage"]>>;
type Call = { service: string; method: string; inputs: unknown[]; result: unknown };
type Finding = { decision: string; finding: string; evidenceIds: string[]; components?: Finding[] };
type Report = {
  decision: "held" | "reviewed" | "staged";
  reason: string;
  plan: { path: string | null; focus: string; inspectLifecycle: boolean; stageIcon: boolean; requireProtectedSource: boolean; reason: string };
  observation: Observation | null;
  design: { native: Finding | null; manifest: string; lifecycle: { observation: Lifecycle; source: string; activity: string; reason: string } | null } | null;
  identity: {
    observed: IdentityObservation; intent: Icon;
    assessment: { candidate: Candidate; next: string };
    change: Change | null; outcome: string;
  } | null;
};
type ManifestAnchor = { digest: string; validationError: string | null; entry: string | null;
  activationEvents: string[]; dependencyMode: string | null; icon: string | null };
type Observation = { unit: Unit; revision: string; mainRevision: string;
  manifest: { working: ManifestAnchor; protectedMain: ManifestAnchor } | null;
  designRequest: Design["request"] | null; identityRequest: Identity["request"] };
type Lifecycle = {
  status: string; activeVersion: string | null; buildKey: string | null; sourceRevision: string | null;
  buildVersion: string | null; processId: string | null; health: string | null; pendingApproval: string | null;
};

type Ports = {
  contextId: string;
  vcs: typeof vcs;
  bindDesign: typeof bindExtensionDesign;
  bindIdentity: typeof bindUnitIdentity;
  prepareIcon: typeof prepareUnitIcon;
  status: typeof extensions.status;
  metadata(key: string): ReturnType<typeof getMetadata>;
};
const getMetadata = (key: string) => rpc.call("main", mainRpcMethods["build.getBuildMetadata"], [key]);
const live: Ports = {
  contextId, vcs, bindDesign: bindExtensionDesign, bindIdentity: bindUnitIdentity,
  prepareIcon: prepareUnitIcon, status: name => extensions.status(name), metadata: getMetadata,
};
const revisionOf = (head: State) => head.kind === "event" ? head.eventId : head.applicationId;
const protectedHead = (eventId: string): State => ({ kind: "event", eventId });
const pathOf = (icon: string | null) => icon?.startsWith("./") ? icon.slice(2) : null;

function object(text: string) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || !value.vibestudio || typeof value.vibestudio !== "object")
    throw new Error("Assigned unit must have a Vibestudio package manifest");
  return value;
}

function manifestWithoutIcon(text: string) {
  const manifest = object(text);
  const { icon: _icon, ...vibestudio } = manifest.vibestudio;
  return { ...manifest, vibestudio };
}

export async function prepareUnitHandoff(world: World, ports: Ports = live) {
  const { contextId, vcs } = ports;
  if (!contextId) throw new Error("Run the unit handoff in one owned workspace");
  async function repositoryAt(state: State, unit: Unit) {
    return await vcs.resolveRepository({ state, repoPath: unit.path });
  }
  async function readAt(state: State, unit: Unit, path: string) {
    const repository = await repositoryAt(state, unit);
    if (!repository) return null;
    const file = await vcs.readFile({ state, repositoryId: repository.repositoryId, file: { kind: "path", path } });
    if (file && (file.repositoryId !== repository.repositoryId || file.path !== path))
      throw new Error("Unit handoff read returned a different repository or file");
    return file;
  }
  async function packageAt(state: State, unit: Unit) {
    const file = await readAt(state, unit, "package.json");
    if (!file || file.content.kind !== "text") throw new Error("Assigned unit manifest is missing");
    return { ...file, text: file.content.text };
  }
  async function artworkAt(state: State, unit: Unit, icon: string | null) {
    const path = pathOf(icon);
    if (!path) return null;
    const file = await readAt(state, unit, path);
    if (!file) return null;
    return file.content.kind === "text" ? sha256HexSyncText(file.content.text)
      : sha256Hex(Uint8Array.from(atob(file.content.base64), ch => ch.charCodeAt(0)));
  }
  function iconFrom(text: string): string | null {
    const icon = object(text).vibestudio.icon;
    return typeof icon === "string" ? icon : null;
  }
  async function seed(unit: Unit, head: State) {
    if (world.change === "none") return;
    const manifest = await packageAt(head, unit);
    const config = object(manifest.text);
    let file = manifest;
    if (world.change === "code-only" || world.change === "damaged-artwork") {
      const path = world.change === "code-only" ? config.vibestudio.entry ?? "index.ts" : pathOf(iconFrom(manifest.text));
      const current = path && await readAt(head, unit, path);
      if (!current || current.content.kind !== "text") throw new Error("The retained unit fixture requires its owned source or artwork");
      file = { ...current, text: world.change === "code-only" ? current.content.text + "\n// Local design review candidate.\n"
        : '<svg xmlns="http://www.w3.org/2000/svg"><title>Local placeholder</title></svg>\n' };
    } else {
      switch (world.change) {
        case "activation": config.vibestudio.extension.activationEvents = ["*"]; break;
        case "invalid-dependency": config.vibestudio.extension.dependencyMode = "raw-source"; break;
        case "invalid-icon": config.vibestudio.icon = "bad icon declaration"; break;
        case "metadata-only": config.description = "Local maintainer candidate awaiting review"; break;
      }
      file = { ...manifest, text: world.change === "invalid-json" ? '{ "name":' : JSON.stringify(config, null, 2) + "\n" };
    }
    await vcs.edit({ contextId, expectedWorkingHead: head, commandId: "unit-handoff-" + crypto.randomUUID(),
      intentSummary: "Prepare one isolated unit design input",
      changes: [{ kind: "content-replace", repositoryId: file.repositoryId, fileId: file.fileId, content: { kind: "text", text: file.text } }],
    });
  }

  const initial = await vcs.status({ contextId });
  if (world.target) await seed(world.target, initial.workingHead);
  const before = await vcs.status({ contextId });
  if (before.mainEventId !== initial.mainEventId) throw new Error("Protected main changed during fixture preparation");
  const working = before.workingHead, main = protectedHead(before.mainEventId);
  const selectedPath = world.target?.path ?? null;
  const inventory = (await Promise.all(world.inventory.map(async unit => [unit, await repositoryAt(working, unit)] as const)))
    .filter(([, repository]) => !!repository).map(([unit]) => unit);
  if (inventory.length !== world.inventory.length) throw new Error("A designated installed unit is missing from the owned fixture");
  const expected = world.target && {
    unit: world.target,
    working: await packageAt(working, world.target),
    main: await packageAt(main, world.target),
  };
  const decoys = inventory.filter(unit => unit.path !== selectedPath);
  const decoyManifests = await Promise.all(decoys.map(unit => packageAt(working, unit)));

  function validation(text: string, unit: Unit, fullName: string) {
    try { readAndValidateUnitManifest(extensionUnitManifestDescriptor, unit.path + "/package.json", { unitName: fullName }, () => text); return null; }
    catch (error) {
      if (!(error instanceof UnitManifestError)) throw error;
      return error.code;
    }
  }
  const nameOf = (unit: Unit) => "@workspace-extensions/" + unit.name;
  function manifestAnchor(text: string, digest: string, unit: Unit): ManifestAnchor {
    const errorCode = validation(text, unit, nameOf(unit));
    const config = errorCode === "MANIFEST_PARSE" ? null : object(text).vibestudio;
    const extension = config?.extension;
    return { digest, validationError: errorCode, entry: typeof config?.entry === "string" ? config.entry : null,
      activationEvents: Array.isArray(extension?.activationEvents) ? extension.activationEvents.filter((item: unknown): item is string =>
        typeof item === "string") : [],
      dependencyMode: typeof extension?.dependencyMode === "string" ? extension.dependencyMode : null,
      icon: typeof config?.icon === "string" ? config.icon : null };
  }
  const expectedManifests = expected?.unit.kind === "extension" ? {
    working: manifestAnchor(expected.working.text, expected.working.contentHash, expected.unit),
    protectedMain: manifestAnchor(expected.main.text, expected.main.contentHash, expected.unit),
  } : null;
  const workingError = expected?.unit.kind === "extension" ? validation(expected.working.text, expected.unit, nameOf(expected.unit)) : null;
  const mainError = expected?.unit.kind === "extension" ? validation(expected.main.text, expected.unit, nameOf(expected.unit)) : null;
  const equalManifests = !!expected && expected.working.contentHash === expected.main.contentHash;
  const editGrant = !!expected && !workingError && (world.grant === "working-icon" ||
    world.grant === "protected-match-icon" && equalManifests);
  const originalIcon = expected && world.focus !== "manifest" ? iconFrom(expected.working.text) : null;
  const originalArtwork = expected && world.focus !== "manifest" ? await artworkAt(working, expected.unit, originalIcon) : null;
  // The expected visual brief stays private. It can be compared with the deterministic
  // catalog and prepared bytes without telling the program what to choose.
  const targetIconId = world.icon && (world.icon.family === "emoji" ? world.icon.term : world.icon.family + ":" + world.icon.term);
  async function prepareExpectedIcon() {
    if (!targetIconId) return null;
    try { return await ports.prepareIcon(targetIconId); }
    catch (error) {
      if (error instanceof ProjectIconError || error instanceof UnitManifestError && error.code === "MANIFEST_ICON") return null;
      throw error;
    }
  }
  const expectedIcon = await prepareExpectedIcon();
  const expectedArtwork = expectedIcon && Object.hasOwn(expectedIcon.files, "assets/icon.svg")
    ? sha256HexSyncText(expectedIcon.files["assets/icon.svg"]!) : null;
  const matches = !!expectedIcon && expectedIcon.icon === originalIcon && expectedArtwork === originalArtwork;
  const mustStage = !!expectedIcon && editGrant && world.stageIcon && !matches;
  let discovered = false;
  let scope: Observation | null = null;
  let design: Design | undefined;
  let identity: Identity | undefined;
  let nativeDesign: DesignObservation | null = null;
  let nativeIdentity: IdentityObservation | null = null;
  let nativeCandidate: Candidate = null;
  let nativeChange: Change | null = null;
  let lifecycle: Lifecycle | null = null;
  const calls: Call[] = [];
  const log = <T>(service: string, method: string, inputs: unknown[], result: T): T => {
    calls.push({ service, method, inputs: structuredClone(inputs), result: structuredClone(result) });
    return structuredClone(result);
  };
  async function lifecycleAt(unit: Unit): Promise<Lifecycle> {
    const status = await ports.status(nameOf(unit));
    if (status.name !== nameOf(unit) || status.source !== unit.path) throw new Error("Wrong installed extension lifecycle");
    const metadata = status.activeBundleKey ? await ports.metadata(status.activeBundleKey) : null;
    const exact = metadata?.name === status.name && metadata.sourcePath === status.source &&
      metadata.kind === "extension" && metadata.buildKey === status.activeBundleKey;
    const state = exact ? metadata.sourceState : null;
    const sourceRevision = state?.kind === "event" ? state.eventId : state?.kind === "application" ? state.applicationId : null;
    return { status: status.status, activeVersion: status.activeEv, buildKey: status.activeBundleKey,
      sourceRevision, buildVersion: exact ? metadata.ev : null, processId: status.identity?.entityId ?? null, health: status.health?.state ?? null,
      pendingApproval: status.pendingApproval?.kind ?? null };
  }

  const services = {
    unitHandoff: {
      async discover() {
        if (discovered) return structuredClone(inventory);
        discovered = true;
        return log("unitHandoff", "discover", [], inventory);
      },
      async begin(path: string) {
        const unit = discovered && inventory.find(unit => unit.path === path);
        if (!unit || scope) throw new Error("Begin one discovered installed unit");
        const now = await vcs.status({ contextId });
        if (!isDeepStrictEqual(now.workingHead, working) || now.mainEventId !== before.mainEventId)
          throw new Error("Workspace unit revision changed since discovery");
        const { name, kind, description } = unit;
        identity = ports.bindIdentity({ repoPath: path, goal: world.goal, unit: { name, kind, description },
          prepare: path === selectedPath && editGrant });
        let manifest: Observation["manifest"] = null;
        if (kind === "extension") {
          design = ports.bindDesign({ contextId, source: path, name: nameOf(unit), goal: world.goal });
          const [candidate, published] = await Promise.all([packageAt(now.workingHead, unit), packageAt(main, unit)]);
          manifest = { working: manifestAnchor(candidate.text, candidate.contentHash, unit),
            protectedMain: manifestAnchor(published.text, published.contentHash, unit) };
        }
        scope = { unit, revision: revisionOf(working), mainRevision: before.mainEventId,
          manifest, designRequest: design?.request ?? null, identityRequest: identity.request };
        return log("unitHandoff", "begin", [path], scope);
      },
      async lifecycle(path: string) {
        if (!scope || path !== scope.unit.path || scope.unit.kind !== "extension" || lifecycle)
          throw new Error("Observe one exact selected extension lifecycle");
        lifecycle = await lifecycleAt(scope.unit);
        return log("unitHandoff", "lifecycle", [path], lifecycle);
      },
    },
    extensionDesignRead: {
      async inspect(id: string) {
        if (!design) throw new Error("Begin a selected extension design");
        nativeDesign = await design.services.extensionDesignRead.inspect(id);
        return log("extensionDesignRead", "inspect", [id], nativeDesign);
      },
    },
    unitIdentity: {
      async observe(id: string) {
        if (!identity || nativeIdentity) throw new Error("Observe a selected identity once");
        nativeIdentity = await identity.services.unitIdentity.observe(id);
        return log("unitIdentity", "observe", [id], nativeIdentity);
      },
      async resolve(id: string, intent: Icon) {
        if (!identity) throw new Error("Begin a selected unit identity");
        nativeCandidate = await identity.services.unitIdentity.resolve(id, intent);
        return log("unitIdentity", "resolve", [id, intent], nativeCandidate);
      },
      async stage(id: string, revision: string, authoringId: string) {
        if (!identity) throw new Error("Begin a selected unit identity");
        nativeChange = await identity.services.unitIdentity.stage(id, revision, authoringId);
        return log("unitIdentity", "stage", [id, revision, authoringId], nativeChange);
      },
    },
  };

  const wantDesign = !!expected && world.focus !== "identity";
  const wantIdentity = !!expected && world.focus !== "manifest";
  const finding = !wantDesign ? null : workingError ? "invalid" : equalManifests ? "protected-match" : "local-only";
  const next = !expectedIcon ? "hold" : matches ? "already-matches" : mustStage ? "prepare" : "design-only";
  const action = next === "prepare" ? "prepared" : next;
  const decision = !expected || workingError || wantIdentity && (next === "hold" || world.stageIcon && next === "design-only") ? "held"
    : mustStage ? "staged" : "reviewed";
  const lifecycleSource = (value: Lifecycle) => !value.sourceRevision || !value.activeVersion || !value.buildKey ||
      value.buildVersion !== value.activeVersion ? "unverified" : value.sourceRevision === revisionOf(working) ? "working"
      : value.sourceRevision === before.mainEventId ? "protected-main" : "unverified";

  function lifecycleActivity(value: Lifecycle) {
    if (value.pendingApproval || value.status === "pending-approval") return "approval-pending";
    if (value.status === "error") return "blocked";
    if (value.status === "building") return "in-progress";
    return value.status === "running" && value.processId ? "active" : "inactive";
  }

  function reviewFromObservation(): Finding | null {
    if (!nativeDesign) return null;
    const ids = [nativeDesign.working.receipt?.id, nativeDesign.published.receipt?.id].filter((id): id is string => !!id);
    const components = [
      { decision: workingError ? "revision-needed" : "ready", finding: workingError ?? "manifest-verified", evidenceIds: ids.slice(0, 1) },
      { decision: mainError ? "revision-needed" : "ready", finding: mainError ?? "manifest-verified", evidenceIds: ids.slice(1) },
      { decision: equalManifests ? "ready" : "waiting", finding: equalManifests ? "manifest-published" : "manifest-not-published", evidenceIds: ids },
    ];
    return { decision: workingError || mainError ? "revision-needed" : equalManifests ? "ready" : "waiting",
      finding: workingError || mainError ? "required-revision" : equalManifests ? "prerequisites-verified" : "pending-lifecycle",
      evidenceIds: ids, components };
  }

  async function verify(report: Report | null) {
    const after = await vcs.status({ contextId });
    const protectedUnchanged = after.mainEventId === before.mainEventId;
    const current = expected && await packageAt(after.workingHead, expected.unit);
    const protectedManifest = expected && await packageAt(protectedHead(after.mainEventId), expected.unit);
    const currentArtwork = current && wantIdentity ? await artworkAt(after.workingHead, expected!.unit, iconFrom(current.text)) : null;
    const otherManifests = await Promise.all(decoys.map(unit => packageAt(after.workingHead, unit)));
    const decoysUnchanged = isDeepStrictEqual(otherManifests.map(row => row.contentHash), decoyManifests.map(row => row.contentHash));
    const workingScope = mustStage ? !!current && !!nativeChange && nativeChange.revision === revisionOf(after.workingHead) &&
        nativeChange.revision !== revisionOf(working) && nativeChange.mainUnchanged && nativeChange.manifestOtherwiseUnchanged &&
        isDeepStrictEqual(manifestWithoutIcon(current.text), manifestWithoutIcon(expected!.working.text)) &&
        iconFrom(current.text) === expectedIcon?.icon && currentArtwork === expectedArtwork &&
        isDeepStrictEqual([...nativeChange.changedFiles].sort(), Object.hasOwn(expectedIcon!.files, "assets/icon.svg")
          ? ["assets/icon.svg", "package.json"] : ["package.json"])
      : !nativeChange && isDeepStrictEqual(after.workingHead, working) && current?.contentHash === expected?.working.contentHash;
    const designBound = wantDesign ? !!nativeDesign && !!expected && !!report?.design &&
      isDeepStrictEqual(scope?.manifest, expectedManifests) &&
      nativeDesign.workingRevision === revisionOf(working) && nativeDesign.mainRevision === before.mainEventId &&
      nativeDesign.working.source === expected.unit.path && nativeDesign.published.source === expected.unit.path &&
      nativeDesign.working.candidateDigest === expected.working.contentHash &&
      nativeDesign.published.candidateDigest === expected.main.contentHash &&
      nativeDesign.working.receipt?.errorCode === workingError && nativeDesign.published.receipt?.errorCode === mainError &&
      report.design.manifest === finding && isDeepStrictEqual(report.design.native, reviewFromObservation())
      : !nativeDesign && report?.design === null;
    const identityBound = wantIdentity ? !!report?.identity && !!nativeIdentity && !!expected &&
      nativeIdentity.repoPath === expected.unit.path && nativeIdentity.revision === revisionOf(working) &&
      nativeIdentity.icon === originalIcon && nativeIdentity.artworkDigest === originalArtwork &&
      isDeepStrictEqual(report.identity.observed, nativeIdentity) && isDeepStrictEqual(report.identity.intent, world.icon) &&
      (expectedIcon ? nativeCandidate?.choice.id === targetIconId && nativeCandidate.declaration === expectedIcon.icon &&
        nativeCandidate.artworkDigest === expectedArtwork : nativeCandidate === null) &&
      isDeepStrictEqual(report.identity.assessment, { candidate: nativeCandidate, next }) &&
      isDeepStrictEqual(report.identity.change, nativeChange) && report.identity.outcome === action
      : !nativeIdentity && !nativeCandidate && report?.identity === null;
    const observedLifecycle = report?.design?.lifecycle ?? null;
    const lifecycleBound = world.lifecycle ? !!lifecycle && !!observedLifecycle &&
      isDeepStrictEqual(observedLifecycle.observation, lifecycle) && observedLifecycle.source === lifecycleSource(lifecycle) && observedLifecycle.activity === lifecycleActivity(lifecycle) &&
      !!observedLifecycle.reason.trim()
      : !lifecycle && observedLifecycle === null;
    const expectedCalls = ["unitHandoff.discover",
      ...(expected ? ["unitHandoff.begin"] : []), ...(wantDesign ? ["extensionDesignRead.inspect"] : []),
      ...(world.lifecycle ? ["unitHandoff.lifecycle"] : []),
      ...(wantIdentity ? ["unitIdentity.observe", "unitIdentity.resolve"] : []), ...(mustStage ? ["unitIdentity.stage"] : [])];
    const checks = {
      owned_selection: !!report && report.plan.path === selectedPath && scope?.unit.path === (selectedPath ?? undefined) &&
        report.plan.focus === world.focus && report.plan.inspectLifecycle === world.lifecycle &&
        report.plan.stageIcon === world.stageIcon && report.plan.requireProtectedSource === world.requireProtectedSource &&
        isDeepStrictEqual(report.observation, scope),
      manifest_versions: designBound,
      build_lifecycle: lifecycleBound,
      catalog_and_artwork: identityBound,
      local_effect_and_protected_main: workingScope && protectedUnchanged && decoysUnchanged &&
        protectedManifest?.contentHash === expected?.main.contentHash,
      conclusion: report?.decision === decision && !!report.reason.trim() &&
        isDeepStrictEqual(calls.map(call => call.service + "." + call.method), expectedCalls),
    };
    return { caseId: world.id, contextId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      unitHandoff: { calls: structuredClone(calls), report, working: revisionOf(after.workingHead),
        protectedEvent: after.mainEventId, target: selectedPath, expect: { decision, finding, action, mustStage } } };
  }

  async function reference() {
    await services.unitHandoff.discover();
    const plan = { path: selectedPath, focus: world.focus, inspectLifecycle: world.lifecycle, stageIcon: world.stageIcon,
      requireProtectedSource: world.requireProtectedSource, reason: "Review the assigned installed unit and exact grant." };
    if (expected) {
      await services.unitHandoff.begin(expected.unit.path);
      if (wantDesign && scope?.designRequest) await services.extensionDesignRead.inspect(scope.designRequest.operationId);
      if (world.lifecycle) await services.unitHandoff.lifecycle(expected.unit.path);
      if (wantIdentity && scope && world.icon) {
        const id = scope.identityRequest.operationId;
        await services.unitIdentity.observe(id);
        const choice = await services.unitIdentity.resolve(id, world.icon);
        if (mustStage && choice && nativeIdentity) await services.unitIdentity.stage(id, nativeIdentity.revision, choice.choice.id);
      }
    }
    return verify({ decision, plan, observation: scope, reason: "Report the observed candidate, local scope and protected revision.",
      design: wantDesign && finding ? { native: reviewFromObservation(), manifest: finding,
        lifecycle: lifecycle ? { observation: lifecycle, source: lifecycleSource(lifecycle), activity: lifecycleActivity(lifecycle), reason: "Compare exact retained build evidence." } : null } : null,
      identity: wantIdentity && nativeIdentity && world.icon ? { observed: nativeIdentity, intent: world.icon,
        assessment: { candidate: nativeCandidate, next }, change: nativeChange, outcome: action } : null,
    });
  }
  return { goal: world.goal, services, qualify: reference, verify };
}
