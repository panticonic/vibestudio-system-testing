import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  createEvalExecutor, createEvalRunHandle, EVAL_OPERATION_JOURNAL_MAX_ENTRIES,
  type EvalCall, type EvalResultReceipt, type EvalStartInput,
} from "@vibestudio/service-schemas/eval";
import type { EvalMode } from "./open-goal-eval-handoff-worlds.js";

export type EvalRetryGate = { path: string; blocked: "park" | "reject" };
export type OwnedEvalRequest = { contextId: string; mode: EvalMode; text: string; runId: string; retryGate?: EvalRetryGate };
export type OwnedEvalRun = {
  request: OwnedEvalRequest;
  admission: EvalStartInput;
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

export function openEvalHandoffNative(call: EvalCall) {
  const execute = createEvalExecutor(call);
  const ownedScopes = new Set<string>();
  async function readText(digest: string) {
    return call("blobstore.getText", [digest]);
  }
  async function waitForParkedStore(request: OwnedEvalRequest, handle: ReturnType<typeof createEvalRunHandle>) {
    const digest = sha256HexSyncText(request.text);
    for (let observation = 0; observation < 250; observation++) {
      if (await readText(digest) === request.text) return;
      const state = await handle.get();
      if (state.status === "done" || state.status === "cancelled" || state.status === "approval-route-lost")
        throw new Error("The owned attempt settled before the intended durable write and cooperative cancellation");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Timed out observing the managed probe's owned pre-cancel write");
  }
  async function run(request: OwnedEvalRequest): Promise<OwnedEvalRun> {
    const scopeKey = `open-eval-handoff-${crypto.randomUUID()}`;
    const admission: EvalStartInput = {
      runId: request.runId, scope: { key: scopeKey, lifecycle: "finite" },
      source: { kind: "inline", syntax: "typescript", code: openEvalProbeCode(request) },
    };
    ownedScopes.add(scopeKey);
    const handle = createEvalRunHandle(call, admission);
    const cancelled = request.mode.startsWith("cancelled-");
    let startedDigest: string | null = null;
    if (cancelled) {
      const opened = await handle.start();
      if (opened.runId !== request.runId || opened.status === "terminal") throw new Error("The owned cancellation probe was not admitted");
      startedDigest = opened.runDigest;
      try {
        if (request.mode === "cancelled-store") await waitForParkedStore(request, handle);
      } finally {
        const cancellation = await handle.cancel();
        if (!cancellation.ok || cancellation.forcedReset) throw new Error("The cancellable native cell did not stop cooperatively");
      }
    } else {
      const result = await execute(admission);
      if (result.success === request.mode.startsWith("failed-")) throw new Error("The owned native eval returned the wrong lifecycle outcome");
    }
    const snapshot = await handle.get();
    if (snapshot.status !== (cancelled ? "cancelled" : "done")) throw new Error("The owned native eval lacks its exact terminal state");
    const receipt = await call("eval.receipt", [{ scopeKey, runId: request.runId }]);
    if (!receipt || receipt.runId !== request.runId || !isDeepStrictEqual(snapshot.result, receipt.result) ||
        (cancelled && receipt.result.failureKind !== "cancelled"))
      throw new Error("The terminal native receipt did not match the observed run");
    const runDigest = receipt.runDigest;
    if (!runDigest || (startedDigest && startedDigest !== runDigest)) throw new Error("The receipt did not retain its admitted run identity");
    return { request, admission, terminal: cancelled ? "cancelled" : receipt.result.success ? "returned" : "failed",
      runDigest, receipt, physicallyStored: await readText(sha256HexSyncText(request.text)) === request.text };
  }

  async function replay(run: OwnedEvalRun) {
    const handle = createEvalRunHandle(call, run.admission);
    const next = await handle.start();
    const receipt = await call("eval.receipt", [handle.route]);
    return next.status === "terminal" && next.runId === run.request.runId && next.runDigest === run.runDigest &&
      next.snapshot?.status === (run.terminal === "cancelled" ? "cancelled" : "done") && isDeepStrictEqual(receipt, run.receipt);
  }

  async function retained(run: OwnedEvalRun) {
    const handle = createEvalRunHandle(call, run.admission);
    return isDeepStrictEqual(await call("eval.receipt", [handle.route]), run.receipt) &&
      ((await handle.get()).status === (run.terminal === "cancelled" ? "cancelled" : "done"));
  }

  async function close() {
    const failures = [];
    for (const scopeKey of ownedScopes) {
      try { await call("eval.dispose", [{ scopeKey }]); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Could not dispose the owned eval handoff scopes");
  }

  return { run, readText, retained, replay, close };
}
