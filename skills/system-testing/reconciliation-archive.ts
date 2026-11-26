import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import type { VcsStateNodeRef } from "@vibestudio/service-schemas/vcs";
import type { RuntimeFs } from "@workspace/runtime";

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
type ScratchPort = Pick<RuntimeFs, "mkdtemp" | "writeFile" | "rename" | "readFile">;

export async function seedReconciliationArchive(
  entries: readonly ArchiveAssignment[], states: Record<ArchiveOrigin, VcsStateNodeRef>,
  fs: ScratchPort, readNative: Read,
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
    const body = await fs.readFile(item.path, "utf8");
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
  async function verify(filed: ArchiveReview | null | undefined, state: VcsStateNodeRef) {
    // Native verifier reads are not actor reads. Preserve all immutable records without imposing a lookup route.
    const inspected = [...seen];
    const snapshots = await Promise.all(assignments.map(item => readArtifact(item.card.id)));
    const currentValues = await Promise.all(assignments.map(async item => {
      const actual = JSON.parse(await readNative(state, item.entry.setting)) as Record<string, unknown>;
      return {sourceId:item.card.id,current:{exists:Object.hasOwn(actual,item.entry.key),value:actual[item.entry.key]??null}};
    }));
    const sourceId = filed?.prior?.id ?? null;
    const historical = snapshots.find(item => item?.id===sourceId);
    const recent = currentValues.find(item=>item.sourceId===sourceId)?.current;
    const relation = historical&&recent ? recent.exists&&isDeepStrictEqual(recent.value,historical.value)?"matches":"changed" : null;
    const fields: readonly (keyof ArchiveSnapshot)[]=["id","title","revision","setting","key","value","sha256"];
    const filedAuthentic = filed == null || Boolean(historical&&recent&&
      fields.every(key=>isDeepStrictEqual(filed.prior?.[key],historical[key]))&&
      isDeepStrictEqual(filed.current?.exists,recent.exists)&&isDeepStrictEqual(filed.current?.value,recent.value)&&filed.relation===relation);
    return {passed:snapshots.every(Boolean),filedAuthentic,sourceId,relation,snapshots,currentValues,actorReadIds:inspected,
      protocol:"These snapshots and current values are independent native facts. actorReadIds records only actual admitted actor reads; no private selected index or all-record read route is required."};
  }
  const listings = assignments.map(item => item.card).sort((left, right) => left.id.localeCompare(right.id));
  return { list: () => listings, referenceId: (index: number) => assignments[index]?.card.id, read, current, verify };
}
