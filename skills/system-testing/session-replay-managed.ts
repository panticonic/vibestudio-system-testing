import { isDeepStrictEqual } from "node:util";
import { HeadlessSession } from "@workspace/agentic-session";
import { rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import type { AgenticEvent } from "@workspace/agentic-protocol";
import type {
  LiveReplayReport,
  LiveReplayRequest,
  ReplayCheckpoint,
  ReplayMessage,
  ReplayOperation,
} from "../session-test-review/types.js";
import {
  composedSessionReplayWorlds,
  managedSessionReplayWorlds,
} from "./session-replay-worlds.js";

type Lane = { key: string; target: string; expected: ReplayMessage[] };

export async function createOwnedHeadlessChannel(contextId: string, title: string): Promise<Lane> {
  const key = `natlang-channel-${crypto.randomUUID()}`;
  const { targetId: target, contextId: owner } = await rpc.call(
    "main",
    mainRpcMethods["runtime.createEntity"],
    [
      {
        kind: "do",
        execution: { surface: "code", source: "workers/pubsub-channel" },
        className: "PubSubChannel",
        key,
        contextId,
      },
    ],
  );
  if (owner !== contextId)
    throw new Error("Replay channel belongs to another context");
  await rpc.call(target, channelClientRpcMethods.initializeConversation, [
    contextId,
    { title },
  ]);
  return { key, target, expected: [] };
}

async function durableRows(
  lane: Lane,
  signal: AbortSignal,
): Promise<ReplayMessage[]> {
  const page = await rpc.call(
    lane.target,
    channelRpcMethods.getReplayAfter,
    [{ after: 0, limit: 100 }],
    { signal },
  );
  if (page.ready.hasMoreAfter)
    throw new Error("Replay window exceeds the assigned channel scope");
  return page.logEvents.flatMap((envelope) => {
    const event = envelope.payload as
      | AgenticEvent<"message.completed">
      | undefined;
    if (event?.kind !== "message.completed") return [];
    const { payload } = event;
    if (!("role" in payload) || payload.role !== "user") return [];
    const id = event.causality?.messageId;
    const senderId = envelope.senderId;
    if (!id || !senderId)
      throw new Error("A durable user message is missing its identity");
    return [
      {
        id,
        senderId,
        text: (payload.blocks ?? [])
          .flatMap((block) => (block.type === "text" ? [block.content] : []))
          .join(""),
      },
    ];
  });
}

async function observe(
  lane: Lane,
  client: HeadlessSession,
  signal: AbortSignal,
) {
  const durable = await durableRows(lane, signal);
  if (!isDeepStrictEqual(durable, lane.expected))
    throw new Error(
      `Durable message log differs from accepted history: expected ${lane.expected.length}, saw ${durable.length}`,
    );
  return client.waitUntil(
    () => {
      const snapshot = client.messages.map(
        ({ id, content: text, senderId }) => ({ id, text, senderId }),
      );
      return isDeepStrictEqual(snapshot, durable) ? snapshot : undefined;
    },
    { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) },
  );
}

export async function withOwnedChannelClient<T>(
  lane: Lane,
  contextId: string,
  run: (client: HeadlessSession) => Promise<T>,
) {
  const client = HeadlessSession.create({
    config: { clientId: rpc.selfId, rpc },
  });
  try {
    await client.connect(lane.key, {
      contextId,
      channelTargetId: lane.target,
      methods: {},
    });
    if (client.channelId !== lane.key)
      throw new Error("Headless client connected to another channel");
    return await run(client);
  } finally {
    await client.close();
  }
}

function world(caseId: string) {
  const found = managedSessionReplayWorlds.find(({ id }) => id === caseId);
  if (!found) throw new Error("Unknown live session replay assignment");
  return found;
}

