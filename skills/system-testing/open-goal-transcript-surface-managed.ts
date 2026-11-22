import { isDeepStrictEqual } from "node:util";
import { AGENTIC_EVENT_PAYLOAD_KIND, AGENTIC_PROTOCOL_VERSION, agenticEventSchema, createInitialChannelViewState,
  pubsubAgenticEventToEnvelope, reduceChannelView, type AgenticEvent } from "@workspace/agentic-protocol";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { ChannelReplayEnvelope, ChannelProtocolEvent } from "@vibestudio/service-schemas/channel";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { contextId, fs, rpc, runtime } from "@workspace/runtime";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import type { TranscriptSurfaceWorld } from "./open-goal-transcript-surface-worlds.js";

type Card = TranscriptSurfaceWorld["card"];
type Approval = { id: string; channel: string; subject: string; revision: string; approved: boolean;
  mode: TranscriptSurfaceWorld["mode"]; key: string; card: Card; source: string };
type Effect = "publish-inline" | "refresh-inline" | "display-bar" | "clear-bar" | "none";
type Receipt = { channel: string; basis: number; status: "applied" | "stale"; envelope: string | null; sequence: number | null };
type Ui = AgenticEvent<"ui.inline_rendered"> | AgenticEvent<"ui.action_bar.updated">;
type Lane = { id: string; publish(body: Ui, key: string): Promise<ChannelProtocolEvent>; replay(): Promise<ChannelReplayEnvelope> };
type Ports = { context: string; owner: string; primary: Lane; other: Lane;
  write(path: string, bytes: string): Promise<void>; read(path: string): Promise<Uint8Array>; close(): Promise<void> };
const sourceCode = 'export default function Card({props}) { return <section><strong>{props.title}</strong><p>{props.detail}</p><span>{props.status}</span></section>; }';
const hash = sha256HexSyncText;
const decoder = new TextDecoder("utf-8", { fatal: true });

