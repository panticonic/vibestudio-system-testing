import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import { bindScratchHandoff } from "@workspace-skills/scratch-handoff-bindings";
import type { ConversationCard, ConversationRead, EvidenceRow, OutputReadback, ProviderGoalReport,
  ProviderHandoff, ProviderPlan, ProviderRecord, RequestIdentity } from "@workspace-skills/open-provider-handoff/types";
import { createOwnedHeadlessChannel, withOwnedChannelClient } from "./session-replay-managed.js";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";
import { providerHandoffWorlds, type NoteSeed } from "./open-goal-provider-handoff-worlds.js";

type Lane = Awaited<ReturnType<typeof createOwnedHeadlessChannel>>;
const encode = new TextEncoder();
const limit = 12 * 1024;

async function appendNative(lane: Lane, context: string, records: ProviderRecord[]) {
  return withOwnedChannelClient(lane, context, async client => {
    const ids: string[] = [];
    for (const record of records) ids.push(await client.send(JSON.stringify(record), { idempotencyKey: crypto.randomUUID() }));
    return ids;
  });
}
export async function readNative(lane: Lane, client = rpc): Promise<ConversationRead> {
  const page = await client.call(lane.target, channelClientRpcMethods.getReplayAfter, [{ after: 0, limit: 30 }]);
  const through = page.ready.snapshotLastSeq;
  if (through === undefined || page.ready.hasMoreAfter) throw new Error("Owned provider conversation exceeded its retained frontier");
  const rows = page.logEvents.flatMap((envelope): EvidenceRow[] => {
    const event = envelope.payload as AgenticEvent<"message.completed"> | undefined;
    if (event?.kind !== "message.completed" || !event.causality?.messageId ||
        !("role" in event.payload) || event.payload.role !== "user") return [];
    const text = (event.payload.blocks ?? []).flatMap(block => block.type === "text" ? [block.content] : []).join("");
    if (!envelope.senderId || encode.encode(text).length > 2048) throw new Error("Invalid bound provider message");
    return [{ messageId: event.causality.messageId, envelopeId: envelope.messageId, seq: envelope.id, senderId: envelope.senderId,
      record: JSON.parse(text) as ProviderRecord }];
  });
  return { channelId: lane.key, through, rows };
}
type Ports = {
  contextId: string | null;
  fs: typeof fs;
  status: typeof vcs.status;
  open: typeof createOwnedHeadlessChannel;
  append: typeof appendNative;
  read: typeof readNative;
  put(text: string): Promise<string>;
  get(digest: string): Promise<string | null>;
  readBytes(path: string, limit: number): Promise<Uint8Array>;
};
function livePorts(): Ports {
  return { contextId, fs, status: input => vcs.status(input), open: createOwnedHeadlessChannel, append: appendNative, read: readNative,
    put: async text => (await rpc.call("main", mainRpcMethods["blobstore.putText"], [text])).digest,
    get: digest => rpc.call("main", mainRpcMethods["blobstore.getText"], [digest]),
    readBytes: (path, maximum) => readWorkspaceBytes(rpc, path, maximum) };
}

