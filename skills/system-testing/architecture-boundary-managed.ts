import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { vcs, workers } from "@workspace/runtime";
import { bindArchitectureReview } from "@workspace-skills/architecture/workflow";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { createOwnedHeadlessChannel } from "./session-replay-managed.js";
import { managedArchitectureBoundaryWorlds } from "./architecture-boundary-worlds.js";

type Services = ReturnType<typeof bindArchitectureReview>["services"];
type Route = Awaited<
  ReturnType<Services["architectureProviderRead"]["resolve"]>
>;
type Declaration = Awaited<
  ReturnType<Services["architectureProviderRead"]["declaration"]>
>;
type Report = {
  provider: { route: Route; declaration: Declaration; consistent: boolean };
  ownership: { owner: string; proposedOwner: string; aligned: boolean };
  decision: string;
};

export async function prepareManagedArchitectureBoundary(
  contextId: string,
  caseId: string,
) {
  const world = requireAssignedWorld(
    managedArchitectureBoundaryWorlds,
    caseId,
    "Unknown architecture boundary assignment",
  );
  const lane = world.creatorScoped
    ? await createOwnedHeadlessChannel(contextId, "Ownership review")
    : null;
  const initial = await vcs.status({ contextId });
  const revision =
    initial.workingHead.kind === "event"
      ? initial.workingHead.eventId
      : initial.workingHead.applicationId;
  const resolveProvider = {
    "vibestudio.workspace-source.v1": () =>
      workers.resolveService("vibestudio.workspace-source.v1", null),
    "vibestudio.channel.v1": () =>
      workers.resolveService("vibestudio.channel.v1", lane?.key ?? null),
    "vibestudio.missions.v1": () =>
      workers.resolveService("vibestudio.missions.v1", null),
  }[world.protocol];
  const bound = bindArchitectureReview({
    ...world,
    contextId,
    resolveProvider,
  });
  const routes: Route[] = [];
  const declarations: Declaration[] = [];
  const services: Services = {
    architectureProviderRead: {
      async resolve(id) {
        const route = await bound.services.architectureProviderRead.resolve(id);
        routes.push(structuredClone(route));
        return route;
      },
      async declaration(receipt) {
        const declaration =
          await bound.services.architectureProviderRead.declaration(receipt);
        declarations.push(structuredClone(declaration));
        return declaration;
      },
    },
  };

  function expected(route: Route, declaration: Declaration): Report {
    const aligned = String(world.expectedOwner) === String(world.proposedOwner);
    return {
      provider: { route, declaration, consistent: true },
      ownership: {
        owner: world.expectedOwner,
        proposedOwner: world.proposedOwner,
        aligned,
      },
      decision: aligned ? "retain-boundary" : "move-state-to-owner",
    };
  }

  async function verify(report: Report | null) {
    const [route] = routes;
    const [declaration] = declarations;
    const after = await vcs.status({ contextId });
    const checks = {
      route:
        routes.length >= 1 &&
        route?.contextId === contextId &&
        route.receipt === bound.request.operationId + ":provider" &&
        route.revision === revision &&
        route.protocol === world.protocol &&
        route.name === world.name &&
        route.source === world.source &&
        route.receiver.kind === "durable-object" &&
        route.receiver.className === world.className &&
        route.receiver.creatorScoped === world.creatorScoped &&
        (lane
          ? route.receiver.address === lane.target
          : route.receiver.address.length > 0),
      declaration:
        declarations.length >= 1 &&
        typeof declaration?.hash === "string" &&
        declaration.hash.length > 0 &&
        declaration.routeReceipt === route?.receipt &&
        declaration.name === world.name &&
        declaration.source === world.source &&
        declaration.revision === revision &&
        declaration.protocols.includes(world.protocol) &&
        declaration.className === world.className &&
        declaration.creatorScoped === world.creatorScoped,
      unchanged:
        after.mainEventId === initial.mainEventId &&
        isDeepStrictEqual(after.workingHead, initial.workingHead),
      report: Boolean(
        route &&
        declaration &&
        isDeepStrictEqual(report, expected(route, declaration)),
      ),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      caseId,
      contextId,
      request: bound.request,
      route,
      declaration,
      ownedTarget: lane?.target ?? null,
      checks,
    };
  }

  async function qualify() {
    let rejectedUnboundDeclaration = false;
    try {
      await services.architectureProviderRead.declaration("unbound");
    } catch (error) {
      rejectedUnboundDeclaration =
        error instanceof Error && /observed provider/.test(error.message);
    }
    const route = await services.architectureProviderRead.resolve(
      bound.request.operationId,
    );
    const declaration = await services.architectureProviderRead.declaration(
      route.receipt,
    );
    const report = expected(route, declaration);
    const verification = await verify(report);
    const rejectedWrongOwner = !(
      await verify({
        ...report,
        ownership: {
          owner: "build-projection",
          proposedOwner: world.proposedOwner,
          aligned: true,
        },
      })
    ).passed;
    return { verification, rejectedUnboundDeclaration, rejectedWrongOwner };
  }
  return { request: bound.request, services, verify, qualify };
}

type Prepared = Awaited<ReturnType<typeof prepareManagedArchitectureBoundary>>;
type Input = { contextId: string; caseId: string };
export interface ManagedArchitectureBoundaryReceiver {
  runManagedArchitectureBoundaryTeacher(
    input: Input & { executorModel: string },
  ): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<ReturnType<Prepared["verify"]>>;
  }>;
  qualifyManagedArchitectureBoundary(
    input: Input,
  ): ReturnType<Prepared["qualify"]>;
}
export const managedArchitectureBoundaryMethods =
  createReceiverRpcMethods<ManagedArchitectureBoundaryReceiver>([
    "runManagedArchitectureBoundaryTeacher",
    "qualifyManagedArchitectureBoundary",
  ]);
