import {assessObservedApplicationOutcome} from "@workspace/application-outcomes/observed-application-outcome";
import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { ExplorerInput, ExplorerPlan, ExplorerReport, ExplorerRequest, ExplorerReceipt, ExplorerWitness, OwnerObservation,
  SetupRoute, SetupWitness, TourScene, TourWitness, WelcomeEvidence, WelcomeGoalReport, WelcomeResult, WelcomeHandoff, WelcomeIndex,
  WelcomePlan, WelcomeReason, WelcomeRecord, WelcomeResolution, WelcomeResource, WelcomeReviews, WelcomeRow, WelcomeScope,
  WelcomeSnapshot } from "@workspace-skills/open-personal-welcome/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { personalWelcomeWorlds, type WelcomeSeed } from "./open-goal-personal-welcome-worlds.js";

type Lane = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
type ProbePorts = {request: ExplorerRequest; services: { explorerTextProbe: {
  input(id: string): Promise<ExplorerInput>; run(id: string, plan: ExplorerPlan): Promise<ExplorerReceipt>;
} } };
type Installed = {
  catalog: readonly {id:string;title:string;scope:string}[];
  deck: readonly (TourScene & { notes: readonly string[] })[];
  route(resource: string, action: string): SetupRoute | null;
  bindProbe(input: {goal:string;text:string;claim:ExplorerInput["claim"];repeat:boolean}): ProbePorts;
};
const encoder = new TextEncoder();
const maximum = 12 * 1024;
const bytes = (text:string) => encoder.encode(text).length;
const ownerSender = (id:string) => `owner:${id}`;

async function appendNative(lane: Lane, context: string, records: WelcomeRecord[]) {
  return withOwnedChannelClient(lane,context,async session=>{
    const ids:string[] = [];
    for (const record of records) ids.push(await session.send(JSON.stringify(record),{idempotencyKey:crypto.randomUUID()}));
    return ids;
  });
}
export async function readWelcomeNative(lane: Lane, client = rpc): Promise<WelcomeSnapshot> {
  const page = await client.call(lane.target,channelClientRpcMethods.getReplayAfter,[{after:0,limit:40}]);
  const through = page.ready.snapshotLastSeq;
  if (through === undefined || page.ready.hasMoreAfter) throw new Error("Welcome timeline exceeds its owned frontier");
  const rows = page.logEvents.flatMap((envelope): WelcomeRow[]=>{
    const event = envelope.payload as AgenticEvent<"message.completed"> | undefined;
    if (event?.kind !== "message.completed" || !("role" in event.payload) || event.payload.role !== "user" ||
        !event.causality?.messageId) return [];
    const text = (event.payload.blocks ?? []).flatMap(block=>block.type==="text"?[block.content]:[]).join("");
    if (!envelope.senderId || bytes(text) > 2048) throw new Error("Invalid welcome evidence");
    return [{messageId:event.causality.messageId,seq:envelope.id,envelopeId:envelope.messageId,record:JSON.parse(text) as WelcomeRecord}];
  });
  return {channelId:lane.key,through,rows};
}
type Ports = {
  contextId:string|null; fs:typeof fs; status:typeof vcs.status; open:typeof createOwnedHeadlessChannel;
  append:typeof appendNative; read:typeof readWelcomeNative; readBytes(path:string, limit:number):Promise<Uint8Array>;
};
function livePorts():Ports {
  return {contextId,fs,status:input=>vcs.status(input),open:createOwnedHeadlessChannel,append:appendNative,read:readWelcomeNative,
    readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)};
}

