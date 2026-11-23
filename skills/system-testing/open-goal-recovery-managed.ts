import {recoveryHandoffMatches} from "./retained-task-content.js";
import {assessObservedApplicationOutcome,type ApplicationReturnContribution} from "./observed-application-outcome.js";
import type { InvocationObservations } from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { contextId as actualContextId, fs, rpc } from "@workspace/runtime";
import { bindTranscriptCursor } from "@workspace-skills/session-cursor-bindings";
import { AGENTIC_EVENT_PAYLOAD_KIND, type AgenticEvent } from "@workspace/agentic-protocol";
import type {
  Disposition, RecoveryArtifact, RecoveryCursor, RecoveryFinding,
  RecoveryNote, RecoveryReport, RecoverySource, RecoveryWindow,
} from "@workspace-skills/open-session-recovery/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";

type Lane = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
type Seed = {
  key: string;
  title: string;
  description: string;
  messages: readonly string[];
  saved?: { channel?: string; at: "start" | "head" | "future" | number };
  replay?: { pageSize: number; maxPages: number };
  late?: string;
};
export type OpenRecoveryWorld = {
  id: string;
  goal: string;
  sessions: readonly Seed[];
  canStage: boolean;
  expected: {
    reads: readonly { key: string; status: RecoveryWindow["status"] }[];
    disposition: Disposition;
    citations: readonly { key: string; note: number }[];
    stage: boolean;
    reason?: readonly string[];
  };
};
type Session = {
  lane: Lane;
  seed: Seed;
  source: RecoverySource;
  baseline: { frontier: number; notes: RecoveryNote[] };
  saved: RecoveryCursor;
  lateId?: string;
};

function readNative(lane: Lane, after = 0, throughSeq?: number) {
  return rpc.call(lane.target, channelClientRpcMethods.getReplayAfter, [{
    after, limit: 100, ...(throughSeq !== undefined ? { throughSeq } : {}),
  }]);
}

async function nativeTranscript(lane: Lane, contextId: string, after = 0, throughSeq?: number) {
  const { mode, ready, logEvents } = await readNative(lane, after, throughSeq);
  if (mode !== "after" || ready.contextId !== contextId || ready.hasMoreAfter ||
      ready.snapshotLastSeq === undefined)
    throw new Error("The retained conversation is outside the complete verification window");
  const notes = logEvents.flatMap((entry): RecoveryNote[] => {
    if (entry.type !== AGENTIC_EVENT_PAYLOAD_KIND) return [];
    const event = entry.payload as AgenticEvent<"message.completed"> | undefined;
    if (event?.kind !== "message.completed" || !("role" in event.payload) || event.payload.role !== "user") return [];
    const messageId = event.causality?.messageId;
    if (!messageId) throw new Error("A retained note has no durable message identity");
    return [{ channelId: lane.key, messageId, seq: entry.id,
      text: (event.payload.blocks ?? []).flatMap((block) => block.type === "text" ? [block.content] : []).join("") }];
  });
  return { frontier: ready.snapshotLastSeq, notes };
}

async function sendOwnedNotes(lane: Lane, contextId: string, notes: readonly string[]) {
  return withOwnedChannelClient(lane, contextId, async (client) => {
    const receipts: { id: string; text: string }[] = [];
    for (const text of notes) {
      const id = await client.send(text, { idempotencyKey: crypto.randomUUID() });
      receipts.push({ id, text });
    }
    return receipts;
  });
}

function formatHandoff(review: RecoveryFinding) {
  return JSON.stringify({ schema: "vibestudio.session-recovery-handoff/1", review }, null, 2) + "\n";
}

