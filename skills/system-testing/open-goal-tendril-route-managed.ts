import type { InvocationObservations } from "./observed-invocation.js";
import { includesEvidence } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { createRpcMethodCaller } from "@vibestudio/shared/rpcMethods";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { contextId as activeContext, fs, rpc, vcs } from "@workspace/runtime";
import {
  matchTendrilFunction,
  tendrilRpcMethods,
  tendrilTargetId,
} from "@workspace/tendril";
import type { StateOp, TendrilDescription } from "@workspace/tendril";
import { createTendril } from "@workspace/tendril/agent";
import type {
  BoardSeed,
  Projection,
  RouteFunction,
  SlotSeed,
  TendrilRouteWorld,
} from "./open-goal-tendril-route-worlds.js";
import { createOwnedHeadlessChannel } from "./session-replay-managed.js";
import { tendrilPanel } from "./tendril-worlds.js";

type Slot = Omit<SlotSeed, "key" | "functions"> & {
  id: string;
  functions: { name: string; phrases: string[] }[];
};
type Card = Pick<BoardSeed, "title" | "room" | "audience" | "edition"> & {
  id: string;
};
type Snapshot = Card & {
  channel: string;
  source: string;
  revision: string;
  stateRevision: number;
  agent: BoardSeed["agent"];
  retainAllowed: boolean;
  utterance: BoardSeed["utterance"];
  slots: Slot[];
};
type Finding = Pick<
  Snapshot,
  "id" | "channel" | "audience" | "revision" | "utterance"
> & { slot: string; projection: Projection };
type Probe =
  | { status: "projected"; finding: Finding }
  | { status: "changed"; revision: string };
type Receipt = { path: string; sha256: string; revision: string };
type Outcome = {
  status: "verified" | "held";
  finding: Finding | null;
  receipt: Receipt | null;
  reason: string;
};
type RouteState = {
  audience: string;
  edition: BoardSeed["edition"];
  agent: BoardSeed["agent"];
  retainAllowed: boolean;
  utterance: BoardSeed["utterance"];
  slots: Record<string, SlotSeed["state"]>;
};
type Assignment = { contextId: string; caseId: string };
type Channel = { contextId: string; title: string; envelopes: unknown[] };
type Native = {
  id: string;
  channel: string;
  describe(): Promise<TendrilDescription>;
  state(): Promise<{ rev: number; state: Record<string, unknown> }>;
  apply(ops: StateOp[]): Promise<{ rev: number }>;
  register(slot: {
    slotId: string;
    label: string;
    deviceId: string | null;
  }): Promise<void>;
  functions(slot: string, functions: RouteFunction[]): Promise<void>;
  readChannel(): Promise<Channel>;
};
type Ports = {
  contextId: string | null;
  file: Pick<
    typeof fs,
    "mkdtemp" | "exists" | "readFile" | "writeFile" | "rm" | "readdir"
  >;
  head(): Promise<unknown>;
  create(context: string, board: BoardSeed): Promise<Native>;
};
type Entry = {
  service: "tendrilRouteRead" | "tendrilRouteRetention";
  method: string;
  args: unknown[];
  result: unknown;
};

async function createNative(
  context: string,
  board: BoardSeed,
): Promise<Native> {
  const lane = await createOwnedHeadlessChannel(context, board.room);
  const handle = await createTendril({
    source: tendrilPanel,
    contextId: context,
    channelId: lane.key,
    name: board.title,
    about: { purpose: "Private review for " + board.room },
  });
  const owner = createRpcMethodCaller(
    rpc,
    tendrilTargetId(handle.id),
    tendrilRpcMethods,
  );
  return {
    id: handle.id,
    channel: lane.key,
    describe: handle.describe,
    state: handle.state.get,
    apply: handle.state.apply,
    register: (slot) => owner("registerPresentation", [slot]),
    functions: (slotId, declarations) =>
      owner("registerFunctions", [slotId, declarations]),
    async readChannel() {
      const [contextId, config, page] = await Promise.all([
        rpc.call(lane.target, channelClientRpcMethods.getContextId, []),
        rpc.call(lane.target, channelClientRpcMethods.getConfig, []),
        rpc.call(lane.target, channelClientRpcMethods.getReplayAfter, [
          { after: 0, limit: 100 },
        ]),
      ]);
      if (
        !contextId ||
        !config?.title ||
        page.mode !== "after" ||
        page.ready.contextId !== contextId ||
        page.ready.hasMoreBefore !== false ||
        page.ready.hasMoreAfter !== false ||
        page.ready.totalCount !== page.logEvents.length
      )
        throw new Error(
          "Tendril channel scope or retained envelope readback is incomplete",
        );
      return { contextId, title: config.title, envelopes: page.logEvents };
    },
  };
}

