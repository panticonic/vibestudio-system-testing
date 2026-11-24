import {assessSemanticOutcome} from "./semantic-outcome-contract.js";
import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import {referenceObserver} from "./observer-slot-control.js";
import type {InvocationObservations} from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { createMissionsClient, type MissionRpc } from "@vibestudio/service-schemas/clients/missionsClient";
import { MISSION_REVISION_CHANGED, missionRevisionDigest } from "@vibestudio/automation/mission";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { contextId as activeContext, rpc } from "@workspace/runtime";
import type { Change, DecisionRecord, Lane, Receipt, Resolution, Schedule, ScheduledOutcome, Submission } from
  "@workspace-skills/open-owned-scheduled-recovery/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readScheduledLaneReceipts } from "./scheduled-recovery-replay.js";
import type { ScheduledRecoveryWorld } from "./open-goal-scheduled-recovery-worlds.js";

type Missions = ReturnType<typeof createMissionsClient>;
type Mission = NonNullable<Awaited<ReturnType<Missions["get"]>>>;
type NativeChannel = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
type OwnedItem = { key: "primary" | "neighbor" | "prerequisite"; suffix: string; record: Mission };
type MissionSeed = { defaultMission: Mission; items: OwnedItem[] };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Retained = { lane: Lane; native: NativeChannel; baseline: Receipt[] };
type NativeOutcome = { schedule: string; authorization: string; digest: string; state: string; minutes: number; maxRuns: number | null };
const minute = 60_000;
const futureHorizon = 45 * 24 * 60 * minute;
const defaultId = "workspace-updates";
const peerRevisionSummary = "A later owner edit retained the original cadence pending a fresh review.";

function interval(record: Mission) {
  const trigger = record.charter.trigger;
  if (trigger.kind !== "schedule" || trigger.anchorAt === undefined || trigger.anchorAt < Date.now() + futureHorizon / 2 ||
      trigger.jitterMs !== undefined || trigger.untilAt !== undefined || record.runCount !== 0 ||
      (record.state !== "paused" && record.state !== "active"))
    throw new Error("Expected an owned future interval with no runs");
  return trigger;
}

function stable(record: Mission) {
  const { missionId, name, owner, authorityPlan, charter, revision, revisionDigest, state, nextRunAt } = record;
  return { missionId, name, owner, authorityPlan, charter, revision, revisionDigest, state, nextRunAt };
}

async function readOwnedIdentity(missions: Missions, item: OwnedItem) {
  const live = await missions.get(item.record.missionId);
  if (!live || live.name !== item.record.name || live.owner.userId !== item.record.owner.userId ||
      !isDeepStrictEqual(live.authorityPlan, item.record.authorityPlan))
    throw new Error("Schedule left the owned fixture scope");
  return live;
}

async function readOwned(missions: Missions, item: OwnedItem) {
  const live = await readOwnedIdentity(missions, item);
  interval(live);
  return live;
}

export async function closeOwnedScheduledRecovery(rpc: MissionRpc, items: readonly OwnedItem[]) {
  const missions = createMissionsClient(rpc);
  const outcomes = await Promise.allSettled(items.map(async item => {
    const live = await readOwnedIdentity(missions, item);
    if (live.state === "active")
      await missions.transitionAtRevision(live.missionId, "pause", live.revisionDigest);
  }));
  const errors = outcomes.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors, "Could not pause every owned future schedule");
}

