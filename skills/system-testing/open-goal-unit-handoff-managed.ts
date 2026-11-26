import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["nativeReviewEvidence"]);
import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
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
type Call = { service: string; method: string; inputs: unknown[]; outcome:"returned"|"threw"; result?: unknown };
type Report = {explanation:string;unit:Unit|null;draft:Change|null};
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
  function safeIconFrom(text:string):string|null {try{return iconFrom(text);}catch{return null;}}
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
  const workingError = expected?.unit?.kind === "extension" ? validation(expected.working.text, expected.unit, nameOf(expected.unit)) : null;
  const equalManifests = !!expected && expected.working.contentHash === expected.main.contentHash;
  const editGrant = !!expected && !workingError && (world.grant === "working-icon" ||
    world.grant === "protected-match-icon" && equalManifests);
  const originalIcon = expected ? safeIconFrom(expected.working.text) : null;
  const originalArtwork = expected ? await artworkAt(working, expected.unit, originalIcon) : null;
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
  let nativeDesign: DesignObservation | null = null;
  let nativeIdentity: IdentityObservation | null = null;
  let nativeCandidate: Candidate = null;
  let nativeChange: Change | null = null;
  let lifecycle: Lifecycle | null = null;
  const calls: Call[] = [];
  const log = <T>(service: string, method: string, inputs: unknown[], result: T): T => {
    calls.push({ service, method, inputs: structuredClone(inputs), outcome:"returned", result: structuredClone(result) });
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

  type Binding={unit:Unit;identity:Identity;design?:Design};
  const unitBindings=new Map<string,Binding>();
  const identityBindings=new Map<string,Binding>();
  const designBindings=new Map<string,Binding>();
  const observations:Observation[]=[];
  async function invoke<T>(service:string,method:string,inputs:unknown[],operation:()=>Promise<T>):Promise<T>{
    try{return log(service,method,inputs,await operation());}
    catch(error){calls.push({service,method,inputs:structuredClone(inputs),outcome:"threw"});throw error;}
  }
  const services = {
    unitHandoff: {
      async discover() {
        discovered = true;
        return log("unitHandoff", "discover", [], inventory);
      },
      async begin(path:string) {
        return invoke("unitHandoff","begin",[path],async()=>{
          const unit=discovered&&inventory.find(unit=>unit.path===path);
          if(!unit)throw new Error("Begin only a discovered installed unit");
          const now=await vcs.status({contextId});
          let binding=unitBindings.get(path);
          if(!binding){
            const {name,kind,description}=unit;
            const ownedIdentity=ports.bindIdentity({repoPath:path,goal:world.goal,unit:{name,kind,description},
              prepare:path===selectedPath&&editGrant});
            const ownedDesign=kind==="extension"?ports.bindDesign({contextId,source:path,name:nameOf(unit),goal:world.goal}):undefined;
            binding={unit,identity:ownedIdentity,...(ownedDesign?{design:ownedDesign}:{})};
            unitBindings.set(path,binding);identityBindings.set(ownedIdentity.request.operationId,binding);
            if(ownedDesign)designBindings.set(ownedDesign.request.operationId,binding);
          }
          let manifest:Observation["manifest"]=null;
          if(unit.kind==="extension"){
            const [candidate,published]=await Promise.all([packageAt(now.workingHead,unit),packageAt(protectedHead(now.mainEventId),unit)]);
            manifest={working:manifestAnchor(candidate.text,candidate.contentHash,unit),protectedMain:manifestAnchor(published.text,published.contentHash,unit)};
          }
          const observed:Observation={unit,revision:revisionOf(now.workingHead),mainRevision:now.mainEventId,manifest,
            designRequest:binding.design?.request??null,identityRequest:binding.identity.request};
          observations.push(structuredClone(observed));
          if(path===selectedPath){scope=observed;}
          return observed;
        });
      },
      async lifecycle(path:string) {
        return invoke("unitHandoff","lifecycle",[path],async()=>{
          const binding=unitBindings.get(path);
          if(!binding||binding.unit.kind!=="extension")throw new Error("Observe an actual discovered extension lifecycle");
          const observed=await lifecycleAt(binding.unit);
          if(path===selectedPath)lifecycle=observed;
          return observed;
        });
      },
    },
    extensionDesignRead:{
      async inspect(id:string){return invoke("extensionDesignRead","inspect",[id],async()=>{
        const binding=designBindings.get(id);
        if(!binding?.design)throw new Error("Inspect an actual begun installed extension");
        const observed=await binding.design.services.extensionDesignRead.inspect(id);
        if(binding.unit.path===selectedPath)nativeDesign=observed;
        return observed;
      });},
    },
    unitIdentity:{
      async observe(id:string){return invoke("unitIdentity","observe",[id],async()=>{
        const binding=identityBindings.get(id);if(!binding)throw new Error("Observe an actual begun owned unit identity");
        const observed=await binding.identity.services.unitIdentity.observe(id);
        if(binding.unit.path===selectedPath)nativeIdentity=observed;
        return observed;
      });},
      async resolve(id:string,intent:Icon){return invoke("unitIdentity","resolve",[id,intent],async()=>{
        const binding=identityBindings.get(id);if(!binding)throw new Error("Resolve artwork for an actual begun unit");
        const candidate=await binding.identity.services.unitIdentity.resolve(id,intent);
        if(binding.unit.path===selectedPath)nativeCandidate=candidate;
        return candidate;
      });},
      async stage(id:string,revision:string,authoringId:string){return invoke("unitIdentity","stage",[id,revision,authoringId],async()=>{
        const binding=identityBindings.get(id);if(!binding)throw new Error("Stage only an actual begun unit identity");
        const now=await vcs.status({contextId});
        if(binding.unit.path!==selectedPath||revision!==revisionOf(working)||now.mainEventId!==before.mainEventId)
          throw new Error("The original owned unit draft revision is not authorized");
        const change=await binding.identity.services.unitIdentity.stage(id,revision,authoringId);
        nativeChange=change;
        return change;
      });},
    },
  };

  const wantDesign=!!expected&&world.focus!=="identity";
  const wantIdentity=!!expected&&world.focus!=="manifest";
  const decoyArtworkBefore=await Promise.all(decoys.map(async(unit,index)=>artworkAt(working,unit,safeIconFrom(decoyManifests[index]!.text))));

  async function verify(value:unknown,invocation?:InvocationObservations){
    const report=value as Report|null;
    const after=await vcs.status({contextId});
    const current=expected&&await packageAt(after.workingHead,expected.unit);
    const protectedManifest=expected&&await packageAt(protectedHead(after.mainEventId),expected.unit);
    const currentArtwork=current?await artworkAt(after.workingHead,expected!.unit,safeIconFrom(current.text)):null;
    const originalTargetArtwork=originalArtwork;
    const otherManifests=await Promise.all(decoys.map(unit=>packageAt(after.workingHead,unit)));
    const otherArtwork=await Promise.all(decoys.map(async(unit,index)=>artworkAt(after.workingHead,unit,safeIconFrom(otherManifests[index]!.text))));
    const decoysUnchanged=isDeepStrictEqual(otherManifests.map(row=>row.contentHash),decoyManifests.map(row=>row.contentHash))&&isDeepStrictEqual(otherArtwork,decoyArtworkBefore);
    const changed=!isDeepStrictEqual(after.workingHead,working);
    const attemptedOwnedStage=calls.some(call=>call.service==="unitIdentity"&&call.method==="stage"&&identityBindings.get(call.inputs[0] as string)?.unit.path===selectedPath);
    const ownedCurrentArtifact=!!expected&&!!current&&editGrant&&!!expectedIcon&&
      isDeepStrictEqual(manifestWithoutIcon(current.text),manifestWithoutIcon(expected.working.text))&&
      iconFrom(current.text)===expectedIcon.icon&&currentArtwork===expectedArtwork;
    // Independent current bytes establish the artifact even if a returned
    // receipt was lost after the exact owned operation committed. No actor
    // reread or private report echo is required to establish persisted state.
    const workingScope=changed?attemptedOwnedStage&&ownedCurrentArtifact:
      !nativeChange&&current?.contentHash===expected?.working.contentHash&&currentArtwork===originalTargetArtwork;
    const readbacksBound=calls.filter(call=>call.outcome==="returned").every(call=>{
      if(call.service==="unitHandoff"&&call.method==="begin"){
        const observed=call.result as Observation;
        return isDeepStrictEqual(observed.unit,inventory.find(unit=>unit.path===call.inputs[0]))&&!!observed.revision&&!!observed.mainRevision;
      }
      if(call.service==="unitIdentity"&&call.method==="observe"){
        const binding=identityBindings.get(call.inputs[0] as string),observed=call.result as IdentityObservation;
        return !!binding&&observed.repoPath===binding.unit.path&&typeof observed.revision==="string";
      }
      if(call.service==="extensionDesignRead"&&call.method==="inspect"){
        const binding=designBindings.get(call.inputs[0] as string),observed=call.result as DesignObservation;
        return !!binding&&observed.working.source===binding.unit.path&&observed.published.source===binding.unit.path;
      }
      return true;
    });
    const independentUnits=await Promise.all(inventory.map(async unit=>{
      const manifest=await packageAt(after.workingHead,unit);
      return {unit,manifest:manifest.text,manifestHash:manifest.contentHash,artworkDigest:await artworkAt(after.workingHead,unit,safeIconFrom(manifest.text))};
    }));
    const checks={
      authenticNativeUnitReadbacks:readbacksBound,
      localEffectAndProtectedState:!!workingScope&&decoysUnchanged&&after.mainEventId===before.mainEventId&&protectedManifest?.contentHash===expected?.main.contentHash,
      requestedUnitAnswer:typeof report?.explanation==="string"&&!!report.explanation.trim(),
      authenticUnitValue:report?.unit===null||observations.some(observed=>isDeepStrictEqual(observed.unit,report?.unit)),
      authenticDraftValue:report?.draft===null||!!nativeChange&&isDeepStrictEqual(report?.draft,nativeChange),
    };
    const contract:SemanticOutcomeContract={
      effects:{checks:["authenticNativeUnitReadbacks","localEffectAndProtectedState"],rationale:"Actual scoped native observations, persisted canonical artwork, unchanged metadata, protected main and neighboring bytes establish effect integrity without reference routes."},
      returnedValue:{checks:["requestedUnitAnswer"],required:world.requestedReturnRequired,rationale:"The literal user's requested explanation remains required even after a draft; pure draft-only goals do not require a redundant root report."},
      incidentalValues:{checks:["authenticUnitValue","authenticDraftValue"],rationale:"Any supplied unit or draft value must be an actual observed native value; omitted redundant copies do not establish or invalidate an effect."},
    };
    return assessObservedApplicationOutcome({caseId:world.id,contextId,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      nativeReviewEvidence:{inventory,observations:structuredClone(observations),calls:structuredClone(calls),scope,lifecycle,nativeDesign,nativeIdentity,nativeCandidate,nativeChange,
        independentCurrent:{units:independentUnits,working:revisionOf(after.workingHead),protectedEvent:after.mainEventId},
        protocol:"Native permission limits possible drafts; the actual goal decides whether a read, comparison or draft is requested. Current-state verifier facts are distinct from recorded actor observations."},
      unitHandoff:{calls:structuredClone(calls),report,working:revisionOf(after.workingHead),protectedEvent:after.mainEventId}},contract,value,invocation,[]);
  }

  async function reference() {
    await services.unitHandoff.discover();
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
    const explanation=[scope?`Observed ${scope.unit.path} at ${scope.revision}.`:"No unit was selected from the assigned inventory.",nativeDesign?"Native design observations were acquired.":null,lifecycle?"The actual lifecycle was read.":null,nativeCandidate?`Catalog resolved ${nativeCandidate.choice.id}.`:wantIdentity?"No requested catalog candidate was resolved.":null,nativeChange?`A native draft was verified at ${nativeChange.revision}.`:"No draft was performed."].filter(Boolean).join(" ");
    const report:Report={explanation,unit:scope?.unit??null,draft:nativeChange};
    const proof=await verify(report);
    const referenceRequestedArtifact=!mustStage||!!nativeChange;
    const referenceDesiredObservations=(!wantDesign||!!nativeDesign)&&(!wantIdentity||!!nativeIdentity)&&(!world.lifecycle||!!lifecycle);
    const checks={...proof.checks,referenceRequestedArtifact,referenceDesiredObservations};
    return assessNativeQualification({...proof,checks,passed:Object.values(checks).every(Boolean),
      outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"referenceRequestedArtifact","referenceDesiredObservations"]}}});
  }

  return { goal: world.goal, services, qualify: reference, verify };
}