function relevant(worldIntent:WelcomeScope["intent"], resource:WelcomeResource, row:WelcomeRow) {
  const {kind,resourceId} = row.record;
  return resourceId === resource.id && (resource.kind === "explorer" ? kind === "probe" :
    resource.kind === "tour" ? kind === "tour" : resource.kind === "chooser" || worldIntent === "selection" ? kind === "selection" :
    resource.id === "first-run:welcome" ? kind === "welcome" : kind === "owner" || kind === "decision");
}
function exactHeader(scope:WelcomeScope,resource:WelcomeResource,row:WelcomeRow) {
  return row.record.contextId === scope.contextId && row.record.revision === scope.revision && row.record.sender === resource.sender;
}
function expectedTour(goal:string,row:WelcomeRow,resolution:WelcomeResolution):TourWitness|null {
  if (row.record.kind !== "tour" || !resolution.scene) return null;
  const stop = {topic:goal,scene:resolution.scene,notes:row.record.expectedNotes};
  const frame = row.record.frame;
  const matches = frame.storedScene === stop.scene.id && frame.eyebrow === stop.scene.eyebrow && !!frame.heading.trim() &&
    frame.progress === `${stop.scene.position} of ${resolution.sceneCount}` &&
    frame.notesVisible === stop.notes && frame.storedNotes === stop.notes;
  return {stop,frame,sceneCount:resolution.sceneCount,result:{frame,stage:matches?"verified":"mismatch"}};
}
function expectedSetup(request:SetupWitness["request"],observed:OwnerObservation):SetupWitness {
  const route = request.intent === "selection" ? observed.route : null;
  const status = request.intent === "welcome" ? "overview" : request.intent === "refresh" ? "refresh-overview" :
    request.intent === "workspace-creation" ? "separate-workspace" : !route ? "invalid-selection" :
      ["panel","about-page","shell-navigation"].includes(route.via) ? "route-client" : "route-owner";
  return {request,result:{...observed,status,route,
    unknown:observed.rows.filter(row=>!row.observed||row.state==="unknown").map(row=>row.id),
    needsVerification:observed.rows.filter(row=>row.observed&&row.state==="connected-unverified").map(row=>row.id)}};
}
function expectedProbe(config:NonNullable<(typeof personalWelcomeWorlds)[number]["probe"]>) {
  const digest = sha256HexSyncText(config.text);
  const length = bytes(config.text);
  const crlf = config.text.includes("\r\n");
  const lf = /(?<!\r)\n/u.test(config.text);
  const input:ExplorerInput = {bytes:length,characters:Array.from(config.text).length,digest,
    lineEnding:crlf?(lf?"mixed":"crlf"):lf?"lf":"none",claim:config.claim,repeat:config.repeat};
  const plan:ExplorerPlan = {expectedBytes:length,expectedDigest:digest,comparison:config.repeat?"repeat-store":"round-trip",check:config.check};
  const receipt:ExplorerReceipt = {blob:{digest,writtenBytes:length,exists:true,statBytes:length,readDigest:digest,repeatDigest:config.repeat?digest:null},
    file:{digest,bytes:length,removed:true}};
  return {input,plan,receipt,assessment:{classification:config.mismatch?"doc-mismatch":"ok",issue:config.mismatch?"claim":null}} as const;
}

