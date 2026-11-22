import { isDeepStrictEqual } from "node:util";
import { canonicalJson, sha256HexSyncText } from "@vibestudio/content-addressing";
import { createRecoveryCoordinator } from "@vibestudio/shell-core/recoveryCoordinator";
import { connectViaRpc, type ServerLogEvent, type RpcConnectOptions } from "@workspace/pubsub";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { contextId, rpc, runtime } from "@workspace/runtime";
import {
  deliveryWakeMethods, type DeliveryWakeReceiver, type RecipientAddress, type WakeProjection, type WakeSeed,
} from "@workspace-workers/delivery-wake-fixture/contract";
import type { DeliveryWakeWorld, WakeEventKind } from "./open-goal-delivery-wake-worlds.js";

type Connection = { channel: string; context: string; attempts: number; firstRejected: boolean; ready: boolean; admittedSurfaces: number };
type Event = { id: string; sequence: number; name: string; kind: WakeEventKind; recipients: string[] };
type DeliveryEvidence = { connection: Connection; current: WakeProjection["recipient"]; cursor: number;
  pending: RecipientAddress | null; rangeComplete: boolean; events: Event[]; mailbox: WakeProjection["rows"]; contextRows: number; contextCopies: number };
type Receipt = { event: string; deliveryId: string; revision: number; cursor: number; newRows: number;
  repeatRows: number; contextRows: number; contextCopies: number };
type Ports = { contextId: string; channel: string; projection: DeliveryWakeReceiver; connect(mode: DeliveryWakeWorld["connection"]): Promise<Connection> };
const type = "agentic.trajectory.v1/event";
const nativeKind = { message: "message.completed", terminal: "invocation.completed", failed: "invocation.failed", progress: "invocation.output" } as const;
const fromNative = new Map<string, WakeEventKind>(Object.entries(nativeKind).map(([key,value]) => [value,key as WakeEventKind]));
const scopePrefix = "do:workers/delivery-wake-fixture:DeliveryWakeFixtureDO:";
export async function recoverOwnedSubscription(port: RpcConnectOptions["rpc"], channel: string, target: string, context: string, mode: DeliveryWakeWorld["connection"]) {
  let attempts = 0, firstRejected = false, admittedSurfaces = 0, ready = false;
  const resident = port.selfId.startsWith("do:");
  const register = port.registerResidentSession?.bind(port);
  if (resident && !register) throw new Error("The owned Durable Object has no resident channel registrar");

  function attemptOpening() {
    attempts++;
    if (attempts === 1 && mode !== "clean") {
      firstRejected = true;
      throw Object.assign(new Error("Owned first subscription was rejected"), { code: "ECONNRESET" });
    }
    if (attempts > 2) throw new Error("Owned subscriber exceeded recovery budget");
  }

  const wrapped: RpcConnectOptions["rpc"] = {
    selfId: port.selfId, call: port.call.bind(port),
    streamReadable: async (destination, method, args, options) => {
      if (resident || destination !== target || method.name !== "subscribe")
        return port.streamReadable(destination, method, args, options);
      attemptOpening();
      const response = await port.streamReadable(destination, method, args, options);
      if (response.status >= 200 && response.status < 300) admittedSurfaces++;
      return response;
    },
  };
  if (resident && register) {
    wrapped.registerResidentSession = (channelId, receive, relationship) => {
      const registration = register(channelId, receive, relationship);
      return {
        close: registration.close.bind(registration),
        ...(registration.relationshipEnded && { relationshipEnded: registration.relationshipEnded.bind(registration) }),
        transport: {
          async call(destination, method, args, options) {
            if (destination !== target || method.name !== "join")
              return registration.transport.call(destination, method, args, options);
            attemptOpening();
            const result = await registration.transport.call(destination, method, args, options);
            admittedSurfaces++;
            return result;
          },
        },
      };
    };
  }
  const coordinator = mode === "recover" ? createRecoveryCoordinator() : undefined;
  const client = connectViaRpc({ rpc: wrapped, contextId: context, channel, channelTargetId: target,
    clientId: port.selfId, name: "Owned reconnect probe", type: resident ? "agent" : "user",
    replayMode: "stream", ...(resident ? { deliveryMode: "resident" } : {}),
    ...(coordinator ? { recoveryCoordinator: coordinator } : {}) });
  let lastFailure: string | undefined;
  const unsubscribeErrors = client.onError(error => { lastFailure = error.message; });
  try {
    await client.ready(AbortSignal.timeout(7000));
    if (client.contextId !== context) throw new Error("A different workspace acknowledged the reconnect");
    ready = true;
  } catch (error) {
    if (mode !== "unavailable" || !firstRejected || attempts !== 1 || admittedSurfaces !== 0) {
      const transport = resident ? "resident join" : "stream subscription";
      throw new Error(`Owned ${transport} failed after ${attempts} openings and ${admittedSurfaces} admissions: ${lastFailure ?? error}`,
        { cause: error });
    }
  } finally {
    unsubscribeErrors();
    await client.close();
  }
  return { channel, context, attempts, firstRejected, ready, admittedSurfaces };
}

