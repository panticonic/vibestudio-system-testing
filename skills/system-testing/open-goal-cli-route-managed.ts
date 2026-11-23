import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId, fs, rpc, vcs } from "@workspace/runtime";
import type { CliRouteWorld } from "./open-goal-cli-route-worlds.js";
import type { OpenGoalDomainVerification } from "./open-goal-managed.js";

type Gateway = { serverId: string; bootId: string; workspaceId: string };
type Docket = { id: string; name: string; revision: string; current: boolean };
type Request = { goal: string; operationId: string; serverId: string; workspaceId: string };
type Route = {
  observed: Gateway;
  verdict: CliRouteWorld["gateway"];
  layer: "healthy" | "workspace-routing" | "device-credential";
  next: "accept-identity" | "refresh-workspace-reach" | "verify-server-assignment";
};
type Source = keyof CliRouteWorld["selectors"];
type Coordinate = { contextId: string; workspaceId?: string; serverId?: string };
type Credentials = { kind: "device" } | { kind: "agent"; contextId: string };
type Evidence = {
  gateway: Gateway;
  credential: Credentials;
  operation: CliRouteWorld["operation"];
  selectors: Partial<Record<Source, Coordinate>>;
};
type Continuation = {
  source: Source;
  contextId: string | null;
  status: NonNullable<CliRouteWorld["expected"]>[2];
  action: "run-assigned-command" | "ask-parent" | "repair-scope";
  gateway: Gateway;
};

async function gateway(): Promise<Gateway> {
  const current = await rpc.call("main", mainRpcMethods["auth.getConnectionInfo"], []);
  return { serverId: current.serverId, bootId: current.serverBootId, workspaceId: current.workspaceId };
}

