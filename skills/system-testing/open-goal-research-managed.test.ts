import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareOpenGoal } from "./open-goal-managed.js";

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

it("requires the conclusion as well as the exact source quotation", async () => {
  const prepared = await prepareOpenGoal({ contextId: "owned", caseId: "explain-reserved-example-domains" });
  if (!("goalDiscovery" in prepared.services) || !("web" in prepared.services))
    throw new Error("Expected the public research workspace");
  const { goalDiscovery, web } = prepared.services;
  await goalDiscovery.search(["reserved example domains"]);
  await expect(web.fetch({ url: sources.unrelated })).rejects.toThrow("authorized URL");
  await web.fetch({ url: sources.url });
  const cites = [{ url: sources.url, quote: sources.quote,
    retrieved: new Date(goalDiscovery.snapshotTime()).toISOString().slice(0, 10) }];
  const verify = (text: string) => prepared.verify({
    status: "answered", research: {
      question: prepared.goal, status: "answered", statements: [{ text, cites }],
    },
  });
  expect(await verify("You can register example.com, example.net, and example.org.")).toMatchObject({
    passed: false, checks: { groundedCitations: true, supportedConclusion: false },
  });
  expect(await verify("Example.com, example.net, and example.org are not available for registration."))
    .toMatchObject({
      passed: true, checks: { groundedCitations: true, supportedConclusion: true, attestedSearchProvider: true },
      searches: [{ provider: "duckduckgo" }],
      citationSources: [{ ...cites[0], provider: "duckduckgo", searchIndex: 0 }],
    });
});
