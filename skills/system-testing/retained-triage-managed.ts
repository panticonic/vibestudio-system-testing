import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import {
  systemTestRunnerRpcMethods,
  type PanelTeacherResult,
} from "@vibestudio/service-schemas/systemTestRunner";
import type {
  Failure,
  RetainedFailurePacket,
  RetainedFailureRequest,
  RetainedFailureReview,
  RunPacket,
} from "./triage/types.js";
import evidence from "./triage/triageFailure/evidence.js";
import signals from "./triage/triageFailure/signals.js";
import { retainedTriageWorlds } from "./retained-triage-worlds.js";

type Input = { contextId: string; caseId: string };
type Source = Input & {
  runId: string;
  runnerTargetId: string;
  released: boolean;
};

export function prepareRetainedTriage(input: Source) {
  const world = retainedTriageWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId || !input.released)
    throw new Error(
      "Expected a released run owned by the assigned triage context",
    );
  const request: RetainedFailureRequest = {
    goal: world.goal,
    operationId: crypto.randomUUID(),
    runId: input.runId,
    testName: world.testName,
  };
  const readNative = async () =>
    rpc.call(
      input.runnerTargetId,
      systemTestRunnerRpcMethods.inspectSystemTestRun,
      [request.runId, request.testName],
    ) as Promise<Failure>;
  let used = false;
  let packet: RetainedFailurePacket | undefined;
  const services = {
    retainedTestFailure: {
      async inspect(operationId: string) {
        if (operationId !== request.operationId || used)
          throw new Error(
            "The failure read is outside the retained triage assignment",
          );
        used = true;
        packet = { runId: request.runId, failure: await readNative() };
        return structuredClone(packet);
      },
    },
  };

  async function verify(report: RetainedFailureReview | null) {
    const summary = (await rpc.call(
      input.runnerTargetId,
      systemTestRunnerRpcMethods.inspectSystemTestRun,
      [request.runId],
    )) as RunPacket;
    const native = await readNative();
    const expected = {
      class: world.expectedClass,
      evidence: evidence(world.expectedClass, signals(native)),
    };
    const checks = {
      sourceRun:
        summary.runId === request.runId &&
        isDeepStrictEqual(summary.failedTests, [request.testName]),
      released: input.released,
      exactRecord:
        packet?.runId === request.runId &&
        isDeepStrictEqual(packet.failure, native),
      nativeFailure:
        native.name === world.testName &&
        native.failure?.phase === world.phase &&
        native.failure.error.message === world.detail &&
        (world.expectedClass === "validator"
          ? native.validationFailure?.validator === "harness"
          : native.validationFailure === null),
      triage:
        report?.runId === request.runId &&
        report.testName === request.testName &&
        report.status === "triaged" &&
        isDeepStrictEqual(report.triage, expected) &&
        expected.evidence.some(({ text }) => text.includes(world.detail)),
    };
    return {
      caseId: world.id,
      request,
      native,
      expected,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    const { failure } = await services.retainedTestFailure.inspect(
      request.operationId,
    );
    return verify({
      runId: request.runId,
      testName: request.testName,
      status: "triaged",
      triage: {
        class: world.expectedClass,
        evidence: evidence(world.expectedClass, signals(failure)),
      },
    });
  }
  return { request, services, verify, qualify };
}

type Verification = ReturnType<
  ReturnType<typeof prepareRetainedTriage>["verify"]
>;
export interface RetainedTriageReceiver {
  runRetainedTriageTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<Verification>;
  }>;
  qualifyRetainedTriage(input: Input): Verification;
}
export const retainedTriageMethods =
  createReceiverRpcMethods<RetainedTriageReceiver>([
    "runRetainedTriageTeacher",
    "qualifyRetainedTriage",
  ]);