export async function exerciseSessionReplay(
  contextId: string,
  caseId: string,
  signal: AbortSignal,
) {
  const assigned = world(caseId);
  const primary = await createOwnedHeadlessChannel(contextId, "Owned continuation source");
  const hasAlternative = assigned.steps.some(({ action }) =>
    action.startsWith("other-channel"),
  );
  const alternate = hasAlternative
    ? await createOwnedHeadlessChannel(contextId, "Owned comparison channel")
    : null;
  const originals = await withOwnedChannelClient(primary, contextId, async (client) => {
    const accepted: ReplayOperation[] = [];
    for (const [index, text] of assigned.messages.entries()) {
      signal.throwIfAborted();
      const key = `source-${index}`;
      const messageId = await client.send(text, { idempotencyKey: key });
      primary.expected.push({ id: messageId, text, senderId: rpc.selfId });
      accepted.push({ key, text, messageId });
    }
    await observe(primary, client, signal);
    return accepted;
  });
  if (alternate) {
    await withOwnedChannelClient(alternate, contextId, async (client) => {
      const text = assigned.messages[0]!;
      const messageId = await client.send(text, {
        idempotencyKey: "comparison-copy",
      });
      alternate.expected.push({ id: messageId, text, senderId: rpc.selfId });
      await observe(alternate, client, signal);
    });
  }
  const evidence: ReplayCheckpoint[] = [];
  const submitted = new Map<string, ReplayOperation>();
  for (const [index, step] of assigned.steps.entries()) {
    signal.throwIfAborted();
    const original = originals[step.original];
    if (!original) throw new Error("Replay assignment has no original send");
    const lane =
      step.action.startsWith("other-channel") && alternate
        ? alternate
        : primary;
    const originBefore = await durableRows(primary, signal);
    if (!isDeepStrictEqual(originBefore, primary.expected))
      throw new Error("The originating channel drifted before reconnect");
    evidence.push(
      await withOwnedChannelClient(lane, contextId, async (client) => {
        const before = await observe(lane, client, signal);
        let retry: ReplayOperation | null = null;
        if (step.action !== "inspect" && step.action !== "other-channel") {
          const key =
            step.action === "append" ? `additional-${index}` : original.key;
          const text = step.text ?? original.text;
          const messageId = await client.send(text, { idempotencyKey: key });
          const prior =
            lane === primary && key === original.key
              ? original
              : submitted.get(lane.key + "/" + key);
          if (prior && messageId !== prior.messageId)
            throw new Error("Retry returned a new accepted identity");
          if (!prior) {
            if (lane.expected.some(({ id }) => messageId === id))
              throw new Error("Fresh send returned an existing identity");
            lane.expected.push({ id: messageId, text, senderId: rpc.selfId });
            submitted.set(lane.key + "/" + key, { key, text, messageId });
          }
          retry = { key, text, messageId };
        }
        const after = await observe(lane, client, signal);
        return {
          receipt: `${contextId}:replay:${index + 1}`,
          originalChannel: primary.target,
          replayChannel: lane.target,
          original,
          retry,
          originBefore,
          before,
          after,
        };
      }),
    );
  }
  if (!isDeepStrictEqual(await durableRows(primary, signal), primary.expected))
    throw new Error("The originating channel drifted during replay");
  return evidence;
}

export function bindSessionReplay(
  contextId: string,
  caseId: string,
  evidence: ReplayCheckpoint[],
) {
  const assigned = world(caseId);
  const checkpoints = assigned.steps.map(
    (_, index) => `${contextId}:replay:${index + 1}`,
  );
  if (
    !isDeepStrictEqual(
      evidence.map(({ receipt }) => receipt),
      checkpoints,
    )
  )
    throw new Error("Replay evidence does not match the assignment");
  const request: LiveReplayRequest = { goal: assigned.goal, checkpoints };
  const reads: string[] = [];
  const services = {
    sessionReplay: {
      async inspect(receipt: string) {
        if (receipt !== checkpoints[reads.length])
          throw new Error("Read the assigned checkpoints once in order");
        reads.push(receipt);
        return structuredClone(evidence[reads.length - 1]!);
      },
    },
  };

  function reference(): LiveReplayReport {
    return {
      findings: evidence.map(({ receipt, original, retry, after }, index) => ({
        receipt,
        disposition: assigned.steps[index]!.expected,
        originalId: original.messageId,
        retryId: retry?.messageId ?? null,
        retainedIds: after.map(({ id }) => id),
      })),
    };
  }
  function verify(report: unknown) {
    const checks = {
      exactReadOrder: isDeepStrictEqual(reads, checkpoints),
      reportMatchesReplay: isDeepStrictEqual(report, reference()),
    };
    return {
      caseId,
      evidence,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }
  return {
    request,
    services,
    reference,
    verify,
    describesProgram:
      assigned === managedSessionReplayWorlds[0] ||
      assigned === composedSessionReplayWorlds[0],
  };
}
