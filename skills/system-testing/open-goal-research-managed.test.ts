import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareOpenGoal } from "./open-goal-managed.js";

vi.mock("./open-goal-suite-managed.js",()=>({prepareOpenGoalSuite:vi.fn()}));

const sources = vi.hoisted(() => ({
  url: "https://www.iana.org/help/example-domains",
  unrelated: "https://unrelated.example/answer",
  quote: "not available for registration or transfer",
}));

vi.mock("@workspace/runtime", () => ({
  contextId: "owned",
  credentials: { resolveCredential: vi.fn(async () => null) },
  fs: {},
  panelTree: {},
  rpc: {},
  web: {
    search: vi.fn(async ({ queries }: { queries: string[] }) => ({
      provider: "duckduckgo", elapsedMs: 0,
      results: queries.map(query => ({ query, text: "Scoped public source", sources: [
        { url: sources.url }, { url: sources.unrelated },
      ] })),
    })),
    fetch: vi.fn(async ({ url }: { url: string }) => ({
      url, title: "Example domains", digest: createHash("sha256").update(sources.quote).digest("hex"),
      session: "public", size: sources.quote.length, head: sources.quote, headBytes: sources.quote.length,
      truncated: false, servedFromCache: false, elapsedMs: 0,
    })),
    read: vi.fn(async ({ digest, offset = 0, limit = 8000 }: { digest: string; offset?: number; limit?: number }) => {
      const text = sources.quote.slice(offset, offset + limit);
      return { digest, offset, limit, text, bytes: text.length, nextOffset: offset + text.length };
    }),
  },
}));

it("binds exact source evidence and actual conclusions for independent semantic judgment", async () => {
  const prepared = await prepareOpenGoal({ contextId: "owned", caseId: "explain-reserved-example-domains" });
  if (!("goalDiscovery" in prepared.services) || !("web" in prepared.services))
    throw new Error("Expected the public research workspace");
  const { goalDiscovery, web } = prepared.services;
  await goalDiscovery.search(["reserved example domains"]);
  await web.fetch({ url: sources.unrelated });
  await web.fetch({ url: sources.url });
  const cites = [{ url: sources.url, quote: sources.quote,
    retrieved: new Date(goalDiscovery.snapshotTime()).toISOString().slice(0, 10) }];
  const verify = (text: string) => prepared.verify({
      question: prepared.goal, status: "answered", statements: [{ text, cites }],
    });
  expect(await verify("You can register example.com, example.net, and example.org.")).toMatchObject({
    passed: true, semanticReviewRequired:true, checks: { groundedCitations: true },
    semanticReviewInput:{kind:"public-claims"},
  });
  expect(await verify("Example.com, example.net, and example.org are not available for registration."))
    .toMatchObject({
      passed: true, semanticReviewRequired:true, checks: { groundedCitations: true, attestedSearchProvider: true },
      searches: [{ provider: "duckduckgo" }],
      citationSources: [{ ...cites[0], provider: "duckduckgo", searchIndex: 0 }],
    });
});

it("reads a directly known authorized public source without a mandatory search route",async()=>{
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:"explain-reserved-example-domains"});
  if(!("goalDiscovery"in prepared.services)||!("web"in prepared.services))throw new Error("Expected web research");
  const {web,goalDiscovery}=prepared.services;
  await web.fetch({url:sources.url});
  const result=await prepared.verify({question:prepared.goal,status:"answered",statements:[{
    text:"Example.com, example.net and example.org are not available for registration.",cites:[{url:sources.url,quote:sources.quote,
      retrieved:new Date(goalDiscovery.snapshotTime()).toISOString().slice(0,10)}],
  }]});
  expect(result).toMatchObject({passed:true,searches:[],citationSources:[{provider:null,searchIndex:null}]});
  await expect(web.fetch({url:sources.url,session:"browser"})).rejects.toThrow("public session");
});

it("propagates a failed provider with its actual query and result receipt across RPC",async()=>{
  const {web}=await import("@workspace/runtime");
  const {serializeRpcFailure,deserializeRpcFailure}=await import("@vibestudio/rpc");
  vi.mocked(web.search).mockImplementationOnce(async({queries})=>({provider:"duckduckgo",elapsedMs:7,
    results:queries.map(query=>({query,text:"actual provider refused",sources:[],error:"DuckDuckGo: upstream HTTP 503"}))}));
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:"explain-reserved-example-domains"});
  const error=await prepared.qualify().then(()=>{throw Error("Expected acquisition failure");},error=>error);
  const wire=serializeRpcFailure(error);
  expect(wire.message).toContain("provider duckduckgo failed");
  expect(wire.message).toContain("upstream HTTP 503");
  expect(wire.errorData).toMatchObject({publicReferenceAcquisition:{phase:"search-provider",host:"iana.org",
    searches:[{provider:"duckduckgo",results:[{error:"DuckDuckGo: upstream HTTP 503",urls:[]}]}],attempts:[]}});
  expect(deserializeRpcFailure(wire).errorData).toEqual(wire.errorData);
});