/** Run with the installed System Testing worker's durable mission launch authority. */
export async function seedOwnedScheduledRecovery(rpc: MissionRpc, world: ScheduledRecoveryWorld): Promise<MissionSeed> {
  const missions = createMissionsClient(rpc);
  const defaultMission = await missions.getDefault(defaultId);
  if (!defaultMission) throw new Error("The installed workspace default could not be independently read");
  const anchorAt = Date.now() + futureHorizon;
  const namespace = crypto.randomUUID().slice(0, 12);
  const items: OwnedItem[] = [];
  const definitions = [
    { key: "primary", title: world.title, group: world.group, state: world.initial, minutes: world.minutes, cap: world.cap },
    { key: "neighbor", title: world.title, group: world.group + " archive desk", state: "paused", minutes: 150 },
    { key: "prerequisite", title: world.dependency, group: world.group, state: world.dependencyState, minutes: 240 },
  ] as const;
  try {
    for (const spec of definitions) {
      const suffix = ` [${namespace}-${spec.key}]`;
      const record = await missions.launch({
        name: spec.title + suffix,
        charter: {
          ...defaultMission.charter, summary: "Owned scheduled continuity exercise for " + spec.group,
          trigger: {
            kind: "schedule", everyMs: spec.minutes * minute, anchorAt,
            ...("cap" in spec && spec.cap !== undefined ? { maxRuns: spec.cap } : {}),
          },
        },
      });
      const item = { key: spec.key, suffix, record };
      items.push(item);
      if (record.owner.userId !== defaultMission.owner.userId || interval(record).anchorAt !== anchorAt ||
          record.nextRunAt !== anchorAt)
        throw new Error("The scheduled fixture did not adopt the expected owned future anchor");
      if (spec.state === "paused")
        item.record = await missions.transitionAtRevision(record.missionId, "pause", record.revisionDigest);
    }
  } catch (error) {
    try {
      await closeOwnedScheduledRecovery(rpc, items);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Owned schedule setup and cleanup both failed");
    }
    throw error;
  }
  return { defaultMission, items };
}

async function replay(input: { contextId: string }, native: NativeChannel, transport = rpc): Promise<Receipt[]> {
  const page = await transport.call(native.target, channelClientRpcMethods.getReplayAfter, [{ after: 0, limit: 100 }]);
  return readScheduledLaneReceipts(page, input.contextId, native.key, transport.selfId);
}

function changeMatches(schedule: Schedule, change: Change) {
  if (change.kind === "cadence") return schedule.minutes === change.minutes;
  if (change.kind === "cap") return schedule.maxRuns === change.maxRuns;
  if (change.kind === "window") return schedule.minutes === change.minutes && schedule.maxRuns === change.maxRuns;
  return schedule.state === (change.kind === "pause" ? "paused" : "active");
}

function revisedTrigger(record: Mission, change: Change) {
  const trigger = interval(record);
  if (change.kind === "cadence") return { ...trigger, everyMs: change.minutes * minute };
  if (change.kind === "cap") return { ...trigger, maxRuns: change.maxRuns };
  if (change.kind === "window") return { ...trigger, everyMs: change.minutes * minute, maxRuns: change.maxRuns };
  return trigger;
}

function handoffBody(attemptId: string, schedule: Schedule, authorization: Receipt) {
  const outcome: NativeOutcome = {
    schedule: schedule.id, authorization: authorization.messageId, digest: schedule.digest,
    state: schedule.state, minutes: schedule.minutes, maxRuns: schedule.maxRuns,
  };
  return JSON.stringify({ type: "scheduled-recovery-handoff/v1", attemptId, outcome });
}

