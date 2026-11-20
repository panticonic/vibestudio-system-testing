import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";
import type { RuntimeFs, rpc as RuntimeRpc } from "@workspace/runtime";
import { readWorkspaceBytes } from "./scratch-handoff-managed.js";

export type ArchiveOrigin = "baseline" | "local" | "incoming";
export type ArchiveAssignment = {
  title: string;
  origin: ArchiveOrigin;
  setting: string;
  key: string;
};
export type ArchiveCard = { id: string; title: string; revision: string };
export type ArchiveSnapshot = ArchiveCard & { setting: string; key: string; value: unknown; sha256: string };
export type ArchiveReview = { prior: ArchiveSnapshot; current: { exists: boolean; value: unknown }; relation: "matches" | "changed" };
type Read = (state: VcsStateNodeRef, setting: string) => Promise<string>;
type ScratchPort = Pick<RuntimeFs, "mkdtemp" | "writeFile" | "rename">;

export async function seedReconciliationArchive(
  entries: readonly ArchiveAssignment[], states: Record<ArchiveOrigin, VcsStateNodeRef>,
  fs: ScratchPort, rpc: Pick<typeof RuntimeRpc, "call">, readNative: Read,
) {
  if (!entries.length) return null;
  const directory = await fs.mkdtemp("reconciliation-archive");
  const assignments = await Promise.all(entries.map(async (entry, index) => {
    const current = states[entry.origin];
    const value = JSON.parse(await readNative(current, entry.setting)) as Record<string, unknown>;
    if (!Object.hasOwn(value, entry.key)) throw new Error("Historical evidence requires an actual setting value");
    const card = { id: crypto.randomUUID(), title: entry.title, revision: JSON.stringify(current) };
    const recorded = { ...card, setting: entry.setting, key: entry.key, value: value[entry.key] };
    const body = JSON.stringify(recorded) + "\n";
    const path = directory + "/" + index + ".json";
    await fs.writeFile(path + ".pending", body);
    await fs.rename(path + ".pending", path);
    return { card, entry, path, body, recorded };
  }));
  const seen = new Set<string>();
  async function readArtifact(id: string): Promise<ArchiveSnapshot | null> {
    const item = assignments.find(candidate => candidate.card.id === id);
    if (!item) return null;
    const bytes = await readWorkspaceBytes(rpc, item.path, 24 * 1024);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(body);
    if (body !== item.body || !isDeepStrictEqual(parsed, item.recorded))
      throw new Error("Retained scratch evidence changed");
    return { ...item.recorded, sha256: sha256HexSyncText(body) };
  }
  async function read(id: string) {
    const artifact = await readArtifact(id);
    if (artifact) seen.add(id);
    return artifact;
  }
  async function current(id: string, state: VcsStateNodeRef) {
    const owned = assignments.find(item => item.card.id === id);
    if (!owned || !seen.has(id)) return null;
    const live = JSON.parse(await readNative(state, owned.entry.setting)) as Record<string, unknown>;
    return { exists: Object.hasOwn(live, owned.entry.key), value: live[owned.entry.key] ?? null };
  }
  async function verify(expectedIndex: number, filed: ArchiveReview | null | undefined, state: VcsStateNodeRef) {
    const inspected = new Set(seen);
    const selected = assignments[expectedIndex];
    if (!selected) throw new Error("Historical evidence expected an assigned record");
    // Read independently of the model lookup and compare the actual current VCS value.
    const reread = await Promise.all(assignments.map(item => readArtifact(item.card.id)));
    const current = JSON.parse(await readNative(state, selected.entry.setting)) as Record<string, unknown>;
    const recent = { exists: Object.hasOwn(current, selected.entry.key), value: current[selected.entry.key] ?? null };
    const relation = recent.exists && isDeepStrictEqual(recent.value, selected.recorded.value) ? "matches" : "changed";
    const historical = reread[expectedIndex];
    return {
      passed: reread.every(Boolean) && assignments.every(item => inspected.has(item.card.id))
        && isDeepStrictEqual(filed?.prior, historical) && isDeepStrictEqual(filed?.current, recent)
        && filed?.relation === relation,
      sourceId: selected.card.id,
      relation,
      snapshots: reread,
    };
  }
  const listings = assignments.map(item => item.card).sort((left, right) => left.id.localeCompare(right.id));
  return { list: () => listings, referenceId: (index: number) => assignments[index]?.card.id, read, current, verify };
}
