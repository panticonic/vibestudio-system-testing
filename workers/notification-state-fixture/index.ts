import {
  anyOf,
  methodCapability,
  relationship,
} from "@vibestudio/shared/authorization";
import type { UserNotification } from "@vibestudio/shared/userNotifications";
import { observeDurableProjection } from "@vibestudio/shell-core/durableObservation";
import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import { UserNotificationStore } from "@workspace-workers/workspace-source/userNotificationStore";
import type {
  FixtureConfiguration,
  FixtureLane,
  FixtureSeed,
} from "./contract.js";

const ownedOperation = {
  website: {
    kind: "closed",
    reason: "Only the owned notification test fixture uses these rows.",
  },
  requires: anyOf(
    methodCapability("host"),
    relationship("workspace-role", "root"),
  ),
  effect: { kind: "open" },
  tier: "open",
  sensitivity: "write",
} as const;

function sameLane(a: FixtureLane | null, b: FixtureLane): boolean {
  return a?.id === b.id && a.generation === b.generation && a.label === b.label;
}

/** SQLite rows belong exclusively to this disposable actor; there is no inbox signal or push port. */
export class NotificationStateFixtureDO extends DurableObjectBase {
  private get store() {
    return new UserNotificationStore(this.sql);
  }

  protected createTables() {
    this.store.initialize();
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS fixture (id INTEGER PRIMARY KEY, configuration TEXT NOT NULL, advanced INTEGER NOT NULL)",
    );
  }

  private config() {
    const row = this.sql
      .exec("SELECT configuration, advanced FROM fixture WHERE id = 1")
      .toArray()[0];
    if (!row)
      throw new Error("Owned notification fixture has not been configured");
    return {
      value: JSON.parse(String(row["configuration"])) as FixtureConfiguration,
      advanced: row["advanced"] === 1,
    };
  }

  private identity(account: "assigned" | "neighbor" = "assigned") {
    return `owned-${this.objectKey}-${account}`;
  }

  private lane(
    config: FixtureConfiguration,
    advanced: boolean,
  ): FixtureLane | null {
    if (advanced && config.transition === "retire") return null;
    if (advanced && config.transition === "switch") {
      return {
        id: this.identity("neighbor"),
        label: "Adjacent desk",
        generation: 2,
      };
    }
    return {
      id: this.identity(),
      label: config.desk,
      generation: advanced && config.transition === "rotate" ? 2 : 1,
    };
  }

  private seed(record: FixtureSeed): UserNotification {
    const userId = this.identity(record.account);
    const row = this.store.put(
      {
        userId,
        id: record.id,
        title: record.title,
        kind: record.kind ?? "work.notice",
        createdAt: record.at ?? 10,
        revision: record.revision ?? 1,
        ...(record.channel ? { data: { channelId: record.channel } } : {}),
      },
      "owned notification seed",
    );
    if (record.read && row.revision === (record.revision ?? 1)) {
      this.store.acknowledge(userId, record.id, row.createdAt + 100);
    }
    return row;
  }

  private projection(lane: FixtureLane) {
    const stripOwner = ({ userId: _owner, ...row }: UserNotification) => row;
    const attention = this.store.list(lane.id).notifications.map(stripOwner);
    const retained = this.store
      .list(lane.id, { includeAcknowledged: true })
      .notifications.map(stripOwner);
    return {
      lane,
      attention,
      retained,
      unreadCount: attention.length,
      retainedCount: retained.length,
    };
  }

  private commitChange(config: FixtureConfiguration) {
    const change = config.change;
    if (!change) return "none" as const;
    if ("remove" in change) {
      return this.store.remove(this.identity(change.account), change.remove)
        ? ("removed" as const)
        : ("missing" as const);
    }
    const incoming = change.put;
    const existing = this.sql
      .exec(
        "SELECT producer_revision FROM user_notifications WHERE user_id = ? AND notification_id = ?",
        this.identity(incoming.account),
        incoming.id,
      )
      .toArray()[0];
    const existingRevision = Number(existing?.["producer_revision"] ?? 0);
    try {
      this.seed(incoming);
    } catch (error) {
      if (
        error instanceof Error &&
        /revision \d+ was already used for other data/u.test(error.message)
      ) {
        return "collision" as const;
      }
      throw error;
    }
    const attempted = incoming.revision ?? 1;
    if (existingRevision > attempted) return "older" as const;
    if (existingRevision === attempted) return "idempotent" as const;
    return "applied" as const;
  }

  @rpc(ownedOperation)
  async configure(value: FixtureConfiguration) {
    if (
      !this.objectKey.startsWith("notification-state-") ||
      !value.desk ||
      value.initial.length > 20
    ) {
      throw new Error(
        "Only a small dedicated notification-state fixture may be seeded",
      );
    }
    if (this.sql.exec("SELECT 1 FROM fixture WHERE id=1").toArray().length) {
      throw new Error("Owned notification fixture cannot be reassigned");
    }
    for (const record of value.initial) this.seed(record);
    this.sql.exec(
      "INSERT INTO fixture VALUES (1, ?, 0)",
      JSON.stringify(value),
    );
    return {
      assigned: this.lane(value, false)!,
      neighbor: {
        id: this.identity("neighbor"),
        label: "Adjacent desk",
        generation: 0,
      },
    };
  }

  @rpc(ownedOperation)
  async read(requested: FixtureLane) {
    const config = this.config();
    const active = this.lane(config.value, config.advanced);
    return sameLane(active, requested) ? this.projection(active!) : null;
  }

  @rpc(ownedOperation)
  async refresh(requested: FixtureLane) {
    const { value, advanced } = this.config();
    const active = this.lane(value, advanced);
    if (advanced || !sameLane(active, requested)) {
      throw new Error(
        "Only the exact current notification observation may advance",
      );
    }
    const before = this.projection(active!);
    let reads = 0;
    let invalidated: (() => Promise<void>) | undefined;
    const applied: ReturnType<typeof this.projection>[] = [];
    const releaseRead =
      Promise.withResolvers<ReturnType<typeof this.projection>>();
    const reading = Promise.withResolvers<void>();
    const observation = observeDurableProjection({
      listen(update) {
        invalidated = update;
        return () => {
          invalidated = undefined;
        };
      },
      read: async () => {
        reads++;
        if (reads === 1) {
          reading.resolve();
          return await releaseRead.promise;
        }
        return this.projection(this.lane(value, true)!);
      },
      apply: (snapshot) => {
        applied.push(snapshot);
      },
      error: () => undefined,
    });
    try {
      await reading.promise;
      if (this.config().advanced) {
        throw new Error(
          "Another caller already advanced the owned observation",
        );
      }
      const producerReceipt = this.commitChange(value);
      this.sql.exec("UPDATE fixture SET advanced = 1 WHERE id = 1");
      const lane = this.lane(value, true);
      const authority = !lane
        ? "retired"
        : sameLane(lane, requested)
          ? "unchanged"
          : "changed";
      const retainedAuthority = lane?.id === requested.id;
      const completion = retainedAuthority
        ? invalidated!()
        : observation.stop();
      releaseRead.resolve(before);
      await completion;
      const discardedPriorRead = retainedAuthority
        ? reads === 2 && applied.length === 1
        : reads === 1 && applied.length === 0;
      return {
        authority,
        lane: retainedAuthority ? lane : null,
        discardedPriorRead,
        producerReceipt,
      };
    } finally {
      releaseRead.resolve(before);
      await observation.stop();
    }
  }

  @rpc(ownedOperation)
  async acknowledge(lane: FixtureLane, id: string, revision: number) {
    const config = this.config();
    const active = this.lane(config.value, config.advanced);
    if (!config.advanced || !sameLane(active, lane))
      return { status: "unavailable" as const, id, revision };
    const visible = this.projection(active!);
    const retained = visible.retained.find((row) => row.id === id);
    if (!retained || retained.revision !== revision)
      return { status: "stale" as const, id, revision };
    const changed = this.store.acknowledge(lane.id, id, 10_000);
    return {
      status: changed ? ("acknowledged" as const) : ("already-read" as const),
      id,
      revision,
    };
  }

  /** Independent raw rows, including entries excluded from both UI projections. */
  @rpc(ownedOperation)
  async audit() {
    const { value, advanced } = this.config();
    return {
      active: this.lane(value, advanced),
      rows: this.sql
        .exec(
          `SELECT user_id AS owner, notification_id AS id, title, kind,
          producer_revision AS revision, created_at AS createdAt,
          acknowledged_at AS acknowledgedAt, data_json AS data
        FROM user_notifications ORDER BY user_id, notification_id`,
        )
        .toArray()
        .map((row) => ({
          owner: String(row["owner"]),
          id: String(row["id"]),
          title: String(row["title"]),
          kind: String(row["kind"]),
          revision: Number(row["revision"]),
          createdAt: Number(row["createdAt"]),
          acknowledgedAt:
            typeof row["acknowledgedAt"] === "number"
              ? row["acknowledgedAt"]
              : null,
          data:
            typeof row["data"] === "string"
              ? (JSON.parse(row["data"]) as unknown)
              : null,
        })),
    };
  }
}
