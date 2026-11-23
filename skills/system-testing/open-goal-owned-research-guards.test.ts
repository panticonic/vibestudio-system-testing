import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareOpenOwnedResearch } from "./open-goal-owned-research-managed.js";
import { openOwnedResearchWorlds } from "./open-goal-owned-research-worlds.js";

vi.mock("@workspace/runtime",()=>({contextId:"owned",extensions:{},vcs:{},web:{}}));
vi.mock("./tests/_terminal-screen.js",()=>({attachTerminalScreen:vi.fn()}));
vi.mock("./open-goal-managed.js",()=>({prepareWorkspaceGoal:vi.fn()}));

it("permits a known owned URL without search while rejecting foreign nonce paths and cache IDs",async()=>{
  const world=openOwnedResearchWorlds.find(world=>!world.edit)!;
  const origin="http://127.0.0.1:12345";
  const nonce="a".repeat(24);
  const pages=new Map(world.pages.map(page=>[`${origin}/${nonce}/${page.id}`,page.paragraphs.join("\n")]));
  const bodies=new Map<string,string>();
  const fetch=vi.fn(async({url}:{url:string})=>{
    const body=pages.get(url)!;
    const digest=createHash("sha256").update(body).digest("hex");
    bodies.set(digest,body);
    return {url,title:"Owned notice",digest,size:Buffer.byteLength(body),head:body,headBytes:Buffer.byteLength(body),
      session:"public" as const,truncated:false,servedFromCache:false,elapsedMs:0};
  });
  const read=vi.fn(async({digest,offset=0,limit=8000}:{digest:string;offset?:number;limit?:number})=>{
    const text=Buffer.from(bodies.get(digest)!).subarray(offset,offset+limit).toString();
    return {digest,offset,limit,text,bytes:Buffer.byteLength(text),nextOffset:offset+Buffer.byteLength(text)};
  });
  const prepared=await prepareOpenOwnedResearch({contextId:"owned",caseId:world.id},{contextId:"owned",
    status:vi.fn(async()=>({mainEventId:"event",workingHead:{}})) as never,
    start:async()=>({origin,nonce,close:async()=>{}}),web:{fetch,read} as never});
  const page=await prepared.services.web.fetch({url:pages.keys().next().value!});
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(prepared.services.web.fetch({url:`${origin}/${"b".repeat(24)}/${world.pages[0]!.id}`})).rejects.toThrow("authorized owned HTTP page");
  await expect(prepared.services.web.read({digest:"0".repeat(64),offset:0,limit:20})).rejects.toThrow("observed owned evidence");
  await expect(prepared.services.web.read({digest:page.digest,offset:0,limit:20})).resolves.toMatchObject({digest:page.digest});
});
