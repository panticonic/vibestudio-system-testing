import { sha256Hex } from "@vibestudio/content-addressing";
import type { rpc, runtime } from "@workspace/runtime";
import { imagesRpcMethods, type ImagesService } from "@workspace/runtime/images";

type Ports = { runtime: Pick<typeof runtime, "createEntity" | "retireEntity">; rpc: Pick<typeof rpc, "call"> };
/** Real image service, with fixture-local ownership rows over the shared native CAS. */
export async function createOwnedImageStore(context: string, ports: Ports) {
  const entity = await ports.runtime.createEntity({ kind: "do", contextId: context,
    execution: { surface: "code", source: "workers/images" }, className: "ImagesDO",
    key: "retained-image-fixture-" + crypto.randomUUID() });
  if (entity.kind !== "do" || entity.contextId !== context) {
    await ports.runtime.retireEntity({ id: entity.id });
    throw new Error("Image store escaped its owned fixture context");
  }
  const owners = new Map<string, { assetId: string; owner: string }>();
  const key = (value: { assetId: string; owner: string }) => JSON.stringify([value.assetId, value.owner]);
  const release = async (value: { assetId: string; owner: string }) => {
    await ports.rpc.call(entity.targetId, imagesRpcMethods.release, [value]);
    owners.delete(key(value));
  };
  const images: Pick<ImagesService, "importAsset" | "readAsset" | "release"> = {
    async importAsset(input) {
      // Remember the prospective native identity before awaiting its receipt:
      // a committed import whose reply is lost still belongs to this fixture.
      const bytes = Uint8Array.from(atob(input.base64), char => char.charCodeAt(0));
      const ownership = { assetId: "image:" + sha256Hex(bytes), owner: input.owner ?? "import" };
      owners.set(key(ownership), ownership);
      return ports.rpc.call(entity.targetId, imagesRpcMethods.importAsset, [input]);
    },
    readAsset: id => ports.rpc.call(entity.targetId, imagesRpcMethods.readAsset, [id]),
    release,
  };
  let closed = false;
  let closing: Promise<void> | null = null;
  async function close() {
    if (closed) return;
    if (closing) return closing;
    const run = async () => {
      const results = await Promise.allSettled([...owners.values()].map(release));
      const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      try { await ports.runtime.retireEntity({ id: entity.id }); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Owned image store cleanup failed");
      closed = true;
    };
    closing = run();
    try { await closing; } finally { closing = null; }
  }
  return { images, close };
}
