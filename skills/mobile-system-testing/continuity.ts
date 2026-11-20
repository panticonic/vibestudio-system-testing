import type { RpcClient } from "@vibestudio/rpc";
import type { RecoveryKind } from "@vibestudio/rpc/protocol/recoveryCoordinator";
import type { RemoteConnection } from "@vibestudio/rn-client-api";
import { asPanelEntityId, asPanelSlotId } from "@vibestudio/shared/panel/ids";
import type {
  PanelRuntimeLease,
  RuntimeLeaseSnapshot,
} from "@vibestudio/shared/panel/panelLease";
import {
  MobileRpcClient,
  ClientTrustRevokedError,
  isTransientMobileTransportFailure,
  reconcileTrackedRuntimeLeases,
  trackedRuntimeLeaseWasLost,
  loadMobileShellStartupSnapshot,
  saveMobileShellStartupSnapshot,
  type MobileShellStartupSnapshot,
} from "@workspace-clients/mobile-browser/continuity";

export type CacheCase =
  | "exact"
  | "other-device"
  | "other-workspace"
  | "other-server"
  | "old-schema"
  | "invalid-tree"
  | "missing";
export type TransportCase =
  | "warm"
  | "cold"
  | "retired-callback"
  | "server-swap"
  | "revoked"
  | "no-hub"
  | "ordinary-close"
  | "shared-open";
export type RouteCase =
  | "owned"
  | "empty"
  | "foreign"
  | "overlap"
  | "mixed"
  | "old-runtime"
  | "current-release"
  | "old-connection";
export type Scope = { device: string; server: string; workspace: string };
type Closed = { reason: "trust-revoked" | "server-closed"; message: string };

export async function observeFixtureCache(scope: Scope, fixture: CacheCase) {
  const values = new Map<string, string>();
  const removed: string[] = [];
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      removed.push(key);
      values.delete(key);
    },
  };
  const snapshot: MobileShellStartupSnapshot = {
    schemaVersion: 3,
    serverEndpointId: scope.server,
    deviceId: scope.device,
    workspaceIdentity: scope.workspace,
    capturedAt: 1_795_216_000_000,
    preferredPanelId: "panel:tree/overview",
    tree: {
      revision: 10,
      rootGroups: { revision: 10, groups: [], nextCursor: null },
      groups: [],
    },
    rootPanels: [],
  };
  if (fixture === "other-device") snapshot.deviceId += "-archive";
  if (fixture === "other-workspace") snapshot.workspaceIdentity += "-archive";
  if (fixture === "other-server") snapshot.serverEndpointId = "b".repeat(64);
  if (fixture !== "missing")
    await saveMobileShellStartupSnapshot(snapshot, storage);
  if (fixture === "old-schema" || fixture === "invalid-tree") {
    const savedKey = values.keys().next().value!;
    values.set(
      savedKey,
      JSON.stringify(
        fixture === "old-schema"
          ? { ...snapshot, schemaVersion: 2 }
          : { ...snapshot, tree: null },
      ),
    );
  }
  const loaded = await loadMobileShellStartupSnapshot(
    scope.server,
    scope.workspace,
    scope.device,
    storage,
  );
  return {
    status: loaded
      ? ("loaded" as const)
      : removed.length
        ? ("rejected" as const)
        : ("absent" as const),
    preferredSlot: loaded?.preferredPanelId ?? null,
    treeRevision: loaded?.tree.revision ?? null,
    removedBadRecord: removed.length === 1 && values.size === 0,
  };
}

