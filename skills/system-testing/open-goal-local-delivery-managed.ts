import {bindObservedContentReview} from "@workspace/application-outcomes/observed-content-review";
const assessObservedApplicationOutcome=bindObservedContentReview(["catalog","observations","attempt","readback","nativeProofs","boundaries","rosterReadbacks"],[]);
import {deliveredFactsMatch} from "./retained-task-content.js";
import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
import type { InvocationObservations } from "@workspace/application-outcomes/observed-invocation";
import { isDeepStrictEqual } from "node:util";
import type { WorkspaceRuntime } from "@workspace/runtime/hosted";
import type { RuntimeEntityHandle } from "@vibestudio/shared/runtime/entitySpec";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import { localMessagingFixtureMethods as actor } from "@workspace-workers/local-messaging-fixture/contract";
import { iterateChannelReplayAfterPages, type ChannelEvent } from "@workspace/pubsub";
import type { OwnedMessagingLease, Receipt } from "@workspace-skills/messaging/local-workflow";
import { verifyOutcome } from "./local-messaging/verify-outcome.mjs";
import type { OpenLocalDeliveryWorld, OwnedLocalRoom } from "./open-goal-local-delivery-worlds.js";

// The Natlang package's source is loaded into the workspace compiler. Keep the
// harness interface separate from that load boundary and serialize plain data.
type Conversation = { id: string; title: string; maySend: boolean };
type Evidence = {
  roomId: string; channelId: string; messageId: string; senderId: string; recipientRef: string;
  content: string; sequence: number; acknowledged: boolean;
};
type Roster = import("@workspace-skills/messaging/local-workflow").Snapshot;
type Observation = {
  room: Conversation; basis: string; phrase: string | null; roster: Roster["rows"];
  resolution: Roster["resolution"] | null; prior: Evidence | null;
};
type Attempt = { attemptId: string; response: "submitted" | "interrupted" };
type Delivery = { attempt: Attempt; readback: Evidence | null };
type Result = {
  status: OpenLocalDeliveryWorld["expected"]["status"]; reason: string;
  evidence: Evidence[]; delivery: Delivery | null;
};
type Probe = { ref: string; handle: RuntimeEntityHandle; participantId: string };
type Lane = {
  room: Conversation; spec: OwnedLocalRoom; key: string; channel: RuntimeEntityHandle;
  sender: RuntimeEntityHandle; probes: Probe[]; baseline: number;
  history: { receipt: Receipt; content: string } | null;
};
type Ports = { runtime: Pick<WorkspaceRuntime["runtime"], "createEntity" | "retireEntity">; rpc: WorkspaceRuntime["rpc"] };
type Sent = {
  lane: Lane; basis: string; content: string; to: string; receipt: Receipt | null;
  attempt: Attempt; readback: Evidence | null; didRead: boolean;
};
const fixtureSource = "workers/local-messaging-fixture";
const channelClass = "LocalMessagingChannelDO";
const ref = (handle: string) => `@${handle}`;
const textBlock = (blocks: readonly { type: string; content?: string }[]) => blocks
  .filter(({ type }) => type === "text").map(({ content }) => content).join("\n");

function completedMessage(event: ChannelEvent, senderId: string) {
  if (event.senderId !== senderId || event.type !== "agentic.trajectory.v1/event") return null;
  const payload = event.payload as { kind?: string; causality?: { messageId?: string }; payload?: {
    to?: { kind: string; participantId?: string }[]; blocks?: { type: string; content?: string }[];
  } } | undefined;
  if (payload?.kind !== "message.completed" || !payload.causality?.messageId) return null;
  return { id: payload.causality.messageId, seq: event.id, to: payload.payload?.to ?? [],
    content: textBlock(payload.payload?.blocks ?? []) };
}

