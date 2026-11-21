import { isDeepStrictEqual } from "node:util";
import { gad, rpc, runtime } from "@workspace/runtime";
import { waitFor } from "@workspace/testkit";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import { localMessagingFixtureMethods } from "@workspace-workers/local-messaging-fixture/contract";
import { iterateChannelReplayAfterPages, type ChannelEvent } from "@workspace/pubsub";
import { bindDurableQuestionReview } from "@workspace-skills/gad-context/durable-question-workflow";
import type {
  DurableQuestionHistory,
  DurableQuestionMessage,
  DurableQuestionReport,
  DurableQuestionRoster,
} from "@workspace-skills/gad-context/natlang-types";
import type { GadReviewWorld } from "./open-goal-gad-durable-question-worlds.js";

type Readers = Parameters<typeof bindDurableQuestionReview>[1];
type NativeMember = { participantId: string; handle: string; displayName: string; inactive: boolean };
type NativeState = { messages: DurableQuestionMessage[]; active: string[]; roster: NativeMember[] };
const skill = "gadDurableQuestion";
const channelSource = "workers/pubsub-channel";
const channelClass = "PubSubChannel";
const fixtureSource = "workers/local-messaging-fixture";
const agenticEventKind = "agentic.trajectory.v1/event";

export function canonicalUserRecords(events: ChannelEvent[]): DurableQuestionMessage[] {
  return events.flatMap(row => {
    const event = row.payload as {
      kind?: string;
      actor?: { kind?: string; id?: string };
      causality?: { messageId?: string };
      payload?: { role?: string; blocks?: {type: string; content?: string}[] };
    };
    if (row.type !== agenticEventKind || event?.kind !== "message.completed" ||
        event.payload?.role !== "user" || !event.causality?.messageId ||
        !event.actor?.kind || !event.actor.id) return [];
    if (row.senderId !== event.actor.id) throw new Error("Canonical replay has a different sender");
    return [{ messageId: event.causality.messageId, envelopeId: row.messageId, sequence: row.id,
      senderId: event.actor.id, senderKind: event.actor.kind, role: "user",
      textBlocks: (event.payload.blocks ?? []).flatMap(block => block.type === "text" && typeof block.content === "string" ? [block.content] : []) }];
  });
}

