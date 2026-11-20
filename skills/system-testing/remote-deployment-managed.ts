import { isDeepStrictEqual } from "node:util";
import { contextId } from "@workspace/runtime";
import type { RemoteDeploymentStages } from "@vibestudio/shared/deviceDriver";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { openClientDevice } from "./tests/_client-device.js";
import { managedDeploymentWorlds } from "./remote-deployment-worlds.js";

type Input = { contextId: string; caseId: string };
type Step = keyof RemoteDeploymentStages;

export async function prepareManagedDeployment(input: Input) {
  const world = managedDeploymentWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId)
    throw new Error("Unknown managed deployment assignment");
  const terminal = await openClientDevice("terminal");
  const { operationId, initial } = await terminal.call(
    "remoteDeploymentBegin",
    { intent: world.intent },
  );
  const request = { operationId };
  const steps: { [Stage in Step]?: RemoteDeploymentStages[Stage] } = {};
  const order: Step[] = [];
  let finished = false;
  async function record<Stage extends Step>(step: Stage, evidence: string) {
    const result = (await terminal.call("remoteDeploymentStep", {
      operationId,
      step,
      evidence,
    })) as RemoteDeploymentStages[Stage];
    steps[step] = result;
    order.push(step);
    return result;
  }
  const services = {
    remoteDeploymentRead: { observe: (id: string) => record("baseline", id) },
    remoteDeploymentApply: {
      apply: (receipt: string) => record("apply", receipt),
    },
    remoteDeploymentVerify: {
      verify: (receipt: string) => record("verify", receipt),
    },
  };
  function reference() {
    return {
      status: "deployment-ready",
      identity: steps.verify?.identity,
      evidenceIds: [
        steps.baseline?.receipt,
        steps.apply?.receipt,
        steps.verify?.receipt,
      ],
    };
  }
  async function finish() {
    finished = true;
    return terminal.call("remoteDeploymentFinish", { operationId });
  }
  async function verify(report: unknown) {
    const final = await finish();
    const update = world.intent === "update";
    const checks = {
      assignedBaseline: update
        ? initial.state === "ready"
        : initial.state === "inactive" && initial.identity === null,
      receiptOrder: isDeepStrictEqual(order, ["baseline", "apply", "verify"]),
      deploymentReady:
        final.state === "ready" &&
        steps.apply?.state === "applied" &&
        steps.verify?.state === "verified" &&
        isDeepStrictEqual(steps.verify.identity, final.identity),
      expectedIdentity:
        !update ||
        (final.state === "ready" &&
          initial.state === "ready" &&
          final.identity.serverId === initial.identity.serverId &&
          final.identity.workspaceId === initial.identity.workspaceId &&
          final.identity.bootId !== initial.identity.bootId),
      exactReport: isDeepStrictEqual(report, reference()),
    };
    return {
      caseId: world.id,
      contextId,
      request,
      initial,
      final,
      steps,
      order,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }
  return {
    goal: world.goal,
    request,
    services,
    verify,
    async qualify() {
      try {
        const baseline =
          await services.remoteDeploymentRead.observe(operationId);
        const denied = await services.remoteDeploymentApply
          .apply("foreign-receipt")
          .then(
            () => false,
            () => true,
          );
        const applied = await services.remoteDeploymentApply.apply(
          baseline.receipt,
        );
        await services.remoteDeploymentVerify.verify(applied.receipt);
        const proof = await verify(reference());
        return { ...proof, denied, passed: proof.passed && denied };
      } finally {
        if (!finished) await finish();
      }
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedDeployment>>;
export interface ManagedDeploymentReceiver {
  runManagedDeploymentTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedDeployment(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedDeploymentMethods =
  createReceiverRpcMethods<ManagedDeploymentReceiver>([
    "runManagedDeploymentTeacher",
    "qualifyManagedDeployment",
  ]);
