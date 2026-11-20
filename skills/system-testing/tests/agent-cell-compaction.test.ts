import { describe, expect, it, vi } from "vitest";
import { schemaRpcMock } from "@vibestudio/rpc/test-utils";
import { readNativeTurnReceipt } from "../agent-cell-compaction.js";
import { evalLifecycleTests } from "./eval-lifecycle.js";

const test = evalLifecycleTests.find(
  (candidate) => candidate.name === "agent-cell-compaction-soak",
)!;
const evidence = () => ({
  turns: 65,
  validatedTurns: 65,
  modelCalls: 0,
  nativeReceiptDigest: "a".repeat(64),
  fork: {
    operationId: "native-fork-test", forkedContextId: "owned-fork-context",
    forkedChannelId: "fork-channel", clonedAgentTargetId: "do:cloned-agent",
    clonedAgentCount: 1, sourceSequence: 100, forkSequence: 101,
    adopted: true, modelPreserved: true, elapsedMs: 12,
  },
  firstStorage: {
    engine: "dolt",
    compaction: {
      head: "initial",
      lastCollectedHead: null,
      observedCommitsAtLastCollection: null,
      logLimit: 10000,
    },
  },
  lastStorage: {
    engine: "dolt",
    compaction: {
      head: "after",
      lastCollectedHead: "collected",
      observedCommitsAtLastCollection: 64,
      logLimit: 10000,
    },
  },
});
async function validate(probe: unknown) {
  return test.validate!({
    messages: [],
    duration: 0,
    diagnostics: { agentCellCompaction: probe },
  });
}
describe("actual agent compaction evidence", () => {
  it("accepts joined model-free turns with a real collection observation", async () => {
    expect(await validate(evidence())).toMatchObject({ passed: true });
  });
  it.each([
    [
      "not enough turns",
      (p: ReturnType<typeof evidence>) => {
        p.turns = 64;
      },
    ],
    [
      "unjoined results",
      (p: ReturnType<typeof evidence>) => {
        p.validatedTurns = 64;
      },
    ],
    [
      "a model was used",
      (p: ReturnType<typeof evidence>) => {
        p.modelCalls = 1;
      },
    ],
    [
      "no collection",
      (p: ReturnType<typeof evidence>) => {
        p.lastStorage.compaction.lastCollectedHead = "";
      },
    ],
    [
      "premature collection",
      (p: ReturnType<typeof evidence>) => {
        p.lastStorage.compaction.observedCommitsAtLastCollection = 63;
      },
    ],
    [
      "no receipt chain",
      (p: ReturnType<typeof evidence>) => {
        p.nativeReceiptDigest = "";
      },
    ],
  ] as const)("rejects %s", async (_name, change) => {
    const probe = evidence();
    change(probe);
    expect(await validate(probe)).toMatchObject({ passed: false });
  });
  it("rejects a missing observation instead of throwing", async () => {
    expect(
      await validate({ turns: 65, validatedTurns: 65, modelCalls: 0 }),
    ).toMatchObject({ passed: false });
  });
});

it.each([65, 10000])("joins the durable workload owner for %i turns and preserves its original failure and cleanup evidence", async (turns) => {
  const controller = new AbortController();
  const result = {
    messages: [], duration: 7, error: "original failure",
    cleanupErrors: ["original cleanup failure"],
  };
  let finish!: (value: typeof result) => void;
  const runAgentCellCompaction = vi.fn(() => new Promise<typeof result>((resolve) => { finish = resolve; }));
  const spawn = vi.fn();
  const selected = turns === 65 ? test : evalLifecycleTests.find((candidate) => candidate.name === "agent-cell-fork-benchmark")!;
  const running = selected.orchestrate!({
    runner: { spawn, withCaseContext: (operation: (id: string) => Promise<unknown>) => operation("case-context") } as never,
    signal: controller.signal,
    remainingTimeMs: () => 1000,
    diagnostics: {},
    sendAndWait: vi.fn(),
    runAgentCellCompaction,
  });
  expect(runAgentCellCompaction).toHaveBeenCalledWith(controller.signal, "case-context", turns);
  expect(spawn).not.toHaveBeenCalled();
  finish(result);
  expect(await running).toBe(result);
});