function livePorts(): Ports {
  return {
    contextId: activeContext,
    file: fs,
    create: createNative,
    head: async () => {
      const { mainEventId, workingHead } = await vcs.status();
      return { mainEventId, workingHead };
    },
  };
}

function retainedProjection(board: Snapshot, slot: Slot): Projection {
  const normal = matchTendrilFunction(board.utterance.text, slot.functions);
  if (!normal) return { kind: "agent", attached: board.agent === "attached" };
  const reverse = matchTendrilFunction(
    board.utterance.text,
    [...slot.functions].reverse(),
  );
  if (normal.key !== reverse?.key) {
    const winners = slot.functions.filter(
      (fn) =>
        matchTendrilFunction(board.utterance.text, [
          fn,
          ...slot.functions.filter((other) => other !== fn),
        ])?.key === fn.name,
    );
    return { kind: "ambiguous", names: winners.map((fn) => fn.name).sort() };
  }
  return {
    kind: "local",
    name: normal.key,
    phrase: normal.phrase,
    text: normal.args.text ?? null,
    captures: normal.args.captures ?? [],
  };
}

export async function prepareOpenTendrilRoute(
  input: Assignment,
  world: TendrilRouteWorld,
  ports = livePorts(),
) {
  if (input.contextId !== ports.contextId || input.caseId !== world.id)
    throw new Error("Tendril review belongs to another fixture context");
  const head = await ports.head();
  const natives = new Map<
    string,
    { seed: BoardSeed; native: Native; initial: Snapshot; baseline: Channel }
  >();
  async function snapshot(
    native: Native,
  ): Promise<{ board: Snapshot; room: Channel }> {
    const before = await native.describe();
    const [durable, room] = await Promise.all([
      native.state(),
      native.readChannel(),
    ]);
    const after = await native.describe();
    if (
      !isDeepStrictEqual(before, after) ||
      durable.rev !== after.rev ||
      room.contextId !== input.contextId ||
      after.tendrilId !== native.id ||
      after.contextId !== input.contextId ||
      after.channelId !== native.channel ||
      after.source !== tendrilPanel
    )
      throw new Error(
        "Tendril description, state and room no longer identify one owned scope",
      );
    const route = durable.state.route as RouteState;
    if (!route) throw new Error("The owned Tendril route state is unavailable");
    const slots = after.presentations.map((slot) => ({
      id: slot.slotId,
      label: slot.label,
      device: slot.deviceId,
      state: route.slots[slot.slotId]!,
      functions: after.functions
        .filter((fn) => fn.slotId === slot.slotId)
        .map((fn) => ({ name: fn.name, phrases: fn.phrases ?? [] })),
    }));
    if (
      slots.some((slot) => !slot.state) ||
      Object.keys(route.slots).length !== slots.length
    )
      throw new Error(
        "Tendril retained routes and registered slots no longer agree",
      );
    const board = {
      id: native.id,
      channel: native.channel,
      source: after.source,
      title: after.name,
      room: room.title,
      audience: route.audience,
      edition: route.edition,
      agent: route.agent,
      retainAllowed: route.retainAllowed,
      utterance: route.utterance,
      slots,
      stateRevision: durable.rev,
      revision: sha256HexSyncText(
        JSON.stringify({
          after,
          durable,
          title: room.title,
          contextId: room.contextId,
        }),
      ),
    };
    return { board, room };
  }
  const slotId = (native: Native, slot: string) => native.id + ":" + slot;
  for (const seed of world.boards) {
    const native = await ports.create(input.contextId, seed);
    const { audience, edition, agent, retainAllowed, utterance } = seed;
    const state: RouteState = {
      audience,
      edition,
      agent,
      retainAllowed,
      utterance,
      slots: Object.fromEntries(
        seed.slots.map((slot) => [slotId(native, slot.key), slot.state]),
      ),
    };
    await native.apply([{ op: "set", path: ["route"], value: state }]);
    for (const slot of seed.slots) {
      await native.register({
        slotId: slotId(native, slot.key),
        label: slot.label,
        deviceId: slot.device,
      });
      await native.functions(slotId(native, slot.key), slot.functions);
    }
    const { board, room } = await snapshot(native);
    if (natives.has(board.id))
      throw new Error("Two owned Tendril seeds resolved to the same board");
    natives.set(board.id, { seed, native, initial: board, baseline: room });
  }
  const directory = await ports.file.mkdtemp("tendril-route-review");
  const receiptPath = directory + "/route-evidence.json";
  const close = () =>
    ports.file.rm(directory, { recursive: true, force: true });
  const current = (id: string) => {
    const found = natives.get(id);
    if (!found)
      throw new Error("The Tendril board is outside the owned review");
    return found;
  };
  const journal: Entry[] = [];
  const attest = <T>(
    service: Entry["service"],
    method: string,
    args: unknown[],
    result: T,
  ): T => {
    journal.push(structuredClone({ service, method, args, result }));
    return structuredClone(result);
  };
  const observed = new Map<string, Snapshot>();
  const projected: Finding[] = [];
  let raced = false;
  let probing = false;
  let retaining = false;
  let retained: Receipt | null = null;
  const services = {
    tendrilRouteRead: {
      async listBoards(): Promise<Card[]> {
        const cards = await Promise.all(
          [...natives.values()].map(async ({ native }) => {
            const {
              board: { id, title, room, audience, edition },
            } = await snapshot(native);
            return { id, title, room, audience, edition };
          }),
        );
        return attest("tendrilRouteRead", "listBoards", [], cards);
      },
      async readBoard(id: string) {
        const { board } = await snapshot(current(id).native);
        observed.set(id, board);
        return attest("tendrilRouteRead", "readBoard", [id], board);
      },
      async probe(id: string, slot: string, revision: string): Promise<Probe> {
        const basis = observed.get(id);
        if (
          probing ||
          basis?.revision !== revision ||
          !basis.slots.some(
            (item) => item.id === slot && item.state === "current",
          )
        )
          throw new Error(
            "Probe requires the exact observed owned board and current retained slot",
          );
        probing = true;
        const finish = (result: Probe) =>
          attest("tendrilRouteRead", "probe", [id, slot, revision], result);
        try {
          const { seed, native } = current(id);
          const { board } = await snapshot(native);
          if (board.revision !== revision)
            return finish({ status: "changed", revision: board.revision });
          if (world.coedit && !raced && seed.key === "main") {
            const edit = world.coedit;
            if ("functions" in edit)
              await native.functions(slot, edit.functions);
            else if ("audience" in edit)
              await native.apply([
                {
                  op: "set",
                  path: ["route", "audience"],
                  value: edit.audience,
                },
              ]);
            else
              await native.apply([
                {
                  op: "set",
                  path: ["route", "slots", slot],
                  value: edit.state,
                },
              ]);
            raced = true;
            return finish({
              status: "changed",
              revision: (await snapshot(native)).board.revision,
            });
          }
          const present = board.slots.find((entry) => entry.id === slot)!;
          const finding = {
            id,
            channel: board.channel,
            audience: board.audience,
            slot,
            revision,
            utterance: board.utterance,
            projection: retainedProjection(board, present),
          };
          projected.push(finding);
          return finish({ status: "projected", finding });
        } finally {
          probing = false;
        }
      },
    },
    tendrilRouteRetention: {
      async retain(finding: Finding): Promise<Receipt | null> {
        const entry = current(finding.id);
        const basis = observed.get(finding.id);
        if (
          retaining ||
          retained ||
          !basis?.retainAllowed ||
          !includesEvidence(projected, finding) ||
          finding.projection.kind === "ambiguous" ||
          (finding.projection.kind === "agent" && !finding.projection.attached)
        )
          throw new Error(
            "Retention requires the exact authorized owned route",
          );
        retaining = true;
        const finish = (result: Receipt | null) =>
          attest("tendrilRouteRetention", "retain", [finding], result);
        try {
          if (
            (await snapshot(entry.native)).board.revision !== finding.revision
          )
            return finish(null);
          const body =
            JSON.stringify({
              schema: "vibestudio.tendril-route-evidence/1",
              finding,
            }) + "\n";
          await ports.file.writeFile(receiptPath, body);
          if (
            (await snapshot(entry.native)).board.revision !== finding.revision
          ) {
            await ports.file.rm(receiptPath);
            return finish(null);
          }
          retained = {
            path: receiptPath,
            sha256: sha256HexSyncText(body),
            revision: finding.revision,
          };
          return finish(retained);
        } finally {
          retaining = false;
        }
      },
    },
  };

  async function verify(value: unknown, invocation?: InvocationObservations) {
    const result = value as Outcome | null;
    const outcome = result;
    const { expected } = world;
    const snapshots = await Promise.all(
      [...natives.values()].map(async (entry) => ({
        entry,
        ...(await snapshot(entry.native)),
      })),
    );
    const main = snapshots.find(({ entry }) => entry.seed.key === "main")!;
    const board = expected.board ? main.board : null;
    const wantedSlot =
      expected.slot && board ? slotId(main.entry.native, expected.slot) : null;
    const finding: Finding | null =
      board && wantedSlot && expected.projection
        ? {
            id: board.id,
            channel: board.channel,
            audience: board.audience,
            slot: wantedSlot,
            revision: board.revision,
            utterance: board.utterance,
            projection: expected.projection,
          }
        : null;
    const probes = journal.filter((row) => row.method === "probe");
    const changed = probes.find(
      (row) => (row.result as Probe).status === "changed",
    );
    const initial = main.entry.initial;
    const expectedAudience =
      world.coedit && "audience" in world.coedit
        ? world.coedit.audience
        : initial.audience;
    const expectedSlots = initial.slots.map((slot) => {
      if (!world.coedit || slot.id !== slotId(main.entry.native, "operator"))
        return slot;
      if ("audience" in world.coedit) return slot;
      if ("state" in world.coedit)
        return { ...slot, state: world.coedit.state };
      return {
        ...slot,
        functions: world.coedit.functions
          .map((fn) => ({ name: fn.name, phrases: fn.phrases ?? [] }))
          .sort((first, second) =>
            first.name < second.name ? -1 : first.name > second.name ? 1 : 0,
          ),
      };
    });
    const bytes = (await ports.file.exists(receiptPath))
      ? String(await ports.file.readFile(receiptPath, "utf8"))
      : null;
    const files = await ports.file.readdir(directory);
    const readsFinalRevision =
      !world.coedit ||
      observed.get(main.board.id)?.revision === main.board.revision;
    const checks = {
      discoveredOwnedTendrilRoutes:
        observed.size > 0 && [...observed.keys()].every(id => snapshots.some(({board}) => board.id === id)),
      joinedDurableTendrilAudience:
        snapshots.every(({ entry, room }) =>
          isDeepStrictEqual(room, entry.baseline),
        ) &&
        main.board.audience === expectedAudience &&
        isDeepStrictEqual(main.board.slots, expectedSlots) &&
        snapshots.every(
          ({ board, entry }) =>
            entry === main.entry || isDeepStrictEqual(board, entry.initial),
        ),
      checkedCurrentTendrilProjection:
        (!finding || includesEvidence(projected, finding)) &&
        readsFinalRevision &&
        (world.coedit
          ? raced &&
            changed?.args[0] === main.board.id &&
            changed.args[2] === initial.revision &&
            (changed.result as { revision: string }).revision ===
              main.board.revision &&
            main.board.revision !== initial.revision
          : !raced && main.board.revision === initial.revision),
      matchedTendrilDecision: Boolean(
        isDeepStrictEqual(outcome?.receipt,retained)&&outcome?.status === expected.decision &&
        isDeepStrictEqual(outcome.finding, finding) &&
        typeof outcome.reason === "string" &&
        outcome.reason.trim() &&
        expected.reason.every((term) =>
          outcome.reason.toLowerCase().includes(term),
        ),
      ),
      retainedOnlyExactLocalTendrilEvidence: expected.retain
        ? Boolean(
            bytes &&
            retained &&
            finding &&
            isDeepStrictEqual(files, ["route-evidence.json"]) &&
            bytes ===
              JSON.stringify({
                schema: "vibestudio.tendril-route-evidence/1",
                finding,
              }) +
                "\n" &&
            retained.sha256 === sha256HexSyncText(bytes) &&
            retained.revision === finding.revision,
          )
        : bytes === null &&
          retained === null &&
          files.length === 0 &&
          journal.every((row) => row.method !== "retain"),
      protectedTendrilWorkspaceHead: isDeepStrictEqual(
        await ports.head(),
        head,
      ),
    };
    return {
      outcomeContract:{effects:{checks:["discoveredOwnedTendrilRoutes", "joinedDurableTendrilAudience", "checkedCurrentTendrilProjection", "retainedOnlyExactLocalTendrilEvidence", "protectedTendrilWorkspaceHead"],rationale:"Authoritative native state, captured operations and durable artifact readback establish these facts independently of copied public values."},
        returnedValue:{checks:["matchedTendrilDecision"],required:!expected.retain,rationale:"A requested domain answer is required; an extra result copy is optional after the requested native mutation or artifact is independently established."},
        incidentalValues:{checks:[],rationale:"Known incorrect actual emitted values are masked with their source-bound root definition."}},
      incorrectReturnValues:value!==undefined&&!(checks.matchedTendrilDecision)?[{required:!expected.retain,definition:invocation?.calls.find(call=>call.parentCallId===null)?.definition??{name:"reviewTendrilRoute",source:"reviewTendrilRoute.nl"},value:value}]:[],

      caseId: input.caseId,
      contextId: input.contextId,
      goal: world.goal,
      passed: Object.values(checks).every(Boolean),
      checks,
      current: board,
      finding,
      journal,
      receipt: retained,
      receiptBytes: bytes,
    };
  }

  async function qualify() {
    const cards = await services.tendrilRouteRead.listBoards();
    let foreign = false;
    try {
      await services.tendrilRouteRead.readBoard("outside-tendril");
    } catch {
      foreign = true;
    }
    const views = await Promise.all(
      cards.map(({ id }) => services.tendrilRouteRead.readBoard(id)),
    );
    let finding: Finding | null = null;
    let receipt: Receipt | null = null;
    let scoped = true;
    if (world.expected.board) {
      const main = views.find(
        (board) => current(board.id).seed.key === "main",
      )!;
      const other = views.find((board) => board.id !== main.id)!;
      scoped = false;
      try {
        await services.tendrilRouteRead.probe(
          main.id,
          other.slots[0]!.id,
          main.revision,
        );
      } catch {
        scoped = true;
      }
      const name = world.expected.slot ?? (world.coedit ? "operator" : null);
      if (name) {
        const slot = slotId(current(main.id).native, name);
        let probe = await services.tendrilRouteRead.probe(
          main.id,
          slot,
          main.revision,
        );
        if (probe.status === "changed") {
          const refreshed = await services.tendrilRouteRead.readBoard(main.id);
          if (world.reprobe)
            probe = await services.tendrilRouteRead.probe(
              main.id,
              slot,
              refreshed.revision,
            );
        }
        if (probe.status === "projected") finding = probe.finding;
      }
      if (world.expected.retain && finding) {
        let rejectedAltered = false;
        try {
          await services.tendrilRouteRetention.retain({
            ...finding,
            audience: "foreign audience",
          });
        } catch {
          rejectedAltered = true;
        }
        scoped &&= rejectedAltered;
        receipt = await services.tendrilRouteRetention.retain(finding);
      }
    }
    const outcome = {
      status: world.expected.decision,
      finding,
      receipt,
      reason:
        world.expected.reason.join(" ") ||
        "Matched the retained owned Tendril route",
    };
    const proof = await verify(outcome);
    const rejectedForeignTendrilEvidence = foreign && scoped;
    return {
      ...proof,outcomeContract:{...proof.outcomeContract,effects:{...proof.outcomeContract.effects,checks:[...proof.outcomeContract.effects.checks,"rejectedForeignTendrilEvidence"]}},
      passed: proof.passed && rejectedForeignTendrilEvidence,
      checks: { ...proof.checks, rejectedForeignTendrilEvidence },
    };
  }
  return { goal: world.goal, services, verify, qualify, close };
}
