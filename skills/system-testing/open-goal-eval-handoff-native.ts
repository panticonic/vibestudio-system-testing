import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { RpcCaller } from "@vibestudio/rpc";
import {
  createDynamicCodeRunObserver, startDynamicCodeRun,
} from "@vibestudio/service-schemas/dynamicCode";
import {
  EVAL_OPERATION_JOURNAL_MAX_ENTRIES, evalResultReceiptSchema, settledResult,
  type EvalResultReceipt, type EvalStartInput,
} from "@vibestudio/service-schemas/eval";
import { createMainRpcCaller } from "@vibestudio/service-schemas/mainRpc";
import type { EvalMode } from "./open-goal-eval-handoff-worlds.js";

export type EvalRetryGate = { path: string; blocked: "park" | "reject" };
export type OwnedEvalRequest = { contextId: string; mode: EvalMode; text: string; runId: string; retryGate?: EvalRetryGate };
export type OwnedEvalRun = {
  request: OwnedEvalRequest;
  admission: EvalStartInput & { scope: { key: string; lifecycle: "finite" } };
  terminal: "returned" | "failed" | "cancelled";
  runDigest: string;
  receipt: EvalResultReceipt | null;
  physicallyStored: boolean;
};

export const wroteOutput = (mode: EvalMode) => !["failed-empty", "returned-empty", "cancelled-empty"].includes(mode);

/** The author fixes each finite cell's code and data. Natlang receives no code-writing callback. */
export function openEvalProbeCode({ contextId, mode, text, retryGate }: OwnedEvalRequest): string {
  const digest = sha256HexSyncText(text);
  const read = `await rpc.call("main", mainRpcMethods["blobstore.getText"], [${JSON.stringify(digest)}]);`;
  const store = (value: string) => `await rpc.call("main", mainRpcMethods["blobstore.putText"], [${JSON.stringify(value)}]);`;
  const fill = `for (let i = 0; i < ${EVAL_OPERATION_JOURNAL_MAX_ENTRIES + 1}; i++) { ${read} }`;
  const parked = "await new Promise(() => {});";
  const operations = {
    "returned-store": [store(text)], "failed-store": [store(text)],
    "failed-empty": [read], "returned-empty": [read],
    "cancelled-empty": [parked], "cancelled-store": [store(text), parked],
    "truncated-before-store": [fill, store(text)], "truncated-after-store": [store(text), fill],
    duplicate: [store(text), store(text)], conflicting: [store(text), store(`${text}Competing unapproved result.\n`)],
  }[mode];
  const header = [
    'import { contextId as actualContext, fs, rpc } from "@workspace/runtime";',
    'import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";',
    `if (actualContext !== ${JSON.stringify(contextId)}) throw new Error("Eval recovery left its owned context");`,
  ];
  const failure = 'throw new Error("The own eval handoff ended with the authored failure");';
  const success = 'return { completed: true };';
  if (retryGate) {
    const blocked = retryGate.blocked === "park" ? [parked] : [read, failure];
    return [...header, `const prerequisite = await fs.readFile(${JSON.stringify(retryGate.path)}, "utf8");`,
      'if (prerequisite !== "ready") {', ...blocked.map(line => `  ${line}`), '}', store(text), success].join("\n");
  }
  return [...header, ...operations, mode.startsWith("failed-") ? failure : success].join("\n");
}

type RunObserver = ReturnType<typeof createDynamicCodeRunObserver>;

export function openEvalHandoffNative(rpc: Pick<RpcCaller, "call">) {
  const call = createMainRpcCaller(rpc);
  const ownedScopes = new Map<string, RunObserver | null>();
  async function readText(digest: string) {
    return call("blobstore.getText", [digest]);
  }
  async function waitForParkedStore(request: OwnedEvalRequest, observer: RunObserver) {
    const digest = sha256HexSyncText(request.text);
    for (let observation = 0; observation < 250; observation++) {
      if (await readText(digest) === request.text) return;
      const state = await observer.get();
      if (state.status === "done" || state.status === "cancelled" || state.status === "approval-route-lost")
        throw new Error("The owned attempt settled before the intended durable write and cooperative cancellation");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Timed out observing the managed probe's owned pre-cancel write");
  }
  async function run(request: OwnedEvalRequest): Promise<OwnedEvalRun> {
    const scopeKey = `open-eval-handoff-${crypto.randomUUID()}`;
    const admission: OwnedEvalRun["admission"] = {
      runId: request.runId, scope: { key: scopeKey, lifecycle: "finite" },
      source: { kind: "inline", syntax: "typescript", code: openEvalProbeCode(request) },
    };
    ownedScopes.set(scopeKey, null);
    const { admission: admitted, observer, started } = await startDynamicCodeRun(rpc, admission);
    ownedScopes.set(scopeKey, observer);
    if (admitted.runId !== request.runId || started.runId !== request.runId)
      throw new Error("The owned run was not admitted");
    const cancelled = request.mode.startsWith("cancelled-");
    if (cancelled) {
      try {
        if (request.mode === "cancelled-store") await waitForParkedStore(request, observer);
      } finally {
        const cancellation = await observer.cancel();
        if (!cancellation.ok || cancellation.forcedReset) throw new Error("The cancellable native cell did not stop cooperatively");
      }
    } else {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const state = await observer.await(400);
        const result = settledResult(state);
        if (result) {
          if (result.success === request.mode.startsWith("failed-")) throw new Error("The owned native eval returned the wrong lifecycle outcome");
          break;
        }
        if (state.status === "unknown" || Date.now() >= deadline) throw new Error("The owned native eval did not settle");
      }
    }
    const snapshot = await observer.get();
    if (snapshot.status !== (cancelled ? "cancelled" : "done")) throw new Error("The owned native eval lacks its exact terminal state");
    const receipt = evalResultReceiptSchema.parse(await observer.receipt());
    if (receipt.runId !== request.runId || !isDeepStrictEqual(snapshot.result, receipt.result) ||
        (cancelled && receipt.result.failureKind !== "cancelled"))
      throw new Error("The terminal native receipt did not match the observed run");
    const runDigest = receipt.runDigest;
    if (!runDigest || (started.runDigest && started.runDigest !== runDigest))
      throw new Error("The receipt did not retain its admitted run identity");
    return { request, admission, terminal: cancelled ? "cancelled" : receipt.result.success ? "returned" : "failed",
      runDigest, receipt, physicallyStored: await readText(sha256HexSyncText(request.text)) === request.text };
  }

  async function replay(run: OwnedEvalRun) {
    const { admission, observer, started } = await startDynamicCodeRun(rpc, run.admission);
    const original = ownedScopes.get(run.admission.scope.key);
    const snapshot = await observer.get();
    const receipt = await observer.receipt();
    return admission.hostId === original?.route.hostId && started.runId === run.request.runId &&
      started.runDigest === run.runDigest &&
      snapshot.status === (run.terminal === "cancelled" ? "cancelled" : "done") &&
      isDeepStrictEqual(receipt, run.receipt);
  }

  async function retained(run: OwnedEvalRun) {
    const observer = ownedScopes.get(run.admission.scope.key);
    return !!observer && isDeepStrictEqual(await observer.receipt(), run.receipt) &&
      (await observer.get()).status === (run.terminal === "cancelled" ? "cancelled" : "done");
  }

  async function close() {
    const failures = [];
    for (const [scopeKey, observer] of ownedScopes) {
      try { await observer?.release(); }
      catch (error) { failures.push(error); }
      try { await call("dynamicCode.dispose", [{ scopeKey }]); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Could not dispose the owned eval handoff scopes");
  }

  return { run, readText, retained, replay, close };
}
