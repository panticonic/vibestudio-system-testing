import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import { channelClientRpcMethods } from "@workspace/pubsub/rpc-contract";
import { channelRpcMethods } from "@workspace-workers/pubsub-channel/contract";
import {
  anyOf,
  methodCapability,
  relationship,
} from "@vibestudio/shared/authorization";
import { canonicalEntityId } from "@vibestudio/shared/runtime/entitySpec";
import {
  assertChannelDeliverySource,
  type ResidentChannelDeliveryInput,
} from "@vibestudio/shared/residentSession";

const requires = anyOf(
  methodCapability("host"),
  relationship("workspace-role", "root"),
);
const ownerOnly = {
  website: {
    kind: "closed",
    reason: "Only owned System Testing method peers use this operation.",
  },
  requires,
  effect: { kind: "open" },
  tier: "open",
  sensitivity: "write",
} as const;
const channelOnly = {
  website: {
    kind: "closed",
    reason: "Only the exact admitted local fixture channel may dispatch.",
  },
  principals: ["host", "code"],
  effect: { kind: "open" },
  tier: "open",
  sensitivity: "write",
} as const;
export const ownedMethods = [
  "inspect-counts",
  "compare-template",
  "verify-ownership",
  "confirm-state",
] as const;
export type OwnedMethod = (typeof ownedMethods)[number];
type Configuration = {
  contextId: string;
  fixtureId: string;
  channel: string;
  channelTarget: string;
  peer: string | null;
  role: "caller" | "provider";
  method: OwnedMethod;
  detail: string;
  refused: boolean;
  withholdFirstResponse: boolean;
};
type MethodPayload = { fixtureId: string; source: string; transport: string };
type Execution = {
  transport: string;
  invocation: string;
  method: OwnedMethod;
  detail: string;
  refused: boolean;
};

