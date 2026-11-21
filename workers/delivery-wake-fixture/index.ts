import { anyOf, methodCapability, relationship } from "@vibestudio/shared/authorization";
import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import { ChannelDeliveryProjection } from "@workspace-workers/pubsub-channel/delivery-projection";
import type { ServerLogEvent } from "@workspace/pubsub";
import type { DeliveryWakeReceiver, RecipientAddress, WakeProjection, WakeSeed } from "./contract.js";

const authority = {
  website: { kind: "closed", reason: "Native delivery wake uses a disposable projection and two fixture-local recipients." },
  requires: anyOf(methodCapability("host"), relationship("workspace-role", "root")),
  effect: { kind: "open" }, tier: "open", sensitivity: "write",
} as const;

export class DeliveryWakeFixtureDO extends DurableObjectBase implements DeliveryWakeReceiver {
  protected createTables() {
    ChannelDeliveryProjection.createTables(this.sql);
    this.sql.exec("CREATE TABLE IF NOT EXISTS fixture_scope (id INTEGER PRIMARY KEY CHECK(id=1), key TEXT NOT NULL, recipient TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS fixture_log (seq INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  }

  private projection(key: string) {
    return new ChannelDeliveryProjection(this.sql, operation => this.ctx.storage.transactionSync(operation), key);
  }

  private scope(key: string) {
    const row = this.sql.exec("SELECT key,recipient FROM fixture_scope WHERE id=1").toArray()[0];
    if (!row || row.key !== key) throw new Error("Unknown owned channel projection");
    return String(row.recipient);
  }

  private history(after: number, through: number): ServerLogEvent[] {
    return this.sql.exec("SELECT body FROM fixture_log WHERE seq > ? AND seq <= ? ORDER BY seq ASC", after, through)
      .toArray().map(row => JSON.parse(String(row.body)) as ServerLogEvent);
  }

  private observe(key: string): WakeProjection {
    const recipient = this.scope(key), projection = this.projection(key);
    const member = projection.relationship(recipient);
    const debt = projection.pendingReattachBackfills().find(item => item.participantId === recipient);
    const pending = member && debt ? { recipient, revision: member.revision, after: debt.afterSequence, through: debt.throughSequence } : null;
    const cursor = projection.cursor();
    const rows = this.sql.exec(`SELECT delivery_id,event_id,event_sequence,participant_id,subscription_revision,state
      FROM channel_delivery_mailbox ORDER BY event_sequence,participant_id,subscription_revision`).toArray()
      .map(row => ({ deliveryId: String(row.delivery_id), event: String(row.event_id), sequence: Number(row.event_sequence),
        recipient: String(row.participant_id), revision: Number(row.subscription_revision), state: String(row.state) }));
    const contextIds = this.sql.exec("SELECT event_id FROM channel_delivery_event_context ORDER BY event_id")
      .toArray().map(row => String(row.event_id));
    return { cursor, recipient: member ? { id: member.participantId, revision: member.revision, active: member.active, attached: member.attached } : null,
      pending, history: this.history(0, cursor), rows, contextIds, contextCopies: projection.diagnostics(cursor).contextStorage.mailboxContextCopies,
      receipts: projection.receiptRows().map(({ messageId, participantId, state }) => ({ messageId, participantId, state })) };
  }

  @rpc(authority)
  async seed(input: WakeSeed) {
    const { key, recipient, peer, events, omit, seedThrough } = input;
    const address = /^do:workers\/delivery-wake-fixture:DeliveryWakeFixtureDO:[a-z0-9-]{1,160}$/u;
    if (!/^delivery-wake-[a-z0-9-]{36}$/u.test(key) || recipient === peer || !address.test(recipient) || !address.test(peer) ||
      this.sql.exec("SELECT id FROM fixture_scope WHERE id=1").toArray().length || events.length > 16 ||
      events.some((event, index) => event.id !== index + 1 || !event.messageId.startsWith(key + ":")))
      throw new Error("Wrong owned delivery seed");
    const projection = this.projection(key);
    projection.initializeChannelConfig({ conversationPolicy: "directed", agentHopLimit: 4 });
    for (const entry of events) {
      if (entry.id !== omit) this.sql.exec("INSERT INTO fixture_log VALUES (?, ?)", entry.id, JSON.stringify(entry));
      projection.fold(entry);
      if (entry.id === 3) projection.recordRead(key + ":baseline", recipient, key + ":accepted");
    }
    if (seedThrough !== null) {
      const debt = projection.pendingReattachBackfills().find(row => row.participantId === recipient);
      if (!debt || seedThrough > debt.throughSequence) throw new Error("Fixture already has a settled wake");
      const rows = this.history(debt.afterSequence, seedThrough);
      if (rows.length !== seedThrough - debt.afterSequence) throw new Error("Partial fixture replay crossed unavailable source");
      for (const row of rows) projection.advanceReattachBackfill(row, recipient);
    }
    this.sql.exec("INSERT INTO fixture_scope VALUES (1, ?, ?)", key, recipient);
  }

  @rpc(authority)
  async inspect(input: { key: string }) {
    return this.observe(input.key);
  }

  @rpc(authority)
  async recover(input: RecipientAddress & { key: string }) {
    const { key, recipient, revision, after, through } = input;
    const before = this.observe(key), expected = before.pending;
    if (!expected || recipient !== expected.recipient || revision !== expected.revision || after !== expected.after || through !== expected.through)
      throw new Error("Wake cursor or receiver no longer matches the owned relationship");
    const history = this.history(after, through);
    if (history.length !== through - after || history.some(({ id }, index) => id !== after + index + 1))
      throw new Error("Owned wake history is incomplete");
    const projection = this.projection(key);
    let inserted = 0, duplicateReplay = 0;
    for (const event of history) {
      inserted += projection.advanceReattachBackfill(event, recipient);
      duplicateReplay += this.projection(key).advanceReattachBackfill(event, recipient);
    }
    return { inserted, duplicateReplay, native: this.observe(key) };
  }
}