export async function prepareOwnedScheduledRecovery(
  input: { contextId: string; caseId: string }, world: ScheduledRecoveryWorld, seed: MissionSeed,
  drivers = { activeContext, rpc, createOwnedHeadlessChannel, withOwnedChannelClient },
) {
  if (input.contextId !== drivers.activeContext || input.caseId !== world.id)
    throw new Error("Scheduled recovery requires the assigned owned context");
  const missions = createMissionsClient(drivers.rpc);
  const owned = new Map(seed.items.map(item => [item.record.missionId, item]));
  const primary = seed.items.find(item => item.key === "primary")!;
  const neighbor = seed.items.find(item => item.key === "neighbor")!;
  const prerequisite = seed.items.find(item => item.key === "prerequisite")!;
  for (const item of seed.items) {
    if (!isDeepStrictEqual(stable(await readOwned(missions, item)), stable(item.record)))
      throw new Error("A seeded schedule changed before starting recovery");
  }

  function snapshot(item: OwnedItem, live: Mission): Schedule {
    const trigger = interval(live);
    return {
      id: live.missionId, title: live.name.slice(0, -item.suffix.length), owner: live.owner.userId,
      group: item.key === "neighbor" ? world.group + " archive desk" : world.group,
      state: live.state as Schedule["state"], revision: live.revision, digest: live.revisionDigest,
      minutes: trigger.everyMs / minute, maxRuns: trigger.maxRuns ?? null, anchorAt: trigger.anchorAt!,
      nextRunAt: live.nextRunAt ?? null,
    };
  }

  const retained = new Map<Lane["role"], Retained>();
  for (const [role, title] of [
    ["decision", world.group + " current decision"], ["archive", world.group + " prior shift"], ["handoff", world.destination],
  ] as const) {
    const native = await drivers.createOwnedHeadlessChannel(input.contextId, title);
    retained.set(role, { lane: { id: native.key, title, role }, native, baseline: [] });
  }
  const decision = retained.get("decision")!;
  const destination = retained.get("handoff")!;
  const seeded = world.entries.map((entry, index) => {
    const item = entry.bind === "other-schedule" ? neighbor : primary;
    const digest = item.record.revisionDigest;
    const record: DecisionRecord = {
      disposition: entry.disposition, schedule: item.record.missionId,
      owner: entry.bind === "other-owner" ? item.record.owner.userId + "-previous" : item.record.owner.userId,
      digest: entry.bind === "prior-revision" ? (digest[0] === "a" ? "b" : "a") + digest.slice(1) : digest,
      change: entry.change,
      ...(entry.prerequisite ? { prerequisite: { schedule: prerequisite.record.missionId, state: entry.prerequisite } } : {}),
      ...(entry.handoff ? { destination: destination.lane.id } : {}),
    };
    return { index, role: entry.lane, record, text: JSON.stringify(record) };
  });
  const originals: { record: DecisionRecord; receipt: Receipt }[] = [];
  for (const role of ["decision", "archive"] as const) {
    const lane = retained.get(role)!;
    const ordered = seeded.filter(entry => entry.role === role);
    if (!ordered.length) continue;
    const acknowledged = await drivers.withOwnedChannelClient(lane.native, input.contextId, async client => {
      const ids: string[] = [];
      for (const entry of ordered)
        ids.push(await client.send(entry.text, { idempotencyKey: "decision-" + entry.index }));
      return ids;
    });
    lane.baseline = await replay(input, lane.native, drivers.rpc);
    if (lane.baseline.length !== ordered.length)
      throw new Error("The retained decision lane does not match the authored history");
    for (const [position, entry] of ordered.entries()) {
      const receipt = lane.baseline[position];
      if (!receipt || receipt.messageId !== acknowledged[position] || receipt.text !== entry.text)
        throw new Error("Could not read back the acknowledged retained decision");
      originals[entry.index] = { record: entry.record, receipt };
    }
  }
  // An older note in the recipient lane must never be mistaken for this operation's receipt.
  const priorHandoff = JSON.stringify({ type: "scheduled-recovery-handoff/v1", attemptId: "previous-shift" });
  const priorId = await drivers.withOwnedChannelClient(destination.native, input.contextId,
    client => client.send(priorHandoff, { idempotencyKey: "previous-shift" }));
  destination.baseline = await replay(input, destination.native, drivers.rpc);
  if (destination.baseline.length !== 1 || destination.baseline[0]?.messageId !== priorId)
    throw new Error("Could not establish the previous locally retained handoff");

  const effects: Effect[] = [];
  const observed = new Map<string, Schedule>();
  const readLanes = new Set<string>();
  let raced = false;
  let nativeRevisionConflict = false;
  let committed = false;
  let currentChange = false;
  let sent: { attempt: Submission; messageId: string; text: string } | undefined;
  const effect = <T>(service: string, method: string, args: unknown[], result: T): T => {
    effects.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };

  function itemById(id: string) {
    const item = owned.get(id);
    if (!item) throw new Error("Schedule is outside this owned context");
    return item;
  }

  async function approval(schedule: Schedule, receipt: Receipt, change?: Change) {
    const retainedDecision = (await replay(input, decision.native, drivers.rpc)).flatMap(row => {
      const original = originals.find(entry => isDeepStrictEqual(entry.receipt, row));
      return original?.record?.schedule === schedule.id ? [original] : [];
    }).at(-1);
    if (!readLanes.has(decision.lane.id) || !isDeepStrictEqual(retainedDecision?.receipt, receipt) ||
        retainedDecision?.record?.disposition !== "approved" || retainedDecision.record.owner !== schedule.owner ||
        retainedDecision.record.digest !== schedule.digest || (change && !isDeepStrictEqual(retainedDecision.record.change, change)))
      return null;
    return retainedDecision.record;
  }

  async function dependencyReady(record: DecisionRecord) {
    if (!record.prerequisite) return true;
    const item = itemById(record.prerequisite.schedule);
    const live = snapshot(item, await readOwned(missions, item));
    return observed.get(item.record.missionId)?.state === record.prerequisite.state && live.state === record.prerequisite.state;
  }

  const services = {
    scheduledMission: {
      async discover() {
        const choices = await Promise.all(seed.items.map(async item => snapshot(item, await readOwned(missions, item))));
        choices.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
        return effect("scheduledMission", "discover", [], choices);
      },
      async observe(id: string) {

        const item = itemById(id);
        const current = snapshot(item, await readOwned(missions, item));
        observed.set(id, current);
        return effect("scheduledMission", "observe", [id], current);
      },
      async change(schedule: Schedule, change: Change, authorization: Receipt): Promise<Resolution> {
        if (world.readOnly || currentChange || schedule.id !== primary.record.missionId ||
            !isDeepStrictEqual(observed.get(schedule.id), schedule))
          throw new Error("Expected one change using the exact observed owned schedule");
        currentChange = true;
        try {
          const record = await approval(schedule, authorization, change);
          let live = await readOwned(missions, primary);
          const finish = (status: Resolution["status"]) => effect("scheduledMission", "change", [schedule, change, authorization],
            { status, current: snapshot(primary, live) });
          if (!record) return finish("held");
          if (!isDeepStrictEqual(snapshot(primary, live), schedule)) return finish("changed");
          if (!await dependencyReady(record)) return finish("held");
          if (changeMatches(schedule, change)) return finish("unchanged");
          if (!raced && world.interruption === "dependency") {
            raced = true;
            const peer = await readOwned(missions, prerequisite);
            await missions.transitionAtRevision(peer.missionId, "pause", peer.revisionDigest);
          }
          if (!await dependencyReady(record)) return finish("held");
          live = await readOwned(missions, primary);
          if (!isDeepStrictEqual(snapshot(primary, live), schedule)) return finish("changed");
          if (committed) throw new Error("An owned change already committed");
          if (!raced && world.interruption === "schedule-revision") {
            await missions.edit(live.missionId, {
              charter: { ...live.charter, summary: peerRevisionSummary },
              expectedRevision: schedule.revision,
            }, { idempotencyKey: "peer-" + authorization.messageId });
            raced = true;
          }
          try {
            if (change.kind === "pause" || change.kind === "resume") {
              live = await missions.transitionAtRevision(live.missionId, change.kind, schedule.digest);
            } else {
              live = await missions.edit(live.missionId, {
                charter: { ...live.charter, trigger: revisedTrigger(live, change) },
                expectedRevision: schedule.revision,
              }, { idempotencyKey: "owner-" + authorization.messageId });
            }
          } catch (error) {
            if (!error || typeof error !== "object" || !("code" in error) ||
                error.code !== MISSION_REVISION_CHANGED) throw error;
            nativeRevisionConflict = true;
            live = await readOwned(missions, primary);
            return finish("changed");
          }
          committed = true;
          return finish("applied");
        } finally {
          currentChange = false;
        }
      },
    },
    scheduledHistory: {
      async discover() {
        return effect("scheduledHistory", "discover", [], [...retained.values()].map(item => item.lane));
      },
      async read(lane: string) {
        const item = [...retained.values()].find(entry => entry.lane.id === lane);
        if (!item) throw new Error("Conversation is outside this owned context");
        const rows = await replay(input, item.native, drivers.rpc);
        readLanes.add(lane);
        return effect("scheduledHistory", "read", [lane], rows);
      },
    },
    scheduledHandoff: {
      async submit(schedule: Schedule, authorization: Receipt, lane: Lane): Promise<Submission> {
        if (world.readOnly || !isDeepStrictEqual(lane, destination.lane) || !isDeepStrictEqual(observed.get(schedule.id), schedule) ||
            schedule.id !== primary.record.missionId)
          throw new Error("Handoff requires the exact observed schedule and owned destination");
        const live = snapshot(primary, await readOwned(missions, primary));
        const original = snapshot(primary, primary.record);
        const record = await approval(original, authorization);
        if (!record || record.destination !== lane.id || !await dependencyReady(record) ||
            !changeMatches(live, record.change) || !isDeepStrictEqual(live, schedule) ||
            (original.digest !== live.digest && !committed))
          throw new Error("Handoff no longer matches the approved schedule and destination");
        // A stable key preserves the original note if the caller repeats after a lost response.
        const attemptId = schedule.id + ":" + authorization.messageId;
        const text = handoffBody(attemptId, schedule, authorization);
        const messageId = await drivers.withOwnedChannelClient(destination.native, input.contextId,
          client => client.send(text, { idempotencyKey: attemptId }));
        const attempt = { attemptId, response: world.interruption === "delivery" ? "interrupted" : "recorded" } as const;
        if (sent && (sent.messageId !== messageId || sent.text !== text))
          throw new Error("Durable retry returned a different handoff");
        sent = { attempt, messageId, text };
        return effect("scheduledHandoff", "submit", [schedule, authorization, lane], attempt);
      },
      async read(submission: Submission) {
        const rows = await replay(input, destination.native, drivers.rpc);
        const matched = isDeepStrictEqual(submission, sent?.attempt)
          ? rows.find(row => row.messageId === sent?.messageId && row.text === sent.text) ?? null : null;
        return effect("scheduledHandoff", "read", [submission], matched);
      },
    },
  };

  async function verifyEvidence(value: unknown, controls?: { foreignSchedule: boolean; wrongAttempt: boolean }, invocation?:InvocationObservations) {
    const report = value as ScheduledOutcome | null;
    const outcome = report;
    const results = await Promise.all(seed.items.map(item => readOwned(missions, item)));
    const nativeRuns = await Promise.all(seed.items.map(item => missions.listRuns(item.record.missionId, { limit: 1 })));
    const defaultMission = await missions.getDefault(defaultId);
    const byKey = new Map(seed.items.map((item, index) => [item.key, results[index]!]));
    const nativeCurrent = byKey.get("primary")!;
    const current = snapshot(primary, nativeCurrent);
    const nativeLanes = await Promise.all([...retained.values()].map(async item => ({
      item, rows: await replay(input, item.native, drivers.rpc),
    })));
    const afterDestination = nativeLanes.find(({ item }) => item.lane.role === "handoff")!.rows;
    const historyPreserved = nativeLanes.every(({ item, rows }) => item.lane.role === "handoff"
      ? isDeepStrictEqual(rows.slice(0, item.baseline.length), item.baseline) : isDeepStrictEqual(rows, item.baseline));
    const authorization = world.expected.entry === null ? null : originals[world.expected.entry]?.receipt ?? null;
    const delivery = world.expected.handoff && afterDestination.length === destination.baseline.length + 1
      ? afterDestination.at(-1)! : null;
    const successors = effects.filter(entry => entry.service === "scheduledMission" && entry.method === "change")
      .map(entry => entry.result as Resolution);
    const applied = successors.filter(entry => entry.status === "applied");
    const lastWrite = effects.findIndex(entry => entry.service === "scheduledMission" && entry.method === "change");
    const confirmed = effects.some((entry, index) => index > lastWrite &&
      entry.service === "scheduledMission" && entry.method === "observe" && isDeepStrictEqual(entry.result, current));
    const wantedChange = world.expected.effect;
    let wantedCharter = primary.record.charter;
    let wantedRevision = primary.record.revision;
    let wantedState = primary.record.state;
    if (wantedChange && ("minutes" in wantedChange || "maxRuns" in wantedChange)) {
      wantedCharter = { ...wantedCharter, trigger: revisedTrigger(primary.record, wantedChange) };
      wantedRevision++;
    }
    if (wantedChange?.kind === "pause" || wantedChange?.kind === "resume")
      wantedState = wantedChange.kind === "pause" ? "paused" : "active";
    if (world.interruption === "schedule-revision") {
      wantedCharter = { ...wantedCharter, summary: peerRevisionSummary };
      wantedRevision++;
    }
    const wantedPrimary = {
      ...stable(primary.record), charter: wantedCharter, revision: wantedRevision, state: wantedState,
      nextRunAt: wantedState === "active" ? interval(primary.record).anchorAt : undefined,
      revisionDigest: missionRevisionDigest(wantedCharter, primary.record.authorityPlan.digest),
    };
    const wantedPrerequisite = world.interruption === "dependency" ? {
      ...stable(prerequisite.record), state: "paused", nextRunAt: undefined,
    } : stable(prerequisite.record);
    const sameDefault = defaultMission && {
      missionId: defaultMission.missionId, charter: defaultMission.charter, state: defaultMission.state,
      digest: defaultMission.revisionDigest, owner: defaultMission.owner, name: defaultMission.name,
    };
    const originalDefault = {
      missionId: seed.defaultMission.missionId, charter: seed.defaultMission.charter, state: seed.defaultMission.state,
      digest: seed.defaultMission.revisionDigest, owner: seed.defaultMission.owner, name: seed.defaultMission.name,
    };
    const nativeHandoff = Boolean(delivery && authorization &&
      delivery.text === handoffBody(current.id + ":" + authorization.messageId, current, authorization) &&
      effects.some(entry => entry.service === "scheduledHandoff" && entry.method === "read" && isDeepStrictEqual(entry.result, delivery)));
    const scopeReadback = readLanes.has(decision.lane.id) && readLanes.has(retained.get("archive")!.lane.id);
    const expectedRace = world.interruption === "schedule-revision" || world.interruption === "dependency";
    const reason = typeof outcome?.reason === "string" ? outcome.reason.toLowerCase() : "";
    const checks = {
      discoveredExactOwnedSchedule: confirmed && isDeepStrictEqual(observed.get(current.id), current),
      joinedRetainedOwnerDecision: scopeReadback && historyPreserved,
      verifiedExactNativeSchedule: isDeepStrictEqual(stable(nativeCurrent), wantedPrimary) &&
        applied.length === (wantedChange ? 1 : 0),
      protectedPeersAndDefault: isDeepStrictEqual(stable(byKey.get("neighbor")!), stable(neighbor.record)) &&
        isDeepStrictEqual(stable(byKey.get("prerequisite")!), wantedPrerequisite) && isDeepStrictEqual(sameDefault, originalDefault),
      neverAdmittedFixtureRuns: nativeRuns.every(runs => runs.items.length === 0),
      honoredCurrentRevisionAndDependencies: raced === expectedRace &&
        nativeRevisionConflict === (world.interruption === "schedule-revision") &&
        (!expectedRace || successors.some(
        entry => entry.status === (world.interruption === "dependency" ? "held" : "changed"))) &&
        (!originals[world.expected.entry ?? -1]?.record?.prerequisite || observed.has(prerequisite.record.missionId)) &&
        (world.interruption !== "dependency" || observed.get(prerequisite.record.missionId)?.state === "paused"),
      independentlyRecoveredLocalHandoff: (world.expected.handoff ? nativeHandoff :
          effects.every(entry => entry.service !== "scheduledHandoff" || entry.method !== "submit") &&
          afterDestination.length === destination.baseline.length),
      exactScheduledRecoveryReport: isDeepStrictEqual(outcome?.delivery,delivery)&&isDeepStrictEqual(outcome?.authorization,authorization)&&Boolean(reason) && world.expected.reason.every(term => reason.includes(term)) &&
        isDeepStrictEqual(outcome?.schedule, current),
      ...(controls ? { rejectedForeignScheduleAndWrongAttempt: controls.foreignSchedule && controls.wrongAttempt } : {}),
    };
    return assessObservedApplicationOutcome({ contextId: input.contextId, caseId: input.caseId, goal: world.goal, checks,
      passed: Object.values(checks).every(Boolean), current, authorization, delivery, effects },{effects:{checks:[...["discoveredExactOwnedSchedule","joinedRetainedOwnerDecision","verifiedExactNativeSchedule","protectedPeersAndDefault","neverAdmittedFixtureRuns","honoredCurrentRevisionAndDependencies","independentlyRecoveredLocalHandoff"],...(controls?["rejectedForeignScheduleAndWrongAttempt"]:[])],rationale:"Actual native observations, captured operations, protected state and persisted artifact bytes establish the requested effects independently of public copies."},returnedValue:{checks:["exactScheduledRecoveryReport"],required:!world.expected.effect&&!world.expected.handoff,rationale:"The requested domain answer is required; a redundant returned copy is optional after a requested native mutation or artifact is established."},incidentalValues:{checks:[],rationale:"Wrong optional returned receipts are masked with their actual hash-checked invocation definition and value."}},value,invocation);
  }

  async function qualify() {
    await services.scheduledMission.discover();
    let foreignSchedule = false;
    try { await services.scheduledMission.observe("foreign-mission"); } catch { foreignSchedule = true; }
    const wrongAttempt = await services.scheduledHandoff.read({ attemptId: "previous-shift", response: "recorded" }) === null;
    for (const lane of await services.scheduledHistory.discover()) await services.scheduledHistory.read(lane.id);
    const before = await services.scheduledMission.observe(primary.record.missionId);
    await services.scheduledMission.observe(prerequisite.record.missionId);
    const applicable = originals.filter(({ receipt, record }) => receipt.lane === decision.lane.id && record.schedule === before.id).at(-1);
    if ((world.expected.effect || world.interruption === "schedule-revision" || world.interruption === "dependency") && applicable)
      await services.scheduledMission.change(before, applicable.record.change, applicable.receipt);
    const schedule = await services.scheduledMission.observe(before.id);
    await services.scheduledMission.observe(prerequisite.record.missionId);
    const authorization = world.expected.entry === null ? null : originals[world.expected.entry]!.receipt;
    let delivery: Receipt | null = null;
    if (world.expected.handoff && authorization) {
      const submission = await services.scheduledHandoff.submit(schedule, authorization, destination.lane);
      delivery = await services.scheduledHandoff.read(submission);
      if (submission.response === "interrupted") {
        const original = await services.scheduledHandoff.submit(schedule, authorization, destination.lane);
        if (!isDeepStrictEqual(original, submission) || !isDeepStrictEqual(await services.scheduledHandoff.read(original), delivery))
          throw new Error("An interrupted response could not recover its original idempotent handoff");
      }
    }
    const outcome = { schedule, authorization, delivery,
      reason: world.expected.reason.join(" ") || "Current owned schedule independently confirmed" };
    const proof=await verifyEvidence(outcome,{foreignSchedule,wrongAttempt});
    const observerSlotValidated=(await verify(outcome,referenceObserver(outcome))).passed;
    const checks={...proof.observedChecks,observerSlotValidated};
    return assessSemanticOutcome({...proof,checks,observerSlotValidated},{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"observerSlotValidated"]}});
  }
  async function verify(value:unknown,invocation?:InvocationObservations){return verifyEvidence(value,undefined,invocation);}
    return { goal: world.goal, services, verify, qualify };
}