export function bindOpenGadDurableQuestion(
  contextId: string, channelId: string, world: GadReviewWorld,
  readNative: () => Promise<NativeState>, readers?: Readers,
) {
  const binding = bindDurableQuestionReview(channelId, readers);
  let history: DurableQuestionHistory | null = null;
  let roster: DurableQuestionRoster | null = null;
  const services = {
    gadDurableHistory: { async read() {
      const result = await binding.gadDurableHistory.read();
      history = structuredClone(result);
      return result;
    } },
    gadDurableRoster: { async read(receipt: string) {
      const result = await binding.gadDurableRoster.read(receipt);
      roster = structuredClone(result);
      return result;
    } },
  };
  const expected = world.expected;

  async function verify(raw: unknown) {
    const report = raw as {status?: string; skill?: string; outcome?: DurableQuestionReport} | null;
    const outcome = report?.outcome;
    const native = await readNative();
    const expectedMessage = expected.message === null ? null : native.messages[expected.message];
    const expectedMember = expected.member === null ? null :
      roster?.members.find(row => row.participantId === native.roster[expected.member!]?.participantId);
    const ready = expected.question === "current" && expected.participant === "confirmed";
    const currentRoster = roster?.members.filter(member => member.leftAt === null).map(member => member.participantId).sort();
    const rosterMatches = !!roster && roster.members.length === native.roster.length && native.roster.every(entry =>
      roster!.members.some(member => member.participantId === entry.participantId && member.handle === entry.handle &&
        member.displayName === entry.displayName && member.kind === "agent" && !!member.joinedAt &&
        (member.leftAt !== null) === entry.inactive));
    const historyMatches = history?.complete ? isDeepStrictEqual(history.messages, native.messages) :
      expected.question === "history-incomplete" && !!history?.messages.length && history.messages.length < native.messages.length &&
      isDeepStrictEqual(history.messages, native.messages.slice(-history.messages.length));
    const checks = {
      exactIndividualPublications: !!history && history.channelId === channelId && historyMatches &&
        history.through === (native.messages.at(-1)?.sequence ?? null) &&
        isDeepStrictEqual(native.messages.map(message => message.textBlocks), world.messages.map(text => [text])),
      exactRetainedRoster: roster?.channelId === channelId && roster.complete && rosterMatches &&
        isDeepStrictEqual(currentRoster, [...native.active].sort()),
      exactQuestionDisposition: !!outcome && outcome.question?.status === expected.question &&
        isDeepStrictEqual(outcome.question.message, expectedMessage),
      exactParticipantDisposition: !!outcome && outcome.participant?.status === expected.participant &&
        isDeepStrictEqual(outcome.participant.member, expectedMember),
      derivedReadOnlyHandoff: report?.status === "workspace-skill-reviewed" && report.skill === skill &&
        outcome?.channelId === channelId && outcome.historyReceipt === history?.receipt &&
        outcome.rosterReceipt === roster?.receipt && outcome.disposition === (ready ? "ready" : "hold") &&
        typeof outcome.explanation === "string" && outcome.explanation.trim().length > 0,
    };
    return { contextId, caseId: world.id, sourceGroup: world.sourceGroup, goal: world.goal,
      passed: Object.values(checks).every(Boolean), checks, diagnostics: {history, roster, native} };
  }

  async function qualify() {
    const observed = await services.gadDurableHistory.read();
    let rejectedForeignReceipt = false;
    try { await services.gadDurableRoster.read("a receipt from a different conversation"); }
    catch (error) { rejectedForeignReceipt = error instanceof Error && /assigned durable history/.test(error.message); }
    const observedRoster = await services.gadDurableRoster.read(observed.receipt);
    const native = await readNative();
    const question = {status: expected.question, message: expected.message === null ? null :
      observed.messages.find(message => message.messageId === native.messages[expected.message!]?.messageId) ?? null};
    const participant = {status: expected.participant, member: expected.member === null ? null :
      observedRoster.members.find(member => member.participantId === native.roster[expected.member!]?.participantId) ?? null};
    const disposition = question.status === "current" && participant.status === "confirmed" ? "ready" : "hold";
    const report = {status:"workspace-skill-reviewed", skill, outcome: {
      channelId, historyReceipt:observed.receipt, rosterReceipt:observedRoster.receipt, question, participant, disposition,
      explanation: `Exact question disposition ${question.status} and persisted ${world.role} roster disposition ${participant.status}.`,
    }};
    const accepted = await verify(report);
    const rejectedAlteredEvidence = !(await verify({...report, outcome: {...report.outcome, historyReceipt:"foreign"}})).passed &&
      !(await verify({...report, outcome: {...report.outcome, disposition:disposition === "ready" ? "hold" : "ready"}})).passed &&
      !(await verify({...report, outcome: {...report.outcome, question:{...question, message:question.message === null ? native.messages[0] ?? {} : {...question.message, sequence:question.message.sequence + 1}}}})).passed &&
      !(await verify({...report, outcome: {...report.outcome, participant:{...participant, member:participant.member === null ? observedRoster.members[0] ?? {} : {...participant.member,participantId:"same-display-foreign-id"}}}})).passed;
    return {...accepted, report, rejectedForeignReceipt, rejectedAlteredEvidence,
      passed:accepted.passed && rejectedForeignReceipt && rejectedAlteredEvidence};
  }

  return {services, verify, qualify};
}

type Ports = {
  runtime: Pick<typeof runtime, "createEntity" | "retireEntity">;
  rpc: typeof rpc;
  readers?: Readers;
  driveOwnObservation?: () => Promise<void>;
};