export async function prepareOpenLocalDelivery(
  { contextId, caseId }: { contextId: string; caseId: string }, world: OpenLocalDeliveryWorld, { runtime, rpc }: Ports,
) {
  if (caseId !== world.id || !contextId || new Set(world.rooms.map(({ key }) => key)).size !== world.rooms.length)
    throw new Error("Open local delivery requires its owned conversation inventory");
  const fixtureId = crypto.randomUUID();
  const issued: RuntimeEntityHandle[] = [];
  const lanes: Lane[] = [];
  let closed = false;
  let sending = false;
  const state: { sent: Sent | null } = { sent: null };
  const observations = new Map<string, Observation>();
  const issuedObservations = new Map<string, Observation>();
  const revisions = new Map<string, string>();
  const reading = new Set<string>();

  async function create(className: string, key: string) {
    const entity = await runtime.createEntity({ kind: "do", execution: { surface: "code", source: fixtureSource }, className, key, contextId });
    if (entity.kind !== "do" || entity.contextId !== contextId) throw new Error("Disposable delivery entity escaped its owner");
    issued.push(entity);
    return entity;
  }
  async function close() {
    if (closed) return;
    closed = true;
    const errors = [];
    for (const entity of [...issued].reverse()) {
      try { await runtime.retireEntity({ id: entity.id }); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Disposable conversation cleanup failed");
  }
  async function replay(lane: Lane, after: number, throughSeq?: number) {
    const events: ChannelEvent[] = [];
    for await (const page of iterateChannelReplayAfterPages(request => rpc.call(lane.channel.targetId, channelRpcMethods.getReplayAfter, [request]),
      { after, ...(throughSeq !== undefined ? { throughSeq } : {}) })) events.push(...page.logEvents);
    return events;
  }
  async function join(lane: Lane) {
    const { barrier } = await rpc.call(lane.channel.targetId, actor.joinFixtureDelivery, []);
    if (!barrier || typeof barrier !== "object" || Array.isArray(barrier) ||
        !("channelId" in barrier) || barrier.channelId !== lane.key ||
        !("headSequence" in barrier) || typeof barrier.headSequence !== "number" ||
        !("headHash" in barrier) || typeof barrier.headHash !== "string" || !barrier.headHash)
      throw new Error("Owned delivery returned a foreign or incomplete joined boundary");
    return { channelId: lane.key, after: lane.baseline, through: barrier.headSequence, joined: true, barrier };
  }
  async function roster(lane: Lane) {
    const output = await rpc.call(lane.channel.targetId, channelClientRpcMethods.getParticipants, []);
    return output.map(({ participantId, metadata }) => ({ participantId, handle: metadata["handle"], kind: metadata["type"] }));
  }
  const snapshots = async (lane: Lane) => Promise.all(lane.probes.map(async probe => ({
    ...await rpc.call(probe.handle.targetId, actor.snapshot, []), joined: true,
  })));
  function laneByKey(key: string) {
    const lane = lanes.find(({ spec }) => spec.key === key);
    if (!lane) throw new Error(`Unknown owned local conversation ${key}`);
    return lane;
  }
  async function evidence(lane: Lane, receipt: Receipt, content: string): Promise<Evidence> {
    const native = await rpc.call(lane.sender.targetId, actor.inspectDelivery, [receipt]);
    if (!native.committed || native.channelId !== lane.key || native.messageId !== receipt.messageId ||
        native.content !== content || !isDeepStrictEqual(native.recipientRefs, [receipt.to]))
      throw new Error("Canonical local delivery readback differs from the original message");
    const boundary = await join(lane);
    const events = await replay(lane, boundary.after, boundary.through);
    const raw = events.map(event => completedMessage(event, lane.sender.id)).find(message => message?.id === receipt.messageId);
    const target = lane.probes.find(probe => probe.ref === receipt.to);
    if (!raw || !target || raw.content !== content || raw.to.length !== 1 ||
        raw.to[0]?.kind !== "participant" || raw.to[0].participantId !== target.participantId)
      throw new Error("The joined replay does not contain the exact addressed message");
    const probes = await snapshots(lane);
    const acknowledged = probes.some(probe => probe.participantId === target.participantId && probe.channelId === lane.key &&
      probe.deliveries.some(delivery => delivery.channelId === lane.key && delivery.participantId === target.participantId &&
        delivery.subscriptionRevision === probe.subscriptionRevision && delivery.eventSequence === raw.seq &&
        completedMessage(delivery.envelope.event, lane.sender.id)?.id === raw.id));
    return { roomId: lane.room.id, channelId: lane.key, messageId: raw.id, senderId: lane.sender.id,
      recipientRef: receipt.to, content, sequence: raw.seq, acknowledged };
  }

  async function provision(spec: OwnedLocalRoom) {
    const key = `open-local-${fixtureId}-${spec.key}`;
    const channel = await create(channelClass, key);
    await rpc.call(channel.targetId, channelRpcMethods.initializeConversation, [contextId, { title: spec.title }]);
    const channelRef = { source: fixtureSource, className: channelClass, objectKey: key };
    const configuration = { contextId, fixtureId, channelId: key, channelTargetId: channel.targetId, channelRef };
    const probes: Probe[] = [];
    for (const [handle, name] of spec.participants) {
      const participant = await create("LocalMessagingProbeDO", `probe-${fixtureId}-${spec.key}-${handle}`);
      const joined = await rpc.call(participant.targetId, actor.configure, [{ ...configuration, handle, name }]);
      if (joined.participantId !== participant.id) throw new Error("Passive local participant identity changed at join");
      probes.push({ ref: ref(handle), handle: participant, participantId: joined.participantId });
    }
    const sender = await create("LocalMessagingSenderDO", `sender-${fixtureId}-${spec.key}`);
    const lease: OwnedMessagingLease = { fixtureId, channelId: key, senderParticipantId: sender.id,
      operationId: `local-delivery-${fixtureId}-${spec.key}`, active: true,
      recipients: probes.map(({ ref, participantId }) => ({ ref, participantId, kind: "agent" })) };
    await rpc.call(sender.targetId, actor.configure, [{ ...configuration, lease, handle: "fixture-sender", name: "Owned synthetic sender" }]);
    const lane: Lane = { spec, key, channel, sender, probes, baseline: 0, history: null,
      room: { id: crypto.randomUUID(), title: spec.title, maySend: spec.maySend } };
    lane.baseline = (await join(lane)).through;
    return lane;
  }

  try {
    for (const spec of world.rooms) {
      const lane = await provision(spec);
      lanes.push(lane);
      if (spec.prior) {
        const phrase = `Tell ${ref(spec.prior.to)} the retained release decision.`;
        const snapshot = await rpc.call(lane.sender.targetId, actor.inspect, [phrase]);
        const receipt = await rpc.call(lane.sender.targetId, actor.send, [snapshot.revision, phrase, ref(spec.prior.to), spec.prior.content]);
        if (!(await evidence(lane, receipt, spec.prior.content)).acknowledged)
          throw new Error("The native fixture did not retain its initial passive acknowledgement");
        lane.history = { receipt, content: spec.prior.content };
      }
    }
  } catch (error) {
    try { await close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Open delivery setup and cleanup failed"); }
    throw error;
  }

  const catalog = lanes.map(({ room }) => room);
  const services = {
    localDeliveryCatalog: {
      async discover() { return structuredClone(catalog); },
    },
    localDeliveryHistory: {
      async inspect(roomId: string, phrase: string | null): Promise<Observation> {
        const lane = lanes.find(({ room }) => room.id === roomId);
        if (!lane || reading.has(roomId) || sending ||
            (phrase !== null && (typeof phrase !== "string" || !phrase.trim() || phrase.length > 180)))
          throw new Error("Inspect an owned local conversation with a bounded recipient phrase");
        reading.add(roomId);
        try {
          const snapshot = await rpc.call(lane.sender.targetId, actor.inspect, [phrase ?? ""]);
          if (snapshot.channelId !== lane.key || snapshot.fixtureId !== fixtureId)
            throw new Error("Roster snapshot belongs to another conversation");
          const observation = { room: lane.room, basis: crypto.randomUUID(), phrase,
            roster: snapshot.rows, resolution: phrase === null ? null : snapshot.resolution,
            prior: lane.history ? await evidence(lane, lane.history.receipt, lane.history.content) : null };
          observations.set(roomId, observation);
          issuedObservations.set(observation.basis, observation);
          revisions.set(observation.basis, snapshot.revision);
          return structuredClone(observation);
        } finally { reading.delete(roomId); }
      },
    },
    localDeliverySend: {
      async submit(basis: string, content: string): Promise<Attempt> {
        const lookup = issuedObservations.get(basis);
        const revision = revisions.get(basis);
        const lane = lanes.find(({ room }) => room.id === lookup?.room.id);
        if (sending || state.sent || reading.size || !lane?.room.maySend || lane.history || !lookup?.phrase || !revision ||
            lookup.resolution?.kind !== "ref" || typeof content !== "string" || !content.trim() || content.length > 800 || /(?:^|\s)@[-\w]+/u.test(content))
          throw new Error("Submit only one scoped local note using its exact current recipient and original roster");
        sending = true;
        const to = lookup.resolution.ref;
        const attempt: Attempt = { attemptId: crypto.randomUUID(), response: "interrupted" };
        const submitted: Sent = { lane, basis, content, to, receipt: null, attempt, readback: null, didRead: false };
        state.sent = submitted;
        try {
          const receipt = await rpc.call(lane.sender.targetId, actor.send, [revision, lookup.phrase, to, content]);
          if (!lane.spec.lostAcknowledgement) {
            submitted.receipt = receipt;
            attempt.response = "submitted";
          }
        } catch {
          // A missing response cannot authorize a second operation.
        } finally { sending = false; }
        return structuredClone(attempt);
      },
    },
    localDeliveryReadback: {
      async read(attemptId: string): Promise<Evidence | null> {
        const sent = state.sent;
        if (sending || !sent || sent.attempt.attemptId !== attemptId )
          throw new Error("Read back only the original owned attempt");
        sent.didRead = true;
        if (!sent.receipt) {
          const { lane, to, content } = sent;
          const target = lane.probes.find(probe => probe.ref === to);
          const boundary = await join(lane);
          const events = await replay(lane, boundary.after, boundary.through);
          const candidates = events.map(event => completedMessage(event, lane.sender.id)).filter(message =>
            message?.content === content && message.to.length === 1 && message.to[0]?.kind === "participant" &&
            message.to[0].participantId === target?.participantId);
          if (candidates.length === 1 && candidates[0])
            sent.receipt = { messageId: candidates[0].id, channelId: lane.key, to, alert: "none" };
        }
        sent.readback = sent.receipt ? await evidence(sent.lane, sent.receipt, sent.content) : null;
        return structuredClone(sent.readback);
      },
    },
  };

  function requiredEvidence() {
    return world.expected.evidence.map(key => observations.get(laneByKey(key).room.id)?.prior);
  }
  
  async function verify(value: unknown,invocation?: InvocationObservations,negatives?: { foreign: boolean; wrongAttempt: boolean }) {
    const proof=await verifyNativeApplication(value,invocation,negatives);
    if(!proof.outcomeContract)throw new Error("Application verifier must declare native effects and returned values");
    // Bind only fields actually emitted by this composition. Native receipt-only
    // branches have no sampled semantic return contribution to invent.
    const authored:readonly ApplicationReturnContribution[]=[{"checks":["matchedLocalDeliveryDecision"],"rootPath":["reason"],"producerSourceSuffix":"workTowardLocalDelivery/decideDelivery.nl","producerPath":["reason"]}];
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
async function verifyNativeApplication(value: unknown, invocation?: InvocationObservations, negatives?: { foreign: boolean; wrongAttempt: boolean }) {
    const envelope = value as Result | null;
    const outcome = envelope;
    const sent = state.sent;
    for (const lane of lanes) await rpc.call(lane.sender.targetId, actor.closeAdmission, []);
    const boundaries = await Promise.all(lanes.map(join));
    const events = (await Promise.all(lanes.map(async (lane, index) =>
      (await replay(lane, lane.baseline, boundaries[index]!.through)).map(event => ({ channelId: lane.key, event }))))).flat();
    const probeSnapshots = (await Promise.all(lanes.map(snapshots))).flat();
    const rosterReadbacks = await Promise.all(lanes.map(async (lane) => ({ channelId: lane.key, entries: await roster(lane) })));
    const ownedChannelIds = lanes.map(({ key }) => key);
    const ownedProbeIds = lanes.flatMap(({ probes }) => probes.map(({ participantId }) => participantId));
    const nativeProofs = lanes.map((lane) => {
      const followUp = world.expected.send?.room === lane.spec.key ? world.expected.send : null;
      const expectedRecipient = lane.spec.prior ? ref(lane.spec.prior.to) : followUp ? ref(followUp.recipient) : null;
      const expectedRecipientIds = expectedRecipient ? lane.probes.filter(probe => probe.ref === expectedRecipient).map(probe => probe.participantId) : [];
      const report = lane.history
        ? { status: "delivered", messageId: lane.history.receipt.messageId, content: lane.history.content }
        : followUp ? { status: "delivered", messageId: sent?.readback?.messageId, content: sent?.readback?.content }
        : { status: "held", clarification: "This lane remained without another accepted message.", messageId: null };
      return verifyOutcome({ expectedStatus: expectedRecipient ? "delivered" : "held", expectedRecipientIds,
        ownedChannelIds, ownedProbeIds, requiredFacts: lane.spec.prior ? [lane.spec.prior.content] : followUp?.facts ?? [],
        senderId: lane.sender.id, sourceChannelId: lane.key, report, closedAdmission: true, boundaries, events, probeSnapshots });
    });
    const expectedReads = Object.entries(world.expected.reads);
    const sorted = <T extends { roomId: string }>(values: readonly T[]) => [...values].sort((a, b) => a.roomId.localeCompare(b.roomId));
    const wanted = requiredEvidence().filter((item): item is Evidence => item !== undefined && item !== null);
    const reason = typeof outcome?.reason === "string" ? outcome.reason.toLowerCase() : null;
    const checks = {
      discoveredOwnedDeliveryRooms: observations.size > 0,
      exactObservedDeliveryScope: expectedReads.every(([key, phrase]) =>
        [...issuedObservations.values()].some(lookup => lookup.room.id === laneByKey(key).room.id &&
          (phrase === null ? lookup.phrase === null : lookup.phrase?.toLowerCase().includes(phrase.toLowerCase())))),
      independentlyJoinedLocalDelivery: nativeProofs.every(proof => proof.passed),
      preservedOwnedLocalRosters: lanes.every((lane, index) => {
        const current = rosterReadbacks[index]?.entries ?? [];
        // Addressed AgentWorkerBase subscriptions register as observers. The
        // probes join the channel directly as passive agents.
        const expected = new Map([[lane.sender.id, { handle: "fixture-sender", kind: "observer" }],
          ...lane.probes.map(({ participantId, ref }) => [participantId, { handle: ref.slice(1), kind: "agent" }] as const)]);
        return current.length === expected.size && new Set(current.map(entry => entry.participantId)).size === expected.size &&
          current.every(({ participantId, handle, kind }) => isDeepStrictEqual({ handle, kind }, expected.get(participantId)));
      }),
      verifiedOriginalLocalReceipts: wanted.length === world.expected.evidence.length &&
        wanted.every(item => item.acknowledged),
      matchedLocalDeliveryDecision: isDeepStrictEqual(outcome?.delivery,sent?{attempt:sent.attempt,readback:sent.readback}:null)&&outcome?.status === world.expected.status && Boolean(reason?.trim()),
      exactLocalRecipientAndReadback: world.expected.send ? Boolean(sent?.didRead && sent.readback?.acknowledged &&
        sent.lane.spec.key === world.expected.send.room && sent.to === ref(world.expected.send.recipient) &&
        deliveredFactsMatch(sent.readback.content,world.expected.send.facts) &&
        sent.attempt.response === (sent.lane.spec.lostAcknowledgement ? "interrupted" : "submitted")) : sent === null,
      ...(negatives ? { rejectedForeignLocalRoom: negatives.foreign, rejectedForeignLocalAttempt: negatives.wrongAttempt } : {}),
    };
    return {
      outcomeContract:{effects:{checks:[...["discoveredOwnedDeliveryRooms", "exactObservedDeliveryScope", "independentlyJoinedLocalDelivery", "preservedOwnedLocalRosters", "verifiedOriginalLocalReceipts", "exactLocalRecipientAndReadback"],...(negatives?["rejectedForeignLocalRoom", "rejectedForeignLocalAttempt"]:[])],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["matchedLocalDeliveryDecision"],required:!world.expected.send,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:[],

      contextId, caseId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      catalog, observations: [...observations.values()], attempt: sent?.attempt ?? null, readback: sent?.readback ?? null,
      nativeProofs, boundaries, rosterReadbacks,
    };
  }
  return {
    goal: world.goal, services, verify, close,
    async qualify() {
      await services.localDeliveryCatalog.discover();
      let foreign = false, wrongAttempt = false;
      try { await services.localDeliveryHistory.inspect(crypto.randomUUID(), null); }
      catch { foreign = true; }
      for (const [key, phrase] of Object.entries(world.expected.reads)) {
        const target = laneByKey(key);
        await services.localDeliveryHistory.inspect(target.room.id, phrase === null ? null
          : `Tell ${phrase.includes("-") ? ref(phrase) : phrase} the owned local note.`);
      }
      let delivery: Delivery | null = null;
      try { await services.localDeliveryReadback.read(crypto.randomUUID()); }
      catch { wrongAttempt = true; }
      if (world.expected.send) {
        const target = observations.get(laneByKey(world.expected.send.room).room.id);
        if (!target) throw new Error("Reference delivery has no current roster");
        const attempt = await services.localDeliverySend.submit(target.basis, world.expected.send.facts.join("\n"));
        delivery = { attempt, readback: await services.localDeliveryReadback.read(attempt.attemptId) };
      }
      const reason = (world.expected.mentions ?? []).map(([term]) => term).join("; ") || "Exact local delivery result verified";
      return verify({
        status: world.expected.status, delivery, reason,
      }, undefined, { foreign, wrongAttempt });
    },
  };
}