async function nativePorts(owner: string) {
  if (contextId !== owner) throw new Error("Delivery wake fixture has wrong workspace");
  const owned: string[] = [];
  const close = async () => {
    const failures = (await Promise.allSettled(owned.map(id => runtime.retireEntity({ id }))))
      .flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Release owned delivery wake objects");
  };
  async function create(source: string, className: string, key: string) {
    const entity = await runtime.createEntity({ kind: "do", contextId: owner, execution: { surface: "code", source }, key, className });
    owned.push(entity.id);
    if (entity.kind !== "do" || entity.contextId !== owner) throw new Error("Delivery wake object escaped the local owned context");
    return entity.targetId;
  }
  try {
    const channel = "delivery-wake-" + crypto.randomUUID();
    const channelTarget = await create("workers/pubsub-channel", "PubSubChannel", channel);
    await rpc.call(channelTarget, channelClientRpcMethods.initializeConversation, [owner, { title: "Owned delivery wake proof" }]);
    const projectionTarget = await create("workers/delivery-wake-fixture", "DeliveryWakeFixtureDO", channel);
    const projection: DeliveryWakeReceiver = {
      seed: data => rpc.call(projectionTarget, deliveryWakeMethods.seed, [data]),
      inspect: data => rpc.call(projectionTarget, deliveryWakeMethods.inspect, [data]),
      recover: data => rpc.call(projectionTarget, deliveryWakeMethods.recover, [data]),
    };
    const ports: Ports = { contextId: owner, channel, projection,
      connect: mode => recoverOwnedSubscription(rpc, channel, channelTarget, owner, mode) };
    return { ports, close };
  } catch (error) { await close(); throw error; }
}

function seedWake(key: string, world: DeliveryWakeWorld) {
  const recipient = scopePrefix + key + "-primary", peer = scopePrefix + key + "-neighbor";
  const events: ServerLogEvent[] = [];
  function append(eventType: string, senderId: string, payload: unknown) {
    const id = events.length + 1;
    events.push({ id, messageId: key + ":event:" + id, senderId, type: eventType, payload, ts: id * 1000 } as ServerLogEvent);
  }
  function relation(action: "opened" | "detached" | "revised" | "ended", participantId: string, revision: number) {
    append("channel.subscription." + action, participantId, action === "opened" || action === "revised" ?
      { participantId, revision, delivery: "addressed", endpoint: { kind: "entity", entityId: participantId, invocation: "direct" },
        metadata: { type: "agent", handle: participantId === recipient ? "owned receiver" : "neighbor receiver" }, applicationConfig: null } :
      { participantId, revision, detachAfterSequence: 3 });
  }
  function log(name: string, kind: WakeEventKind, targets: string[]) {
    const sender = "user:fixture-publisher";
    const to = kind === "progress" ? [] : targets.map(participantId => ({ kind: "participant", participantId }));
    append(type, sender, { kind: nativeKind[kind], actor: { kind: "user", id: sender },
      causality: kind === "message" ? { messageId: key + ":" + name } : { invocationId: key + ":" + name },
      payload: { protocol: "agentic.trajectory.v1", ...(kind === "message" ?
        { role: "user", blocks: [{ type: "text", content: name }], outcome: "completed" } : { name }), to },
      createdAt: "2026-01-01T00:00:00.000Z" });
  }
  relation("opened", recipient, 1);
  relation("opened", peer, 1);
  log("baseline", "message", [recipient]);
  relation(world.relationship === "ended" ? "ended" : "detached", recipient, 2);
  let omit: number | null = null;
  for (const row of world.rows) {
    log(row.name, row.kind, row.target === "peer" ? [peer] : row.target === "both" ? [recipient, peer] : [recipient]);
    if (row.name === world.missing) omit = events.length;
  }
  const final = events.length;
  if (world.relationship === "settled" || world.relationship === "pending") relation("revised", recipient, 3);
  const seed: WakeSeed = { key, recipient, peer, events, omit,
    seedThrough: world.relationship === "settled" ? final : world.half ? 5 : null };
  return seed;
}

