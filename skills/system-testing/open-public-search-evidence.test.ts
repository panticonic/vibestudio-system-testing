import { expect, it, vi } from "vitest";
import type { ProviderName } from "@workspace/web-core";
import { attestPublicSearch } from "./open-public-search-evidence.js";

const url = "https://www.iana.org/help/example-domains";
const output = (provider: ProviderName, query = "reserved domains") => ({
  provider, elapsedMs: 10, results: [{ query, text: "Result", sources: [{ url }] }],
});

it("retains the credentialed provider, successful sources and original query arguments", async () => {
  const hasCredential = vi.fn(async (origin: string) => origin === "https://api.search.brave.com/");
  const search = vi.fn(async () => output("brave"));
  const receipt = await attestPublicSearch({ hasCredential, search }, [" reserved domains "]);
  expect(receipt).toEqual({
    queries: [" reserved domains "], provider: "brave",
    credentialChecks: [{ provider: "tavily", matched: false }, { provider: "brave", matched: true }, {provider:"exa",matched:false}],
    result: output("brave"), urls: [url],
  });
  expect(hasCredential.mock.calls).toEqual([["https://api.tavily.com/"], ["https://api.search.brave.com/"],["https://api.exa.ai/"]]);
  expect(search).toHaveBeenCalledWith([" reserved domains "]);
});

it("requires a completed absence check for every keyed provider before accepting fallback", async () => {
  const receipt = await attestPublicSearch({ hasCredential: async () => false, search: async () => output("duckduckgo") },
    ["reserved domains"]);
  expect(receipt.credentialChecks).toEqual(["tavily", "brave", "exa"].map(provider => ({ provider, matched: false })));
  const search = vi.fn(async () => output("duckduckgo"));
  await expect(attestPublicSearch({ hasCredential: async () => { throw new Error("scope unavailable"); }, search },
    ["reserved domains"])).rejects.toThrow("scope unavailable");
  expect(search).not.toHaveBeenCalled();
});

it("rejects a dropped credential or a response from the wrong keyed provider", async () => {
  const hasCredential = async (origin: string) => origin === "https://api.tavily.com/";
  for (const provider of ["exa"] as const) {
    await expect(attestPublicSearch({ hasCredential, search: async () => output(provider) },
      ["reserved domains"])).rejects.toThrow(/provider does not match/);
  }
});

it("rejects a substituted query and excludes sources returned by errored queries", async () => {
  const hasCredential = async () => false;
  await expect(attestPublicSearch({ hasCredential, search: async () => output("duckduckgo", "unrelated query") },
    ["reserved domains"])).rejects.toThrow(/different query batch/);
  const result = output("duckduckgo");
  const receipt = await attestPublicSearch({ hasCredential, search: async () => ({ ...result,
    results: result.results.map(row => ({ ...row, error: "Provider did not complete" })),
  }) }, ["reserved domains"]);
  expect(receipt.urls).toEqual([]);
});

it("attests a credential-authorized fallback rather than prescribing the first provider",async()=>{
  const receipt=await attestPublicSearch({hasCredential:async origin=>origin==="https://api.tavily.com/",search:async()=>output("duckduckgo")},["reserved domains"]);
  expect(receipt.provider).toBe("duckduckgo");
  expect(receipt.credentialChecks).toHaveLength(3);
});