it("distinguishes successful empty discovery from a provider failure",async()=>{
  const {web}=await import("@workspace/runtime");
  const {serializeRpcFailure}=await import("@vibestudio/rpc");
  const empty=async({queries}:{queries:string[]})=>({provider:"duckduckgo" as const,elapsedMs:1,
    results:queries.map(query=>({query,text:"No matching sources",sources:[]}))});
  vi.mocked(web.search).mockImplementationOnce(empty).mockImplementationOnce(empty);
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:"explain-reserved-example-domains"});
  const error=await prepared.qualify().then(()=>{throw Error("Expected empty discovery");},error=>error);
  const wire=serializeRpcFailure(error);
  expect(wire.message).toContain("Successful reference public searches");
  expect(wire.errorData).toMatchObject({publicReferenceAcquisition:{phase:"source-discovery",attempts:[]}});
  const receipts=(wire.errorData as {publicReferenceAcquisition:{searches:{results:{query:string}[]}[]}}).publicReferenceAcquisition.searches;
  expect(receipts).toHaveLength(2);
  expect(receipts[0]!.results[0]!.query).toContain(prepared.goal);
  for(const receipt of receipts)for(const result of receipt.results)
    expect(result.query).not.toContain(`"${sources.quote}"`);
});

it("considers authority candidates beyond unrelated leading results and retains genuine page digests",async()=>{
  const {web}=await import("@workspace/runtime");
  vi.mocked(web.search).mockImplementationOnce(async({queries})=>({provider:"duckduckgo",elapsedMs:1,
    results:queries.map(query=>({query,text:"Public result list",sources:[
      ...Array.from({length:5},(_,i)=>({url:`https://unrelated-${i}.example/`})),{url:sources.url},
    ]}))}));
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:"explain-reserved-example-domains"});
  const proof=await prepared.qualify();
  expect(proof).toMatchObject({passed:true,semanticReviewRequired:true,
    citationSources:[{url:sources.url,digest:createHash("sha256").update(sources.quote).digest("hex"),provider:"duckduckgo"}]});
});

it("uses an alternative real candidate after one fetch fails, without accepting a foreign redirect",async()=>{
  const {web}=await import("@workspace/runtime");
  const fetch=vi.mocked(web.fetch),original=fetch.getMockImplementation()!;
  vi.mocked(web.search).mockImplementationOnce(async({queries})=>({provider:"duckduckgo",elapsedMs:1,
    results:queries.map(query=>({query,text:"Public result list",sources:[
      {url:"https://www.iana.org/unavailable"},{url:"https://www.iana.org/foreign-redirect"},{url:sources.url},
    ]}))}));
  fetch.mockRejectedValueOnce(Error("Actual candidate connection closed"));
  fetch.mockImplementationOnce(async(options)=>({...await original(options),url:sources.unrelated}));
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:"explain-reserved-example-domains"});
  const proof=await prepared.qualify();
  expect(proof).toMatchObject({passed:true,citationSources:[{url:sources.url}]});
});

it("keeps a wrong native cache digest terminal instead of trying another source",async()=>{
  const {web}=await import("@workspace/runtime");
  const {serializeRpcFailure}=await import("@vibestudio/rpc");
  vi.mocked(web.read).mockImplementationOnce(async({digest,offset=0,limit=8000})=>({digest,offset,limit,
    text:"X".repeat(sources.quote.length),bytes:sources.quote.length,nextOffset:offset+sources.quote.length}));
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:"explain-reserved-example-domains"});
  const error=await prepared.qualify().then(()=>{throw Error("Expected cache-integrity failure");},error=>error);
  expect(serializeRpcFailure(error)).toMatchObject({message:expect.stringContaining("cached page digest"),
    errorData:{publicReferenceAcquisition:{phase:"cache-integrity",attempts:[{url:sources.url}]}}});
});

it("retains original candidate transport failures instead of reporting an empty search",async()=>{
  const {web}=await import("@workspace/runtime");
  const {serializeRpcFailure}=await import("@vibestudio/rpc");
  vi.mocked(web.fetch).mockRejectedValueOnce(Error("Actual source ERR_CONNECTION_CLOSED"));
  const prepared=await prepareOpenGoal({contextId:"owned",caseId:"explain-reserved-example-domains"});
  const error=await prepared.qualify().then(()=>{throw Error("Expected candidate acquisition failure");},error=>error);
  const wire=serializeRpcFailure(error);
  expect(wire).toMatchObject({message:expect.stringContaining("source acquisition failed"),
    errorData:{publicReferenceAcquisition:{phase:"candidate-fetch",attempts:[{url:sources.url,error:"Actual source ERR_CONNECTION_CLOSED"}]}},
    cause:{errors:[{message:"Actual source ERR_CONNECTION_CLOSED"}]}});
});