export async function prepareOpenRecoveryGoal({ contextId, caseId }: { contextId: string; caseId: string }, world: OpenRecoveryWorld) {
  if (actualContextId !== contextId || caseId !== world.id) throw new Error("Recovery needs its owned workspace context");
  const sessions = new Map<string, Session>();
  for (const seed of world.sessions) {
    if (seed.messages.some((text) => text.length > 240))
      throw new Error("Recovery notes must fit the bounded transcript preview");
    const lane = await createOwnedHeadlessChannel(contextId, seed.title);
    const accepted = await sendOwnedNotes(lane, contextId, seed.messages);
    const baseline = await nativeTranscript(lane, contextId);
    if (!isDeepStrictEqual(baseline.notes.map(({ messageId: id, text }) => ({ id, text })), accepted))
      throw new Error("The previous session did not retain the acknowledged notes");
    const source = { id: lane.key, title: seed.title, description: seed.description };
    sessions.set(seed.key, { lane, baseline, source, seed, saved: { channelId: lane.key, seq: 0 } });
  }
  function session(key: string) {
    const found = sessions.get(key);
    if (!found) throw new Error("The conversation is outside this recovery scope");
    return found;
  }
  for (const current of sessions.values()) {
    const pointer = current.seed.saved;
    if (!pointer) continue;
    const origin = pointer.channel ? session(pointer.channel) : current;
    const at = pointer.at;
    const seq = at === "start" ? 0 : at === "head" ? origin.baseline.frontier
      : at === "future" ? origin.baseline.frontier + 1_000
        : origin.baseline.notes[at]?.seq;
    if (seq === undefined) throw new Error("The saved recovery coordinate has no retained note");
    current.saved = { channelId: origin.lane.key, seq };
  }
  const catalog = [...sessions.values()].map(({ source }) => source);
  const observed = new Map<string, RecoveryWindow>();
  const running = new Set<string>();
  let artifact: RecoveryArtifact | null = null;
  let handoffText: string | null = null;
  let stagedReview: RecoveryFinding | null = null;
  const services = {
    recoverySessions: {
      async discover() {
        return structuredClone(catalog);
      },
    },
    recoveryReplay: {
      async resume(id: string): Promise<RecoveryWindow> {
        const found = [...sessions.values()].find(({ source }) => source.id === id);
        if (!found || running.size || artifact)
          throw new Error("Resume an authorized retained conversation once before staging a handoff");
        if (observed.has(id)) return structuredClone(observed.get(id)!);
        running.add(id);
        try {
          const bound = bindTranscriptCursor({
            goal: world.goal, channelId: id, targetId: found.lane.target, saved: found.saved,
            pageSize: found.seed.replay?.pageSize ?? 16, maxPages: found.seed.replay?.maxPages ?? 6,
          });
          const operation = bound.request.operationId;
          const cursor = bound.services.transcriptCursor;
          const start = await cursor.open(operation);
          const window: RecoveryWindow = {
            source: found.source, saved: found.saved, status: "foreign", frontier: null, next: null, notes: [],
          };
          let page = start.first;
          if (page) {
            const frontier = page.through;
            window.frontier = frontier;
            if (found.seed.late && !found.lateId) {
              const [late] = await sendOwnedNotes(found.lane, contextId, [found.seed.late]);
              found.lateId = late!.id;
            }
            if (found.saved.seq > frontier) window.status = "future";
            else {
              let count = 0;
              for (;;) {
                window.notes.push(...page.messages.map(({ messageId, seq, preview }) =>
                  ({ channelId: id, messageId, seq, text: preview })));
                if (!page.hasMore || ++count >= start.maxPages) break;
                page = await cursor.next(operation, page.nextAfter, frontier);
              }
              window.next = { channelId: id, seq: page.nextAfter };
              window.status = page.hasMore ? "partial"
                : page.nextAfter === found.saved.seq ? "caught-up" : "complete";
            }
          }
          observed.set(id, window);
          return structuredClone(window);
        } finally {
          running.delete(id);
        }
      },
    },
    recoveryHandoff: {
      async stage(review: RecoveryFinding): Promise<RecoveryArtifact> {
        if (!world.canStage || artifact || running.size ||
            !["continue", "hold"].includes(review?.disposition) ||
            typeof review.reason !== "string" || !review.reason.trim() || review.reason.length > 2_000 ||
            !Array.isArray(review.citations) || review.citations.length === 0 ||
            new Set(review.citations.map(({ messageId }) => messageId)).size !== review.citations.length)
          throw new Error("Stage one authorized handoff backed by distinct complete replay notes");
        for (const citation of review.citations) {
          const read = observed.get(citation.channelId);
          if (read?.status !== "complete" || !read.notes.some((note) => isDeepStrictEqual(note, citation)))
            throw new Error("Use only exact retained notes from the complete replay");
        }
        running.add("staging");
        try {
          const directory = await fs.mkdtemp("session-recovery");
          const path = `${directory}/recovery-handoff.json`;
          const text = formatHandoff(review);
          await fs.writeFile(path, text);
          if (await fs.readFile(path, "utf8") !== text) throw new Error("Handoff readback differs from the recovery evidence");
          stagedReview = structuredClone(review);
          handoffText = text;
          artifact = { path, sha256: sha256HexSyncText(text), citationIds: review.citations.map(({ messageId }) => messageId) };
          return structuredClone(artifact);
        } finally {
          running.delete("staging");
        }
      },
    },
  };

  function expectedCitations() {
    return world.expected.citations.map(({ key, note }) => {
      const value = session(key).baseline.notes[note];
      if (!value) throw new Error("Expected note is outside the retained baseline");
      return value;
    });
  }

  
  async function verify(value: unknown,invocation?: InvocationObservations) {
    const proof=await verifyNativeApplication(value,invocation);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["groundedRecoveryDecision"],"rootPath":["review"],"producerSourceSuffix":"recoverSessionGoal/interpretRecovery.nl","producerPath":[]}];
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
    const envelope = value as RecoveryReport | null;
    const report = envelope;
    const citations = expectedCitations();
    const replays = await Promise.all([...observed.values()].map(async (window) => {
      const lane = [...sessions.values()].find((entry) => entry.source.id === window.source.id)!.lane;
      if (window.status === "foreign" || window.status === "future")
        return window.notes.length === 0 && window.next === null &&
          (window.status === "foreign" ? window.saved.channelId !== lane.key : window.saved.seq > window.frontier!);
      if (window.frontier === null || window.next?.channelId !== lane.key) return false;
      const native = await nativeTranscript(lane, contextId, window.saved.seq, window.frontier);
      return native.frontier === window.frontier &&
        isDeepStrictEqual(window.notes, native.notes.filter(({ seq }) => seq <= window.next!.seq));
    }));
    const channelReads = await Promise.all([...sessions.values()].map(async (entry) => {
      const latest = await nativeTranscript(entry.lane, contextId);
      const baseline = entry.baseline.notes;
      const tail = latest.notes.slice(baseline.length);
      const read = observed.get(entry.source.id);
      return {
        id: entry.source.id, latest,
        matched: isDeepStrictEqual(latest.notes.slice(0, baseline.length), baseline) &&
          (!entry.lateId ? tail.length === 0 : tail.length === 1 &&
            tail[0]?.messageId === entry.lateId && tail[0].text === entry.seed.late &&
            read?.frontier !== null && read?.frontier !== undefined && tail[0].seq > read.frontier),
      };
    }));
    const reason = report?.review?.reason;
    const actualHandoffText=artifact?await fs.readFile(artifact.path,"utf8"):null;
    const hasArtifact = Boolean(artifact && handoffText && stagedReview &&
      handoffText === formatHandoff(stagedReview) && actualHandoffText === handoffText &&
      recoveryHandoffMatches(actualHandoffText,{disposition:world.expected.disposition,citations,reason:world.expected.reason}) &&
      artifact.sha256 === sha256HexSyncText(handoffText));
    const checks = {
      discoveredRetainedSources: catalog.length === world.sessions.length,
      exactReplayScope: isDeepStrictEqual([...observed.values()].map(({ source, status }) => [source.id, status]),
        world.expected.reads.map(({ key, status }) => [session(key).source.id, status])),
      boundNativeReplay: replays.every(Boolean),
      preservedRetainedChannels: channelReads.every(({ matched }) => matched),
      groundedRecoveryDecision: isDeepStrictEqual(report?.handoff,artifact)&&report?.review?.disposition === world.expected.disposition && isDeepStrictEqual(report.review.citations, citations) &&
        typeof reason === "string" && !!reason.trim() &&
        (world.expected.reason ?? []).every((term) => reason.toLowerCase().includes(term.toLowerCase())),
      verifiedRecoveryHandoff: world.expected.stage ? hasArtifact : artifact === null,
    };
    return {
      outcomeContract:{effects:{checks:["discoveredRetainedSources", "exactReplayScope", "boundNativeReplay", "preservedRetainedChannels", "verifiedRecoveryHandoff"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["groundedRecoveryDecision"],required:!world.expected.stage,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],
 contextId, caseId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      catalog, observed: [...observed.values()], durable: channelReads, artifact, handoffText };
  }

  async function qualify() {
    await services.recoverySessions.discover();
    for (const { key } of world.expected.reads) await services.recoveryReplay.resume(session(key).source.id);
    const review = { disposition: world.expected.disposition,
      reason: world.expected.reason?.join(" ") || "The retained record supports this disposition.",
      citations: expectedCitations() };
    const handoff = world.expected.stage ? await services.recoveryHandoff.stage(review) : null;
    return verify({ review, handoff });
  }

  return { goal: world.goal, services, verify, qualify };
}