export async function prepareOpenProviderHandoff(input: { contextId: string; caseId: string }, ports = livePorts()) {
  const found = providerHandoffWorlds.find(item => item.id === input.caseId);
  if (!found || input.contextId !== ports.contextId) throw new Error("Retained provider evidence belongs to its assigned context");
  const world = found;
  const before = await ports.status();
  const mainLane = await ports.open(input.contextId, world.label);
  const request: RequestIdentity = {
    id: crypto.randomUUID(), provider: world.provider, operation: world.operation,
    audience: world.audience, revision: `review-${crypto.randomUUID()}`,
  };
  const owner = `owner-${crypto.randomUUID()}`;
  const card: ConversationCard = { channelId: mainLane.key, label: world.label, request, owner,
    viewer: world.viewer ?? "linked-agent", mayStage: world.mayStage === true };
  const lanes = new Map([[card.channelId, { lane: mainLane, card }]]);
  if (world.decoy) {
    const lane = await ports.open(input.contextId, world.decoy);
    lanes.set(lane.key, { lane, card: { ...card, channelId: lane.key, label: world.decoy, owner: `archive-${crypto.randomUUID()}`,
      mayStage: false, request: { ...card.request, id: crypto.randomUUID(), revision: "historical" } } });
    await ports.append(lane, input.contextId, [{ kind: "note", text: "Archived record. No current approval or output is attached." }]);
  }

  const seedIds = new Map<string, string>();
  const seeded = new Map<string, ProviderRecord>();
  async function materialize(row: NoteSeed): Promise<ProviderRecord> {
    switch (row.kind) {
      case "note": return { kind: "note", text: row.text };
      case "queue": return { kind: "queue", receipt: { source: row.surface, kind: row.observation, ids: row.pending ? [request.id] : [] } };
      case "decision": return { kind: "decision", request: { ...request, ...row.mismatch }, state: row.state,
        owner: row.foreignOwner ? `alternate-${owner}` : owner, hostRendered: !row.spoofed };
      case "result": {
        const digest = row.missingBlob ? sha256HexSyncText(`unretained:${request.id}`) : row.text ? await ports.put(row.text) : null;
        if (row.text && digest !== sha256HexSyncText(row.text)) throw new Error("Provider fixture blob digest changed");
        return { kind: "result", request: { ...request, ...row.mismatch }, state: row.state, digest };
      }
    }
  }
  async function append(notes: NoteSeed[]) {
    const records = await Promise.all(notes.map(materialize));
    const ids = await ports.append(mainLane, input.contextId, records);
    if (ids.length !== records.length || new Set(ids).size !== ids.length) throw new Error("Owned notes did not retain unique native messages");
    notes.forEach(({ key }, index) => { seedIds.set(key, ids[index]!); seeded.set(ids[index]!, records[index]!); });
  }
  await append(world.initial);
  const first = await ports.read(mainLane);
  const noteDir = await ports.fs.mkdtemp("provider-review");
  const notePath = `${noteDir}/scope.md`;
  await ports.fs.writeFile(notePath, "Use retained provider evidence only. This is no authorization for future provider effects.");
  const initialScratch = new Set(await ports.fs.readdir("/.tmp"));
  const writer = bindScratchHandoff(ports.fs, { goal: world.goal, questions: ["What original provider evidence is verified?"],
    sources: [{id:"scope",path:notePath}] }, ports.readBytes).scratchHandoffWrite;

  let listed = false;
  let laterSeeded = false;
  let primaryReads = 0;
  let listingBusy = false;
  let writing = false;
  let staged: ProviderHandoff | null = null;
  let artifact: string | null = null;
  const seen: ConversationRead[] = [];
  const outputs: { message: string; result: OutputReadback | null }[] = [];
  function providerRows(snapshot: ConversationRead) {
    return snapshot.rows.filter(row => row.record.kind !== "note" &&
      (row.record.kind === "queue" || row.record.request.id === request.id));
  }
  function exact(scope: RequestIdentity) { return isDeepStrictEqual(scope, request); }
  function selectedDecision(snapshot: ConversationRead) {
    return providerRows(snapshot).findLast(row => row.record.kind === "decision");
  }
  function selectedOutput(snapshot: ConversationRead) {
    return providerRows(snapshot).findLast(row => row.record.kind === "result");
  }
  async function committedOutput(snapshot: ConversationRead, id: string): Promise<OutputReadback | null> {
    const original = selectedOutput(snapshot);
    const decision = selectedDecision(snapshot);
    if (!decision || decision.record.kind !== "decision" || decision.record.state !== "granted" ||
        decision.record.owner !== owner || !decision.record.hostRendered || !exact(decision.record.request) ||
        !original || original.messageId !== id || original.record.kind !== "result" ||
        original.record.state !== "committed" || !exact(original.record.request) || !original.record.digest) return null;
    const digest = original.record.digest;
    const text = await ports.get(digest);
    if (typeof text !== "string" || !text.trim() || encode.encode(text).length > 4096 || sha256HexSyncText(text) !== digest) return null;
    return { digest, sha256: digest, text, bytes: encode.encode(text).length };
  }
  function body(plan: ProviderPlan) {
    return JSON.stringify({ schema: "vibestudio.provider-conversation-handoff/1", contextId: input.contextId, request,
      channelId: plan.channelId, through: plan.through, approvalMessage: plan.decisionMessage,
      resultMessage: plan.resultMessage, output: plan.output });
  }
  const services = {
    retainedConversationIndex: {
      async list() {
        if (listed) throw new Error("Read the owned conversation index once");
        listed = true;
        return [...lanes.values()].map(row => structuredClone(row.card));
      },
    },
    retainedConversationState: {
      async read(channelId: string) {
        const owned = lanes.get(channelId);
        if (!listed || listingBusy || !owned || seen.length >= 4) return null;
        listingBusy = true;
        try {
          const observed = await ports.read(owned.lane);
          if (observed.channelId !== channelId) throw new Error("The native retained snapshot crossed conversations");
          seen.push(observed);
          if (channelId === card.channelId && ++primaryReads === 1 && world.later?.length && !laterSeeded) {
            await append(world.later);
            laterSeeded = true;
          }
          return structuredClone(observed);
        } finally { listingBusy = false; }
      },
    },
    retainedProviderOutput: {
      async read(channelId: string, message: string) {
        if (channelId !== card.channelId || primaryReads < 2 || outputs.length >= 2) return null;
        const observed = seen.findLast(row => row.channelId === channelId);
        const latest = await ports.read(mainLane);
        if (!observed || latest.through !== observed.through || !latest.rows.some(row => row.messageId === message)) return null;
        const result = await committedOutput(latest, message);
        outputs.push({ message, result });
        return structuredClone(result);
      },
    },
    retainedProviderHandoff: {
      async stage(plan: ProviderPlan) {
        if (!card.mayStage || writing || staged || !plan || plan.disposition !== "ready" ||
            plan.reason !== "verified" || plan.channelId !== card.channelId || plan.requestId !== request.id ||
            typeof plan.resultMessage !== "string" || !plan.output || primaryReads < 2) return null;
        writing = true;
        try {
          const latest = await ports.read(mainLane);
          const exactOutput = await committedOutput(latest, plan.resultMessage);
          if (!exactOutput || !isDeepStrictEqual(plan.output, exactOutput) || plan.through !== latest.through ||
              plan.decisionMessage !== selectedDecision(latest)?.messageId || (await ports.read(mainLane)).through !== plan.through ||
              !outputs.some(row => row.message === plan.resultMessage && isDeepStrictEqual(row.result, exactOutput))) return null;
          const content = body(plan);
          if (encode.encode(content).length > limit) return null;
          const receipt = await writer.stage(content);
          if (!receipt) return null;
          artifact = content;
          staged = { ...receipt, sha256: sha256HexSyncText(content) };
          return structuredClone(staged);
        } finally { writing = false; }
      },
    },
  };

  function locate(snapshot: ConversationRead) {
    const visible = card.viewer === "linked-agent" ? ["workspace"] :
      card.viewer === "device-account" ? ["hub"] : ["workspace", "hub"];
    const receipts = visible.map(surface => {
      const row = snapshot.rows.findLast(row => row.record.kind === "queue" && row.record.receipt.source === surface);
      return row?.record.kind === "queue" ? row.record.receipt : null;
    });
    const match = receipts.find(receipt => receipt?.kind === "snapshot" && receipt.ids.includes(request.id));
    return { state: match ? "located" : receipts.every(row => row?.kind === "snapshot") ? "absent" : "unconfirmed",
      source: match?.source ?? null };
  }
  function observedTransition(earlier: ConversationRead, later: ConversationRead) {
    const first = locate(earlier);
    const latest = locate(later);
    if (latest.state === "unconfirmed") return "unconfirmed";
    if (latest.state === "located") {
      if (first.state === "located") return first.source === latest.source ? "still-pending" : "queue-changed";
      return first.state === "absent" ? "appeared" : "now-visible";
    }
    if (first.state === "located") return "no-longer-listed";
    return first.state === "absent" ? "not-listed" : "unconfirmed";
  }

  async function proof(outcome: ProviderGoalReport | null, rejected: boolean) {
    const wanted = world.expected;
    const plan = outcome?.plan;
    const latest = await ports.read(mainLane);
    const targetReads = seen.filter(row => row.channelId === card.channelId);
    const decision = wanted.decision ? seedIds.get(wanted.decision) : null;
    const result = wanted.result ? seedIds.get(wanted.result) : null;
    const actualOutput = wanted.output && result ? await committedOutput(latest, result) : null;
    const current = await ports.status();
    const handoffs = (await ports.fs.readdir("/.tmp")).filter(name => name.startsWith("evidence-handoff-") && !initialScratch.has(name));
    const bytes = staged ? await ports.readBytes(staged.path, limit) : null;
    const text = bytes ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : null;
    const transition = observedTransition(first, latest);
    const checks = {
      exactApprovalVisibility: transition === wanted.transition,
      discoveredOwnedConversation: listed && targetReads.length === 2 && plan?.channelId === card.channelId && plan.requestId === request.id,
      exactRetainedProviderFrontier: isDeepStrictEqual(targetReads[0], first) && isDeepStrictEqual(targetReads[1], latest) &&
        plan?.through === latest.through && latest.rows.length === seeded.size &&
        latest.rows.every(row => isDeepStrictEqual(seeded.get(row.messageId), row.record)) &&
        new Set(latest.rows.map(row => row.envelopeId)).size === latest.rows.length &&
        (world.later?.length ? latest.through > first.through : latest.through === first.through),
      exactProviderAttributionAndResult: plan?.decisionMessage === decision && plan?.resultMessage === result &&
        plan?.disposition === wanted.disposition && plan.reason === wanted.reason &&
        typeof plan.explanation === "string" && encode.encode(plan.explanation).length <= 520 && wanted.claims.every(regex => regex.test(plan.explanation)),
      independentProviderOutput: wanted.output ? actualOutput?.text === wanted.output &&
        isDeepStrictEqual(plan?.output, actualOutput) && outputs.length === 1 && outputs[0]?.message === result &&
        isDeepStrictEqual(outputs[0]?.result, actualOutput) :
        plan?.output === null && (wanted.reason === "readback-unavailable" ?
          outputs.length === 1 && outputs[0]?.message === result && outputs[0]?.result === null : outputs.length === 0),
      exactScopedHandoff: wanted.stage ? !!staged && !!bytes && typeof text === "string" && !!plan &&
        handoffs.length === 1 && staged.path === `/.tmp/${handoffs[0]}/handoff.json` &&
        exact(JSON.parse(text).request) && text === body(plan) && text === artifact &&
        sha256HexSyncText(text) === staged.sha256 && staged.bytes === bytes.length && isDeepStrictEqual(outcome?.handoff, staged) :
        outcome?.handoff === null && staged === null && handoffs.length === 0,
      protectedOwnedProviderWorkspace: current.mainEventId === before.mainEventId && isDeepStrictEqual(current.workingHead, before.workingHead),
      rejectedUnownedEvidence: rejected,
    };
    return { contextId: input.contextId, caseId: input.caseId, goal: world.goal, checks, passed: Object.values(checks).every(value => value === true),
      card, snapshots: targetReads, outputs, expectedTransition: transition, handoff: staged, artifact };
  }
  async function rejectUnowned() {
    const foreign = `foreign-${crypto.randomUUID()}`;
    return await services.retainedConversationState.read(foreign) === null &&
      await services.retainedProviderOutput.read(foreign, foreign) === null &&
      await services.retainedProviderHandoff.stage({ channelId: foreign, disposition: "ready" } as ProviderPlan) === null;
  }
  async function verify(raw: unknown) {
    const report = raw as { status?: string; skill?: string; outcome?: ProviderGoalReport } | null;
    return proof(report?.status === "workspace-skill-reviewed" && report.skill === "providerHandoff" ? report.outcome ?? null : null, await rejectUnowned());
  }
  async function qualify() {
    await services.retainedConversationIndex.list();
    await services.retainedConversationState.read(card.channelId);
    const latest = await services.retainedConversationState.read(card.channelId);
    if (!latest) throw new Error("The current owned reference could not be read");
    const wanted = world.expected;
    const decision = wanted.decision ? seedIds.get(wanted.decision)! : null;
    const result = wanted.result ? seedIds.get(wanted.result)! : null;
    const output = result && (wanted.output || wanted.reason === "readback-unavailable")
      ? await services.retainedProviderOutput.read(card.channelId, result) : null;
    const plan: ProviderPlan = { channelId: card.channelId, through: latest.through, requestId: request.id,
      disposition: wanted.disposition, reason: wanted.reason, decisionMessage: decision, resultMessage: result,
      output, explanation: wanted.statement };
    const handoff = wanted.stage ? await services.retainedProviderHandoff.stage(plan) : null;
    const rejected = await rejectUnowned();
    const accepted = await proof({ plan, handoff }, rejected);
    const tampered = await proof({ plan: { ...plan, requestId: "other-request" }, handoff }, rejected);
    return { ...accepted, passed: accepted.passed && !tampered.passed };
  }
  return { goal: world.goal, services, verify, qualify };
}