export async function observeFixtureTransport(
  scope: Scope,
  fixture: TransportCase,
  failure: unknown,
) {
  const caller = "shell:" + scope.device;
  const recovered: string[] = [];
  const recoveries: Array<(kind: RecoveryKind) => void | Promise<void>> = [];
  const closedListeners: Array<(closed: Closed) => void> = [];
  let opens = 0;
  const impossible = () => {
    throw new Error(
      "Fixture continuity never sends RPC or opens a physical session",
    );
  };
  const rpc = {
    selfId: caller,
    call: impossible,
    emit: impossible,
    stream: impossible,
    streamReadable: impossible,
    expose: () => {},
    on: () => () => {},
  } as unknown as RpcClient;
  const client = new MobileRpcClient({
    async connectWorkspace(recover) {
      const index = opens++;
      recoveries[index] = recover;
      return {
        serverId:
          fixture === "server-swap" && index > 0
            ? "b".repeat(64)
            : scope.server,
        deviceId: scope.device,
        callerId: caller,
        rpc,
        hubControlRpc: fixture === "no-hub" ? null : rpc,
        session: {
          status: () => "connected",
          onStatusChange: () => () => {},
          onClosed(listener: (closed: Closed) => void) {
            closedListeners[index] = listener;
            return () => {};
          },
        },
        transport: {
          openSession: impossible,
          onReconnectProgress: () => () => {},
        },
        async close() {},
      } as unknown as RemoteConnection;
    },
  });
  const stop = client.onRecovery((kind) => {
    recovered.push(kind);
  });
  let error: string | null = null;
  let revoked = false;
  try {
    if (fixture === "shared-open")
      await Promise.all([client.connectAndWait(), client.connectAndWait()]);
    else await client.connectAndWait();
    if (fixture === "revoked") {
      closedListeners[0]({
        reason: "trust-revoked",
        message: "The local fixture owner withdrew device trust",
      });
      await client.connectAndWait();
    } else if (
      ["retired-callback", "server-swap", "ordinary-close"].includes(fixture)
    ) {
      if (fixture === "ordinary-close")
        closedListeners[0]({
          reason: "server-closed",
          message: "Prior session ended normally",
        });
      client.reconnect();
      await client.connectAndWait();
      if (fixture === "retired-callback") await recoveries[0]("cold-recover");
      await recoveries[1]("resubscribe");
    } else {
      await recoveries[0](fixture === "cold" ? "cold-recover" : "resubscribe");
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
    revoked = reason instanceof ClientTrustRevokedError;
  }
  const result = {
    state: revoked
      ? ("revoked" as const)
      : client.status === "connected"
        ? ("connected" as const)
        : ("closed" as const),
    opens,
    recovered,
    caller: client.status === "connected" ? client.selfId : null,
    server: client.serverId,
    error,
    transient:
      failure === null ? null : isTransientMobileTransportFailure(failure),
  };
  stop();
  await client.close();
  return result;
}

export function observeFixtureRoutes(scope: Scope, fixture: RouteCase) {
  const clientSessionId = "session:" + scope.device;
  const slot = "panel:tree/overview";
  const note = "panel:tree/notes";
  const tracking = [slot, note];
  const lease = (
    name: string,
    owner = clientSessionId,
    runtime = "current",
    connectionId = "retained-connection",
  ) =>
    ({
      slotId: asPanelSlotId(name),
      runtimeEntityId: asPanelEntityId(
        "panel:nav-" + name.slice("panel:tree/".length) + "-" + runtime,
      ),
      clientSessionId: owner,
      connectionId,
    }) as PanelRuntimeLease;
  const address = lease(slot);
  const current = {
    empty: [],
    foreign: [lease(slot, "foreign-session"), lease(note)],
    overlap: [lease(slot, "foreign-session", "previous"), address, lease(note)],
    mixed: [address],
  };
  const leases =
    fixture in current
      ? current[fixture as keyof typeof current]
      : [address, lease(note)];
  const snapshot = {
    version: { epoch: "fixture-boot", counter: 6 },
    leases,
  } satisfies RuntimeLeaseSnapshot;
  const projection = reconcileTrackedRuntimeLeases({
    snapshot,
    trackedSlotIds: tracking,
    clientSessionId,
  });
  const previous =
    fixture === "old-runtime"
      ? lease(slot, clientSessionId, "previous")
      : fixture === "old-connection"
        ? lease(slot, clientSessionId, "current", "earlier-connection")
        : address;
  const inspectEvent = [
    "old-runtime",
    "old-connection",
    "current-release",
  ].includes(fixture);
  const lost =
    inspectEvent &&
    trackedRuntimeLeaseWasLost({
      tracked: address,
      event: {
        runtimeEntityId: previous.runtimeEntityId,
        previous,
        next: null,
      },
      clientSessionId,
    });
  return {
    owned: projection.ours.map((entry) => String(entry.slotId)),
    lost: projection.lost,
    unleased: projection.orphaned,
    invalidated: lost ? [slot] : [],
  };
}