export async function prepareOpenCliRoute(input: { contextId: string; caseId: string; goal: string }, world: CliRouteWorld) {
  if (contextId !== input.contextId || world.id !== input.caseId || world.goal !== input.goal)
    throw new Error("The CLI route must belong to the current goal and context");
  const initial = await vcs.status({ contextId });
  const assignedGateway = await gateway();
  const otherContext = crypto.randomUUID();
  const otherWorkspace = `ws_${crypto.randomUUID()}`;
  const otherServer = `server_${crypto.randomUUID()}`;
  const directory = await fs.mkdtemp("owned-cli-invocation");
  const operationId = crypto.randomUUID();
  const request: Request = {
    goal: input.goal, operationId,
    serverId: world.gateway === "server-mismatch" ? otherServer : assignedGateway.serverId,
    workspaceId: world.gateway === "workspace-mismatch" ? otherWorkspace : assignedGateway.workspaceId,
  };
  function coordinate(source: Source, position: NonNullable<CliRouteWorld["selectors"][Source]>): Coordinate {
    return {
      contextId: position === "other-context" ? otherContext : input.contextId,
      ...(source === "session" || source === "default"
        ? { serverId: position === "other-server" ? otherServer : assignedGateway.serverId } : {}),
      ...(source === "session" || source === "binding" || source === "default"
        ? { workspaceId: position === "other-workspace" ? otherWorkspace : assignedGateway.workspaceId } : {}),
    };
  }
  const basis = {
    request, operation: world.operation,
    credential: (world.credential === "device" ? { kind: "device" } : { kind: "agent", contextId: input.contextId }) as Credentials,
    selectors: Object.fromEntries((Object.entries(world.selectors) as [Source, NonNullable<CliRouteWorld["selectors"][Source]>][])
      .map(([source, position]) => [source, coordinate(source, position)])),
  };
  const history = {
    ...basis, request: { ...request, operationId: crypto.randomUUID(), workspaceId: otherWorkspace },
    selectors: { default: coordinate("default", "other-workspace") },
  };
  const record = JSON.stringify(basis), savedHistory = JSON.stringify(history);
  const docket = { id: crypto.randomUUID(), name: world.title, current: true, revision: sha256HexSyncText(record) };
  const retired = { id: crypto.randomUUID(), name: `${world.title} (retained archive)`, current: false, revision: sha256HexSyncText(savedHistory) };
  const currentPath = `${directory}/${docket.id}.json`, retiredPath = `${directory}/${retired.id}.json`;
  await fs.writeFile(currentPath, record);
  await fs.writeFile(retiredPath, savedHistory);
  let selected: { docket: Docket; request: Request } | null = null;
  let observed: Gateway | null = null;
  let scope: Evidence | null = null;

  async function read(path: string, chosen: Docket) {
    const stored = await fs.readFile(path, "utf8");
    if (stored.length > 8192 || sha256HexSyncText(stored) !== chosen.revision)
      throw new Error("The retained CLI invocation revision changed");
    return JSON.parse(stored) as typeof basis;
  }
  const services = {
    cliRouteDocket: {
      async list() {
        await Promise.all([read(currentPath, docket), read(retiredPath, retired)]);
        return [retired, docket];
      },
      async read(id: string, revision: string) {
        if (id !== docket.id || revision !== docket.revision)
          throw new Error("Use the current exact saved invocation");
        selected = { docket, request: (await read(currentPath, docket)).request };
        return selected;
      },
    },
    remoteGatewayIdentity: {
      async observe(id: string) {
        if (selected && id === selected.request.operationId && observed) return structuredClone(observed);
        if (!selected || id !== selected.request.operationId)
          throw new Error("Verify the gateway of the exact selected invocation once");
        observed = await gateway();
        return observed;
      },
    },
    remoteCliScope: {
      async evidence(id: string): Promise<Evidence> {
        if (!observed || !selected || id !== selected.request.operationId || scope ||
            selected.request.serverId !== observed.serverId || selected.request.workspaceId !== observed.workspaceId)
          throw new Error("The CLI context can only be read after the same gateway was verified");
        const current = await read(currentPath, docket);
        scope = { gateway: observed, selectors: current.selectors,
          credential: current.credential, operation: current.operation };
        return scope;
      },
    },
  };

  function expectedRoute(native: Gateway): Route {
    switch (world.gateway) {
      case "verified": return { observed: native, verdict: "verified", layer: "healthy", next: "accept-identity" };
      case "server-mismatch": return { observed: native, verdict: "server-mismatch", layer: "device-credential", next: "verify-server-assignment" };
      case "workspace-mismatch": return { observed: native, verdict: "workspace-mismatch", layer: "workspace-routing", next: "refresh-workspace-reach" };
    }
  }
  function expectedContinuation(native: Gateway): Continuation | null {
    if (!world.expected) return null;
    const [source, position, status] = world.expected;
    const contextId = status === "unattached" ? null : coordinate(source, position).contextId;
    const action = status !== "usable" ? "repair-scope" :
      world.operation !== "inspect" && world.credential === "agent" ? "ask-parent" : "run-assigned-command";
    return { source, contextId, status, action, gateway: native };
  }
  async function verify(value: unknown): Promise<OpenGoalDomainVerification & Record<string, unknown>> {
    const report = value as {
      status?: string; skill?: string; outcome?: {
        status?: string; docket?: Docket | null; gateway?: Route | null; continuation?: Continuation | null; reason?: string;
      };
    } | null;
    const outcome = report?.outcome;
    const [native, current, storedRetired, final] = await Promise.all([
      gateway(), read(currentPath, docket), read(retiredPath, retired), vcs.status({ contextId }),
    ]);
    const expected = expectedContinuation(native);
    const scopeBound = scope ? isDeepStrictEqual(scope, { gateway: native, selectors: current.selectors,
      credential: current.credential, operation: current.operation }) : false;
    const checks = {
      independentlyObservedCurrentCliDocket: isDeepStrictEqual(selected, { docket, request }) &&
        isDeepStrictEqual(outcome?.docket, docket) && isDeepStrictEqual(current, basis) && isDeepStrictEqual(storedRetired, history),
      exactAuthenticatedCliGateway: isDeepStrictEqual(observed, native) && isDeepStrictEqual(assignedGateway, native) &&
        isDeepStrictEqual(outcome?.gateway, expectedRoute(native)),
      boundAuthorizedCliContinuation: expected ? scopeBound && isDeepStrictEqual(outcome?.continuation, expected) :
        scope === null && outcome?.continuation === null,
      preservedReadOnlyContinuation: isDeepStrictEqual(initial.workingHead, final.workingHead) && initial.mainEventId === final.mainEventId,
      matchedCliRouteDisposition: report?.status === "workspace-skill-reviewed" && report.skill === "cliRoute" &&
        outcome?.status === (expected ? "reviewed" : "held") &&
        typeof outcome.reason === "string" && outcome.reason.trim().length > 0,
    };
    return { contextId: input.contextId, caseId: input.caseId, goal: input.goal,
      passed: Object.values(checks).every(Boolean), checks, docket, observed, selected, scope, expected,
      outcome: outcome ?? null, available: [retired, docket] };
  }
  async function qualify() {
    await services.cliRouteDocket.list();
    const earlyDenied = await services.remoteCliScope.evidence(operationId).then(() => false, () => true);
    const retiredDenied = await services.cliRouteDocket.read(retired.id, retired.revision).then(() => false, () => true);
    await services.cliRouteDocket.read(docket.id, docket.revision);
    const native = await services.remoteGatewayIdentity.observe(operationId);
    const route = expectedRoute(native);
    if (route.verdict === "verified") await services.remoteCliScope.evidence(operationId);
    const wrongIdDenied = await services.remoteCliScope.evidence("foreign").then(() => false, () => true);
    const report = { status: "workspace-skill-reviewed", skill: "cliRoute", outcome: {
      status: route.verdict === "verified" ? "reviewed" : "held", docket, gateway: route,
      continuation: expectedContinuation(native), reason: "Checked the retained invocation against the authenticated gateway.",
    } };
    const proof = await verify(report);
    const enforcedCliEvidenceBoundary = earlyDenied && retiredDenied && wrongIdDenied;
    return { ...proof, passed: proof.passed && enforcedCliEvidenceBoundary,
      checks: { ...proof.checks, enforcedCliEvidenceBoundary } };
  }
  return { services, verify, qualify };
}
