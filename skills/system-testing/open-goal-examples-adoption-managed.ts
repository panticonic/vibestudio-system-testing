import {assessNativeQualification} from "@workspace/application-outcomes/semantic-outcome-contract";
import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome = bindObservedContentReview(["card", "installed", "composition", "gate", "journal", "nativeFacts"], ["noteText"]);
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import {
  sha256HexSyncText,
  stableSha256Hex,
} from "@vibestudio/content-addressing";
import { parseWorkspaceSystemEpochEnvelope } from "@vibestudio/workspace/configParser";
import { parseTemplateManifestContent } from "@vibestudio/workspace/templateManifest";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { bindScratchHandoff, maxScratchArtifactBytes as maxNoteBytes} from "@workspace-skills/scratch-handoff-bindings";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import {
  adoptionReviewLayers,
  evaluateAdoption,
} from "./examples-adoption-composition.js";
import type { ExamplesAdoptionWorld } from "./open-goal-examples-adoption-worlds.js";

type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];
type Ports = {
  contextId: string | null;
  vcs: Pick<
    typeof vcs,
    "status" | "importSnapshot" | "resolveRepository" | "readFile"
  >;
  fs: Parameters<typeof bindScratchHandoff>[0] & Pick<typeof fs, "readdir">;
  putText(text: string): Promise<string>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
type Plan = {
  finding: string;
  proof: string[];
};
type Card = {
  id: string;
  title: string;
  event: string;
  edition: "staged" | "retired";
  mayRecord: boolean;
};
type Installed = {
  repository: string;
  packageName: string;
  manifestDigest: string;
  templateDigest: string;
  main: string;
};
type Composition = ReturnType<typeof evaluateAdoption> & {
  id: string;
  event: string;
};
type Gate = { event: string; status: "current" | "changed" };
type Receipt = { path: string; digest: string; event: string };
type Readback = { main: string; event: string; digest: string | null };

type Journal = {
  service: string;
  method: string;
  args: unknown[];
  result: unknown;
};
const read = "adoptionReview";
const write = "adoptionHandoff";
function livePorts(): Ports {
  return {
    contextId,
    vcs,
    fs,
    putText: async (text) =>
      (await rpc.call("main", mainRpcMethods["blobstore.putText"], [text]))
        .digest,
    readBytes: (path, limit) => readWorkspaceBytes(rpc, path, limit),
  };
}

export async function prepareOpenExamplesAdoption(
  input: { contextId: string; caseId: string },
  world: ExamplesAdoptionWorld,
  ports = livePorts(),
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Composition review belongs to another context");
  const key = crypto.randomUUID();
  const ownedRepo = "packages/examples-adoption-review-" + key;
  const status = () => ports.vcs.status({ contextId: input.contextId });
  const initial = await status();
  const release = { kind: "event" as const, eventId: initial.mainEventId };
  const file = async (state: State, repoPath: string, path: string) => {
    const repo = await ports.vcs.resolveRepository({ state, repoPath });
    if (!repo || repo.repoPath !== repoPath)
      throw new Error("Missing exact native repository " + repoPath);
    const observed = await ports.vcs.readFile({
      state,
      repositoryId: repo.repositoryId,
      file: { kind: "path", path },
    });
    if (
      observed?.content.kind !== "text" ||
      observed.contentHash !== sha256HexSyncText(observed.content.text)
    )
      throw new Error("Missing exact source " + repoPath + "/" + path);
    return {
      text: observed.content.text,
      digest: observed.contentHash,
      repositoryId: repo.repositoryId,
    };
  };
  async function installedEvidence(): Promise<Installed & { epoch: number }> {
    const [manifest, unit] = await Promise.all([
      file(release, "meta", "vibestudio.yml"),
      file(release, world.unit, "package.json"),
    ]);
    const epoch = parseWorkspaceSystemEpochEnvelope(manifest.text);
    const parsed = parseTemplateManifestContent(manifest.text, epoch);
    const services = parsed.top.services ?? [];
    if (
      !services.some(
        (service) =>
          service.name === "grimoire" &&
          service.source === "workers/grimoire-world",
      ) ||
      !services.some(
        (service) =>
          service.name === "regency" &&
          service.source === "workers/regency-realm",
      )
    )
      throw new Error("Expected the installed Examples world services");
    const packageName = JSON.parse(unit.text).name;
    if (typeof packageName !== "string")
      throw new Error("Installed Examples unit lacks a package name");
    return {
      repository: world.unit,
      packageName,
      manifestDigest: unit.digest,
      templateDigest: manifest.digest,
      main: initial.mainEventId,
      epoch,
    };
  }
  const installed = await installedEvidence();
  const layers = adoptionReviewLayers(
    world,
    installed.epoch,
    installed.packageName,
  );
  const source = (label: string) =>
    JSON.stringify({
      title: world.name,
      label,
      protectedMain: initial.mainEventId,
      installed,
      layers:
        label === "working"
          ? layers
          : layers.map((layer, index) =>
              index === 0
                ? layer
                : {
                    ...layer,
                    files: Object.fromEntries(
                      Object.entries(layer.files).map(([path, bytes]) => [
                        path,
                        path.endsWith("/review-candidate.ts")
                          ? bytes +
                            "export const reviewEdition = " +
                            JSON.stringify(label) +
                            ";\n"
                          : bytes,
                      ]),
                    ),
                  },
            ),
    });
  let repositoryId: string | undefined;
  async function stageReview(expectedWorkingHead: State, label: string) {
    const records = [
      [
        "package.json",
        JSON.stringify({
          name: "@workspace/examples-adoption-review-" + key,
          private: true,
          type: "module",
          version: "0.1.0",
        }),
      ],
      ["review.json", source(label)],
    ] as const;
    const files = await Promise.all(
      records.map(async ([path, text]) => {
        const digest = await ports.putText(text);
        if (digest !== sha256HexSyncText(text))
          throw new Error("Template review source changed while seeding");
        return { path, mode: 0o644 as const, contentHash: digest };
      }),
    );
    const result = await ports.vcs.importSnapshot({
      contextId: input.contextId,
      commandId: "examples-adoption-" + key + "-" + label,
      expectedWorkingHead,
      intentSummary: "Stage owned Examples adoption evidence",
      source: {
        kind: "generated",
        uri: "system-test://examples-adoption/" + key,
        snapshotRevision: stableSha256Hex(files),
      },
      repositories: [
        {
          repoPath: ownedRepo,
          files,
          ...(repositoryId ? { repositoryId } : {}),
        },
      ],
      message: "Record the disposable composition review",
    });
    const state = { kind: "event" as const, eventId: result.eventId };
    const exact = await file(state, ownedRepo, "review.json");
    if (
      exact.text !== records[1][1] ||
      result.importedRepositoryIds.length !== 1 ||
      result.importedRepositoryIds[0] !== exact.repositoryId ||
      (repositoryId && repositoryId !== exact.repositoryId)
    )
      throw new Error("VCS did not retain the exact owned composition review");
    repositoryId = exact.repositoryId;
    return state;
  }
  const retired = await stageReview(initial.workingHead, "earlier");
  const current = await stageReview(retired, "working");
  const card: Card = {
    id: key,
    title: world.name,
    event: current.eventId,
    edition: "staged",
    mayRecord: world.mayRecord,
  };
  const older: Card = {
    id: crypto.randomUUID(),
    title: world.name + " prior review",
    event: retired.eventId,
    edition: "retired",
    mayRecord: false,
  };
  const priorScratch = new Set(await listOwnedScratchEntries(ports.fs));
  const writer = bindScratchHandoff(
    ports.fs,
    {
      goal: world.goal,
      questions: ["What does the exact staged Examples composition permit?"],
      sources: [{ id: "owned-adoption", path: "/.tmp/" + key }],
    },
    ports.readBytes,
  ).scratchHandoffWrite;
  const journal: Journal[] = [];
  const keep = <T>(
    service: string,
    method: string,
    args: unknown[],
    result: T,
  ): T => {
    journal.push({
      service,
      method,
      args: structuredClone(args),
      result: structuredClone(result),
    });
    return result;
  };
  const assign = (id: string) => {
    if (id !== key)
      throw new Error("Read only the current owned Examples review");
  };
  const stateEvent = async () => {
    const state = await status();
    if (
      state.mainEventId !== initial.mainEventId ||
      state.workingHead.kind !== "event"
    )
      throw new Error("The owned review must preserve protected main");
    return state.workingHead.eventId;
  };
  if ((await stateEvent()) !== current.eventId)
    throw new Error("The staged review is not the owned working head");
  const nativeComposition = async (): Promise<Composition> => {
    const evidence = await file(current, ownedRepo, "review.json");
    if (
      evidence.repositoryId !== repositoryId ||
      evidence.text !== source("working")
    )
      throw new Error("The staged Examples review changed its source");
    const readLayers = JSON.parse(evidence.text).layers as typeof layers;
    return {
      id: key,
      event: current.eventId,
      ...evaluateAdoption(world.unit, readLayers),
    };
  };
  let composition: Composition | undefined;
  let gate: Gate | undefined;
  let receipt: Receipt | null = null;
  let advanced = false;
  // The external restage belongs to native lifetime, not to a mandatory caller route.
  async function observeCurrentFrontier() {
    if(world.during&&!advanced){advanced=true;await stageReview(current,"coedited");}
    return stateEvent();
  }
  function possible(c: Composition) {
    return [
      c.issue,
      c.owner,
      c.minimumAppVersion,
      ...c.privateFiles,
      ...c.settings,
      ...c.pulledUnits,
    ];
  }
  const services = {
    adoptionReview: {
      async discover() {
        return keep(read, "discover", [], [card, older]);
      },
      async installed(id: string) {
        assign(id);
        const { epoch, ...observed } = await installedEvidence();
        return keep(read, "installed", [id], observed);
      },
      async compose(id: string, event: string) {
        assign(id);
        if (event !== card.event)
          throw new Error("Compose only the exact reviewed candidate event");
        composition = await nativeComposition();
        return keep(read, "compose", [id, event], composition);
      },
      async confirm(id: string, event: string) {
        assign(id);
        if (event !== card.event)
          throw new Error("Confirm only the observed composition");
        const head = await observeCurrentFrontier();
        gate = { event: head, status: head === event ? "current" : "changed" };
        return keep(read, "confirm", [id, event], gate);
      },
      async readback(id: string, path: string | null) {
        assign(id);
        if (path !== (receipt?.path ?? null))
          throw new Error(
            "Read only the assigned private composition artifact",
          );
        const event = await observeCurrentFrontier();
        const bytes = path ? await ports.readBytes(path, maxNoteBytes) : null;
        const digest = bytes
          ? sha256HexSyncText(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            )
          : null;
        return keep(read, "readback", [id, path], {
          main: initial.mainEventId,
          event,
          digest,
        });
      },
    },
    adoptionHandoff: {
      async record(id: string, event: string, plan: Plan) {
        assign(id);
        let result: Receipt | null = null;
        if (
          !receipt &&
          card.mayRecord &&
          event === card.event &&
          composition?.event === event &&
          (await observeCurrentFrontier()) === event &&
          typeof plan.finding === "string" && Boolean(plan.finding.trim()) &&
          Array.isArray(plan.proof) &&
          plan.proof.every((item) => typeof item === "string" && possible(composition!).includes(item))
        ) {
          const body = JSON.stringify({
            title: card.title,
            event,
            main: initial.mainEventId,
            compositionDigest: composition.digest,
            status: composition.status,
            issue: composition.issue,
            owner: composition.owner,
            proof: plan.proof,
            finding: plan.finding,
          });
          const staged = await writer.stage(body);
          if (staged) {
            if ((await stateEvent()) === event) {
              result = {
                path: staged.path,
                digest: sha256HexSyncText(body),
                event,
              };
              receipt = result;
            } else {
              await ports.fs.rm(
                staged.path.slice(0, staged.path.lastIndexOf("/")),
                { recursive: true, force: true },
              );
            }
          }
        }
        return keep(write, "record", [id, event, plan], result);
      },
    },
  };
  
  async function verify(value: unknown,observations?: InvocationObservations) {
    const proof=await verifyNativeApplication(value);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    const assessed=await assessObservedApplicationOutcome(proof,proof.outcomeContract,value,observations,
      [{checks:["returnedAdoptionValue"],rootPath:[],producerSourceSuffix:"reviewExamplesAdoption.nl",producerPath:[]}]);
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }
  async function verifyNativeApplication(value: unknown) {
    const finalEvent=await observeCurrentFrontier();
    const independent=await nativeComposition();
    const {epoch,...installedSource}=await installedEvidence();
    const liveSource=await file({kind:"event",eventId:finalEvent},ownedRepo,"review.json");
    const liveLayers=JSON.parse(liveSource.text).layers as typeof layers;
    const currentComposition={id:key,event:finalEvent,...evaluateAdoption(world.unit,liveLayers)};
    const files=(await listOwnedScratchEntries(ports.fs)).filter(path=>!priorScratch.has(path));
    const saved=receipt?await ports.readBytes(receipt.path,maxNoteBytes):null;
    const body=saved?new TextDecoder("utf-8",{fatal:true}).decode(saved):null;
    const records=journal.filter(row=>row.service===write&&row.method==="record"&&row.result!==null);
    const issued=records.find(row=>isDeepStrictEqual(row.result,receipt));
    const draft=issued?.args[2] as Plan|undefined;
    const readback:Readback={main:initial.mainEventId,event:finalEvent,digest:body===null?null:sha256HexSyncText(body)};
    const observed=journal.filter(row=>row.service===read);
    const nativeBody=draft?{title:card.title,event:card.event,main:initial.mainEventId,
      compositionDigest:independent.digest,status:independent.status,issue:independent.issue,
      owner:independent.owner,proof:draft.proof,finding:draft.finding}:null;
    const checks={
      returnedAdoptionValue:typeof value==="string"&&Boolean(value.trim()),
      authenticObservedAdoptionEvidence:observed.every(row=>{
        if(row.method==="discover")return isDeepStrictEqual(row.args,[])&&isDeepStrictEqual(row.result,[card,older]);
        if(row.method==="installed")return isDeepStrictEqual(row.args,[key])&&isDeepStrictEqual(row.result,installedSource);
        if(row.method==="compose")return isDeepStrictEqual(row.args,[key,card.event])&&isDeepStrictEqual(row.result,independent);
        if(row.method==="confirm"){const result=row.result as Gate;return isDeepStrictEqual(row.args,[key,card.event])&&
          [card.event,finalEvent].includes(result.event)&&result.status===(result.event===card.event?"current":"changed");}
        if(row.method==="readback"){const result=row.result as Readback;return row.args[0]===key&&
          result.main===initial.mainEventId&&[card.event,finalEvent].includes(result.event)&&
          (row.args[1]===null?result.digest===null:!!receipt&&row.args[1]===receipt.path&&result.digest===receipt.digest);}
        return false;
      }),
      exactNativeCompositionAndProtectedSource:liveSource.repositoryId===repositoryId&&
        liveSource.text===sourceForCurrentReview()&&
        /^[a-f0-9]{64}$/u.test(liveSource.digest)&&
        (independent.status==="composed"?/^[a-f0-9]{64}$/u.test(independent.digest??"")&&typeof independent.owner==="string":independent.digest===null&&independent.owner===null),
      currentOwnedAdoptionWrites:records.every(row=>{const got=row.result as Receipt;return row.args[0]===key&&
        row.args[1]===card.event&&got.event===card.event&&card.mayRecord&&finalEvent===card.event&&
        isDeepStrictEqual(got,receipt);}),
      actualPrivateAdoptionBytes:receipt!==null?!!issued&&!!draft&&body!==null&&files.length===1&&
        typeof draft.finding==="string"&&Boolean(draft.finding.trim())&&
        draft.proof.every(item=>possible(independent).includes(item))&&
        sha256HexSyncText(body)===receipt.digest&&isDeepStrictEqual(JSON.parse(body),nativeBody):body===null&&files.length===0,
      independentReadbackAndPreservedMain:readback.main===initial.mainEventId&&readback.event===finalEvent&&readback.digest===(receipt?.digest??null),
    };
    return {outcomeContract:{
      effects:{checks:["authenticObservedAdoptionEvidence","exactNativeCompositionAndProtectedSource","currentOwnedAdoptionWrites","actualPrivateAdoptionBytes","independentReadbackAndPreservedMain"],rationale:"Actual native source, current owned write authority, protected main and persisted bytes; independent verification is not an actor read."},
      returnedValue:{checks:["returnedAdoptionValue"],required:world.requestedReturnRequired,rationale:"Explicit literal chat/check questions require their actual finding; a requested private artifact need not have an extra root report."},
      incidentalValues:{checks:[],rationale:"The public result is the user's finding, not a copied private status or receipt envelope."}},
      incorrectReturnValues:[],contextId:input.contextId,caseId:world.id,goal:world.goal,
      passed:Object.values(checks).every(Boolean),checks,card,installed:installedSource,composition:independent,gate,
      receipt,readback,noteText:body,journal:structuredClone(journal),
      nativeFacts:{reviewed:{card,composition:independent},current:{event:finalEvent,composition:currentComposition,sourceDigest:liveSource.digest},
        actorObserved:{installed:observed.some(row=>row.method==="installed"),composition:observed.some(row=>row.method==="compose"),frontier:observed.some(row=>row.method==="confirm"),readback:observed.some(row=>row.method==="readback")},
        artifact:{receipt,noteText:body},protocol:"Installed, reviewed and current native facts have separate roles. Independent verifier reads are not actor reads. A grant does not request an artifact; a refused attempt has no committed effect. Meaning review must judge actual requested findings/notes from the real actor evidence and retained bytes, never a reference disposition, path set or method count."},
    };
  }
  function sourceForCurrentReview(){return source(advanced?"coedited":"working");}
  async function qualify() {
    const discovered=await services.adoptionReview.discover();let denied=0;
    try{await services.adoptionReview.installed(older.id);}catch{denied++;}
    try{await services.adoptionReview.compose(key,older.event);}catch{denied++;}
    await services.adoptionReview.installed(key);
    const native=await services.adoptionReview.compose(key,card.event);
    const confirmed=await services.adoptionReview.confirm(key,card.event);
    const draft:Plan={finding:JSON.stringify({status:native.status,issue:native.issue,owner:native.owner,privateFiles:native.privateFiles,pulledUnits:native.pulledUnits,settings:native.settings,minimumAppVersion:native.minimumAppVersion}),
      proof:possible(native).filter((item):item is string=>typeof item==="string")};
    const shouldRecord=world.requestedArtifact!=="none"&&card.mayRecord&&confirmed.status==="current";
    const saved=shouldRecord?await services.adoptionHandoff.record(key,card.event,draft):null;
    await services.adoptionReview.readback(key,saved?.path??null);
    const report=draft.finding;const verification=await verify(report);
    const requiredArtifact=world.requestedArtifact==="required"||shouldRecord;
    const referenceActuallyPerformed=denied===2&&(requiredArtifact?!!saved&&verification.checks.actualPrivateAdoptionBytes:saved===null)&&
      native.status===world.status;
    return assessNativeQualification({...verification,
      outcomeContract:{...verification.outcomeContract,effects:{...verification.outcomeContract.effects,checks:[...verification.outcomeContract.effects.checks,"referenceActuallyPerformed"]}},
      passed:verification.passed&&referenceActuallyPerformed,checks:{...verification.checks,referenceActuallyPerformed},referenceReport:report});
  }
  return {services,verify,qualify};
}
