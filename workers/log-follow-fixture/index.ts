import { anyOf, methodCapability, relationship } from "@vibestudio/shared/authorization";
import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";

const fixtureOperation = {
  website: { kind: "closed", reason: "Only a disposable managed log follower can emit its private evidence." },
  requires: anyOf(methodCapability("host"), relationship("workspace-role", "root")),
  effect: { kind: "open" },
  tier: "open",
  sensitivity: "write",
} as const;
const phases = ["ready", "catchup", "final"] as const;
type AppendBatch = { marker: string; phase: typeof phases[number]; messages: string[] };

export class LogFollowFixtureDO extends DurableObjectBase {
  protected createTables(): void {
    this.sql.exec("CREATE TABLE IF NOT EXISTS log_fixture (id INTEGER PRIMARY KEY CHECK (id=1), marker TEXT NOT NULL, cursor INTEGER NOT NULL)");
  }

  @rpc(fixtureOperation)
  async appendBatch(input: AppendBatch): Promise<void> {
    const { marker, phase, messages } = input;
    const saved = this.sql.exec("SELECT marker,cursor FROM log_fixture WHERE id=1").toArray()[0];
    const next = saved ? Number(saved.cursor) + 1 : 0;
    if (saved && saved.marker !== marker || !/^natlang-follow-[a-z0-9-]{36}$/u.test(marker) || next > 2 || phases[next] !== phase ||
      messages.length < 1 || messages.length > 17 || messages.at(-1) !== marker + "/barrier " + phase ||
      messages.slice(0, -1).some(message => message.length > 1024 || /[\r\n]/u.test(message) || !message.startsWith(marker + "/row ")))
      throw new Error("Host log fixture batch is outside its owned marker or phase");
    this.sql.exec("INSERT INTO log_fixture VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor", marker, next);
    // This module runs in the owning worker. Eval captures its own console before it reaches the Host server log.
    for (const message of messages) console.warn(message);
  }
}