export async function prepareOpenPersonalWelcome(input:{contextId:string;caseId:string},installed:Installed,ports=livePorts()) {
  const world = personalWelcomeWorlds.find(row=>row.id===input.caseId);
  if (!world || input.contextId !== ports.contextId) throw new Error("Personal setup belongs to its assigned context");
  const before = await ports.status();
  const lane = await ports.open(input.contextId,world.title);
  const scope:WelcomeScope = {contextId:input.contextId,channelId:lane.key,revision:crypto.randomUUID(),intent:world.intent,
    mayRetry:world.mayRetry===true,mayStage:world.mayStage===true};
  const resources:WelcomeResource[] = world.resources.map(({id,title})=>{
    const setup = installed.catalog.find(row=>row.id===id);
    const scene = installed.deck.find(row=>`tour:${row.id}`===id);
    if (setup) return {id,title:title ?? setup.title,kind:"setup",scope:setup.scope,
      sender:world.intent==="selection"?"client:setup-hub":ownerSender(id)};
    if (scene) return {id,title:scene.title,kind:"tour",scope:"panel",sender:"panel:tour"};
    if (id==="workspace:chooser") return {id,title:"Separate workspace chooser",kind:"chooser",scope:"shell",sender:"shell:workspace-chooser"};
    if (id==="first-run:welcome") return {id,title:"Retained first-run welcome",kind:"setup",scope:"conversation",sender:"system:welcome-seed"};
    if (id==="explorer:text") return {id,title:"Owned Explorer text storage check",kind:"explorer",scope:"local-text",sender:"worker:explorer"};
    throw new Error("Assigned resource is absent from installed Personal catalog and deck");
  });
  const index:WelcomeIndex = {scope,resources};
  const seeded = new Map<string,WelcomeRecord>();
  const messages = new Map<string,string>();
  const nativeProbe = world.mayRetry && world.probe ? installed.bindProbe({goal:world.goal,text:world.probe.text,claim:world.probe.claim,repeat:world.probe.repeat}) : null;
  const probeConfig = world.probe ? expectedProbe(world.probe) : null;
  function materialize(seed:WelcomeSeed):WelcomeRecord {
    const resource = resources.find(item=>item.id===seed.resource)!;
    const {key,resource:id,stale,foreign,sender,...specific} = seed;
    const common = {resourceId:id,sender:sender??resource.sender,contextId:foreign?"another-workspace":scope.contextId,
      revision:stale?"previous-generation":scope.revision};
    if (specific.kind === "tour") {
      const scene = installed.deck.find(row=>`tour:${row.id}`===resource.id)!;
      const visible = specific.wrongScene ? installed.deck.find(row=>row.id===specific.wrongScene)! : scene;
      const expectedNotes = specific.notes===true;
      return {...common,kind:"tour",expectedNotes,frame:{storedScene:scene.id,storedNotes:expectedNotes,
        eyebrow:visible.eyebrow,heading:visible.title,progress:`${visible.position} of ${installed.deck.length}`,
        notesVisible:specific.wrongNotes?!expectedNotes:expectedNotes}};
    }
    if (specific.kind === "owner") return {...common,kind:"owner",state:specific.state,observed:specific.observed!==false};
    if (specific.kind === "probe") return {...common,kind:"probe",state:specific.state,digest:probeConfig?.input?.digest ?? sha256HexSyncText("retained local probe")};
    if (specific.kind === "welcome") return {...common,kind:"welcome",state:"retained"};
    return {...common,...specific};
  }
  async function append(seeds:WelcomeSeed[]) {
    const records = seeds.map(materialize);
    const ids = await ports.append(lane,input.contextId,records);
    if (ids.length!==records.length || new Set(ids).size!==ids.length) throw new Error("Welcome records need exact original IDs");
    seeds.forEach((seed,i)=>{messages.set(seed.key,ids[i]!);seeded.set(ids[i]!,records[i]!);});
  }
  await append(world.first);
  const initial = await ports.read(lane);
  const scratch = await ports.fs.mkdtemp("welcome-review");
  const note = `${scratch}/scope.md`;
  await ports.fs.writeFile(note,"Review only this owned first-run conversation and any expressly authorized local diagnostic.");
  const beforeFiles = new Set(await listOwnedScratchEntries(ports.fs));
  const writer = bindScratchHandoff(ports.fs,{goal:world.goal,questions:["Which current Personal next step is supported?"],
    sources:[{id:"scope",path:note}]},ports.readBytes).scratchHandoffWrite;
  let reading = false;
  let writing = false;
  let resolution:WelcomeResolution|null = null;
  let ownerRead:OwnerObservation|null = null;
  let probeInput:ExplorerInput|null = null;
  let probeRun:{plan:ExplorerPlan;receipt:ExplorerReceipt}|null = null;
  let handoff:WelcomeHandoff|null = null;
  const snapshots:WelcomeSnapshot[] = [];
  const currentRow = (current:WelcomeSnapshot,resource:WelcomeResource) =>
    current.rows.findLast(row=>relevant(scope.intent,resource,row))??null;
  function resolveResource(current:WelcomeSnapshot,resource:WelcomeResource):WelcomeResolution {
    const row = currentRow(current,resource);
    const scene = installed.deck.find(item=>`tour:${item.id}`===resource.id)??null;
    const scopeValid = row && exactHeader(scope,resource,row);
    const route = scopeValid && row.record.kind==="selection" && resource.kind==="setup" ?
      installed.route(resource.id,row.record.action):null;
    const permit = scopeValid && row.record.kind==="probe" && row.record.state==="interrupted" && scope.mayRetry &&
      row.record.digest === probeConfig?.input?.digest && nativeProbe;
    return {resourceId:resource.id,route,scene:scene?{id:scene.id,title:scene.title,eyebrow:scene.eyebrow,position:scene.position}:null,
      sceneCount:installed.deck.length,guidance:scene?[...scene.notes]:[],probe:permit?permit.request:null};
  }
  function observeOwner(current:WelcomeSnapshot,resolved:WelcomeResolution):OwnerObservation {
    const rows = resources.filter(resource=>resource.kind==="setup"&&resource.id!=="first-run:welcome").map(resource=>{
      const row = current.rows.findLast(row=>row.record.kind==="owner"&&row.record.resourceId===resource.id&&
        row.record.contextId===scope.contextId&&row.record.revision===scope.revision&&row.record.sender===ownerSender(resource.id));
      return row?.record?.kind==="owner" ? {id:resource.id,state:row.record.state,observed:row.record.observed} :
        {id:resource.id,state:"unknown" as const,observed:false};
    });
    return {receipt:sha256HexSyncText(JSON.stringify({scope,through:current.through,rows,route:resolved.route})),rows,route:resolved.route};
  }
  function assess(current:WelcomeSnapshot,resource:WelcomeResource|null, resolved:WelcomeResolution|null):WelcomeEvidence {
    if (!resource) return {sender:null,message:null,reason:world.expected.reason};
    const row = currentRow(current,resource);
    if (!row) return {sender:null,message:null,reason:"missing-evidence"};
    const record = row.record;
    const claim = (reason:WelcomeReason):WelcomeEvidence => ({sender:record.sender,message:row.messageId,reason});
    if (record.contextId!==scope.contextId) return claim("wrong-context");
    if (record.sender!==resource.sender) return claim("foreign-sender");
    if (record.revision!==scope.revision) return claim("stale-receipt");
    if (record.kind==="welcome") return claim("welcome-retained");
    if (record.kind==="decision") return claim("preference-preserved");
    if (record.kind==="owner") return claim(!record.observed||record.state==="unknown"?"owner-unknown":
      record.state==="connected-unverified"?"needs-verification":"verified-current");
    if (record.kind==="selection") return claim(resource.kind==="chooser"?"separate-workspace":resolved?.route?"verified-current":"invalid-route");
    if (record.kind==="tour") return claim(resolved?.scene?"verified-current":"invalid-route");
    return claim(record.state==="completed"?"already-complete":resolved?.probe?"retry-ready":"retry-unauthorized");
  }
  function decisions(current:WelcomeSnapshot,resource:WelcomeResource|null,resolved:WelcomeResolution|null,probe:ExplorerWitness|null) {
    const evidence = assess(current,resource,resolved);
    const row = resource ? currentRow(current,resource):null;
    const setup = resolved && resource && (resource.kind==="setup"||resource.kind==="chooser") ?
      expectedSetup({goal:world.goal,intent:scope.intent},observeOwner(current,resolved)):null;
    const tour = row && resolved && resource?.kind==="tour" && evidence.reason==="verified-current" ?
      expectedTour(world.goal,row,resolved):null;
    const reason = tour?.result?.stage==="mismatch"?"tour-frame-mismatch":
      evidence.reason==="retry-ready"&&probe?"local-retry-complete":evidence.reason;
    const supported = ["verified-current","welcome-retained","separate-workspace","preference-preserved","needs-verification",
      "owner-unknown","already-complete","local-retry-complete"].includes(reason);
    const action:WelcomePlan["action"] = supported ? scope.mayStage && ["verified-current","local-retry-complete"].includes(reason) ?
      "stage":"report":"hold";
    return {plan:{...evidence,reason,action,resourceId:resource?.id??null,channelId:scope.channelId,through:current.through},
      setup,tour,probeRequired:evidence.reason==="retry-ready"};
  }
  function qualityProbe(probe:ExplorerWitness|null) {
    if (!probe || !probeConfig || !nativeProbe || !probeInput || !probeRun) return false;
    const {next,...result} = probe.result;
    return isDeepStrictEqual(probe.request,nativeProbe.request) && isDeepStrictEqual(result,probeConfig) &&
      isDeepStrictEqual(probeInput,probeConfig.input) && isDeepStrictEqual(probeRun,{plan:probeConfig.plan,receipt:probeConfig.receipt}) &&
      typeof next==="string"&&!!next.trim()&&bytes(next)<=260;
  }
  function stageText(plan:WelcomePlan,reviews:WelcomeReviews) {
    return JSON.stringify({schema:"vibestudio.personal-welcome-handoff/1",contextId:scope.contextId,generation:scope.revision,
      resource:plan.resourceId,sender:plan.sender,channel:plan.channelId,frontier:plan.through,message:plan.message,
      outcome:plan.reason,explanation:plan.explanation,reviews});
  }
  let stagedText:string|null=null;
  const services = {
    welcomeResourceIndex:{
      async list() {

        return structuredClone(index);
      },
    },
    welcomeReceiptStore:{
      async read(channelId:string) {
        if (channelId!==lane.key) return null;
        if (snapshots.length>=2) return structuredClone(snapshots.at(-1)!);
        if (reading) return null;
        reading=true;
        try {
          const latest=await ports.read(lane);
          snapshots.push(latest);
          if (snapshots.length===1 && world.later?.length) await append(world.later);
          return structuredClone(latest);
        } finally {reading=false;}
      },
    },
    welcomeResourceResolution:{
      async resolve(resourceId:string) {
        const resource=resources.find(row=>row.id===resourceId);
        if (!resource || !snapshots[1] || resolution) return null;
        resolution=resolveResource(snapshots[1],resource);
        return structuredClone(resolution);
      },
    },
    onboardingRead:{
      async inspect() {
        if (!resolution || !snapshots[1] || ownerRead) throw new Error("Use the current resolved Personal owner");
        ownerRead=observeOwner(snapshots[1],resolution);
        return structuredClone(ownerRead);
      },
    },
    explorerTextProbe:{
      async input(id:string) {
        if (!nativeProbe || id!==resolution?.probe?.operationId || probeInput || (await ports.read(lane)).through!==snapshots[1]?.through)
          throw new Error("Use the explicitly authorized current Personal probe");
        probeInput=await nativeProbe.services.explorerTextProbe.input(id);
        return structuredClone(probeInput);
      },
      async run(id:string,plan:ExplorerPlan) {
        if (!nativeProbe || id!==resolution?.probe?.operationId || !probeInput || probeRun ||
            (await ports.read(lane)).through!==snapshots[1]?.through) throw new Error("Only one exact local retry is authorized");
        const receipt=await nativeProbe.services.explorerTextProbe.run(id,plan);
        probeRun={plan:structuredClone(plan),receipt:structuredClone(receipt)};
        return receipt;
      },
    },
    welcomeLocalHandoff:{
      async stage(plan:WelcomePlan,reviews:WelcomeReviews) {
        if (!scope.mayStage || writing || handoff || plan?.action!=="stage" || plan.resourceId!==resolution?.resourceId ||
            plan.channelId!==lane.key || !snapshots[1]) return null;
        writing=true;
        try {
          const latest=await ports.read(lane);
          const resource=resources.find(row=>row.id===plan.resourceId);
          if (!resource || !resolution) return null;
          const actual=resolveResource(latest,resource);
          const expected=decisions(latest,resource,actual,reviews.probe);
          const {explanation,...facts}=plan;
          const status=await ports.status();
          if (!explanation?.trim() || !isDeepStrictEqual(resolution,actual) || !isDeepStrictEqual(expected.plan,facts) ||
              !isDeepStrictEqual(expected.setup,reviews.setup) || !isDeepStrictEqual(expected.tour,reviews.tour) ||
              (expected.probeRequired?!qualityProbe(reviews.probe):reviews.probe!==null) ||
              status.mainEventId!==before.mainEventId || !isDeepStrictEqual(status.workingHead,before.workingHead) ||
              (await ports.read(lane)).through!==plan.through) return null;
          const text=stageText(plan,reviews);
          if (bytes(text)>maximum) return null;
          const receipt=(stagedText=text,await writer.stage(text));
          if (!receipt) return null;
          handoff={...receipt,sha256:sha256HexSyncText(text)};
          return structuredClone(handoff);
        } finally {writing=false;}
      },
    },
  };
  async function verify(raw:unknown,invocation?:InvocationObservations) {
    const report=raw as WelcomeResult|null;
    const outcome=report;
    const latest=await ports.read(lane);
    const expected=world.expected;
    const resource=resources.find(row=>row.id===expected.target)??null;
    const native=resource?resolveResource(latest,resource):null;
    const actualProbe=outcome?.probe&&nativeProbe?{request:nativeProbe.request,result:outcome.probe}:null;
    const independent=decisions(latest,resource,native,actualProbe);
    const plan=outcome?.plan;
    const checked=outcome;
    const status=await ports.status();
    const files=(await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-")&&!beforeFiles.has(name));
    const data=handoff?await ports.readBytes(handoff.path,maximum):null;
    const artifact=data?new TextDecoder("utf-8",{fatal:true}).decode(data):null;
    const foreign=crypto.randomUUID();
    const artifactExplanation=(()=>{try{return artifact?JSON.parse(artifact)?.explanation:null;}catch{return null;}})();
    const checks={
      returnedArtifactReceipt:isDeepStrictEqual(outcome?.handoff,handoff),
      exactWelcomeResource:!!plan&&plan.resourceId===expected.target&&isDeepStrictEqual(resolution,native),
      exactWelcomeFrontiers:snapshots.length===2&&isDeepStrictEqual(initial,snapshots[0])&&isDeepStrictEqual(latest,snapshots[1])&&
        latest.rows.length===seeded.size&&latest.rows.every(row=>isDeepStrictEqual(seeded.get(row.messageId),row.record))&&
        new Set(latest.rows.map(row=>row.envelopeId)).size===latest.rows.length,
      exactWelcomeDecision:!!plan&&isDeepStrictEqual((({explanation,...facts})=>facts)(plan),independent.plan)&&
        plan.reason===expected.reason&&plan.action===expected.action&&plan.message===(expected.key?messages.get(expected.key):null)&&
        typeof plan.explanation==="string"&&bytes(plan.explanation)<=600&&expected.claims.every(pattern=>pattern.test(plan.explanation)),
      verifiedWelcomeOwner:independent.setup?!!checked&&checked.setup?.status===expected.setup&&
        isDeepStrictEqual(checked.setup,independent.setup.result)&&isDeepStrictEqual(ownerRead,resource&&native?observeOwner(latest,native):null):
        checked?.setup===null&&ownerRead===null,
      verifiedWelcomeTour:isDeepStrictEqual(checked?.tour,independent.tour?.result??null)&&(checked?.tour?.stage??null)===expected.tour,
      verifiedWelcomeRetry:expected.probe?independent.probeRequired&&qualityProbe(actualProbe):
        !independent.probeRequired&&probeInput===null&&probeRun===null&&checked?.probe===null,
      exactWelcomeHandoff:expected.action==="stage"?typeof artifactExplanation==="string"&&bytes(artifactExplanation)<=600&&expected.claims.every(pattern=>pattern.test(artifactExplanation))&&!!plan&&!!checked&&!!handoff&&!!artifact&&!!data&&files.length===1&&
        handoff.path===`/.tmp/${files[0]}/handoff.json`&&artifact===stagedText&&
        handoff.sha256===sha256HexSyncText(artifact)&&handoff.bytes===data.length:
        files.length===0&&handoff===null,
      preservedWelcomeContext:status.mainEventId===before.mainEventId&&isDeepStrictEqual(status.workingHead,before.workingHead),
      rejectedForeignWelcome:await services.welcomeReceiptStore.read(foreign)===null&&await services.welcomeResourceResolution.resolve(foreign)===null&&
        await services.welcomeLocalHandoff.stage({resourceId:foreign} as WelcomePlan,{} as WelcomeReviews)===null,
    };
    const contract:SemanticOutcomeContract={"effects": {"checks": ["exactWelcomeFrontiers", "exactWelcomeHandoff", "preservedWelcomeContext", "rejectedForeignWelcome"], "rationale": "Native observations, scoped authority, retained bytes and protected state establish application effects independently."}, "returnedValue": {"checks": ["exactWelcomeResource", "exactWelcomeDecision", "verifiedWelcomeOwner", "verifiedWelcomeTour", "verifiedWelcomeRetry"], "required": true, "rationale": "The returned domain findings are required for queries; completed mutations are established independently."}, "incidentalValues": {"checks": ["returnedArtifactReceipt"], "rationale": "Receipt echoes are optional presentation of independently verified native artifacts."}};
    return assessObservedApplicationOutcome({contextId:input.contextId,caseId:input.caseId,goal:world.goal,checks,passed:Object.values(checks).every(Boolean),
      index,snapshots,resolution,ownerRead,independent,probeInput,probeRun,handoff,artifact},contract,raw,invocation,[{"checks":["verifiedWelcomeTour"],"rootPath":["tour"],"producerSourceSuffix":"workOnPersonalWelcomeGoal/reviewWelcomeTour/tour/rehearseTour/reviewStops/verifyTourStop.nl","producerPath":[]},{"checks":["verifiedWelcomeRetry"],"rootPath":["probe"],"producerSourceSuffix":"workOnPersonalWelcomeGoal/retryWelcomeProbe/explorer/probeWorkspaceText.nl","producerPath":[]},{"checks":["exactWelcomeResource","exactWelcomeDecision"],"rootPath":["plan"],"producerSourceSuffix":"workOnPersonalWelcomeGoal/decideWelcomeNextStep.nl","producerPath":[]},{"checks":["verifiedWelcomeOwner"],"rootPath":["setup"],"producerSourceSuffix":"workOnPersonalWelcomeGoal/reviewWelcomeSetup/onboarding/planSetup.nl","producerPath":[]}]);
  }
  async function qualify() {
    await services.welcomeResourceIndex.list();
    await services.welcomeReceiptStore.read(lane.key);
    const latest=await services.welcomeReceiptStore.read(lane.key);
    if (!latest) throw new Error("The reference needs both owned native states");
    const resource=resources.find(row=>row.id===world.expected.target)??null;
    const resolved=resource?await services.welcomeResourceResolution.resolve(resource.id):null;
    const interim=decisions(latest,resource,resolved,null);
    if (interim.setup) await services.onboardingRead.inspect();
    let probe:ExplorerWitness|null=null;
    if (interim.probeRequired && resolved?.probe && probeConfig) {
      const value=await services.explorerTextProbe.input(resolved.probe.operationId);
      const receipt=await services.explorerTextProbe.run(resolved.probe.operationId,probeConfig.plan);
      probe={request:resolved.probe,result:{input:value,plan:probeConfig.plan,receipt,assessment:probeConfig.assessment,
        next:"Retain the measurements and cleanup evidence for the local review."}};
    }
    const exact=decisions(latest,resource,resolved,probe);
    const plan:WelcomePlan={...exact.plan,explanation:world.expected.statement};
    const reviews:WelcomeReviews={setup:exact.setup,tour:exact.tour,probe};
    const receipt=plan.action==="stage"?await services.welcomeLocalHandoff.stage(plan,reviews):null;
    const report={plan,setup:reviews.setup?.result??null,tour:reviews.tour?.result??null,probe:reviews.probe?.result??null,handoff:receipt};
    const accepted=await verify(report);
    const forged=await verify({...report,plan:{...plan,through:-1}});
    return {...accepted,passed:accepted.passed&&!forged.passed};
  }
  return {goal:world.goal,services,verify,qualify};
}
