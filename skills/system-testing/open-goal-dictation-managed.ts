import { listOwnedScratchEntries } from "./owned-scratch-entries.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { Acknowledgment, CaptureReceipt, DictationArtifact, DictationGoalReport, DictationPlan, DictationReason,
  DictationRecord, DictationRow, DictationSnapshot, DictationThread, DraftReceipt, DraftReview,
  RetainedTranscript, SegmentReceipt } from "@workspace-skills/open-dictation-handoff/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { dictationHandoffWorlds, type DictationSeed } from "./open-goal-dictation-worlds.js";

type Lane = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
const encoder = new TextEncoder();
const limit = 12 * 1024;

async function appendNative(lane: Lane, context: string, records: DictationRecord[]) {
  return withOwnedChannelClient(lane, context, async session => {
    const ids: string[] = [];
    for (const record of records) ids.push(await session.send(JSON.stringify(record), { idempotencyKey: crypto.randomUUID() }));
    return ids;
  });
}
export async function readDictationNative(lane: Lane, client = rpc): Promise<DictationSnapshot> {
  const page = await client.call(lane.target, channelClientRpcMethods.getReplayAfter, [{after:0,limit:40}]);
  const through = page.ready.snapshotLastSeq;
  if (through === undefined || page.ready.hasMoreAfter) throw new Error("Dictation replay exceeded its bound");
  const rows = page.logEvents.flatMap((envelope): DictationRow[] => {
    const event = envelope.payload as AgenticEvent<"message.completed"> | undefined;
    if (event?.kind !== "message.completed" || !event.causality?.messageId ||
        !("role" in event.payload) || event.payload.role !== "user") return [];
    const text = (event.payload.blocks ?? []).flatMap(block => block.type === "text" ? [block.content] : []).join("");
    if (!envelope.senderId || encoder.encode(text).length > 2048) throw new Error("Invalid retained dictation row");
    return [{messageId: event.causality.messageId, envelopeId: envelope.messageId, seq: envelope.id,
      senderId: envelope.senderId, record: JSON.parse(text) as DictationRecord}];
  });
  return {threadId:lane.key,through,rows};
}