/** Test-only passive peer. Inbound calls must be admitted by the exact native channel. */
export class OwnedMethodPeerDO extends DurableObjectBase {
  protected createTables() {
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS local_method_config (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS local_method_execution (transport TEXT PRIMARY KEY, body TEXT NOT NULL, executions INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS local_method_lost_response (transport TEXT PRIMARY KEY)",
    );
  }

  private self() {
    return canonicalEntityId({
      kind: "do",
      source: String(this.env["WORKER_SOURCE"]),
      className: String(this.env["WORKER_CLASS_NAME"]),
      key: this.objectKey,
    });
  }

  private configuration(): Configuration {
    this.ensureReady();
    const row = this.sql
      .exec("SELECT body FROM local_method_config WHERE id=1")
      .toArray()[0];
    if (!row) throw new Error("The owned method peer is not configured");
    return JSON.parse(String(row["body"])) as Configuration;
  }

  @rpc(ownerOnly)
  async configureMethodPeer(config: Configuration) {
    this.ensureReady();
    if (
      !ownedMethods.includes(config.method) ||
      !config.contextId ||
      !config.fixtureId ||
      !config.channel.startsWith("owned-method-") ||
      config.channelTarget !==
        "do:workers/local-messaging-fixture:LocalMessagingChannelDO:" +
          config.channel ||
      (config.peer !== null &&
        !config.peer.startsWith(
          "do:workers/local-messaging-fixture:OwnedMethodPeerDO:method-" +
            config.fixtureId +
            "-",
        ))
    )
      throw new Error("Invalid owned method peer scope");
    const previous = this.sql
      .exec("SELECT body FROM local_method_config WHERE id=1")
      .toArray()[0];
    if (previous && String(previous["body"]) !== JSON.stringify(config))
      throw new Error("The owned method peer cannot change scope");
    this.sql.exec(
      "INSERT OR IGNORE INTO local_method_config VALUES (1,?)",
      JSON.stringify(config),
    );
    const id = this.self();
    const joined = await this.rpc.call(
      config.channelTarget,
      channelRpcMethods.join,
      [
        {
          participantId: id,
          operationId: "join:" + config.fixtureId + ":" + config.role,
          contextId: config.contextId,
          delivery: "addressed",
          replay: false,
          applicationConfig: null,
          metadata: {
            type: "agent",
            handle: "fixture-" + config.role,
            name: "Owned method " + config.role,
          },
          endpoint: { kind: "entity", entityId: id, invocation: "direct" },
        },
      ],
    );
    return { id, revision: joined.revision };
  }

  @rpc(ownerOnly)
  async submitOwnedMethod(transport: string, invocation: string) {
    const config = this.configuration();
    if (
      config.role !== "caller" ||
      !config.peer ||
      transport !== "transport:" + config.fixtureId ||
      invocation !== "invocation:" + config.fixtureId
    )
      throw new Error("Request is outside the single owned method exchange");
    const body: MethodPayload = {
      fixtureId: config.fixtureId,
      source: this.self(),
      transport,
    };
    await this.rpc.call(
      config.channelTarget,
      channelClientRpcMethods.callMethod,
      [
        this.self(),
        config.peer,
        transport,
        config.method,
        body,
        { transportCallId: transport, invocationId: invocation },
      ],
    );
    if (config.withholdFirstResponse) {
      const prior = this.sql
        .exec(
          "SELECT transport FROM local_method_lost_response WHERE transport=?",
          transport,
        )
        .toArray()[0];
      if (!prior) {
        this.sql.exec(
          "INSERT INTO local_method_lost_response VALUES (?)",
          transport,
        );
        throw new Error("Owned method transport response withheld");
      }
    }
    return { transport, invocation };
  }

  @rpc(channelOnly)
  async onMethodCall(
    channel: string,
    transport: string,
    method: string,
    value: unknown,
    options: {
      invocationId?: string;
      providerClaimGeneration?: number;
    },
  ) {
    const config = this.configuration();
    const body = value as Partial<MethodPayload> | null;
    if (
      this.rpcCallerKind !== "do" ||
      this.rpcCallerId !== config.channelTarget ||
      config.role !== "provider" ||
      channel !== config.channel ||
      method !== config.method ||
      transport !== "transport:" + config.fixtureId ||
      body?.fixtureId !== config.fixtureId ||
      body.source !== config.peer ||
      body.transport !== transport ||
      options.invocationId !== "invocation:" + config.fixtureId ||
      typeof options.providerClaimGeneration !== "number"
    )
      throw new Error("Only the exact admitted local fixture call may execute");
    const marked = await this.rpc.call(
      config.channelTarget,
      channelClientRpcMethods.markMethodCallExecutionStarted,
      [this.self(), transport, options.providerClaimGeneration],
    );
    if (!marked.accepted)
      throw new Error("Owned method provider claim has moved");
    const outcome: Execution = {
      transport,
      invocation: options.invocationId,
      method: config.method,
      detail: config.detail,
      refused: config.refused,
    };
    this.sql.exec(
      "INSERT INTO local_method_execution VALUES (?,?,1) ON CONFLICT(transport) DO UPDATE SET executions=executions+1",
      transport,
      JSON.stringify(outcome),
    );
    return { result: { detail: config.detail }, isError: config.refused };
  }

  @rpc(channelOnly)
  override async acceptChannelDelivery(input: ResidentChannelDeliveryInput) {
    const config = this.configuration();
    assertChannelDeliverySource(
      { id: this.rpcCallerId, kind: this.rpcCallerKind },
      input,
      config.channelTarget,
    );
    if (
      input.participantId !== this.self() ||
      input.channelId !== config.channel
    )
      throw new Error("Local method delivery is outside its admitted scope");
    return { deliveryId: input.deliveryId, disposition: "processed" as const };
  }

  @rpc(ownerOnly)
  async readOwnedRelationship() {
    const config = this.configuration();
    return this.rpc.call(
      config.channelTarget,
      channelRpcMethods.relationshipState,
      [this.self()],
    );
  }

  @rpc(ownerOnly)
  async retireOwnedMembership(revision: number) {
    const config = this.configuration();
    if (config.role !== "provider")
      throw new Error("Only the owned provider may be retired here");
    await this.rpc.call(config.channelTarget, channelRpcMethods.leave, [
      { participantId: this.self(), revision },
    ]);
  }

  @rpc(ownerOnly)
  async readOwnedExecutions() {
    this.configuration();
    return this.sql
      .exec(
        "SELECT body,executions FROM local_method_execution ORDER BY transport",
      )
      .toArray()
      .map((row) => ({
        ...(JSON.parse(String(row["body"])) as Execution),
        executions: Number(row["executions"]),
      }));
  }
}
