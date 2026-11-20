import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  createEvalExecutor, createEvalRunHandle, evalEventsPageSchema, evalResultReceiptSchema,
  type EvalCall, type EvalResultReceipt, type EvalRunEvent, type EvalStartInput,
} from "@vibestudio/service-schemas/eval";

export type RetainedRun = { runId: string; scopeKey: string; code: string; receipt: EvalResultReceipt };
export type NativeEventPage = { events: EvalRunEvent[]; complete: boolean };
export function bindAgentCapabilityEval(call: EvalCall) {
  const execute = createEvalExecutor(call);
  const scopes = new Set<string>();
  const usedScopes = new Set<string>();
  function owned(scopeKey: string) {
    if (!scopes.has(scopeKey)) throw new Error("Only the disposable owned notebook scopes may be accessed");
  }
  function allocateScope() {
    const key = "agent-capability-" + crypto.randomUUID();
    scopes.add(key);
    return key;
  }
  async function observe(run: Pick<RetainedRun, "scopeKey" | "runId">) {
    owned(run.scopeKey);
    const route = { scopeKey: run.scopeKey, runId: run.runId };
    const found = await call("eval.receipt", [route]);
    const receipt = evalResultReceiptSchema.parse(found);
    const state = await call("eval.get", [route]);
    if (receipt.runId !== run.runId || !("result" in state) || !isDeepStrictEqual(receipt.result, state.result) ||
        !["done", "cancelled"].includes(state.status))
      throw new Error("The native action did not retain its exact terminal receipt");
    return receipt;
  }
  async function run(scopeKey: string, code: string, cancelBeforeAdmission = false): Promise<RetainedRun> {
    owned(scopeKey);
    usedScopes.add(scopeKey);
    const runId = "owned-capability-step-" + crypto.randomUUID();
    const admission: EvalStartInput = {
      runId, scope: { key: scopeKey, lifecycle: "finite" }, source: { kind: "inline", syntax: "typescript", code },
    };
    if (cancelBeforeAdmission) {
      const result = await createEvalRunHandle(call, admission).cancel();
      if (!result.ok || result.forcedReset) throw new Error("Cancelling the unadmitted cell changed its notebook");
    } else {
      await execute(admission);
    }
    return { scopeKey, runId, code, receipt: await observe({ scopeKey, runId }) };
  }
  async function events(run: RetainedRun): Promise<NativeEventPage> {
    owned(run.scopeKey);
    let after = 0;
    const events: EvalRunEvent[] = [];
    for (let pageIndex = 0; pageIndex < 32; pageIndex++) {
      const page = evalEventsPageSchema.parse(await call("eval.events", [{
        scopeKey: run.scopeKey, runId: run.runId, after, limit: 3,
      }]));
      for (const event of page.events) {
        if (event.sequence !== after + 1 || (event.kind === "diagnostic" &&
          (event.payload as { code?: string } | null)?.code === "event-retention-gap")) return { events, complete: false };
        events.push(event);
        after = event.sequence;
      }
      if (page.next !== after) return { events, complete: false };
      if (!page.hasMore) return { events, complete: true };
      if (!page.events.length) return { events, complete: false };
    }
    return { events, complete: false };
  }
  async function text(scopeKey: string, key: string): Promise<string> {
    owned(scopeKey);
    const limit = 4096;
    let offset = 0;
    let length: number | undefined;
    const chunks: Buffer[] = [];
    do {
      const page = await call("eval.readScopeTextPage", [{ scopeKey, key, offset, limit }]);
      if (page.encoding !== "utf16le-base64" || !Number.isSafeInteger(page.length) || page.length < 0 ||
          page.length > 32768 || length !== undefined && page.length !== length)
        throw new Error("The owned notebook text exceeded its evidence bound or changed length");
      length = page.length;
      const bytes = Buffer.from(page.chunk, "base64");
      if (bytes.length !== Math.min(limit, length - offset) * 2)
        throw new Error("The owned notebook page did not carry the exact UTF-16LE length");
      chunks.push(bytes);
      offset += bytes.length / 2;
    } while (offset < length);
    return Buffer.concat(chunks).toString("utf16le");
  }
  async function close() {
    const results = await Promise.allSettled([...usedScopes].map(scopeKey => call("eval.dispose", [{ scopeKey }])));
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Unable to release isolated owned agent capability notebooks");
  }
  return { allocateScope, run, observe, events, text, close };
}

export function consoleDigest(console: string) {
  const lines = console ? console.split("\n") : [];
  return { lines: lines.length, tail: lines.at(-1)?.slice(-160) ?? null, sha256: sha256HexSyncText(console) };
}