type Ports = {
  contextId: string | null;
  fs: typeof fs;
  status: typeof vcs.status;
  open: typeof createOwnedHeadlessChannel;
  append: typeof appendNative;
  read: typeof readDictationNative;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
function livePorts(): Ports {
  return {
    contextId,fs,status: input => vcs.status(input),open:createOwnedHeadlessChannel,append:appendNative,read:readDictationNative,
    readBytes: (path, maximum) => readWorkspaceBytes(rpc,path,maximum),
  };
}
type RowFor<R extends DictationRecord> = DictationRow & {record:R};
function recordsOf<R extends DictationRecord>(snapshot: DictationSnapshot, kind: R["kind"]): RowFor<R>[] {
  return snapshot.rows.filter((row): row is RowFor<R> => row.record.kind === kind);
}

function independentlyInspect(thread: DictationThread, snapshot: DictationSnapshot) {
  const captureRow = recordsOf<CaptureReceipt>(snapshot,"capture").at(-1);
  const draft = recordsOf<DraftReceipt>(snapshot,"draft").findLast(row => row.record.draftId === thread.draftId);
  if (!captureRow || !draft) throw new Error("Assigned dictation history is incomplete");
  const capture = captureRow.record;
  const ack = recordsOf<Acknowledgment>(snapshot,"acknowledgment").findLast(row => row.record.captureId === capture.captureId);
  const core = {captureId:capture.captureId,draftRevision:draft.record.revision,acknowledgementMessage:ack?.messageId ?? null};
  const state = (reason: DictationReason, transcript: RetainedTranscript | null = null, segmentMessages: string[] = []) =>
    ({...core,reason,transcript,segmentMessages});
  if (capture.owner !== thread.owner || capture.draftId !== thread.draftId || (ack && ack.record.draftId !== thread.draftId))
    return state("wrong-scope");
  if (capture.state === "abandoned") return state("capture-abandoned");
  if (capture.device !== thread.device) return state("wrong-device");
  if (capture.language !== thread.language) return state("language-conflict");
  if (!ack || ack.record.state !== "confirmed") return state("unconfirmed");
  const finals = recordsOf<SegmentReceipt>(snapshot,"segment").filter(row =>
    row.record.captureId === capture.captureId && row.record.state === "final");
  const selected: RowFor<SegmentReceipt>[] = [];
  for (let ordinal = 1; ordinal <= ack.record.throughOrdinal; ordinal++) {
    const rows = finals.filter(row => row.record.ordinal === ordinal);
    const [first] = rows;
    if (!first) return state("missing-continuation");
    if (rows.some(row => row.record.device !== thread.device)) return state("wrong-device");
    if (rows.some(row => row.record.language !== thread.language)) return state("language-conflict");
    if (rows.some(row => !isDeepStrictEqual(row.record,first.record))) return state("segment-conflict");
    selected.push(first);
  }
  const partial = capture.state === "interrupted" || recordsOf<SegmentReceipt>(snapshot,"segment").some(row =>
    row.record.captureId === capture.captureId && row.record.ordinal > ack.record.throughOrdinal);
  if (partial && !thread.usePrefix) return state("missing-continuation");
  const text = selected.map(row => row.record.text).join(" ");
  const transcript: RetainedTranscript = {text,language:capture.language,model:"whistle"};
  return state(!text.trim() ? "silence" : partial ? "verified-prefix" : "verified",transcript,selected.map(row => row.messageId));
}
function expectedReview(transcript: RetainedTranscript | null): DraftReview | null {
  if (!transcript) return null;
  return transcript.text.trim() ? {status:"draft",text:transcript.text} : {status:"silence",text:null};
}
function exactDisposition(thread: DictationThread, snapshot: DictationSnapshot) {
  const selection = independentlyInspect(thread,snapshot);
  const draft = recordsOf<DraftReceipt>(snapshot,"draft").findLast(row => row.record.draftId === thread.draftId)!;
  let reason = selection.reason;
  let action: DictationPlan["action"] = "hold";
  if (reason === "verified" || reason === "verified-prefix") {
    if (thread.localAction === "none") action = "report";
    else if (draft.record.state === "closed") reason = "draft-closed";
    else if (thread.localAction === "alternative") action = "stage-alternative";
    else if (draft.record.revision !== thread.baseline) reason = "revision-conflict";
    else action = "stage-correction";
  }
  return {...selection,reason,action,threadId:thread.threadId,draftId:thread.draftId,through:snapshot.through};
}

export async function prepareOpenDictationHandoff(input: { contextId: string; caseId: string }, ports = livePorts()) {
  const world = dictationHandoffWorlds.find(item => item.id === input.caseId);
  if (!world || input.contextId !== ports.contextId) throw new Error("Dictation handoff belongs to its assigned context");
  const before = await ports.status();
  const main = await ports.open(input.contextId,world.title);
  const thread: DictationThread = {
    threadId:main.key,title:world.title,owner:crypto.randomUUID(),draftId:crypto.randomUUID(),baseline:"r1",
    device:world.device,language:world.language ?? "en",usePrefix:world.usePrefix === true,localAction:world.localAction ?? "none",
  };
  const lanes = new Map([[thread.threadId,{lane:main,thread}]]);
  if (world.archive) {
    const archivedLane = await ports.open(input.contextId,world.archive);
    const archived = {...thread,threadId:archivedLane.key,title:world.archive,owner:crypto.randomUUID(),draftId:crypto.randomUUID()};
    lanes.set(archived.threadId,{lane:archivedLane,thread:archived});
    await ports.append(archivedLane,input.contextId,[{kind:"draft",draftId:archived.draftId,revision:"r1",state:"closed",text:"Archived rehearsal."}]);
  }
  const captureIds = new Map<string,string>();
  const messageIds = new Map<string,string>();
  const seeded = new Map<string,DictationRecord>();
  function idFor(ref: string) {
    if (!captureIds.has(ref)) captureIds.set(ref,crypto.randomUUID());
    return captureIds.get(ref)!;
  }
  function materialize(row: DictationSeed): DictationRecord {
    if (row.kind === "draft") return {kind:row.kind,draftId:thread.draftId,revision:row.revision,
      state:row.closed ? "closed" : "editable",text:row.text};
    if (row.kind === "acknowledgment") return {kind:row.kind,captureId:idFor(row.ref),
      draftId:row.differentDraft ? "other-draft" : thread.draftId,throughOrdinal:row.count,state:row.interrupted ? "interrupted" : "confirmed"};
    const common = {captureId:idFor(row.ref),device:row.device ?? thread.device,language:row.language ?? thread.language};
    return row.kind === "capture" ? {kind:row.kind,...common,owner:row.differentOwner ? "other-owner" : thread.owner,
      draftId:row.differentDraft ? "other-draft" : thread.draftId,state:row.state ?? "finished"} :
      {kind:row.kind,...common,ordinal:row.ordinal,segmentId:row.stableId ?? row.key,text:row.text,state:row.preview ? "preview" : "final"};
  }
  async function append(seeds: DictationSeed[]) {
    const records = seeds.map(materialize);
    const ids = await ports.append(main,input.contextId,records);
    if (ids.length !== records.length || new Set(ids).size !== ids.length) throw new Error("Retained dictation messages must be unique");
    seeds.forEach((row,index) => {
      const messageId = ids[index]!;
      seeded.set(messageId, records[index]!);
      if ("key" in row) messageIds.set(row.key,messageId);
    });
  }
  await append(world.initial);
  const first = await ports.read(main);
  const noteDir = await ports.fs.mkdtemp("dictation-review");
  const notePath = `${noteDir}/scope.md`;
  await ports.fs.writeFile(notePath,"Only the named owned draft and any expressly authorized local alternative are in scope.");
  const initialScratch = new Set(await listOwnedScratchEntries(ports.fs));
  const writer = bindScratchHandoff(ports.fs,{goal:world.goal,questions:["What retained wording is verified?"],
    sources:[{id:"scope",path:notePath}]},ports.readBytes).scratchHandoffWrite;
  let listed: DictationThread[] | null = null;
  let reading = false;
  let writing = false;
  let primaryReads = 0;
  let handoff: DictationArtifact | null = null;
  const seen: DictationSnapshot[] = [];
  function body(plan: DictationPlan, review: DraftReview) {
    return JSON.stringify({schema:"vibestudio.retained-dictation-handoff/1",contextId:input.contextId,
      thread:plan.threadId,draft:plan.draftId,revision:plan.draftRevision,capture:plan.captureId,frontier:plan.through,
      ack:plan.acknowledgementMessage,segments:plan.segmentMessages,action:plan.action,language:plan.transcript?.language,text:review.text});
  }
  function samePlan(plan: DictationPlan, current: DictationSnapshot) {
    const {explanation,...facts} = plan;
    return typeof explanation === "string" && encoder.encode(explanation).length <= 520 &&
      isDeepStrictEqual(facts,exactDisposition(thread,current));
  }
  const services = {
    retainedDictationIndex: {
      async list() {
        if (listed) throw new Error("Read the owned dictation index once");
        listed = [...lanes.values()].map(entry => structuredClone(entry.thread));
        return structuredClone(listed);
      },
    },
    retainedDictationState: {
      async read(threadId: string) {
        const known = lanes.get(threadId);
        if (!listed || !known || reading || seen.length >= 4) return null;
        reading = true;
        try {
          const snapshot = await ports.read(known.lane);
          if (snapshot.threadId !== threadId) throw new Error("Read crossed the owned dictation thread");
          seen.push(snapshot);
          if (threadId === thread.threadId && ++primaryReads === 1 && world.later?.length) await append(world.later);
          return structuredClone(snapshot);
        } finally { reading = false; }
      },
    },
    retainedDictationHandoff: {
      async stage(plan: DictationPlan, review: DraftReview) {
        if (!plan || thread.localAction === "none" || plan.threadId !== thread.threadId ||
            plan.draftId !== thread.draftId || primaryReads !== 2 || handoff || writing ||
            (plan.action !== "stage-correction" && plan.action !== "stage-alternative")) return null;
        writing = true;
        try {
          const latest = await ports.read(main);
          if (!samePlan(plan,latest) || !isDeepStrictEqual(review,expectedReview(plan.transcript)) ||
              (await ports.read(main)).through !== plan.through) return null;
          const text = body(plan,review);
          if (encoder.encode(text).length > limit) return null;
          const receipt = await writer.stage(text);
          if (!receipt) return null;
          handoff = {...receipt,sha256:sha256HexSyncText(text)};
          return structuredClone(handoff);
        } finally { writing = false; }
      },
    },
  };
  async function verify(raw: unknown) {
    const report = raw as {status?:string;skill?:string;outcome?:DictationGoalReport} | null;
    const outcome = report?.status === "workspace-skill-reviewed" && report.skill === "dictationHandoff" ? report.outcome : null;
    const plan = outcome?.plan;
    const latest = await ports.read(main);
    const snapshots = seen.filter(item => item.threadId === thread.threadId);
    const expected = world.expected;
    const independent = exactDisposition(thread,latest);
    const exactDraft = expectedReview(independent.transcript);
    const after = await ports.status();
    const scratch = (await listOwnedScratchEntries(ports.fs)).filter(name => name.startsWith("evidence-handoff-") && !initialScratch.has(name));
    const bytes = handoff ? await ports.readBytes(handoff.path,limit) : null;
    const artifact = bytes ? new TextDecoder("utf-8",{fatal:true}).decode(bytes) : null;
    const local = expected.action === "stage-correction" || expected.action === "stage-alternative";
    const foreign = crypto.randomUUID();
    const checks = {
      exactOwnedDictation: listed !== null && plan?.threadId === thread.threadId && plan.draftId === thread.draftId,
      verifiedDictationFrontiers: snapshots.length === 2 && isDeepStrictEqual(snapshots[0],first) && isDeepStrictEqual(snapshots[1],latest) &&
        latest.rows.length === seeded.size && latest.rows.every(row => isDeepStrictEqual(row.record,seeded.get(row.messageId))) &&
        new Set(latest.rows.map(row => row.envelopeId)).size === latest.rows.length,
      exactDictationSelection: !!plan && samePlan(plan,latest) && plan.reason === expected.reason && plan.action === expected.action &&
        plan.captureId === captureIds.get(expected.capture) && isDeepStrictEqual(plan.segmentMessages,expected.selected.map(key => messageIds.get(key))) &&
        plan.acknowledgementMessage === (expected.acknowledgement ? messageIds.get(expected.acknowledgement) : null) &&
        plan.draftRevision === expected.revision && (plan.transcript?.text ?? null) === expected.text && expected.claim.test(plan.explanation),
      exactInstalledDraft: exactDraft ? outcome?.review?.goal === world.goal && outcome.review.presentation === "verbatim" &&
        isDeepStrictEqual(outcome.review.transcript,independent.transcript) && isDeepStrictEqual(outcome.review.result,exactDraft) : outcome?.review === null,
      verifiedLocalCorrection: local ? !!plan && !!exactDraft && !!artifact && !!handoff && !!bytes &&
        scratch.length === 1 && handoff.path === `/.tmp/${scratch[0]}/handoff.json` &&
        artifact === body(plan,exactDraft) && sha256HexSyncText(artifact) === handoff.sha256 &&
        handoff.bytes === bytes.length && isDeepStrictEqual(handoff,outcome?.handoff) :
        handoff === null && outcome?.handoff === null && scratch.length === 0,
      preservedDraftAndMain: before.mainEventId === after.mainEventId && isDeepStrictEqual(before.workingHead,after.workingHead),
      rejectedForeignDictation: await services.retainedDictationState.read(foreign) === null &&
        await services.retainedDictationHandoff.stage({threadId:foreign} as DictationPlan,{status:"silence",text:null}) === null,
    };
    return {passed:Object.values(checks).every(Boolean),contextId:input.contextId,caseId:world.id,goal:world.goal,checks,
      thread,listed,snapshots,independent,exactDraft,handoff,artifact};
  }
  async function qualify() {
    await services.retainedDictationIndex.list();
    await services.retainedDictationState.read(thread.threadId);
    const current = await services.retainedDictationState.read(thread.threadId);
    if (!current) throw new Error("Owned dictation reference could not be read");
    const plan = {...exactDisposition(thread,current),explanation:world.expected.statement};
    const draft = expectedReview(plan.transcript);
    const review = draft && plan.transcript ? {goal:world.goal,transcript:plan.transcript,presentation:"verbatim",result:draft} : null;
    const receipt = draft && (plan.action === "stage-correction" || plan.action === "stage-alternative")
      ? await services.retainedDictationHandoff.stage(plan,draft) : null;
    const report = {status:"workspace-skill-reviewed",skill:"dictationHandoff",outcome:{plan,review,handoff:receipt}};
    const positive = await verify(report);
    const altered = await verify({...report,outcome:{...report.outcome,plan:{...plan,through:-1}}});
    return {...positive,passed:positive.passed && !altered.passed};
  }
  return {goal:world.goal,services,verify,qualify};
}
