import { isDeepStrictEqual } from "node:util";
import { contextId, rpc } from "@workspace/runtime";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { remoteRouteWorlds } from "./remote-route-worlds.js";

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

type Verification = ReturnType<
  Awaited<ReturnType<typeof prepareRemoteRoute>>["verify"]
>;
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