export async function prepareOpenGadDurableQuestion(
  contextId: string, world: GadReviewWorld, ports: Ports = {runtime,rpc},
) {
  const { runtime, rpc, readers = gad, driveOwnObservation } = ports;
  const fixtureId = crypto.randomUUID();
  const channelId = `gad-question-${fixtureId}`;
  const issued: string[] = [];
  const roster: NativeMember[] = [];
  const published: { messageId: string; id?: number }[] = [];
  async function create(source: string, className: string, key: string) {
    const handle = await runtime.createEntity({kind: "do", execution: { surface: "code", source }, className, key, contextId});
    if (handle.kind !== "do" || handle.contextId !== contextId) throw new Error("Durable review requires an owned local entity");
    issued.push(handle.id);
    return handle;
  }
  async function close() {
    const errors: unknown[] = [];
    while (issued.length) {
      try { await runtime.retireEntity({id: issued.pop()!}); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Owned durable question cleanup failed");
  }
  try {
    const channel = await create(channelSource, channelClass, channelId);
    await rpc.call(channel.targetId, channelClientRpcMethods.initializeConversation, [contextId, {title:"Owned durable question review"}]);
    for (const [index, person] of world.participants.entries()) {
      const peer = await create(fixtureSource, "LocalMessagingProbeDO", `question-peer-${fixtureId}-${index}`);
      const joined = await rpc.call(peer.targetId, localMessagingFixtureMethods.configure, [{
        contextId, fixtureId, channelId, channelTargetId:channel.targetId,
        channelRef:{ source:channelSource, className:channelClass, objectKey:channelId }, handle:person.handle, name:person.name,
      }]);
      if (joined.participantId !== peer.id) throw new Error("Participant did not join under its bound identity");
      if (person.retired) await rpc.call(peer.targetId, localMessagingFixtureMethods.leaveOwnedRoster, [joined.revision]);
      roster.push({participantId:peer.id, handle:person.handle, displayName:person.name, inactive:!!person.retired});
    }
    // The native caller relay stamps the verified sender but does not add a roster member.
    for (const [index, text] of world.messages.entries()) {
      published.push(await rpc.call(channel.targetId, channelClientRpcMethods.sendAsCaller, [text, {
        idempotencyKey:`review-${fixtureId}-${index}`,
      }]));
    }
    async function readNative(): Promise<NativeState> {
      const events: ChannelEvent[] = [];
      for await (const page of iterateChannelReplayAfterPages(
        request => rpc.call(channel.targetId, channelRpcMethods.getReplayAfter, [request]), {after:0},
      )) events.push(...page.logEvents);
      const messages = canonicalUserRecords(events);
      const active = (await rpc.call(channel.targetId, channelClientRpcMethods.getParticipants, []))
        .map(row => row.participantId);
      if (!isDeepStrictEqual(published.map(row => [row.messageId,row.id]), messages.map(row => [row.messageId,row.sequence])))
        throw new Error("Native replay differs from the individual published message receipts");
      return {messages, roster, active};
    }
    const native = await readNative();
    await driveOwnObservation?.();
    // Native replay leads the workspace GAD projection through its observation queue.
    // Establish the assigned fixture frontier before handing the read-only scope to the model.
    await waitFor(async () => {
      const boundary = await readers.readChannelEnvelopes({channelId, limit:0, payloadKind:agenticEventKind});
      const members = await readers.inspectChannelRoster({channelId, limit:24});
      return (boundary.pageInfo.lastSeq ?? null) === (native.messages.at(-1)?.sequence ?? null) &&
        boundary.pageInfo.totalCount === native.messages.length &&
        members.rows.length === roster.length &&
        roster.every(expected => members.rows.some(row => row.participant_id === expected.participantId &&
          (row.left_at !== null) === expected.inactive)) ? true : undefined;
    }, {label:"owned GAD projection frontier",timeoutMs:20000,intervalMs:100});
    return {...bindOpenGadDurableQuestion(contextId,channelId,world,readNative,readers),close};
  } catch (error) {
    try { await close(); }
    catch (cleanup) { throw new AggregateError([error,cleanup], "Durable question setup and cleanup failed"); }
    throw error;
  }
}
