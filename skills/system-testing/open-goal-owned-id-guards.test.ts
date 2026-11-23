import { expect,it,vi } from "vitest";
import { prepareOpenLiveLocalInventory } from "./open-goal-live-local-inventory-managed.js";
const native=vi.hoisted(()=>({files:new Map<string,string>()}));
vi.mock("@workspace/runtime",()=>({contextId:"owned",vcs:{status:async()=>({workingHead:{},mainEventId:"event"})},fs:{
  mkdtemp:async()=>"/owned-docket",writeFile:async(path:string,body:string)=>{native.files.set(path,body);},
  readFile:async(path:string)=>native.files.get(path),
}}));

it("reads a known current owned docket directly and repeatedly without a list ceremony",async()=>{
  const world={id:"test",goal:"Inspect local inventory",title:"Current workload",preferences:{}} as never;
  const prepared=await prepareOpenLiveLocalInventory({contextId:"owned",caseId:"test",goal:"Inspect local inventory"},world,
    async()=>({}) as never);
  const id=JSON.parse(native.files.get("/owned-docket/docket.json")!).card.id;
  const docket=await prepared.services.localInventoryDocket.read(id);
  expect(docket.card.id).toBe(id);
  expect(await prepared.services.localInventoryDocket.read(id)).toEqual(docket);
  await expect(prepared.services.localInventoryDocket.read("foreign")).rejects.toThrow("exact current workload");
  native.files.set("/owned-docket/docket.json","tampered");
  await expect(prepared.services.localInventoryDocket.read(id)).rejects.toThrow("docket changed");
});
