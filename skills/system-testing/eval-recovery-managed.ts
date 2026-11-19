import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { EvalOperationJournal } from "@vibestudio/service-schemas/eval";
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

/** The system test owns this finite cell and the only values interpolated into it. */
export function evalRecoveryProbeCode(input: Input): string {
  const world = worldFor(input.caseId);
  const text = expectedText(input);
  const operation = world.stored
    ? `await rpc.call("main", mainRpcMethods["blobstore.putText"], [${JSON.stringify(text)}]);`
    : `await rpc.call("main", mainRpcMethods["blobstore.getText"], [${JSON.stringify(sha256HexSyncText(text))}]);`;
  const outcome = world.fails
    ? 'throw new Error("Intentional failure after the assigned store");'
    : "return { stored: true };";
  return `
    import { contextId as actualContextId, rpc } from "@workspace/runtime";
    import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
    if (actualContextId !== ${JSON.stringify(input.contextId)})
      throw new Error("Recovery probe belongs to another context");
    ${operation}
    ${outcome}
  `;
}

export function prepareManagedEvalRecovery(input: Input, probe: Probe) {
  const { contextId, caseId } = input;
  const world = worldFor(caseId);
  const text = expectedText(input);
  const digest = sha256HexSyncText(text);
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
    const expectedJournal = world.stored ? "matched" : "absent";
    const expectedEffect = world.allowReadback ? "confirmed" : "unchecked";
    const checks = {
      original:
        !!probe.runId &&
        probe.success === !world.fails &&
        probe.operationJournal?.truncated === false &&
        attempt?.runId === probe.runId &&
        attempt.cell === expectedCell &&
        attempt.journal === "complete" &&
        attempt.expectedDigest === digest &&
        attempt.expectedSize === text.length &&
        attempt.allowReadback === world.allowReadback &&
        isDeepStrictEqual(
          attempt.stores,
          world.stored
            ? [{ digest, contentDigest: digest, size: text.length }]
            : [],
        ),
      storage: hostRead === (world.stored ? text : null),
      readback: isDeepStrictEqual(
        readback,
        world.allowReadback
          ? { digest, observedDigest: digest, size: text.length }
          : null,
      ),
      recovery:
        report?.runId === probe.runId &&
        report.cell === expectedCell &&
        report.journal === expectedJournal &&
        report.effect === expectedEffect &&
        report.next === world.next &&
        !!report.reason.trim() &&
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
    const effect = world.allowReadback
      ? await services.evalRecoveryReadback.read(
          bound.request.operationId,
          digest,
        )
      : null;
    return {
      verification: await verify({
        runId: observation.runId,
        cell: observation.cell,
        journal: world.stored ? "matched" : "absent",
        readback: effect,
        effect: effect ? "confirmed" : "unchecked",
        next: world.next,
        reason: "Use the actual operation journal and assigned readback.",
      }),
      rejectsAnotherDigest,
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
