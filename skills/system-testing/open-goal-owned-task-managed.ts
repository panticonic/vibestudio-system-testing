import {assessObservedApplicationOutcome} from "./observed-application-outcome.js";
import {assessSemanticOutcome} from "./semantic-outcome-contract.js";
import {referenceObserver} from "./observer-slot-control.js";
import type {InvocationObservations} from "./observed-invocation.js";
import { isDeepStrictEqual } from "node:util";
import { contextId as activeContext, rpc, runtime } from "@workspace/runtime";
import { prepareOpenLocalDelivery } from "./open-goal-local-delivery-managed.js";
import type { OpenLocalDeliveryWorld } from "./open-goal-local-delivery-worlds.js";
import type { AttemptRecord, BoardStatus, OwnedTaskWorld } from "./open-goal-owned-task-worlds.js";

type Task = {
  id: string; title: string; status: BoardStatus; revision: number; description: string;
  dependencies: string[]; updatedAt: number;
};
type TaskPort = {
  call(method: "createProject", input: { name: string; repos: string[] }): Promise<{ id: string; name: string }>;
  call(method: "createTask", input: {
    projectId: string; title: string; status: BoardStatus; description?: string; dependencies?: string[];
    historyMode?: "conversation"; checklist?: { id: string; text: string; done: boolean }[];
  }): Promise<Task>;
  call(method: "updateTask", input: { id: string; expectedRevision: number; changes: { status?: BoardStatus; description?: string } }): Promise<Task>;
  call(method: "getTask", input: { id: string }): Promise<Task>;
};
type LocalDelivery = Awaited<ReturnType<typeof prepareOpenLocalDelivery>>;
type LocalView = Awaited<ReturnType<LocalDelivery["services"]["localDeliveryHistory"]["inspect"]>>;
type Handoff = {
  attempt: Awaited<ReturnType<LocalDelivery["services"]["localDeliverySend"]["submit"]>>;
  readback: Awaited<ReturnType<LocalDelivery["services"]["localDeliveryReadback"]["read"]>>;
};
type Receipt = NonNullable<LocalView["prior"]>;
type BoundAttempt = AttemptRecord & { taskId: string };
type Lane = { lane: LocalView["room"]; basis: string; owner: string | null; receipt: Receipt | null; record: BoundAttempt | null };
type Effect = { service: string; method: string; args: unknown[]; result: unknown };
type Outcome = { task?: string; revision?: number; status?: BoardStatus; original?: Receipt | null; delivery?: Handoff | null; reason?: string };
type TaskAssignment = Omit<AttemptRecord, "phase">;
const stableTask = ({ updatedAt: _updatedAt, ...task }: Task) => task;
const phase = new Set(["failed", "cancelled", "draft", "ready", "accepted"]);
const userEditable = new Set<BoardStatus>(["ready", "review", "done"]);

function parseRecord(receipt: Receipt | null): BoundAttempt | null {
  if (!receipt?.acknowledged) return null;
  try {
    const body = JSON.parse(receipt.content) as BoundAttempt;
    if ([body.taskId, body.task, body.owner, body.attempt, body.artifact].every(field => typeof field === "string" && field.length > 0) &&
        phase.has(body.phase)) return body;
  } catch {}
  return null;
}

