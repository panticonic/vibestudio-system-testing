import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { contextId, vcs } from "@workspace/runtime";
import { bindTerminalChecks } from "@workspace-skills/terminal/workflow";
import { bindTerminalReceiptReview } from "@workspace-skills/terminal/receipt-review";
import type { DeviceTerminalReview, TerminalOperationEvidence } from "../device-and-terminal-review/types.js";
import { managedTerminalEvidenceWorlds } from "./terminal-evidence-worlds.js";

type Input = { contextId: string; caseId: string };

export async function prepareManagedTerminalEvidence(input: Input) {
  const selected = managedTerminalEvidenceWorlds.find(({ id }) => id === input.caseId);
  if (!selected || input.contextId !== contextId)
    throw new Error("Unknown assigned terminal evidence review");
  const world = selected;
  const start = await vcs.status({ contextId });
  async function run(intent: Parameters<typeof bindTerminalChecks>[0]["checks"][number]["intent"]) {
    const { request, services } = bindTerminalChecks({
      goal: world.goal,
      checks: [{ id: "evidence", purpose: "Produce the assigned terminal evidence", prerequisites: [],
        intent, timeoutMs: 5000, maxOutputBytes: 1024 }],
    });
    const operationId = request.operationId;
    const plan = await services.terminalCheckRead.observe(operationId);
    const result = await services.terminalCheckRun.execute(plan.receipt, "evidence");
    return { contextId, operationId, plan, result };
  }
  const assigned = await run(world.mode === "notice"
    ? { kind: "script", script: "printf '%s' 'release-ready'; printf '%s' 'diagnostic notice' >&2" }
    : world.mode === "truncated"
      ? { kind: "argv", executable: "/usr/bin/seq", args: ["1", "500"] }
      : { kind: "argv", executable: "/usr/bin/printf", args: ["%s", "assigned marker"] });
  const retained = world.mode === "foreign"
    ? await run({ kind: "argv", executable: "/usr/bin/printf", args: ["%s", "neighbor marker"] })
    : assigned;
  const bound = bindTerminalReceiptReview({ goal: world.goal, assigned, retained });
  let observation: TerminalOperationEvidence | undefined;
  const services = {
    terminalEvidenceRead: {
      async inspect(id: string) {
        observation = await bound.services.terminalEvidenceRead.inspect(id);
        return structuredClone(observation);
      },
    },
  };
  const expected: DeviceTerminalReview = {
    status: world.status,
    findings: [{
      code: world.code,
      evidenceIds: world.mode === "foreign" ? [assigned.operationId, retained.result.receipt] : [retained.result.receipt],
    }],
  };
  async function verify(report: DeviceTerminalReview | null) {
    const after = await vcs.status({ contextId });
    const { result } = retained;
    const truncated = world.mode === "truncated";
    const marker = truncated
      ? Array.from({ length: 500 }, (_, index) => `${index + 1}\n`).join("").slice(0, 1024)
      : world.mode === "notice" ? "release-ready" : "neighbor marker";
    const checks = {
      processes: assigned.result.status === "complete" && assigned.result.exitCode === 0 &&
        result.status === "complete" && result.exitCode === 0 &&
        !assigned.result.timedOut && !result.timedOut &&
        result.truncated === truncated && result.stdout === marker &&
        result.stderr === (world.mode === "notice" ? "diagnostic notice" : "") &&
        (world.mode !== "foreign" || (assigned.result.stdout === "assigned marker" &&
          assigned.operationId !== retained.operationId)),
      attribution: observation?.target.operationId === assigned.operationId &&
        observation.invocation?.operationId === assigned.operationId &&
        observation.result?.operationId === retained.operationId &&
        observation.result.id === result.receipt && observation.result.exitCode === result.exitCode &&
        observation.result.truncated === result.truncated,
      preserved: after.mainEventId === start.mainEventId && isDeepStrictEqual(after.workingHead, start.workingHead),
      outcome: isDeepStrictEqual(report, expected),
    };
    return { ...input, request: bound.request, observation, assigned, retained, checks, passed: Object.values(checks).every(Boolean) };
  }
  return {
    request: bound.request, services, verify,
    async qualify() {
      await services.terminalEvidenceRead.inspect(bound.request.operationId);
      return verify(expected);
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedTerminalEvidence>>;
type Verification = ReturnType<Prepared["verify"]>;
export interface ManagedTerminalEvidenceReceiver {
  runManagedTerminalEvidenceTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: Awaited<Verification>;
  }>;
  qualifyManagedTerminalEvidence(input: Input): Verification;
}
export const managedTerminalEvidenceMethods =
  createReceiverRpcMethods<ManagedTerminalEvidenceReceiver>(["runManagedTerminalEvidenceTeacher", "qualifyManagedTerminalEvidence"]);
