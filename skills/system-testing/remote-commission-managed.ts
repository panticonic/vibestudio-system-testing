import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import type {
  RemoteCommissionStages,
  RemoteCommissionStep,
} from "@vibestudio/shared/deviceDriver";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { openClientDevice } from "./tests/_client-device.js";
import { liveRemoteCommissionWorld } from "./remote-commission-worlds.js";

type Input = { contextId: string };

export async function prepareRemoteCommission(input: Input) {
  if (input.contextId !== contextId)
    throw new Error(
      "The commissioning fixture must run in its assigned context",
    );
  const terminal = await openClientDevice("terminal");
  const before = await rpc.call(
    "main",
    mainRpcMethods["auth.getConnectionInfo"],
    [],
  );
  const { operationId, identity } = await terminal.call(
    "remoteCommissionBegin",
    {},
  );
  const request = { operationId };
  const steps: {
    [Stage in RemoteCommissionStep]?: RemoteCommissionStages[Stage];
  } = {};
  const order: RemoteCommissionStep[] = [];
  let finished = false;

  async function step<Stage extends RemoteCommissionStep>(
    name: Stage,
    evidence: string,
  ) {
    const result = await terminal.call("remoteCommissionStep", {
      operationId,
      step: name,
      evidence,
    });
    const receipt = result as RemoteCommissionStages[Stage];
    steps[name] = receipt;
    order.push(name);
    return receipt;
  }

  const services = {
    remoteDeploymentRead: { observe: (id: string) => step("baseline", id) },
    remoteDeploymentApply: {
      async apply() {
        throw new Error("This assignment reuses the running hub");
      },
    },
    remoteDeploymentVerify: {
      async verify() {
        throw new Error("This assignment has no installation receipt");
      },
    },
    remoteDeploymentHandoff: {
      open: (receipt: string) => step("handoff", receipt),
    },
    remoteAccessRead: { observe: (id: string) => step("profile", id) },
    remoteAccessPair: { pair: (receipt: string) => step("pair", receipt) },
    remoteAccessRoute: { select: (receipt: string) => step("route", receipt) },
    remoteAccessVerify: { verify: (receipt: string) => step("child", receipt) },
  };

  async function finish() {
    finished = true;
    return terminal.call("remoteCommissionFinish", { operationId });
  }

  function reference() {
    return {
      deployment: {
        status: "already-running",
        identity: null,
        evidenceIds: [steps.baseline?.receipt],
      },
      handoff: steps.handoff,
      access: {
        status: "workspace-ready",
        workspaceId: identity.workspaceId,
        evidenceIds: [
          steps.profile?.receipt,
          steps.pair?.receipt,
          steps.route?.receipt,
          steps.child?.receipt,
        ],
      },
    };
  }

  async function verify(report: unknown) {
    const proof = await finish();
    const after = await rpc.call(
      "main",
      mainRpcMethods["auth.getConnectionInfo"],
      [],
    );
    const isAssigned = (info: typeof after) =>
      info.workspaceId === identity.workspaceId &&
      info.serverId === identity.serverId;
    const checks = {
      stableDeployment:
        proof.stableDeployment &&
        isAssigned(before) &&
        isAssigned(after) &&
        typeof before.serverBootId === "string" &&
        before.serverBootId.length > 0 &&
        before.serverBootId === after.serverBootId,
      newPairedProfile:
        proof.persistedNewProfile &&
        steps.profile?.state === "unpaired" &&
        steps.profile.inviteAssigned &&
        steps.pair?.state === "paired",
      receiptOrder: isDeepStrictEqual(order, [
        "baseline",
        "handoff",
        "profile",
        "pair",
        "route",
        "child",
      ]),
      assignedChild:
        steps.baseline?.state === "ready" &&
        steps.baseline.intent === "deploy" &&
        steps.baseline.hasPriorIdentity &&
        steps.handoff?.state === "assigned" &&
        steps.route?.state === "routed" &&
        steps.child?.state === "verified" &&
        steps.child.workspaceId === identity.workspaceId,
      exactReport: isDeepStrictEqual(report, reference()),
    };
    return {
      caseId: liveRemoteCommissionWorld.id,
      contextId,
      request,
      identity,
      workspaceBootId: before.serverBootId,
      proof,
      steps,
      order,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  return {
    request,
    services,
    goal: liveRemoteCommissionWorld.goal,
    verify,
    async qualify() {
      try {
        const baseline =
          await services.remoteDeploymentRead.observe(operationId);
        const refusedForeign = await services.remoteDeploymentHandoff
          .open("foreign-receipt")
          .then(
            () => false,
            () => true,
          );
        const handoff = await services.remoteDeploymentHandoff.open(
          baseline.receipt,
        );
        if (!handoff.operationId)
          throw new Error("The hub did not bind the assigned CLI profile");
        const profile = await services.remoteAccessRead.observe(
          handoff.operationId,
        );
        const paired = await services.remoteAccessPair.pair(profile.receipt);
        const selected = await services.remoteAccessRoute.select(
          paired.receipt,
        );
        await services.remoteAccessVerify.verify(selected.receipt);
        const refusedReplay = await services.remoteAccessVerify
          .verify(selected.receipt)
          .then(
            () => false,
            () => true,
          );
        const result = await verify(reference());
        return {
          ...result,
          refusedForeign,
          refusedReplay,
          passed: result.passed && refusedForeign && refusedReplay,
        };
      } finally {
        if (!finished) await finish();
      }
    },
  };
}

type Prepared = Awaited<ReturnType<typeof prepareRemoteCommission>>;
export interface RemoteCommissionReceiver {
  runRemoteCommissionTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyRemoteCommission(input: Input): ReturnType<Prepared["qualify"]>;
}

export const remoteCommissionMethods =
  createReceiverRpcMethods<RemoteCommissionReceiver>([
    "runRemoteCommissionTeacher",
    "qualifyRemoteCommission",
  ]);
