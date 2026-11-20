import { requireAssignedWorld } from "./assigned-world.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { explorerTextWorlds } from "./explorer-probe-worlds.js";

export type ExplorerProbeInput = { contextId: string; caseId: string };
type Input = {
  bytes: number;
  characters: number;
  digest: string;
  lineEnding: string;
  claim: string | null;
  repeat: boolean;
};
type Plan = { expectedBytes: number; expectedDigest: string; comparison: string; check: string };
type Receipt = {
  blob: {
    digest: string;
    writtenBytes: number;
    exists: boolean;
    statBytes: number | null;
    readDigest: string | null;
    repeatDigest: string | null;
  };
  file: { digest: string; bytes: number; removed: boolean };
};

type Services = {
  explorerTextProbe: {
    input(operationId: string): Promise<Input>;
    run(operationId: string, plan: Plan): Promise<Receipt>;
  };
};
type Report = {
  input: Input;
  plan: Plan;
  receipt: Receipt;
  assessment: { classification: string; issue: string | null };
  next: string;
};

export function prepareExplorerProbe(
  assigned: ExplorerProbeInput,
  bound: { request: { goal: string; operationId: string }; services: Services },
) {
  const world = requireAssignedWorld(
    explorerTextWorlds,
    assigned.caseId,
    "Unknown workspace text probe",
  );
  let observed: Input | undefined;
  let actual: Receipt | undefined;
  const operations: string[] = [];
  const expectedDigest = createHash("sha256").update(world.text, "utf8").digest("hex");
  const expectedBytes = Buffer.byteLength(world.text, "utf8");
  const expectedPlan = {
    expectedBytes, expectedDigest, check: world.check,
    comparison: world.repeat ? "repeat-store" : "round-trip",
  };
  const expectedReceipt = {
    blob: {
      digest: expectedDigest, writtenBytes: expectedBytes, exists: true,
      statBytes: expectedBytes, readDigest: expectedDigest,
      repeatDigest: world.repeat ? expectedDigest : null,
    },
    file: { digest: expectedDigest, bytes: expectedBytes, removed: true },
  };
  const expectedAssessment = {
    classification: world.classification, issue: world.classification === "ok" ? null : "claim",
  };
  const services: Services = {
    explorerTextProbe: {
      async input(id) {
        const value = await bound.services.explorerTextProbe.input(id);
        operations.push("input");
        observed = structuredClone(value);
        return value;
      },
      async run(id, plan) {
        const value = await bound.services.explorerTextProbe.run(id, plan);
        operations.push("run");
        actual = structuredClone(value);
        return value;
      },
    },
  };

  function verify(report: Report | null) {
    const checks = {
      operations: isDeepStrictEqual(operations, ["input", "run"]),
      input: isDeepStrictEqual(observed, {
        bytes: expectedBytes, characters: Array.from(world.text).length, digest: expectedDigest,
        lineEnding: world.lineEnding, claim: world.claim, repeat: world.repeat,
      }) && isDeepStrictEqual(report?.input, observed),
      plan: isDeepStrictEqual(report?.plan, expectedPlan),
      native: isDeepStrictEqual(actual, expectedReceipt) && isDeepStrictEqual(report?.receipt, actual),
      classification: isDeepStrictEqual(report?.assessment, expectedAssessment) &&
        typeof report?.next === "string" && !!report.next.trim(),
    };
    return { ...assigned, request: bound.request, observed, actual, operations, checks, passed: Object.values(checks).every(Boolean) };
  }
  async function qualify() {
    const { operationId } = bound.request;
    const input = await services.explorerTextProbe.input(operationId);
    const receipt = await services.explorerTextProbe.run(operationId, expectedPlan);
    return verify({
      input, plan: expectedPlan, receipt, assessment: expectedAssessment,
      next: "Record the exact storage and cleanup measurements.",
    });
  }

  return { request: bound.request, services, qualify, verify };
}

type Prepared = ReturnType<typeof prepareExplorerProbe>;
export interface ExplorerProbeReceiver {
  runExplorerProbeTeacher(input: ExplorerProbeInput & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyExplorerProbe(input: ExplorerProbeInput): ReturnType<Prepared["qualify"]>;
}
export const explorerProbeMethods = createReceiverRpcMethods<ExplorerProbeReceiver>([
  "runExplorerProbeTeacher", "qualifyExplorerProbe",
]);
