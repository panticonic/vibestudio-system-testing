import { isDeepStrictEqual } from "node:util";
import { contextId, vcs } from "@workspace/runtime";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { githubSetupWorlds } from "./github-setup-worlds.js";

type Input = { contextId: string; caseId: string };
type World = (typeof githubSetupWorlds)[number];
type SetupStatus = { stage: string; connected: boolean; verified: boolean };
type SetupRoute = {
  action: string;
  accessLevel?: string;
  next: string;
  reason: string;
};
type BoundSetup = {
  request: { goal: string; operationId: string; interactive: boolean };
  services: {
    githubSetupRead: { inspect(id: string): Promise<SetupStatus> };
    githubSetupRoute: {
      resolve(
        id: string,
        accessLevel: World["accessLevel"],
      ): Promise<SetupRoute>;
    };
  };
};
type SetupReport = {
  status: SetupStatus;
  accessLevel: string;
  route: SetupRoute;
  handoff: string;
};
type Ports = {
  bind: (goal: string, interactive: boolean) => BoundSetup;
  countCredentials: () => Promise<number>;
};

export async function prepareGitHubSetup(input: Input, ports: Ports) {
  const world = githubSetupWorlds.find(({ id }) => id === input.caseId);
  if (!world || input.contextId !== contextId)
    throw new Error("Unknown GitHub setup assignment");
  const before = await vcs.status({ contextId });
  const beforeCount = await ports.countCredentials();
  if (beforeCount !== 0)
    throw new Error(
      "The assigned Personal workspace already has GitHub credentials",
    );
  const bound = ports.bind(world.goal, world.interactive);
  let status: SetupStatus | undefined;
  let route: SetupRoute | undefined;
  let selected: string | undefined;

  const services: BoundSetup["services"] = {
    githubSetupRead: {
      async inspect(id) {
        const result = await bound.services.githubSetupRead.inspect(id);
        status = structuredClone(result);
        return result;
      },
    },
    githubSetupRoute: {
      async resolve(id, level) {
        const result = await bound.services.githubSetupRoute.resolve(id, level);
        route = structuredClone(result);
        selected = level;
        return result;
      },
    },
  };

  async function verify(report: SetupReport | null) {
    const afterCount = await ports.countCredentials();
    const after = await vcs.status({ contextId });
    const expectedStatus = {
      stage: "needs-token",
      connected: false,
      verified: false,
    };
    const expectedComponent = `inline_ui({ path: "skills/github/GitHubSetup.tsx", props: { accessLevel: "${world.accessLevel}" } })`;
    const checks = {
      exactConnection:
        isDeepStrictEqual(status, expectedStatus) &&
        isDeepStrictEqual(report?.status, expectedStatus),
      accessLevel:
        selected === world.accessLevel &&
        report?.accessLevel === world.accessLevel,
      nativeRoute:
        route?.action === "render-setup" &&
        route.accessLevel === world.accessLevel &&
        route.next === expectedComponent &&
        !!route.reason &&
        isDeepStrictEqual(route, report?.route),
      surfaceHandoff: report?.handoff === world.handoff,
      credentialsUnchanged: beforeCount === 0 && afterCount === 0,
      workspaceUnchanged:
        after.mainEventId === before.mainEventId &&
        isDeepStrictEqual(after.workingHead, before.workingHead),
    };
    return {
      caseId: world.id,
      request: bound.request,
      status,
      route,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    const { operationId } = bound.request;
    const status = await services.githubSetupRead.inspect(operationId);
    const route = await services.githubSetupRoute.resolve(
      operationId,
      world.accessLevel,
    );
    return verify({
      status,
      accessLevel: world.accessLevel,
      route,
      handoff: world.handoff,
    });
  }

  return { request: bound.request, services, verify, qualify };
}

type Verification = ReturnType<
  Awaited<ReturnType<typeof prepareGitHubSetup>>["verify"]
>;
export interface GitHubSetupReceiver {
  runGitHubSetupTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: Awaited<Verification>;
  }>;
  qualifyGitHubSetup(input: Input): Verification;
}
export const gitHubSetupMethods = createReceiverRpcMethods<GitHubSetupReceiver>(
  ["runGitHubSetupTeacher", "qualifyGitHubSetup"],
);
