import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { localMessagingFixtureMethods } from "@workspace-workers/local-messaging-fixture/contract";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { Attempt, HistoryReview, IntegrationArtifact, OriginalArtifact, ReceiptJoin, Result, Specialist,
  SpecialistGoalReport, SpecialistIndex, SpecialistPlan, SpecialistRecord, SpecialistRow, SpecialistScope,
  SpecialistSnapshot, SpecialistMembershipRequest as MembershipRequest } from "@workspace-skills/open-specialist-handoff/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { specialistHandoffWorlds, type SpecialistSeed } from "./open-goal-specialist-worlds.js";

type Lane = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
type RosterRow = { participantId: string; metadata: Record<string, unknown> };
type Membership = { state: Specialist["availability"]; participantId: string | null };
const bytes = (text: string) => new TextEncoder().encode(text).length;
const maximum = 12 * 1024;

async function appendNative(lane: Lane, context: string, records: SpecialistRecord[]) {
  return withOwnedChannelClient(lane, context, async session => {
    const ids: string[] = [];
    for (const record of records) ids.push(await session.send(JSON.stringify(record),{idempotencyKey:crypto.randomUUID()}));
    return ids;
  });
}
export async function readSpecialistNative(lane: Lane, client = rpc): Promise<SpecialistSnapshot> {
  const page = await client.call(lane.target,channelClientRpcMethods.getReplayAfter,[{after:0,limit:40}]);
  const through = page.ready.snapshotLastSeq;
  if (through === undefined || page.ready.hasMoreAfter) throw new Error("The owned specialist timeline exceeded its bound");
  const rows = page.logEvents.flatMap((envelope): SpecialistRow[] => {
    const event = envelope.payload as AgenticEvent<"message.completed"> | undefined;
    if (event?.kind !== "message.completed" || !event.causality?.messageId ||
        !("role" in event.payload) || event.payload.role !== "user") return [];
    const text = (event.payload.blocks ?? []).flatMap(block => block.type === "text" ? [block.content] : []).join("");
    if (!envelope.senderId || bytes(text) > 2048) throw new Error("Invalid original specialist evidence row");
    return [{messageId:event.causality.messageId,envelopeId:envelope.messageId,seq:envelope.id,record:JSON.parse(text) as SpecialistRecord}];
  });
  return {channelId:lane.key,through,rows};
}
async function openPassiveSpecialist(lane: Lane, context: string, handle: string, name: string,
    availability: Specialist["availability"]) {
  const source = "workers/local-messaging-fixture";
  const className = "LocalMessagingProbeDO";
  async function create() {
    const entity = await rpc.call("main",mainRpcMethods["runtime.createEntity"],[{
      kind:"do",execution:{surface:"code",source},className,key:`specialist-${crypto.randomUUID()}`,contextId:context,
    }]);
    if (entity.contextId !== context) throw new Error("A specialist probe escaped the owned context");
    return entity;
  }
  const expected = await create();
  if (availability === "absent") return expected.id;
  const member = availability === "conflict" ? await create() : expected;
  const receipt = await rpc.call(member.targetId,localMessagingFixtureMethods.configure,[{
    contextId:context,fixtureId:crypto.randomUUID(),channelId:lane.key,channelTargetId:lane.target,
    channelRef:{source:"workers/pubsub-channel",className:"PubSubChannel",objectKey:lane.key},handle,name,
  }]);
  if (receipt.participantId !== member.id) throw new Error("The passive native roster joined a different participant");
  return expected.id;
}
async function readNativeRoster(lane: Lane, context: string): Promise<RosterRow[]> {
  if (await rpc.call(lane.target,channelClientRpcMethods.getContextId,[]) !== context) throw new Error("Foreign specialist roster");
  return rpc.call(lane.target,channelClientRpcMethods.getParticipants,[]);
}
type Ports = {
  contextId: string | null;
  fs: typeof fs;
  status: typeof vcs.status;
  open: typeof createOwnedHeadlessChannel;
  append: typeof appendNative;
  read: typeof readSpecialistNative;
  member: typeof openPassiveSpecialist;
  roster: typeof readNativeRoster;
  put(text: string): Promise<string>;
  get(digest: string): Promise<string | null>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
function livePorts(): Ports {
  return {contextId,fs,status:input=>vcs.status(input),open:createOwnedHeadlessChannel,append:appendNative,read:readSpecialistNative,
    member:openPassiveSpecialist,roster:readNativeRoster,
    put:async text=>(await rpc.call("main",mainRpcMethods["blobstore.putText"],[text])).digest,
    get:digest=>rpc.call("main",mainRpcMethods["blobstore.getText"],[digest]),
    readBytes:(path,limit)=>readWorkspaceBytes(rpc,path,limit)};
}

function joinOriginal(scope: SpecialistScope, handle: string | null, membership: Membership | null,
    snapshot: SpecialistSnapshot, noChoice: SpecialistPlan["reason"]): ReceiptJoin {
  const empty = { attemptMessage:null,resultMessage:null };
  if (!handle) return {...empty,reason:noChoice};
  if (membership?.state !== "member") return {...empty,reason:"unavailable-specialist"};
  const attempt = snapshot.rows.findLast(row=>row.record.kind === "attempt" && row.record.handle === handle);
  if (!attempt || attempt.record.kind !== "attempt") return {...empty,reason:"awaiting-settlement"};
  const current = attempt.record;
  const result = snapshot.rows.findLast(row=>row.record.kind === "result" &&
    row.record.handle === handle && row.record.attemptId === current.attemptId);
  const ids = {attemptMessage:attempt.messageId,resultMessage:result?.messageId ?? null};
  const exact = (record: Attempt | Result) => record.taskId === scope.taskId && record.contextId === scope.contextId &&
    record.participantId === membership.participantId;
  if (!exact(current) || current.channelId !== scope.channelId) return {...ids,reason:"wrong-scope"};
  if (current.state === "cancelled") return {...ids,reason:"cancelled-attempt"};
  if (current.state === "failed") return {...ids,reason:"failed-attempt"};
  if (current.state === "running") return {...ids,reason:"awaiting-settlement"};
  if (result?.record.kind !== "result") return {...ids,reason:"unlinked-result"};
  const original = result.record;
  if (!exact(original)) return {...ids,reason:"wrong-scope"};
  if ([current,original].some(record=>record.provider !== scope.requiredProvider)) return {...ids,reason:"provider-mismatch"};
  if ([current,original].some(record=>record.parentRevision !== scope.parentRevision)) return {...ids,reason:"revision-drift"};
  if (!original.sourceEvent || original.sourceState !== "committed") return {...ids,reason:"source-uncommitted"};
  return {...ids,reason:"verified"};
}

export async function prepareOpenSpecialistHandoff(input: { contextId: string; caseId: string }, ports = livePorts()) {
  const world = specialistHandoffWorlds.find(row=>row.id === input.caseId);
  if (!world || input.contextId !== ports.contextId) throw new Error("Specialist evidence belongs to the assigned owned context");
  const before = await ports.status();
  const lane = await ports.open(input.contextId,world.title);
  const scope: SpecialistScope = {channelId:lane.key,contextId:input.contextId,taskId:crypto.randomUUID(),concern:world.concern,
    parentRevision:before.mainEventId ?? crypto.randomUUID(),requiredProvider:world.provider ?? "assigned-fixture",mayStage:world.mayStage === true};
  const identities = new Map<string,string>();
  for (const entry of world.candidates) {
    identities.set(entry.handle,await ports.member(lane,input.contextId,entry.handle,entry.specialty,entry.roster ?? "member"));
  }
  function interpretRoster(handle: string, rows: RosterRow[]): Membership {
    const expected = identities.get(handle);
    const candidates = rows.filter(row=>row.metadata["handle"] === handle || row.participantId === expected);
    if (!candidates.length) return {state:"absent",participantId:null};
    const [match] = candidates;
    return candidates.length === 1 && match && match.participantId === expected &&
      match.metadata["handle"] === handle && match.metadata["type"] === "agent"
      ? {state:"member",participantId:match.participantId} : {state:"conflict",participantId:null};
  }
  const issued = new Map<string,string>();
  const runIds = new Map<string,string>();
  const expectedRows = new Map<string,SpecialistRecord>();
  async function materialize(row: SpecialistSeed): Promise<SpecialistRecord> {
    if (!runIds.has(row.run)) runIds.set(row.run,crypto.randomUUID());
    const shared = {handle:row.handle,participantId:(row.wrongParticipant ? "foreign-participant" : identities.get(row.handle))!,
      contextId:row.foreignContext ? "foreign-context" : scope.contextId,taskId:row.foreignTask ? "foreign-task" : scope.taskId,
      attemptId:runIds.get(row.run)!,provider:row.provider ?? scope.requiredProvider,parentRevision:row.stale ? "previous-parent" : scope.parentRevision};
    if (row.kind === "attempt") return {kind:"attempt",...shared,state:row.state,channelId:row.foreignChannel ? "another-channel" : lane.key};
    const digest = row.missingBlob ? sha256HexSyncText(`absent:${scope.taskId}`) : await ports.put(row.proposal);
    if (!row.missingBlob && digest !== sha256HexSyncText(row.proposal)) throw new Error("Native original's stored hash changed");
    return {kind:"result",...shared,digest,sourceEvent:row.unfinished ? null : crypto.randomUUID(),
      sourceState:row.unfinished ? "working" : "committed",owner:row.unit,consumers:row.consumers};
  }
  async function append(seeds: SpecialistSeed[]) {
    const values = await Promise.all(seeds.map(materialize));
    const ids = await ports.append(lane,input.contextId,values);
    if (ids.length !== values.length || new Set(ids).size !== ids.length) throw new Error("Distinct retained specialist IDs are required");
    seeds.forEach((seed,i)=>{
      issued.set(seed.key,ids[i]!);
      expectedRows.set(ids[i]!,values[i]!);
    });
  }
  await append(world.first);
  const initial = await ports.read(lane);
  const initialRoster = await ports.roster(lane,input.contextId);
  const scratch = await ports.fs.mkdtemp("specialist-review");
  const note = `${scratch}/scope.md`;
  await ports.fs.writeFile(note,"The assigned specialist evidence may only inform this local integration review.");
  const beforeFiles = new Set(await listOwnedScratchEntries(ports.fs));
  const stage = bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What original specialist work is verified?"],
    sources:[{id:"scope",path:note}]},ports.readBytes).scratchHandoffWrite;
  let busy = false;
  let writing = false;
  let index: SpecialistIndex | null = null;
  let handoff: IntegrationArtifact | null = null;
  const snapshots: SpecialistSnapshot[] = [];
  const membershipReads: { request: MembershipRequest; observed: Membership }[] = [];
  const artifactReads: { message: string; value: OriginalArtifact | null }[] = [];
  const sourceOf = (snapshot: SpecialistSnapshot, message: string | null) =>
    snapshot.rows.find(row=>row.messageId === message && row.record.kind === "result")?.record as Result | undefined;
  async function cached(result: Result | undefined): Promise<OriginalArtifact | null> {
    if (!result) return null;
    const text = await ports.get(result.digest);
    return typeof text === "string" && !!text.trim() && bytes(text) <= 4096 && sha256HexSyncText(text) === result.digest
      ? {text,digest:result.digest,bytes:bytes(text)} : null;
  }
  function historyShape(review: HistoryReview | null, original: OriginalArtifact, result: Result) {
    return !!review && review.goal === original.text &&
      isDeepStrictEqual(review.units,{owner:result.owner,consumers:result.consumers,blockers:[]}) &&
      typeof review.result?.persistedContract === "boolean" && Array.isArray(review.result.retainedHistoryChecks) &&
      review.result.retainedHistoryChecks.length <= 6 &&
      review.result.retainedHistoryChecks.every(check=>typeof check === "string" && check.trim() && bytes(check) <= 300) &&
      review.result.persistedContract === (review.result.retainedHistoryChecks.length > 0);
  }
  function artifactText(plan: SpecialistPlan, history: HistoryReview) {
    return JSON.stringify({schema:"vibestudio.specialist-handoff/1",contextId:scope.contextId,channel:plan.channelId,task:plan.taskId,
      parent:scope.parentRevision,sourceEvent:plan.sourceEvent,attempt:plan.attemptMessage,result:plan.resultMessage,
      specialist:plan.handle,frontier:plan.through,original:plan.artifact,history});
  }
  async function complete(snapshot: SpecialistSnapshot, handle: string | null, membership: Membership | null) {
    const join = joinOriginal(scope,handle,membership,snapshot,world.expected.reason);
    const result = sourceOf(snapshot,join.resultMessage);
    const original = join.reason === "verified" ? await cached(result) : null;
    const reason = join.reason === "verified" && !original ? "readback-unavailable" : join.reason;
    const plan: Omit<SpecialistPlan,"explanation"> = {...join,reason,handle,through:snapshot.through,channelId:lane.key,taskId:scope.taskId,
      sourceEvent:original ? result?.sourceEvent ?? null : null,artifact:original,
      action:original ? scope.mayStage ? "stage" : "report" : "hold"};
    return {plan,result};
  }
  const services = {
    ownedSpecialistIndex: {
      async list(): Promise<SpecialistIndex> {
        if (index) throw new Error("Read the owned specialist roster once");
        const roster = await ports.roster(lane,input.contextId);
        index = {scope,agents:world.candidates.map(entry=>{
          const {state,participantId} = interpretRoster(entry.handle,roster);
          return {handle:entry.handle,specialty:entry.specialty,provider:entry.provider ?? scope.requiredProvider,availability:state,participantId};
        })};
        return structuredClone(index);
      },
    },
    channelAgentRead: {
      async read(request: MembershipRequest) {
        if (!index || membershipReads.length || request?.goal !== world.goal || request.channelId !== lane.key ||
            request.contextId !== scope.contextId || request.action !== "inspect" || request.options !== null ||
            !identities.has(request.handle)) throw new Error("Only one exact owned inspect request is permitted");
        const observed = interpretRoster(request.handle,await ports.roster(lane,input.contextId));
        membershipReads.push({request:structuredClone(request),observed});
        return structuredClone(observed);
      },
    },
    ownedSpecialistRun: {
      async read(channelId: string) {
        if (!index || busy || channelId !== lane.key || snapshots.length >= 2) return null;
        busy = true;
        try {
          const observed = await ports.read(lane);
          if (observed.channelId !== lane.key) throw new Error("Specialist receipt crossed the owned channel");
          snapshots.push(observed);
          if (snapshots.length === 1 && world.later?.length) await append(world.later);
          return structuredClone(observed);
        } finally { busy = false; }
      },
    },
    ownedSpecialistArtifact: {
      async read(channelId: string, message: string) {
        const current = snapshots[1];
        const member = membershipReads[0];
        if (!current || !member || channelId !== lane.key || artifactReads.length) return null;
        const join = joinOriginal(scope,member.request.handle,member.observed,current,"no-suitable-specialist");
        if (join.reason !== "verified" || join.resultMessage !== message || (await ports.read(lane)).through !== current.through) return null;
        const value = await cached(sourceOf(current,message));
        artifactReads.push({message,value});
        return structuredClone(value);
      },
    },
    ownedSpecialistHandoff: {
      async stage(plan: SpecialistPlan, history: HistoryReview) {
        if (!scope.mayStage || writing || handoff || !plan || plan.action !== "stage" || plan.channelId !== lane.key ||
            plan.taskId !== scope.taskId || snapshots.length !== 2 || !membershipReads[0]) return null;
        writing = true;
        try {
          const latest = await ports.read(lane);
          const member = membershipReads[0];
          const {plan:verified,result} = await complete(latest,member.request.handle,interpretRoster(member.request.handle,await ports.roster(lane,input.contextId)));
          const {explanation,...facts} = plan;
          if (!explanation?.trim() || !isDeepStrictEqual(facts,verified) || !verified.artifact || !result ||
              !historyShape(history,verified.artifact,result) || artifactReads.length !== 1 ||
              !isDeepStrictEqual(artifactReads[0]!.value,verified.artifact) || (await ports.read(lane)).through !== plan.through) return null;
          const content = artifactText(plan,history);
          const current = await ports.status();
          if (bytes(content) > maximum || current.mainEventId !== before.mainEventId ||
              !isDeepStrictEqual(current.workingHead,before.workingHead)) return null;
          const resultReceipt = await stage.stage(content);
          if (!resultReceipt) return null;
          handoff = {...resultReceipt,sha256:sha256HexSyncText(content)};
          return structuredClone(handoff);
        } finally { writing = false; }
      },
    },
  };
  async function verify(raw: unknown) {
    const report = raw as {status?:string;skill?:string;outcome?:SpecialistGoalReport} | null;
    const outcome = report?.status === "workspace-skill-reviewed" && report.skill === "specialistHandoff" ? report.outcome : null;
    const latest = await ports.read(lane);
    const roster = await ports.roster(lane,input.contextId);
    const expected = world.expected;
    const selected = expected.handle ? interpretRoster(expected.handle,roster) : null;
    const {plan:independent,result} = await complete(latest,expected.handle,selected);
    const membership = selected ? { ...selected,status:selected.state === "conflict" ? "held" : "observed" } : null;
    const plan = outcome?.plan;
    const member = membershipReads[0];
    const after = await ports.status();
    const files = (await listOwnedScratchEntries(ports.fs)).filter(name=>name.startsWith("evidence-handoff-") && !beforeFiles.has(name));
    const written = handoff ? await ports.readBytes(handoff.path,maximum) : null;
    const artifact = written ? new TextDecoder("utf-8",{fatal:true}).decode(written) : null;
    const foreign = crypto.randomUUID();
    const checks = {
      exactCurrentSpecialist: !!index && !!plan && plan.handle === expected.handle &&
        (expected.handle ? membershipReads.length === 1 && member?.request.handle === expected.handle &&
          isDeepStrictEqual(member.observed,selected) &&
          isDeepStrictEqual(outcome?.membership,{request:member.request,report:membership}) :
          membershipReads.length === 0 && outcome?.membership === null),
      exactSpecialistFrontiers: snapshots.length === 2 && isDeepStrictEqual(snapshots[0],initial) &&
        isDeepStrictEqual(snapshots[1],latest) && latest.rows.length === expectedRows.size &&
        latest.rows.every(row=>isDeepStrictEqual(row.record,expectedRows.get(row.messageId))) &&
        new Set(latest.rows.map(row=>row.envelopeId)).size === latest.rows.length,
      exactOriginalAttempt: !!plan && isDeepStrictEqual((({explanation,...facts})=>facts)(plan),independent) &&
        independent.reason === expected.reason && independent.action === expected.action &&
        independent.attemptMessage === (expected.attempt ? issued.get(expected.attempt) : null) &&
        independent.resultMessage === (expected.result ? issued.get(expected.result) : null) &&
        typeof plan.explanation === "string" && bytes(plan.explanation) <= 600 && expected.claims.every(check=>check.test(plan.explanation)),
      verifiedArtifactAndImpact: independent.artifact ? !!result && !!outcome && historyShape(outcome.history,independent.artifact,result) &&
        outcome.history?.result.persistedContract === expected.history && artifactReads.length === 1 &&
        artifactReads[0]!.message === independent.resultMessage && isDeepStrictEqual(artifactReads[0]!.value,independent.artifact) :
        outcome?.history === null && (independent.reason === "readback-unavailable" ?
          artifactReads.length === 1 && artifactReads[0]!.message === independent.resultMessage && artifactReads[0]!.value === null :
          artifactReads.length === 0),
      exactSpecialistHandoff: expected.action === "stage" ? !!plan && !!outcome?.history && !!handoff && !!artifact && !!written &&
        files.length === 1 && handoff.path === `/.tmp/${files[0]}/handoff.json` &&
        artifactText(plan,outcome.history) === artifact && handoff.sha256 === sha256HexSyncText(artifact) &&
        handoff.bytes === written.length && isDeepStrictEqual(handoff,outcome.handoff) :
        files.length === 0 && handoff === null && outcome?.handoff === null,
      preservedSpecialistContext: after.mainEventId === before.mainEventId && isDeepStrictEqual(after.workingHead,before.workingHead) &&
        isDeepStrictEqual(initialRoster.filter(row=>row.metadata["type"] === "agent"),roster.filter(row=>row.metadata["type"] === "agent")),
      rejectedForeignSpecialist: await services.ownedSpecialistRun.read(foreign) === null &&
        await services.ownedSpecialistArtifact.read(foreign,foreign) === null &&
        await services.ownedSpecialistHandoff.stage({channelId:foreign} as SpecialistPlan,{} as HistoryReview) === null,
    };
    return {contextId:input.contextId,caseId:input.caseId,goal:world.goal,passed:Object.values(checks).every(Boolean),checks,
      index,snapshots,independent,result,membershipReads,artifactReads,handoff,artifact};
  }
  async function qualify() {
    await services.ownedSpecialistIndex.list();
    const handle = world.expected.handle;
    const membership = handle ? await services.channelAgentRead.read({goal:world.goal,channelId:lane.key,
      contextId:scope.contextId,handle,action:"inspect",options:null}) : null;
    await services.ownedSpecialistRun.read(lane.key);
    const current = await services.ownedSpecialistRun.read(lane.key);
    if (!current) throw new Error("Reference could not read the owned specialist timeline");
    const {plan:verified,result} = await complete(current,handle,membership);
    if (verified.reason === "readback-unavailable" || verified.reason === "verified")
      await services.ownedSpecialistArtifact.read(lane.key,verified.resultMessage!);
    const plan: SpecialistPlan = {...verified,explanation:world.expected.statement};
    const history: HistoryReview | null = verified.artifact && result ? {
      goal:verified.artifact.text,units:{owner:result.owner,consumers:result.consumers,blockers:[]},
      result:{persistedContract:world.expected.history === true,
        retainedHistoryChecks:world.expected.history ? ["Verify representative stored history against the proposed contract."] : []},
    } : null;
    const receipt = verified.action === "stage" && history ? await services.ownedSpecialistHandoff.stage(plan,history) : null;
    const memberRead = membershipReads[0];
    const membershipWitness = membership && memberRead ? {request:memberRead.request,
      report:{...membership,status:membership.state === "conflict" ? "held" : "observed"}} : null;
    const report = {status:"workspace-skill-reviewed",skill:"specialistHandoff",
      outcome:{plan,membership:membershipWitness,history,handoff:receipt}};
    const accepted = await verify(report);
    const forged = await verify({...report,outcome:{...report.outcome,plan:{...plan,taskId:"other-task"}}});
    return {...accepted,passed:accepted.passed && !forged.passed};
  }
  return {goal:world.goal,services,verify,qualify};
}