export async function prepareOwnedTaskRecovery(
  input: { contextId: string; caseId: string }, world: OwnedTaskWorld, store: TaskPort,
  dependencies = { activeContext, runtime, rpc, prepareOpenLocalDelivery },
) {
  const { contextId, caseId } = input;
  if (!contextId || contextId !== dependencies.activeContext || caseId !== world.id)
    throw new Error("Task recovery requires an owned Personal workspace context");
  const project = await store.call("createProject", { name: world.project, repos: [] });
  const archive = await store.call("createProject", { name: world.project + " history", repos: [] });
  const prerequisites: Task[] = [];
  for (const requires of world.requires)
    prerequisites.push(await store.call("createTask", { projectId: project.id, title: requires.title, status: requires.status }));
  const primary = await store.call("createTask", {
    projectId: project.id, title: world.assignment.task, status: world.initial, dependencies: prerequisites.map(task => task.id),
    description: JSON.stringify(world.assignment), historyMode: "conversation",
    checklist: [{ id: "scope", text: "Preserve the registered work scope", done: false }],
  });
  const oldCard = await store.call("createTask", {
    projectId: archive.id, title: world.assignment.task, status: "review",
    description: JSON.stringify({ ...world.assignment, owner: world.assignment.owner + "-archive", attempt: "archived-" + world.assignment.attempt }),
  });
  const options = [{ id: primary.id, project: project.name, title: primary.title }, { id: oldCard.id, project: archive.name, title: oldCard.title }]
    .sort((left, right) => left.id.localeCompare(right.id));
  const allowedReads = new Map(world.lanes.map(lane => [lane.key, lane.inspectRecipient ?? (lane.deliver ? lane.recipient : null)]));
  const expectedDestination = world.lanes.find(lane => lane.key === world.expected.handoff);
  const handoffSpec = expectedDestination ? {
    room: expectedDestination.key, recipient: expectedDestination.recipient,
    facts: [world.assignment.attempt, world.assignment.artifact],
  } : undefined;
  const localWorld: OpenLocalDeliveryWorld = {
    id: caseId, goal: world.goal, kind: "local-delivery", workspace: "system", sourceGroup: world.sourceGroup,
    rooms: world.lanes.map(lane => ({
      key: lane.key, title: lane.title, maySend: Boolean(lane.deliver),
      participants: [[lane.recipient, lane.recipient.replaceAll("-", " ")], ...(lane.extra ? [lane.extra] : [])],
      ...(lane.record ? { prior: { to: lane.recipient, content: JSON.stringify({ ...lane.record, taskId: lane.recordScope === "archive" ? oldCard.id : primary.id }) } } : {}),
      ...(lane.interrupted ? { lostAcknowledgement: true } : {}),
    })),
    expected: {
      reads: Object.fromEntries(allowedReads), evidence: world.lanes.filter(lane => lane.record).map(lane => lane.key),
      status: handoffSpec ? "delivered" : "held", ...(handoffSpec ? { send: handoffSpec } : {}),
    },
  };
  const local = await dependencies.prepareOpenLocalDelivery(input, localWorld, { runtime: dependencies.runtime, rpc: dependencies.rpc });
  const effects: Effect[] = [];
  const matched = new Map<string, Lane>();
  const observedBoard = new Map<string, Awaited<ReturnType<typeof taskView>>>();
  const observeNative = (id: string) => store.call("getTask", { id });
  let rooms: Awaited<ReturnType<LocalDelivery["services"]["localDeliveryCatalog"]["discover"]>> = [];
  let raceInjected = false;
  let moving = false;

  const record = <T>(service: string, method: string, args: unknown[], result: T) => {
    effects.push({ service, method, args, result: structuredClone(result) });
    return result;
  };
  async function taskView(id: string) {
    const task = options.find(option => option.id === id);
    if (!task) throw new Error("Task card is outside the assigned board");
    const native = await observeNative(id);
    const assignment = JSON.parse(native.description) as TaskAssignment;
    const needs = await Promise.all(native.dependencies.map(observeNative));
    return {
      task, status: native.status, revision: native.revision,
      owner: assignment.owner, attempt: assignment.attempt, artifact: assignment.artifact, work: assignment.task,
      allowed: id === primary.id ? [...world.allowed] : [],
      prerequisites: needs.map(({ title, status, revision }) => ({ title, status, revision })),
    };
  }
  async function injectRace() {
    if (raceInjected || !world.race) return false;
    const race = world.race;
    if (race.field === "prerequisite") {
      const saved = prerequisites.find(task => task.title === race.title);
      if (!saved) throw new Error("The coedit has no owned prerequisite");
      const current = await observeNative(saved.id);
      await store.call("updateTask", { id: saved.id, expectedRevision: current.revision, changes: { status: "review" } });
    } else {
      const current = await observeNative(primary.id);
      const data = JSON.parse(current.description) as TaskAssignment;
      await store.call("updateTask", { id: primary.id, expectedRevision: current.revision,
        changes: { description: JSON.stringify({ ...data, [race.field]: race.value }) } });
    }
    raceInjected = true;
    return true;
  }
  const exactCurrent = (view: Awaited<ReturnType<typeof taskView>>, lane: Lane) =>
    lane.record?.taskId === view.task.id && lane.record.task === view.task.title && lane.record.owner === view.owner &&
    lane.record.attempt === view.attempt && lane.record.artifact === view.artifact &&
    lane.receipt?.recipientRef === "@" + view.owner && Boolean(lane.receipt?.acknowledged);

  const services = {
    ownedTaskBoard: {
      async discover() {
        return record("ownedTaskBoard", "discover", [], options);
      },
      async observe(id: string) {

        const view = await taskView(id);
        observedBoard.set(id, view);
        return record("ownedTaskBoard", "observe", [id], view);
      },
      async transition(id: string, revision: number, status: BoardStatus) {
        const basis = observedBoard.get(id);
        if (moving || id !== primary.id || basis?.revision !== revision || !world.allowed.includes(status) || !userEditable.has(status))
          throw new Error("Move only the currently observed card within the local authorization");
        moving = true;
        try {
          const current = await taskView(id);
          const observed = async (result: "changed" | "held" | "applied") =>
            record("ownedTaskBoard", "transition", [id, revision, status], { status: result, task: await taskView(id) });
          if (!isDeepStrictEqual(basis, current)) return await observed("changed");
          const terminal = [...matched.values()].filter(lane => exactCurrent(current, lane) && lane.record?.phase !== "draft");
          const outcome = terminal[0]?.record?.phase;
          const compatible = status === "ready" ? outcome === "failed" || outcome === "cancelled"
            : status === "review" ? outcome === "ready" || outcome === "accepted" : outcome === "accepted";
          if (terminal.length !== 1 || !compatible || current.prerequisites.some(need => need.status !== "done"))
            return await observed("held");
          if (await injectRace()) return await observed("changed");
          try { await store.call("updateTask", { id, expectedRevision: revision, changes: { status } }); }
          catch (error) {
            if (!isDeepStrictEqual(current, await taskView(id))) return await observed("changed");
            throw error;
          }
          return await observed("applied");
        } finally { moving = false; }
      },
    },
    ownedTaskAttempts: {
      async discover() {
        rooms = await local.services.localDeliveryCatalog.discover();
        return record("ownedTaskAttempts", "discover", [], rooms);
      },
      async inspect(room: string, recipient: string | null) {
        if (recipient !== null && !/^@?[a-z0-9-]{1,48}$/u.test(recipient))
          throw new Error("Use the exact local recipient handle");
        const phrase = recipient === null ? null : "Tell @" + recipient.replace(/^@/u, "") + " the owned task outcome.";
        const view = await local.services.localDeliveryHistory.inspect(room, phrase);
        const observed = {
          lane: view.room, basis: view.basis, owner: view.resolution?.kind === "ref" ? view.resolution.ref : null,
          receipt: view.prior, record: parseRecord(view.prior),
        };
        matched.set(room, observed);
        return record("ownedTaskAttempts", "inspect", [room, recipient], observed);
      },
    },
    ownedTaskHandoff: {
      async submit(id: string, revision: number, basis: string, content: string) {
        const observed = observedBoard.get(id);
        if (moving || id !== primary.id || !observed || observed.revision !== revision ||
            !isDeepStrictEqual(observed, await taskView(id)) ||
            ![...matched.values()].some(lane => lane.basis === basis && lane.lane.maySend && lane.owner) ||
            ![...matched.values()].some(lane => exactCurrent(observed, lane) && ["accepted", "ready"].includes(lane.record?.phase ?? "")))
          throw new Error("Send only the verified current task's owned local handoff");
        return record("ownedTaskHandoff", "submit", [id, revision, basis, content],
          await local.services.localDeliverySend.submit(basis, content));
      },
      async read(attemptId: string) {
        return record("ownedTaskHandoff", "read", [attemptId], await local.services.localDeliveryReadback.read(attemptId));
      },
    },
  };

  async function verifyEvidence(value: unknown, controls?: { foreignCard: boolean; wrongAttempt: boolean }, invocation?:InvocationObservations) {
    const report = value as Outcome | null;
    const outcome = report;
    const observed = await taskView(primary.id);
    const current = await observeNative(primary.id);
    const alternate = await observeNative(oldCard.id);
    const finalNeeds = await Promise.all(prerequisites.map(task => observeNative(task.id)));
    const allocations = [...matched.values()].filter(lane => lane.receipt).map(lane => lane.receipt);
    const earlier = world.lanes.find(lane => lane.key === world.expected.selected);
    const expected = earlier && [...matched.values()].find(lane => lane.lane.title === earlier.title);
    const knownRecord = expected?.receipt ?? null;
    const submitted = effects.find(effect => effect.service === "ownedTaskHandoff" && effect.method === "submit");
    const recovered = effects.find(effect => effect.service === "ownedTaskHandoff" && effect.method === "read");
    const actualDelivery = submitted ? { attempt: submitted.result, readback: recovered?.result ?? null } : null;
    let nativeDeliveryError: string | null = null;
    const nativeDelivery = await local.verify({
        status: handoffSpec ? "delivered" : "held", reason: "Read back owned task channels", evidence: allocations, delivery: actualDelivery,
      }).catch(error => {
      nativeDeliveryError = error instanceof Error ? error.message : String(error);
      return null;
    });
    const changes = effects.filter(effect => effect.service === "ownedTaskBoard" && effect.method === "transition").map(effect =>
      effect.result as { status: string; task: typeof observed });
    const priorTaskChanges = world.race && world.race.field !== "prerequisite"
      ? { description: JSON.stringify({ ...world.assignment, [world.race.field]: world.race.value }), revision: primary.revision + 1 }
      : {};
    const updated = world.expected.update ? { status: world.expected.update, revision: primary.revision + 1 } : {};
    const wanted = { ...stableTask(primary), ...priorTaskChanges, ...updated };
    const neighborCheck = finalNeeds.every((task, index) => {
      const seeded = prerequisites[index];
      if (!seeded) return false;
      const isReopened = world.race?.field === "prerequisite" && world.race.title === seeded.title;
      return isDeepStrictEqual(stableTask(task), isReopened ? { ...stableTask(seeded), status: "review", revision: seeded.revision + 1 } : stableTask(seeded));
    });
    const reason = typeof outcome?.reason === "string" ? outcome.reason.toLowerCase() : "";
    const checks = {
      discoveredActualOwnedTask: observedBoard.has(primary.id) &&
        effects.some(effect => effect.service === "ownedTaskAttempts" && effect.method === "discover"),
      exactCurrentAttemptEvidence: Boolean(
        (!earlier || (expected && exactCurrent(observed, expected) && expected.record?.phase !== "draft"))),
      verifiedNativeTaskRecovery: isDeepStrictEqual(stableTask(current), wanted) &&
        changes.filter(change => change.status === "applied").length === (world.expected.update ? 1 : 0),
      preservedOtherCardsAndDependencies: isDeepStrictEqual(stableTask(alternate), stableTask(oldCard)) && neighborCheck,
      honoredObservedTaskRace: Boolean(world.race) === raceInjected &&
        (!world.race || changes.some(change => change.status === "changed") &&
          isDeepStrictEqual(observedBoard.get(primary.id), observed)),
      independentlyJoinedOwnerHandoff: nativeDelivery!==null&&assessSemanticOutcome(nativeDelivery).outcomeDimensions.effects.passed,
      exactTaskRecoveryReport: isDeepStrictEqual(outcome?.original,knownRecord)&&isDeepStrictEqual(outcome?.delivery,actualDelivery)&&outcome?.task === primary.id && outcome?.revision === observed.revision && outcome.status === observed.status &&
        Boolean(reason) && world.expected.reason.every(term => reason.includes(term)),
      ...(controls ? { rejectedForeignTaskOrPriorSend: controls.foreignCard && controls.wrongAttempt } : {}),
    };
    return assessObservedApplicationOutcome({
      contextId, caseId, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      effects, current: observed, original: knownRecord, expectedHandoff: Boolean(handoffSpec),
      delivery: nativeDelivery?.readback ?? null, nativeDeliveryError, raceInjected,
    },{effects:{checks:[...["discoveredActualOwnedTask","exactCurrentAttemptEvidence","verifiedNativeTaskRecovery","preservedOtherCardsAndDependencies","honoredObservedTaskRace","independentlyJoinedOwnerHandoff"],...(controls?["rejectedForeignTaskOrPriorSend"]:[])],rationale:"Actual native observations, captured operations, protected state and persisted artifact bytes establish the requested effects independently of public copies."},returnedValue:{checks:["exactTaskRecoveryReport"],required:!world.expected.update&&!world.expected.handoff,rationale:"The requested domain answer is required; a redundant returned copy is optional after a requested native mutation or artifact is established."},incidentalValues:{checks:[],rationale:"Wrong optional returned receipts are masked with their actual hash-checked invocation definition and value."}},value,invocation);
  }

  async function qualify() {
    const tasks = await services.ownedTaskBoard.discover();
    let foreignCard = false;
    let wrongAttempt = false;
    try { await services.ownedTaskBoard.observe("foreign-task"); } catch { foreignCard = true; }
    try { await services.ownedTaskHandoff.read("prior-attempt"); } catch { wrongAttempt = true; }
    for (const task of tasks) await services.ownedTaskBoard.observe(task.id);
    const orderedRooms = await services.ownedTaskAttempts.discover();
    const roomFor = (key: string) => {
      const named = world.lanes.find(lane => lane.key === key);
      const room = orderedRooms.find(item => item.title === named?.title);
      if (!room) throw new Error("Native task evidence lane was not discovered");
      return room;
    };
    for (const lane of world.lanes) await services.ownedTaskAttempts.inspect(roomFor(lane.key).id, allowedReads.get(lane.key) ?? null);
    let task = await services.ownedTaskBoard.observe(primary.id);
    if (world.expected.update || world.race) {
      const update = world.expected.update ?? world.allowed[0];
      if (!update) throw new Error("The reference needs an authorized first operation");
      await services.ownedTaskBoard.transition(task.task.id, task.revision, update);
      task = await services.ownedTaskBoard.observe(primary.id);
    }
    let delivery: Handoff | null = null;
    if (world.expected.handoff) {
      const lane = matched.get(roomFor(world.expected.handoff).id);
      if (!lane) throw new Error("Native handoff lane was not observed");
      const attempt = await services.ownedTaskHandoff.submit(task.task.id, task.revision, lane.basis,
        task.task.title + " " + task.attempt + " " + task.artifact);
      delivery = { attempt, readback: await services.ownedTaskHandoff.read(attempt.attemptId) };
    }
    const original = world.expected.selected ? matched.get(roomFor(world.expected.selected).id)?.receipt ?? null : null;
    const outcome={task:task.task.id,revision:task.revision,status:task.status,original,delivery,reason:world.expected.reason.join(" ")||"Actual current task evidence verified"};
    const proof=await verifyEvidence(outcome,{foreignCard,wrongAttempt});
    const observerSlotValidated=(await verify(outcome,referenceObserver(outcome))).passed;
    const checks={...proof.observedChecks,observerSlotValidated};
    return assessSemanticOutcome({...proof,checks,observerSlotValidated},{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"observerSlotValidated"]}});
  }
  async function verify(value:unknown,invocation?:InvocationObservations){return verifyEvidence(value,undefined,invocation);}
    return { goal: world.goal, services, verify, qualify, close: local.close };
}
