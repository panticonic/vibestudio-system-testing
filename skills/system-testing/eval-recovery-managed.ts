import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { EVAL_OPERATION_JOURNAL_MAX_ENTRIES, type EvalOperationJournal } from "@vibestudio/service-schemas/eval";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { rpc } from "@workspace/runtime";
import { bindEvalRecovery } from "@workspace-skills/eval-recovery-bindings";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedEvalRecoveryWorlds } from "./eval-recovery-worlds.js";

type Services = ReturnType<typeof bindEvalRecovery>["services"];
type Attempt = Awaited<ReturnType<Services["evalRecoveryJournal"]["observe"]>>;
type Readback = Awaited<ReturnType<Services["evalRecoveryReadback"]["read"]>>;
type Report = {
  runId: string;
  cell: string;
  journal: string;
  readback: Readback | null;
  effect: string;
  next: string;
  reason: string;
};
type Input = { contextId: string; caseId: string };
type Probe = {
  runId: string;
  success: boolean;
  operationJournal?: EvalOperationJournal;
};

function worldFor(caseId: string) {
  const world = managedEvalRecoveryWorlds.find(({ id }) => caseId === id);
  if (!world) throw new Error("Unknown assigned eval recovery");
  return world;
}

function expectedText(input: Input) {
  return `Assigned recovery evidence for ${input.caseId} in ${input.contextId}.\n`;
}

function unrelatedText(input: Input) {
  return `Unrelated recovery evidence for ${input.caseId} in ${input.contextId}.\n`;
}

/** The system test owns this finite cell and the only values interpolated into it. */
export function evalRecoveryProbeCode(input: Input): string {
  const world = worldFor(input.caseId);
  const text = expectedText(input);
  const store = (value: string) =>
    `await rpc.call("main", mainRpcMethods["blobstore.putText"], [${JSON.stringify(value)}]);`;
  const read = `await rpc.call("main", mainRpcMethods["blobstore.getText"], [${JSON.stringify(sha256HexSyncText(text))}]);`;
  const fill = `for (let i = 0; i < ${EVAL_OPERATION_JOURNAL_MAX_ENTRIES + 1}; i++) { ${read} }`;
  const operations = world.journalCase === "truncated-before-store" ? [fill, store(text)]
    : world.journalCase === "truncated-after-store" ? [store(text), fill]
    : world.journalCase === "duplicate" ? [store(text), store(text)]
    : world.journalCase === "conflicting" ? [store(text), store(unrelatedText(input))]
    : world.stored ? [store(text)] : [read];
  const outcome = world.fails
    ? 'throw new Error("Intentional failure after the assigned store");'
    : "return { stored: true };";
  return `
    import { contextId as actualContextId, rpc } from "@workspace/runtime";
    import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
    if (actualContextId !== ${JSON.stringify(input.contextId)})
      throw new Error("Recovery probe belongs to another context");
    ${operations.join("\n")}
    ${outcome}
  `;
}

export function prepareManagedEvalRecovery(input: Input, probe: Probe) {
  const { contextId, caseId } = input;
  const world = worldFor(caseId);
  const text = expectedText(input);
  const digest = sha256HexSyncText(text);
  const truncated = world.journalCase?.startsWith("truncated-") === true;
  const expectedJournal = truncated ? "incomplete"
    : world.journalCase ? "mismatch"
    : world.stored ? "matched" : "absent";
  const readExpected = world.allowReadback && expectedJournal === "matched";
  const observedStores = world.journalCase === "conflicting" ? [text, unrelatedText(input)]
    : world.journalCase === "duplicate" ? [text, text]
    : world.journalCase === "truncated-before-store" || !world.stored ? [] : [text];
  const bound = bindEvalRecovery({
    goal: world.goal,
    contextId,
    runId: probe.runId,
    expectedText: text,
    result: {
      success: probe.success,
      operationJournal: probe.operationJournal,
    },
    allowReadback: world.allowReadback,
  });
  let attempt: Attempt | undefined;
  let readback: Readback | null = null;
  const services: Services = {
    evalRecoveryJournal: {
      async observe(id) {
        const result = await bound.services.evalRecoveryJournal.observe(id);
        attempt = structuredClone(result);
        return result;
      },
    },
    evalRecoveryReadback: {
      async read(id, digest) {
        const result = await bound.services.evalRecoveryReadback.read(
          id,
          digest,
        );
        readback = { ...result };
        return result;
      },
    },
  };

  async function verify(report: Report | null) {
    const hostRead = await rpc.call(
      "main",
      mainRpcMethods["blobstore.getText"],
      [digest],
    );
    const expectedCell = world.fails ? "failed" : "returned";
    const expectedEffect = readExpected ? "confirmed" : "unchecked";
    const checks = {
      original:
        !!probe.runId &&
        probe.success === !world.fails &&
        probe.operationJournal?.truncated === truncated &&
        attempt?.runId === probe.runId &&
        attempt.cell === expectedCell &&
        attempt.journal === (truncated ? "truncated" : "complete") &&
        attempt.expectedDigest === digest &&
        attempt.expectedSize === text.length &&
        attempt.allowReadback === world.allowReadback &&
        isDeepStrictEqual(
          attempt.stores,
          observedStores.map((value) => {
            const digest = sha256HexSyncText(value);
            return { digest, contentDigest: digest, size: new TextEncoder().encode(value).byteLength };
          }),
        ),
      storage: hostRead === (world.stored ? text : null),
      readback: isDeepStrictEqual(
        readback,
        readExpected
          ? { digest, observedDigest: digest, size: text.length }
          : null,
      ),
      recovery:
        report?.runId === probe.runId &&
        report.cell === expectedCell &&
        report.journal === expectedJournal &&
        report.effect === expectedEffect &&
        report.next === world.next &&
        typeof report.reason === "string" && !!report.reason.trim() &&
        isDeepStrictEqual(report.readback, readback),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      attempt,
      readback,
      checks,
    };
  }

  async function qualify() {
    const observation = await services.evalRecoveryJournal.observe(
      bound.request.operationId,
    );
    let rejectsAnotherDigest = false;
    try {
      await services.evalRecoveryReadback.read(
        bound.request.operationId,
        "f".repeat(64),
      );
    } catch (error) {
      rejectsAnotherDigest =
        error instanceof Error &&
        error.message.includes("complete native receipt");
    }
    const rejectsUnprovenReadback = !world.journalCase || await services.evalRecoveryReadback
      .read(bound.request.operationId, digest)
      .then(() => false, (error: unknown) =>
        error instanceof Error && error.message.includes("complete native receipt")
      );
    const effect = readExpected
      ? await services.evalRecoveryReadback.read(
          bound.request.operationId,
          digest,
        )
      : null;
    return {
      verification: await verify({
        runId: observation.runId,
        cell: observation.cell,
        journal: expectedJournal,
        readback: effect,
        effect: effect ? "confirmed" : "unchecked",
        next: world.next,
        reason: "Use the actual operation journal and assigned readback.",
      }),
      rejectsAnotherDigest,
      rejectsUnprovenReadback,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedEvalRecovery>;
export interface ManagedEvalRecoveryReceiver {
  runManagedEvalRecoveryTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedEvalRecovery(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedEvalRecoveryMethods =
  createReceiverRpcMethods<ManagedEvalRecoveryReceiver>([
    "runManagedEvalRecoveryTeacher",
    "qualifyManagedEvalRecovery",
  ]);
