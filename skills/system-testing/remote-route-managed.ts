import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import {
  cliContinuationWork,
  remoteRouteWorlds,
} from "./remote-route-worlds.js";

type Input = { contextId: string; caseId: string };

async function readGateway() {
  const { serverId, serverBootId, workspaceId } = await rpc.call(
    "main",
    mainRpcMethods["auth.getConnectionInfo"],
    [],
  );
  return { serverId, bootId: serverBootId, workspaceId };
}

export async function prepareRemoteRoute(input: Input) {
  const world = remoteRouteWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId)
    throw new Error("Unknown assigned workspace-route review");

  const assignedGateway = await readGateway();
  const request = {
    goal: world.goal,
    operationId: crypto.randomUUID(),
    serverId: assignedGateway.serverId,
    workspaceId: world.differentWorkspace
      ? `ws_${crypto.randomUUID()}`
      : assignedGateway.workspaceId,
  };
  let used = false;
  let observed: Awaited<ReturnType<typeof readGateway>> | undefined;
  const services = {
    remoteGatewayIdentity: {
      async observe(id: string) {
        if (used || id !== request.operationId)
          throw new Error(
            "Read the gateway only for the assigned route review",
          );
        used = true;
        observed = await readGateway();
        return structuredClone(observed);
      },
    },
  };

  function reportFor(gateway: Awaited<ReturnType<typeof readGateway>>) {
    return {
      observed: gateway,
      verdict: world.verdict,
      layer: world.layer,
      next: world.next,
    };
  }

  async function verify(report: unknown) {
    const native = await readGateway();
    const expected = reportFor(native);
    const checks = {
      scopedRead: used && isDeepStrictEqual(observed, native),
      stableGateway: isDeepStrictEqual(assignedGateway, native),
      assignedRoute:
        native.serverId === request.serverId &&
        (native.workspaceId !== request.workspaceId) ===
          world.differentWorkspace,
      exactReport: isDeepStrictEqual(report, expected),
    };
    return {
      caseId: world.id,
      request,
      native,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    return verify(
      reportFor(
        await services.remoteGatewayIdentity.observe(request.operationId),
      ),
    );
  }
  return { request, services, qualify, verify };
}

export async function prepareCliContinuation(input: Input) {
  const world = remoteRouteWorlds.find(({ id }) => id === input.caseId);
  if (!world?.cli) throw new Error("Unknown assigned CLI continuation");
  const assigned = world.cli;
  const route = await prepareRemoteRoute(input);
  const otherContext = crypto.randomUUID();
  const otherWorkspace = `ws_${crypto.randomUUID()}`;
  let readback: Awaited<ReturnType<typeof createEvidence>> | undefined;
  async function createEvidence() {
    const gateway = await route.verify(null);
    if (
      !gateway.checks.scopedRead ||
      !gateway.checks.stableGateway ||
      !gateway.checks.assignedRoute
    )
      throw new Error(
        "Verify the assigned workspace gateway before reading CLI scope",
      );
    const selectors = Object.fromEntries(
      Object.entries(assigned.selectors).map(([source, coordinate]) => [
        source,
        {
          contextId: coordinate === "owned" ? input.contextId : otherContext,
          ...(source === "session" || source === "default"
            ? { serverId: gateway.native.serverId }
            : {}),
          ...(["session", "binding", "default"].includes(source)
            ? {
                workspaceId:
                  coordinate === "foreign"
                    ? otherWorkspace
                    : gateway.native.workspaceId,
              }
            : {}),
        },
      ]),
    );
    return {
      gateway: gateway.native,
      credential:
        assigned.credential === "device"
          ? { kind: "device" }
          : { kind: "agent", contextId: input.contextId },
      operation: assigned.operation,
      selectors,
    };
  }
  async function evidence(operationId: string) {
    if (operationId !== route.request.operationId || readback)
      throw new Error("Read CLI evidence only once for the assigned operation");
    readback = await createEvidence();
    return structuredClone(readback);
  }
  function expected(observed: NonNullable<typeof readback>) {
    return {
      source: assigned.source,
      contextId: observed.selectors[assigned.source]?.contextId ?? null,
      status: assigned.status,
      action: assigned.action,
      gateway: observed.gateway,
    };
  }
  async function verify(value: unknown) {
    const result = value as { results?: { report: unknown }[] } | null;
    const gateway = await route.verify(result?.results?.[0]?.report);
    const checks = {
      verifiedGateway: gateway.passed,
      exactScope:
        !!readback &&
        isDeepStrictEqual(result?.results?.[1]?.report, expected(readback)),
    };
    return {
      caseId: world.id,
      passed: Object.values(checks).every(Boolean),
      checks,
      gateway,
      evidence: readback,
    };
  }
  return {
    request: {
      goal: world.goal,
      work: cliContinuationWork.map((selector) => ({
        ...selector,
        input: route.request,
      })),
    },
    services: { ...route.services, remoteCliScope: { evidence } },
    verify,
    async qualify() {
      const earlyDenied = await evidence(route.request.operationId).then(
        () => false,
        () => true,
      );
      const observed = await route.services.remoteGatewayIdentity.observe(
        route.request.operationId,
      );
      const wrongOperation = await evidence("unassigned").then(
        () => false,
        () => true,
      );
      const scope = expected(await evidence(route.request.operationId));
      const reference = {
        observed,
        verdict: world.verdict,
        layer: world.layer,
        next: world.next,
      };
      const result = await verify({
        results: [{ report: reference }, { report: scope }],
      });
      return {
        ...result,
        passed: result.passed && earlyDenied && wrongOperation,
      };
    },
  };
}

type Verification =
  | ReturnType<Awaited<ReturnType<typeof prepareRemoteRoute>>["verify"]>
  | ReturnType<Awaited<ReturnType<typeof prepareCliContinuation>>["verify"]>;
export interface RemoteRouteReceiver {
  runRemoteRouteTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<Verification>;
  }>;
  qualifyRemoteRoute(input: Input): Verification;
}
export const remoteRouteMethods = createReceiverRpcMethods<RemoteRouteReceiver>(
  ["runRemoteRouteTeacher", "qualifyRemoteRoute"],
);
