import { expect, it, vi } from "vitest";
import { sha256Hex } from "@vibestudio/content-addressing";
import { imagesRpcMethods } from "@workspace/runtime/images";
import { createOwnedImageStore } from "./owned-image-store.js";
import { prepareOpenImageCandidate } from "./open-goal-image-candidate-managed.js";
import { openImageCandidateWorlds } from "./open-goal-image-candidate-worlds.js";
import { imageFixtureBytes } from "./open-goal-image-fixture-bytes.js";

vi.mock("@workspace/runtime",()=>({contextId:"owned",fs:{},rpc:{},runtime:{},vcs:{}}));
vi.mock("./session-replay-managed.js",()=>({createOwnedHeadlessChannel:vi.fn(),withOwnedChannelClient:vi.fn()}));
vi.mock("./scratch-handoff-managed.js",()=>({readWorkspaceBytes:vi.fn()}));

/** Model the native API's separate SQL ownership tables over shared CAS bytes. */
export function imageStores() {
  const content = new Map<string, string>();
  const stores = new Map<string, Map<string, { asset: Record<string, unknown>; owners: Set<string> }>>([["shared", new Map()]]);
  const created: Record<string, unknown>[] = [], retired: string[] = [];
  let lostReply = false;
  const call = async (target: unknown, method: unknown, args: unknown[]) => {
    const store = stores.get(String(target));
    if (!store) throw new Error("Unknown owned image service");
    if (method === imagesRpcMethods.importAsset) {
      const input = args[0] as { base64: string; owner?: string };
      const bytes = Uint8Array.from(atob(input.base64), char => char.charCodeAt(0));
      const digest = sha256Hex(bytes), id = "image:" + digest;
      const row = store.get(id) ?? { asset: { id, digest, mimeType: "image/png", width: 1, height: 1, byteLength: bytes.length }, owners: new Set<string>() };
      row.owners.add(input.owner ?? "import");store.set(id, row);content.set(digest, input.base64);
      if (lostReply) { lostReply = false;throw new Error("Lost committed import reply"); }
      return row.asset;
    }
    if (method === imagesRpcMethods.release) {
      const input = args[0] as { assetId: string; owner: string };
      store.get(input.assetId)?.owners.delete(input.owner);return;
    }
    const row = store.get(String(args[0]));
    if (!row?.owners.size) throw new Error("Image asset is not retained");
    return { asset: row.asset, base64: content.get(String(row.asset["digest"])) };
  };
  const ports = { rpc: { call }, runtime: {
    async createEntity(input: Record<string, unknown>) {
      created.push(input);const id = "private-" + created.length;stores.set(id, new Map());
      return { id, targetId: id, contextId: input["contextId"], kind: "do" };
    },
    async retireEntity(input: { id: string }) { retired.push(input.id); },
  } };
  return { ports, call, created, retired, stores, loseReply: () => { lostReply = true; } };
}

it("keeps missing originals missing in the owned store while identical shared bytes stay retained", async () => {
  const native = imageStores(), base64 = imageFixtureBytes.png[0];
  const peer = await native.call("shared", imagesRpcMethods.importAsset, [{ base64, owner: "another-case" }]) as { id: string };
  const owned = await createOwnedImageStore("owned", native.ports as never);
  const asset = await owned.images.importAsset({ base64, owner: "this-case" });
  expect(asset.id).toBe(peer.id);
  await owned.images.release({ assetId: asset.id, owner: "this-case" });
  await expect(owned.images.readAsset(asset.id)).rejects.toThrow("not retained");
  expect((await native.call("shared", imagesRpcMethods.readAsset, [peer.id]) as { base64: string }).base64).toBe(base64);
  await owned.close();await owned.close();
  expect(native.created).toHaveLength(1);
  expect(native.created[0]).toMatchObject({ contextId: "owned", className: "ImagesDO", execution: { source: "workers/images" } });
  expect(native.retired).toEqual(["private-1"]);
});