it("keeps the long measurement explicit and requires all 10,000 joined turns", async () => {
  const benchmark = evalLifecycleTests.find((candidate) => candidate.name === "agent-cell-fork-benchmark")!;
  expect(benchmark.explicitOnly).toBe(true);
  expect(await benchmark.validate!({ messages: [], duration: 0, diagnostics: { agentCellCompaction: evidence() } })).toMatchObject({ passed: false });
  expect(await benchmark.validate!({ messages: [], duration: 0, diagnostics: { agentCellCompaction: { ...evidence(), turns: 10000, validatedTurns: 10000 } } })).toMatchObject({ passed: true });
});
it.each(["adoption", "model", "history", "measurement"])("rejects missing fork %s proof", async (kind) => {
  const probe = evidence();
  if (kind === "adoption") probe.fork.adopted = false;
  if (kind === "model") probe.fork.modelPreserved = false;
  if (kind === "history") probe.fork.forkSequence = 99;
  if (kind === "measurement") probe.fork.elapsedMs = NaN;
  expect(await validate(probe)).toMatchObject({ passed: false });
});


describe("native benchmark receipts", () => {
  const digest = "f".repeat(64);
  const invocationId = "invocation:exact";
  const input = {
    channelTarget: "do:channel",
    channelId: "channel", executorId: "do:agent", runId: "run:one", turn: 12, after: 40,
  };
  const value = { marker: "P4_NATIVE_TURN", turn: input.turn, storage: null };
  const stored = JSON.stringify({ details: { returnValue: value } });
  function fixture({
    callId = "automation:run:one:eval", completedInvocationId = invocationId,
  } = {}) {
    const call = vi.fn(async (target: string, method: string, args: unknown[]) => {
      if (target === input.channelTarget && method === "getReplayAfter") {
        const { after } = args[0] as { after: number };
        if (after === 40) return {
          ready: { snapshotLastSeq: 42, hasMoreAfter: true, replayToId: 41 },
          logEvents: [{
            id: 41, messageId: "start",
            payload: {
              kind: "invocation.started", causality: { invocationId },
              payload: {
                name: "eval",
                nativeSource: {
                  owner: { runtimeId: input.executorId, channelId: input.channelId },
                  operation: { kind: "direct-tool", callId },
                },
              },
            },
          }],
        };
        expect(args).toEqual([{ after: 41, limit: 32, throughSeq: 42 }]);
        return {
          ready: { snapshotLastSeq: 42, hasMoreAfter: false },
          logEvents: [{
            id: 42, messageId: "terminal",
            payload: {
              kind: "invocation.completed", causality: { invocationId: completedInvocationId },
              payload: {
                result: { protocol: "vibestudio.blob-ref.v1", digest, size: stored.length, encoding: "json", originalBytes: stored.length },
              },
            },
          }],
        };
      }
      if (target === "main" && method === "blobstore.getText") {
        expect(args).toEqual([digest]);
        return stored;
      }
      throw new Error(`Unexpected benchmark read ${target} ${method}`);
    });
    return schemaRpcMock({ call });
  }

  it("reads a stored result from the exact paged channel completion", async () => {
    await expect(readNativeTurnReceipt(fixture(), input)).resolves.toEqual({
      after: 42, invocationId, value,
    });
  });

  it("rejects a completion for a different run or invocation", async () => {
    await expect(readNativeTurnReceipt(fixture({ callId: "automation:run:other:eval" }), input))
      .rejects.toThrow("has no exact durable completion");
    await expect(readNativeTurnReceipt(fixture({ completedInvocationId: "invocation:foreign" }), input))
      .rejects.toThrow("has no exact durable completion");
  });
});