function readEvent(row: ServerLogEvent, key: string): Event | null {
  const body = row.payload as { kind?: unknown; causality?: { messageId?: string; invocationId?: string };
    payload?: { to?: { participantId: string }[] } } | null;
  const kind = row.type === type && typeof body?.kind === "string" ? fromNative.get(body.kind) : undefined;
  if (!kind || !body) return null;
  const name = body.causality?.[kind === "message" ? "messageId" : "invocationId"];
  if (!name?.startsWith(key + ":")) throw new Error("Native delivery event has no exact fixture provenance");
  return { id: row.messageId, sequence: row.id, name: name.slice(key.length + 1), kind,
    recipients: (body.payload?.to ?? []).map(value => value.participantId) };
}

export async function prepareDeliveryWake(input: { contextId: string; caseId: string }, world: DeliveryWakeWorld, replayPorts?: Ports) {
  if (replayPorts) return bindDeliveryWake(input, world, replayPorts);
  const { ports, close } = await nativePorts(input.contextId);
  try { return { ...await bindDeliveryWake(input, world, ports), close }; }
  catch (error) { await close(); throw error; }
}

async function bindDeliveryWake(input: { contextId: string; caseId: string }, world: DeliveryWakeWorld, ports: Ports) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id) throw new Error("Wrong owned delivery wake assignment");
  const key = ports.channel, store = ports.projection;
  const seeded = seedWake(key, world);
  await store.seed(seeded);
  const before = await store.inspect({ key });
  const realm = before.recipient;
  if (!realm) throw new Error("Missing native receiver projection");
  const nativeCursor = before.pending?.after ?? before.cursor;
  const assignment = { id: crypto.randomUUID(), goal: world.goal, subject: world.subject, channel: key, request: world.request,
    kind: world.requestedKind, recipient: world.claim === "peer" ? seeded.peer : seeded.recipient,
    revision: world.claim === "older-revision" ? realm.revision - 1 : realm.revision,
    saved: nativeCursor + (world.claim === "later-cursor" ? 1 : world.claim === "earlier-cursor" ? -1 : 0), mayWake: world.mayWake };
  const effects: { service: string; method: string; args: unknown[]; result: unknown }[] = [];
  let claimed = false, pending = false;
  let observed: DeliveryEvidence | null = null, receipt: Receipt | null = null;
  const events = before.history.flatMap(row => readEvent(row, key) ?? []);
  const candidates = events.filter(event => event.name === assignment.request && event.kind === assignment.kind &&
    event.recipients.includes(seeded.recipient));
  const sourceEvent = candidates.length === 1 ? candidates[0] : null;
  const alreadyPresent = !!sourceEvent && before.rows.some(row => row.event === sourceEvent.id &&
    row.recipient === seeded.recipient && row.revision === realm.revision);
  const range = before.pending;
  const inRange = (sequence: number) => !!range && sequence > range.after && sequence <= range.through;
  const rangeComplete = !range || before.history.filter(row => inRange(row.id)).length === range.through - range.after;
  function capture<T>(service: string, method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  }
  const services = {
    deliveryWakeEvidence: {
      async discover() {
        if (claimed) return structuredClone(assignment);
        claimed = true;
        return capture("deliveryWakeEvidence", "discover", [], assignment);
      },
      async observe(id: string) {
        if (!claimed || id !== assignment.id) throw new Error("Observe the one exact delivery lane");
        if (observed) return structuredClone(observed);
        if (pending) throw new Error("The delivery observation is already in progress");
        pending = true;
        try {
          const connection = await ports.connect(world.connection);
          if (!isDeepStrictEqual(await store.inspect({ key }), before)) throw new Error("Reconnect changed the retained mailbox");
          observed = {
            connection, current: realm, cursor: before.cursor, pending: range, rangeComplete, events, mailbox: before.rows,
            contextRows: before.contextIds.length, contextCopies: before.contextCopies,
          };
          return capture("deliveryWakeEvidence", "observe", [id], observed);
        } finally { pending = false; }
      },
    },
    deliveryWakeAction: {
      async apply(id: string, event: string, cursor: RecipientAddress | null) {
        if (id !== assignment.id || !observed?.connection.ready || observed.connection.channel !== key ||
          observed.connection.admittedSurfaces !== 1 || !range || pending || receipt || !assignment.mayWake || alreadyPresent ||
          !realm.active || !realm.attached || assignment.recipient !== realm.id || assignment.revision !== realm.revision ||
          assignment.saved !== range.after || !rangeComplete || !isDeepStrictEqual(cursor, range) ||
          !sourceEvent || event !== sourceEvent.id || !inRange(sourceEvent.sequence))
          throw new Error("Wake is outside the exact active owned delivery scope");
        pending = true;
        try {
          const response = await store.recover({ key, ...range });
          const delivered = response.native.rows.find(row => row.event === event && row.recipient === realm.id && row.revision === realm.revision);
          if (!delivered || response.native.pending || response.duplicateReplay) throw new Error("Native wake lacks its single exact retained mailbox row");
          receipt = { event, deliveryId: delivered.deliveryId, revision: delivered.revision, cursor: response.native.cursor,
            newRows: response.inserted, repeatRows: response.duplicateReplay, contextRows: response.native.contextIds.length, contextCopies: response.native.contextCopies };
          return capture("deliveryWakeAction", "apply", [id, event, cursor], receipt);
        } finally { pending = false; }
      },
    },
  };
  async function verify(value: unknown) {
    const report = value as { status?: string; skill?: string; outcome?: {
      assignment?: unknown; evidence?: unknown; choice?: unknown; receipt?: unknown;
    } } | null;
    const outcome = report?.outcome, disposition = world.expected;
    const choice = { disposition, event: ["advance","confirmed"].includes(disposition) ? sourceEvent : null };
    const after = await store.inspect({ key });
    const shouldWake = disposition === "advance";
    const added = shouldWake ? events.filter(event => inRange(event.sequence) && event.recipients.includes(seeded.recipient)) : [];
    const expectedAdd = added.map(event => ({ deliveryId: sha256HexSyncText(canonicalJson([key, event.id, seeded.recipient, realm.revision])),
      event: event.id, sequence: event.sequence, recipient: seeded.recipient, revision: realm.revision, state: "ready" }))
      .filter(row => !before.rows.some(previous => previous.deliveryId === row.deliveryId));
    const expectedRows = [...before.rows, ...expectedAdd].sort((a,b) =>
      a.sequence - b.sequence || a.recipient.localeCompare(b.recipient) || a.revision - b.revision);
    const contexts = [...new Set(expectedRows.map(row => row.event))].sort();
    const exactRow = sourceEvent ? after.rows.find(row => row.event === sourceEvent.id &&
      row.recipient === seeded.recipient && row.revision === realm.revision) : undefined;
    const expectedReceipt = shouldWake && exactRow ? { event: exactRow.event, deliveryId: exactRow.deliveryId, revision: exactRow.revision,
      cursor: after.cursor, newRows: expectedAdd.length, repeatRows: 0, contextRows: contexts.length, contextCopies: 0 } : null;
    const ready = world.connection !== "unavailable", connection = observed?.connection;
    const nativeDisposition = !ready ? "hold-connection" : !realm.active || !realm.attached || realm.id !== assignment.recipient ? "hold-recipient" :
      assignment.revision !== realm.revision ? "hold-revision" : assignment.saved !== nativeCursor ? "hold-cursor" :
      !rangeComplete || !sourceEvent ? "hold-evidence" : alreadyPresent ? "confirmed" :
      !inRange(sourceEvent.sequence) ? "hold-evidence" : assignment.mayWake ? "advance" : "hold-policy";
    const checks = {
      matchedOwnedDeliveryAssignment: isDeepStrictEqual(outcome?.assignment, assignment) && isDeepStrictEqual(outcome?.choice, choice),
      verifiedNativeFirstSubscription: connection?.channel === key && connection.context === input.contextId && connection.ready === ready &&
        connection.firstRejected === (world.connection !== "clean") && connection.attempts === (world.connection === "recover" ? 2 : 1) &&
        connection.admittedSurfaces === (ready ? 1 : 0),
      verifiedExactRetainedDelivery: !!observed && isDeepStrictEqual(outcome?.evidence, observed) &&
        before.history.length === seeded.events.length - (seeded.omit ? 1 : 0) &&
        (disposition !== "confirmed" || !!exactRow) && (disposition !== "advance" || !!sourceEvent),
      verifiedSameReceiverCursor: nativeDisposition === disposition && report?.status === "workspace-skill-reviewed" && report.skill === "deliveryWake" &&
        isDeepStrictEqual(after.pending, shouldWake ? null : before.pending) && before.cursor === after.cursor &&
        isDeepStrictEqual(before.history, after.history) && isDeepStrictEqual(before.recipient, after.recipient),
      verifiedUniqueNormalizedMailbox: isDeepStrictEqual(after.rows, expectedRows) && after.contextCopies === 0 &&
        isDeepStrictEqual(after.contextIds, contexts) && new Set(after.rows.map(row => row.deliveryId)).size === after.rows.length &&
        before.receipts.every(old => after.receipts.some(row => isDeepStrictEqual(row, old))),
      verifiedExactWakeReceipt: isDeepStrictEqual(outcome?.receipt, expectedReceipt) && isDeepStrictEqual(receipt, expectedReceipt) &&
        effects.length === (shouldWake ? 3 : 2),
    };
    return { passed: Object.values(checks).every(Boolean), caseId: world.id, contextId: input.contextId, goal: world.goal, checks,
      assignment, evidence: observed, choice, receipt: expectedReceipt, effects: structuredClone(effects) };
  }
  async function qualify() {
    const assigned = await services.deliveryWakeEvidence.discover();
    const evidence = await services.deliveryWakeEvidence.observe(assigned.id);
    const choice = { disposition: world.expected, event: ["advance","confirmed"].includes(world.expected) ? sourceEvent : null };
    async function rejected(work: Promise<unknown>) { try { await work; return false; } catch { return true; } }
    const rejectedForeignReplay = await rejected(services.deliveryWakeAction.apply(assigned.id, "other-event", range));
    const rejectedCursorDrift = !range || await rejected(store.recover({ key, ...range, after: range.after - 1 }));
    const receipt = choice.disposition === "advance" && choice.event ?
      await services.deliveryWakeAction.apply(assigned.id, choice.event.id, range) : null;
    const report = { status: "workspace-skill-reviewed", skill: "deliveryWake", outcome: { assignment: assigned, evidence, choice, receipt } };
    const proof = await verify(report);
    const rejectedWrongScope = !(await verify({ ...report, outcome: { ...report.outcome, choice: { ...choice, event: null },
      assignment: { ...assigned, recipient: "other" } } })).passed;
    const checks = { ...proof.checks, rejectedForeignReplay, rejectedCursorDrift, rejectedWrongScope };
    return { ...proof, checks, passed: Object.values(checks).every(Boolean), report };
  }
  return { services, verify, qualify };
}