it("cleans a committed import after a lost reply and never releases a sibling's owner", async () => {
  const native = imageStores();
  const first = await createOwnedImageStore("first", native.ports as never);
  const sibling = await createOwnedImageStore("sibling", native.ports as never);
  const asset = await sibling.images.importAsset({ base64: imageFixtureBytes.png[0], owner: "sibling" });
  native.loseReply();
  await expect(first.images.importAsset({ base64: imageFixtureBytes.png[0], owner: "first" })).rejects.toThrow("Lost committed");
  await first.close();
  expect(native.stores.get("private-1")!.get(asset.id)!.owners.size).toBe(0);
  await expect(sibling.images.readAsset(asset.id)).resolves.toMatchObject({ asset: { id: asset.id } });
  expect(native.retired).toEqual(["private-1"]);
  await sibling.close();expect(native.retired).toEqual(["private-1", "private-2"]);
});

function candidatePorts(images:Awaited<ReturnType<typeof createOwnedImageStore>>["images"],close:()=>Promise<void>){
  const files=new Map<string,string>(),directories=new Set<string>(),rows:{id:string;seq:number;record:unknown}[]=[];
  const lane={key:"lane-"+crypto.randomUUID(),target:"journal",expected:[]};
  return {contextId:"owned",images,close,status:async()=>({mainEventId:"main",workingHead:{id:"unchanged"}}),
    fs:{mkdtemp:async(prefix:string)=>{const name=prefix+"-"+crypto.randomUUID();directories.add(name);return "/.tmp/"+name;},
      writeFile:async(path:string,value:string)=>{files.set(path,value);},readdir:async()=>[...directories]},
    open:async()=>lane,append:async(_lane:unknown,_owner:string,records:unknown[])=>records.map(record=>{const id=crypto.randomUUID();rows.push({id,seq:rows.length+1,record:structuredClone(record)});return id;}),
    read:async()=>({channelId:lane.key,through:rows.length,rows:structuredClone(rows)}),
    readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??"")};
}

it("qualifies the missing-original world without releasing identical unrelated image content",async()=>{
  const native=imageStores(),base64=imageFixtureBytes.png[0];
  const peer=await native.call("shared",imagesRpcMethods.importAsset,[{base64,owner:"another-case"}]) as {id:string};
  const owned=await createOwnedImageStore("owned",native.ports as never);
  const prepared=await prepareOpenImageCandidate({contextId:"owned",caseId:"image-candidate-lost-retention-after-selection"},candidatePorts(owned.images,owned.close) as never);
  try{
    const proof=await prepared.qualify();expect(proof.passed).toBe(true);
    expect(proof.reads).toMatchObject([{status:"missing",original:null}]);
    expect(proof.handoff).toBeNull();
  }finally{await prepared.close();}
  await expect(native.call("shared",imagesRpcMethods.readAsset,[peer.id])).resolves.toMatchObject({base64});
  expect(native.retired).toEqual(["private-1"]);
});

it("joins every admitted image import before failed fixture setup releases its store",async()=>{
  const world=openImageCandidateWorlds.find(world=>world.seeds.length===2&&world.seeds.every(seed=>!seed.foreign&&!seed.otherBrief&&(seed.state??"succeeded")==="succeeded"&&(seed.format??"png")==="png"))!;
  const native=imageStores(),owned=await createOwnedImageStore("owned",native.ports as never);
  let enter!:()=>void,finish!:()=>void,count=0;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
  const images={...owned.images,async importAsset(input:Parameters<typeof owned.images.importAsset>[0]){
    if(++count===1)throw new Error("First import failed");enter();await gate;return owned.images.importAsset(input);}};
  const setup=prepareOpenImageCandidate({contextId:"owned",caseId:world.id},candidatePorts(images,owned.close) as never);
  let settled=false;void setup.then(()=>{settled=true;},()=>{settled=true;});
  await entered;await Promise.resolve();expect(settled).toBe(false);expect(native.retired).toEqual([]);
  finish();await expect(setup).rejects.toThrow("First import failed");
  expect(native.retired).toEqual(["private-1"]);
  expect([...native.stores.get("private-1")!.values()].every(row=>row.owners.size===0)).toBe(true);
});
