import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";

export type BuildPerformanceInput = {
  contextId: string;
  source: string;
  goal: string;
  initialBudgetBytes?: number;
};

type Contributor = { source: string; bytes: number };

type Receipt = {
  source: string;
  stateHash: string;
  status: string;
  first: { elapsedMs: number; cacheState: string; phases: null | Record<string, number> };
  repeat: { elapsedMs: number; sameBuildKeys: boolean } | null;
  targets: {
    target: string;
    buildKey: string;
    payload: null | {
      initialBytes: number;
      lazyBytes: number;
      totalBytes: number;
      largestInitialInputs: Contributor[];
    };
  }[];
};

type Binding = {
  request: { operationId: string; goal: string; initialBudgetBytes?: number };
  services: { buildPerformance: { observe(id: string): Promise<Receipt> } };
};

type Assessment = {
  observation: Receipt;
  execution: { state: string; repeat: string; phase: string };
  payload: null | { budget: string; largestInitialInput: unknown };
  next: { action: string; reason: string };
};

export function prepareBuildPerformance(input: BuildPerformanceInput, bound: Binding) {
  let receipt: Receipt | undefined;
  let reads = 0;
  const services = {
    buildPerformance: {
      async observe(operationId: string) {
        const result = await bound.services.buildPerformance.observe(operationId);
        receipt = structuredClone(result);
        reads++;
        return result;
      },
    },
  };
  function reference(observed: Receipt): Assessment {
    const phaseNames = { bundlingMs: "bundling", validationMs: "validation", otherMs: "other" };
    const phases = Object.entries(observed.first.phases ?? {}).sort((a, b) => b[1] - a[1]);
    const built = observed.first.cacheState === "built-during-profile";
    const phase = built && phases[0] && phases[0][1] > 0
      ? phases[0][1] === phases[1]?.[1] ? "tied" : phaseNames[phases[0][0] as keyof typeof phaseNames]
      : "unavailable";
    const payload = observed.targets.find(({ target }) => target === "runtime")?.payload;
    const largest = payload?.largestInitialInputs.reduce<Contributor | null>(
      (largest, item) => !largest || item.bytes > largest.bytes ? item : largest, null
    ) ?? null;
    const budget = input.initialBudgetBytes === undefined ? "unassigned"
      : payload && payload.initialBytes > input.initialBudgetBytes ? "over" : "within";
    return {
      observation: observed,
      execution: {
        state: built ? "built" : observed.first.cacheState,
        repeat: "verified",
        phase,
      },
      payload: payload ? { budget, largestInitialInput: largest } : null,
      next: {
        action: budget === "over" ? "reduce-initial-payload" : "record-baseline",
        reason: "Use the observed runtime payload and exact repeat keys.",
      },
    };
  }
  function verify(report: Assessment | null) {
    const expected = receipt && reference(receipt);
    const runtime = receipt?.targets.find(({ target }) => target === "runtime");
    const payload = runtime?.payload;
    const checks = {
      native: reads === 1 && receipt?.status === "ok" && receipt.source === input.source &&
        !!receipt.stateHash && !!runtime?.buildKey && receipt.repeat?.sameBuildKeys === true &&
        !!payload && payload.initialBytes > 0 && payload.totalBytes >= payload.initialBytes,
      observation: !!expected && isDeepStrictEqual(report?.observation, expected.observation),
      judgments: !!expected && isDeepStrictEqual(report?.execution, expected.execution) &&
        isDeepStrictEqual(report?.payload, expected.payload) &&
        report?.next?.action === expected.next.action &&
        typeof report.next.reason === "string" && !!report.next.reason.trim(),
    };
    return { passed: Object.values(checks).every(Boolean), request: bound.request, receipt, checks };
  }
  async function qualify() {
    const result = await services.buildPerformance.observe(bound.request.operationId);
    return verify(reference(result));
  }
  return { request: bound.request, services, qualify, verify };
}

type Prepared = ReturnType<typeof prepareBuildPerformance>;
export interface BuildPerformanceReceiver {
  runBuildPerformanceTeacher(input: BuildPerformanceInput & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyBuildPerformance(input: BuildPerformanceInput): ReturnType<Prepared["qualify"]>;
}
export const buildPerformanceMethods = createReceiverRpcMethods<BuildPerformanceReceiver>([
  "runBuildPerformanceTeacher", "qualifyBuildPerformance",
]);