async function livePorts(ownerContext: string): Promise<Ports> {
  if (contextId !== ownerContext) throw new Error("Wrong context for local transcript surface");
  const owner = rpc.selfId;
  const entities: string[] = [];
  async function close() {
    const failures = (await Promise.allSettled(entities.map(id => runtime.retireEntity({ id })))).flatMap(item =>
      item.status === "rejected" ? [item.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Could not retire all owned transcript surface channels");
  }
  async function create(name: string): Promise<Lane> {
    const id = "transcript-surface-" + crypto.randomUUID();
    const entity = await runtime.createEntity({ kind: "do", contextId: ownerContext,
      execution: { surface: "code", source: "workers/pubsub-channel" }, className: "PubSubChannel", key: id });
    entities.push(entity.id);
    if (entity.kind !== "do" || entity.contextId !== ownerContext) throw new Error("Transcript surface escaped its admitted local context");
    const target = entity.targetId;
    await rpc.call(target, channelClientRpcMethods.initializeConversation, [ownerContext, { title: name }]);
    return { id, publish: (event, key) => rpc.call(target, channelClientRpcMethods.publish, [owner,
      AGENTIC_EVENT_PAYLOAD_KIND, event, { idempotencyKey: key }]),
      replay: () => rpc.call(target, channelClientRpcMethods.getReplayAfter, [{ after: 0, limit: 48 }]) };
  }
  try {
    const primary = await create("Owned conversation under review");
    const other = await create("Neighboring reference conversation");
    const dir = (await fs.mkdtemp("surface-approval")).replace(/\/$/u, "");
    return { context: ownerContext, owner, primary, other,
      write: async (path, bytes) => { await fs.writeFile(dir + "/" + path, bytes); },
      read: path => readWorkspaceBytes(rpc, dir + "/" + path, 32768), close };
  } catch (error) { await close(); throw error; }
}

type Read = Awaited<ReturnType<typeof readLane>>;
async function readLane(lane: Lane, context: string, owner: string, key: string) {
  const page = await lane.replay();
  if (page.ready.contextId !== context || page.ready.hasMoreAfter) throw new Error("Native replay escaped its exact owned bounds");
  const rows = page.logEvents;
  if (rows.some((row, i) => i > 0 && row.id <= rows[i-1]!.id)) throw new Error("Native replay lost sequence order");
  let projection = createInitialChannelViewState();
  const effects: { row: ChannelProtocolEvent; body: Ui }[] = [];
  for (const row of rows) {
    if (row.type !== AGENTIC_EVENT_PAYLOAD_KIND) continue;
    const event = agenticEventSchema.parse(row.payload);
    if (event.kind !== "ui.inline_rendered" && event.kind !== "ui.action_bar.updated") continue;
    const body = event as Ui;
    if (row.senderId !== owner || body.actor.id !== owner || body.actor.participantId !== owner)
      throw new Error("Transcript surface readback differs from native publisher identity");
    projection = reduceChannelView(projection, pubsubAgenticEventToEnvelope(lane.id, { envelopeId: row.messageId,
      pubsubId: row.id, senderId: row.senderId, ts: row.ts, contentClass: row.contentClass, externalKeys: row.externalKeys, payload: body }));
    effects.push({ row, body });
  }
  const inline = projection.inlineUi[owner]?.[key], bar = projection.actionBars[owner];
  const anchor = (kind: Ui["kind"], id?: string) => effects.findLast(({ body }) => body.kind === kind &&
    (id === undefined || body.payload.id === id))?.row;
  const inlineAnchor = anchor("ui.inline_rendered", key), barAnchor = anchor("ui.action_bar.updated");
  const card = inline && inlineAnchor ? { key: inline.id, card: (inline.props ?? null) as Card | null,
    cleared: false, owner, sequence: inlineAnchor.id, envelope: inlineAnchor.messageId } : null;
  const currentBar = bar && barAnchor ? { key: bar.id ?? null, card: (bar.props ?? null) as Card | null,
    cleared: bar.cleared === true, owner, sequence: barAnchor.id, envelope: barAnchor.messageId } : null;
  return { rows, effects, projection, view: { channel: lane.id, owner, cursor: rows.at(-1)?.id ?? 0, card, bar: currentBar } };
}

export async function prepareTranscriptSurface(input: { contextId: string; caseId: string }, world: TranscriptSurfaceWorld, supplied?: Ports) {
  const ports = supplied ?? await livePorts(input.contextId);
  try { return { ...await bindTranscriptSurface(input, world, ports), close: () => ports.close() }; }
  catch (error) { await ports.close(); throw error; }
}

async function bindTranscriptSurface(input: { contextId: string; caseId: string }, world: TranscriptSurfaceWorld, ports: Ports) {
  if (input.contextId !== ports.context || input.caseId !== world.id || ports.primary.id === ports.other.id) throw new Error("Wrong scoped transcript surface assignment");
  const { owner, primary, other } = ports;
  const id = crypto.randomUUID(), revision = "current-" + crypto.randomUUID(), key = "surface-" + crypto.randomUUID();
  const assignment = { id, channel: primary.id, goal: world.goal, subject: world.subject, revision, mayPublish: world.scope !== "read-only" };
  const actor = { kind: "worker" as const, id: owner, participantId: owner };
  const config = { protocol: AGENTIC_PROTOCOL_VERSION } as const;
  const source = { type: "code" as const, code: sourceCode };
  function body(effect: Exclude<Effect, "none">, card: Card, target = key): Ui {
    const createdAt = new Date().toISOString();
    if (effect === "publish-inline" || effect === "refresh-inline") return { kind: "ui.inline_rendered", actor, createdAt,
      payload: { ...config, uiType: "inline", id: target, props: card, source } };
    return { kind: "ui.action_bar.updated", actor, createdAt, payload: { ...config, uiType: "action_bar", result: { ok: true },
      ...(effect === "clear-bar" ? { cleared: true } : { id: target, props: card, source, cleared: false }) } };
  }
  async function push(lane: Lane, item: Ui, step: string) {
    agenticEventSchema.parse(item);
    const row = await lane.publish(item, `${id}-${step}`);
    if (row.senderId !== owner || row.type !== AGENTIC_EVENT_PAYLOAD_KIND || !row.messageId || row.id < 1)
      throw new Error("Native publish acknowledgement omitted its durable coordinate or owner");
    return row;
  }
  const canary = { title: "Shift reference", detail: "Existing reference stays put", status: "retained" };
  const previousCard = { ...world.card, detail: "Previous local instructions", status: "older" };
  await push(primary, body("publish-inline", canary, "existing-reference"), "canary-inline");
  if (world.mode === "inline") await push(primary, body("display-bar", canary, "existing-controls"), "canary-bar");
  if (world.start === "outdated" || world.start === "current") await push(primary, body(world.mode === "inline" ? "publish-inline" : "display-bar",
    world.start === "current" ? world.card : previousCard), "start");
  if (world.start === "cleared") {
    await push(primary, body("display-bar", previousCard), "before-clear");
    await push(primary, body("clear-bar", previousCard), "initial-clear");
  }
  await push(other, body("publish-inline", world.rival ? world.card : canary), "other-inline");
  await push(other, body("display-bar", world.rival ? world.card : canary), "other-bar");
  const baseline = await readLane(primary, ports.context, owner, key), neighboring = await readLane(other, ports.context, owner, key);

  const policy = { id: "active-review", channel: world.scope === "other-channel" ? other.id : primary.id,
    revision: world.scope === "old-revision" ? "earlier" : revision,
    subject: world.subject, approved: world.scope !== "unapproved", mode: world.mode, key, card: world.card };
  const drafts = [
    { ...policy, id: "prior-copy", channel: primary.id, revision: "previous", card: previousCard },
    { ...policy, id: "neighbor-review", channel: other.id, revision, card: world.rival ? world.card : previousCard },
    policy,
    ...(world.scope === "duplicate" ? [{ ...policy, id: "independent-release", card: { ...world.card, detail: "A distinct disputed release" } }] : []),
  ];
  const documents = new Map(drafts.map(record => [record.id + ".json", JSON.stringify(record) + "\n"]));
  for (const [path, bytes] of documents) await ports.write(path, bytes);
  async function scan(): Promise<Approval[]> {
    const results: Approval[] = [];
    for (const path of documents.keys()) {
      const text = decoder.decode(await ports.read(path));
      results.push({ ...JSON.parse(text), source: hash(text) });
    }
    return results;
  }
  const approvals = await scan();
  const currentApprovals = (values: Approval[]) => values.filter(record => record.approved && record.channel === primary.id &&
    record.revision === revision && record.subject === world.subject);
  const selected = currentApprovals(approvals);
  const approval = assignment.mayPublish && selected.length === 1 ? selected[0]! : null;
  const blocker = !assignment.mayPublish ? "authority" : selected.length > 1 ? "competing" : selected.length === 0 ? "missing" : null;
  const selection = { approval, blocker };
  const shouldEffect = (): Effect => {
    if (!approval) return "none";
    const view = baseline.view;
    if (approval.mode === "inline") return !view.card ? "publish-inline" : isDeepStrictEqual(view.card.card, approval.card) ? "none" : "refresh-inline";
    if (approval.mode === "clear") return !view.bar || view.bar.cleared ? "none" : "clear-bar";
    return view.bar && !view.bar.cleared && view.bar.key === approval.key && isDeepStrictEqual(view.bar.card, approval.card) ? "none" : "display-bar";
  };
  const effect = shouldEffect(), decision = { effect, reason: blocker ?? (effect === "none" ? "already-current" : "ready") };
  let discovered = false, listed = false, replay: Read["view"] | null = null, receipt: Receipt | null = null;
  let publishing = false, raced: ChannelProtocolEvent | null = null, published: ChannelProtocolEvent | null = null;
  const effects: { service: string; method: string; args: unknown[]; result: unknown }[] = [];
  function capture<T>(service: string, method: string, args: unknown[], result: T): T {
    effects.push(structuredClone({ service, method, args, result })); return structuredClone(result);
  }
  const services = {
    transcriptApproval: {
      async discover() {
        if (discovered) throw new Error("This transcript assignment was already opened");
        discovered = true;
        return capture("transcriptApproval", "discover", [], assignment);
      },
      async list(scope: string) {
        if (!discovered || scope !== id || listed) throw new Error("Current approvals require the exact open assignment");
        listed = true;
        return capture("transcriptApproval", "list", [scope], await scan());
      },
    },
    transcriptObservation: {
      async replay(scope: string, candidate: string) {
        if (!listed || scope !== id || candidate !== approval?.id || replay) throw new Error("Only the unique approved owned surface can be replayed");
        replay = (await readLane(primary, ports.context, owner, key)).view;
        return capture("transcriptObservation", "replay", [scope, candidate], replay);
      },
    },
    transcriptMutation: {
      async apply(scope: string, candidate: string, cursor: number, change: Effect) {
        if (scope !== id || !approval || candidate !== approval.id || !replay || cursor !== replay.cursor || change === "none" ||
            change !== effect || receipt || publishing) throw new Error("Only an approved effect at the exact observed transcript cursor may publish");
        publishing = true;
        try {
          if (world.race) raced = await push(primary, body("display-bar", { ...canary, title: "Next shift controls" }, "next-shift"), "race");
          const fresh = await readLane(primary, ports.context, owner, key);
          const nextApprovals = currentApprovals(await scan());
          if (fresh.view.cursor !== cursor || nextApprovals.length !== 1 || !isDeepStrictEqual(nextApprovals[0], approval))
            receipt = { channel: primary.id, basis: cursor, status: "stale", envelope: null, sequence: null };
          else {
            published = await push(primary, body(change, approval.card), "authorized-effect");
            receipt = { channel: primary.id, basis: cursor, status: "applied", envelope: published.messageId, sequence: published.id };
          }
          return capture("transcriptMutation", "apply", [scope, candidate, cursor, change], receipt);
        } finally { publishing = false; }
      },
    },
  };
  async function verify(value: unknown) {
    const report = value as { status?: string; skill?: string; outcome?: unknown } | null;
    const after = await readLane(primary, ports.context, owner, key), afterOther = await readLane(other, ports.context, owner, key);
    const approved = await scan();
    const difference = after.rows.slice(baseline.rows.length);
    const applying = ["publish-inline", "refresh-inline", "display-bar", "clear-bar"].includes(world.expected);
    const coordinates = applying ? [published] : world.race ? [raced] : [];
    const expectation = receipt?.status === "stale" ? "stale" : effect === "none" ? decision.reason : effect;
    const exact = published ? after.effects.find(({ row }) => row.id === published?.id && row.messageId === published?.messageId) : null;
    const resulting = after.view;
    const mutation = effect === "publish-inline" || effect === "refresh-inline" ? resulting.card : resulting.bar;
    const expectedKind = effect === "publish-inline" || effect === "refresh-inline" ? "ui.inline_rendered" : "ui.action_bar.updated";
    const correctEffect = Boolean(exact && mutation && exact.body.kind === expectedKind && (effect === "clear-bar" ?
      exact.body.kind === "ui.action_bar.updated" && exact.body.payload.cleared && exact.body.payload.source === undefined && exact.body.payload.result?.ok :
      isDeepStrictEqual(exact.body.payload.source, source) && isDeepStrictEqual(exact.body.payload.props, world.card)));
    const projected = applying && receipt ? correctEffect && mutation?.sequence === receipt.sequence && mutation.envelope === receipt.envelope &&
      (effect === "clear-bar" ? mutation.cleared : mutation.key === key && isDeepStrictEqual(mutation.card, world.card)) :
      !published && (!world.race ? isDeepStrictEqual(resulting, baseline.view) : resulting.bar?.key === "next-shift");
    const baselineSibling = effect === "publish-inline" || effect === "refresh-inline" ? baseline.view.bar : baseline.view.card;
    const finalSibling = effect === "publish-inline" || effect === "refresh-inline" ? resulting.bar : resulting.card;
    const outcome = { assignment, approvals: approved, selection, replay, decision, receipt };
    const checks = {
      boundCurrentTranscriptApproval: discovered && listed && isDeepStrictEqual(approvals, approved),
      provedCurrentNativeSurface: approval ? isDeepStrictEqual(replay, baseline.view) : replay === null,
      exactScopedTranscriptDelta: isDeepStrictEqual(after.rows.slice(0, baseline.rows.length), baseline.rows) &&
        difference.length === coordinates.length && difference.every((row, index) => row.id === coordinates[index]?.id && row.messageId === coordinates[index]?.messageId && row.senderId === owner) &&
        after.projection.inlineUi[owner]?.["existing-reference"]?.props?.title === canary.title &&
        isDeepStrictEqual(afterOther.rows, neighboring.rows) && (world.race || isDeepStrictEqual(baselineSibling, finalSibling)),
      verifiedProjectedTranscriptEffect: expectation === world.expected && Boolean(projected),
      matchedTranscriptSurfaceReport: report?.status === "workspace-skill-reviewed" && report.skill === "transcriptSurface" && isDeepStrictEqual(report.outcome, outcome),
    };
    return { caseId: world.id, contextId: input.contextId, goal: world.goal, passed: Object.values(checks).every(Boolean), checks,
      ...outcome, native: { before: baseline.view, after: resulting, neighbor: neighboring.view, coordinates: difference.map(row => ({ id: row.id, envelope: row.messageId, owner: row.senderId, type: row.type })) }, effects: structuredClone(effects) };
  }
  async function qualify() {
    await services.transcriptApproval.discover();
    await services.transcriptApproval.list(id);
    if (approval) await services.transcriptObservation.replay(id, approval.id);
    const reject = async (work: () => Promise<unknown>) => { try { await work(); return false; } catch { return true; } };
    const rejectedWrongScope = await reject(() => services.transcriptObservation.replay(id, "neighbor-review"));
    const rejectedWrongCursor = await reject(() => services.transcriptMutation.apply(id, approval?.id ?? "unowned", -1, effect));
    const wrongSurface = effect === "clear-bar" ? "display-bar" : "clear-bar";
    const rejectedWrongEffect = await reject(() => services.transcriptMutation.apply(id, approval?.id ?? "unowned", baseline.view.cursor, wrongSurface));
    if (approval && replay && effect !== "none") await services.transcriptMutation.apply(id, approval.id, (replay as Read["view"]).cursor, effect);
    const report = { status: "workspace-skill-reviewed", skill: "transcriptSurface", outcome: { assignment, approvals, selection, replay, decision, receipt } };
    const proof = await verify(report);
    const rejectedInventedEffect = !(await verify({ ...report, outcome: { ...report.outcome, decision: { effect: "none", reason: "invented" } } })).passed;
    const checks = { ...proof.checks, rejectedWrongScope, rejectedWrongCursor, rejectedWrongEffect, rejectedInventedEffect };
    return { ...proof, passed: Object.values(checks).every(Boolean), checks, report };
  }
  return { services, qualify, verify };
}
