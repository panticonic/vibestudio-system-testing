import { isDeepStrictEqual } from "node:util";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { rpc } from "@workspace/runtime";
import { bindOfflineDictation } from "@workspace-skills/offline-dictation-bindings";
import { SPEECH_EXTENSION } from "@workspace/speech";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { managedDictationWorlds } from "./offline-dictation-worlds.js";

type Services = ReturnType<typeof bindOfflineDictation>["services"];
type Capture = Awaited<ReturnType<Services["dictationCaptureRead"]["inspect"]>>;
type Report = {
  capture: Capture;
  review: { next: string; guidance: string };
  transcript: null;
  draft: null;
};

export function prepareManagedDictation(contextId: string, caseId: string) {
  const scenario = managedDictationWorlds.find(({ id }) => id === caseId);
  if (!scenario) throw new Error("Unknown offline dictation case");
  const samples =
    scenario.samples === null
      ? null
      : new Float32Array(scenario.samples).fill(scenario.sample);
  const bound = bindOfflineDictation(
    { goal: scenario.goal, mode: "inspect", presentation: "verbatim" },
    samples,
  );
  let observed: Capture | undefined;
  const services: Services = {
    dictationCaptureRead: {
      async inspect(id) {
        if (observed)
          throw new Error("The assigned recording has already been inspected");
        const capture = await bound.services.dictationCaptureRead.inspect(id);
        observed = { ...capture };
        return capture;
      },
    },
    dictationTranscription: bound.services.dictationTranscription,
  };

  function expectedNext(ready: boolean) {
    if (scenario.recording === "absent") return "supply-recording";
    if (scenario.recording !== "valid") return "repair-recording";
    return ready ? "ready" : "prepare-local-worker";
  }

  async function verify(report: Report | null) {
    const status = (await rpc.call(
      "main",
      mainRpcMethods["extensions.invoke"],
      [SPEECH_EXTENSION, "status", []],
    )) as { ready?: boolean };
    const checks = {
      liveWorker:
        typeof status.ready === "boolean" && observed?.ready === status.ready,
      recording:
        observed?.recording === scenario.recording &&
        observed.durationMs === scenario.durationMs &&
        observed.windowed === scenario.windowed,
      report:
        !!observed &&
        isDeepStrictEqual(report?.capture, observed) &&
        report?.review.next === expectedNext(observed.ready) &&
        !!report.review.guidance.trim() &&
        report.transcript === null &&
        report.draft === null,
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId,
      request: bound.request,
      observed,
      checks,
    };
  }

  async function qualify() {
    const capture = await services.dictationCaptureRead.inspect(
      bound.request.operationId,
    );
    let rejectsUnassignedTranscription = false;
    try {
      await services.dictationTranscription.run(bound.request.operationId);
    } catch (error) {
      rejectsUnassignedTranscription =
        error instanceof Error &&
        error.message.includes("authorized recording");
    }
    return {
      verification: await verify({
        capture,
        review: {
          next: expectedNext(capture.ready),
          guidance: "Use the observed capture and worker status.",
        },
        transcript: null,
        draft: null,
      }),
      rejectsUnassignedTranscription,
    };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = ReturnType<typeof prepareManagedDictation>;
type Input = { contextId: string; caseId: string };
export interface ManagedDictationReceiver {
  runManagedDictationTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedDictation(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedDictationMethods =
  createReceiverRpcMethods<ManagedDictationReceiver>([
    "runManagedDictationTeacher",
    "qualifyManagedDictation",
  ]);
