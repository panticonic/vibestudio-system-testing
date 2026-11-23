import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareAssignedPublicBrief } from "./open-goal-assigned-public-brief-managed.js";
import { assignedPublicBriefWorlds, type AssignedPublicBriefWorld } from "./open-goal-assigned-public-brief-worlds.js";

vi.mock("@workspace/runtime", () => ({ web: {
  fetch: () => Promise.reject(new Error("The public transport must be injected for this test")),
  read: () => Promise.reject(new Error("The cache transport must be injected for this test")),
} }));

function localTransport(world: AssignedPublicBriefWorld, overrides:Record<string,string>={}) {
  const bodies = new Map<string, string>(world.sources.map(url => [
    url,
    overrides[url] ?? "Title and introductory context. " + world.facts.filter(fact => fact.source === url)
      .map(({ pattern }) => pattern + ".").join(" ") + " The page concerns the assigned reference topic.",
  ]));
  const content = new Map<string, string>();
  const fetch = vi.fn(async ({ url, session }: { url: string; session?: string }) => {
    const body = bodies.get(url);
    if (!body || session !== "public") throw new Error("Unexpected transport");
    const digest = createHash("sha256").update(body).digest("hex");
    content.set(digest, body);
    const head = body.slice(0, 32);
    return { url, title: url, digest, size: body.length, head, headBytes: head.length,
      session: "public" as const, truncated: true, servedFromCache: false, elapsedMs: 1 };
  });
  const read = vi.fn(async ({ digest, offset = 0, limit = 8000 }: { digest: string; offset?: number; limit?: number }) => {
    const body = content.get(digest);
    if (!body) throw new Error("Unexpected cache digest");
    const text = body.slice(offset, offset + limit);
    return { digest, offset, limit, text, bytes: text.length, nextOffset: offset + text.length };
  });
  return { fetch, read };
}

it.each(assignedPublicBriefWorlds)("$id uses exact pages and verified citations through the shared adapter", async world => {
  const transport = localTransport(world);
  const prepared = prepareAssignedPublicBrief({ contextId: "owned", caseId: world.id }, world, transport);
  const verified = await prepared.qualify();
  expect(verified.passed).toBe(true);
  expect(transport.fetch.mock.calls).toEqual(world.sources.map(url => [{ url, session: "public" }]));
  expect(verified.assignedPublicBrief.outcome?.decision).toBe(world.facts.length ? "supported" : "held");
  const altered = structuredClone(verified.assignedPublicBrief.outcome!);
  altered.decision = world.facts.length ? "held" : "supported";
  expect((await prepared.verify({ status: "workspace-skill-reviewed", skill: "publicBrief", outcome: altered })).semanticReviewInput.actual.answer).toBe(JSON.stringify(altered));
});

it("keeps source and session scope without prescribing discovery or URL order", async () => {
  const world = assignedPublicBriefWorlds[0];
  const transport = localTransport(world);
  const prepared = prepareAssignedPublicBrief({ contextId: "owned", caseId: world.id }, world, transport);
  const { publicBrief, web } = prepared.services;
  await expect(web.fetch({url:"https://unassigned.example/",session:"public"})).rejects.toThrow(/assigned public/);
  expect(await publicBrief.bind([...world.sources].reverse())).toMatchObject({sources:world.sources});
  expect(await publicBrief.bind([...world.sources])).toMatchObject({ sources: world.sources });
  await expect(web.fetch({ url: world.sources[0], session: "browser" })).rejects.toThrow(/assigned public URLs?/);
  await expect(web.search()).rejects.toThrow("outside this assigned source list");
  expect(transport.fetch).not.toHaveBeenCalled();
  const originalFetch = transport.fetch.getMockImplementation()!;
  transport.fetch.mockImplementationOnce(async request => ({ ...await originalFetch(request), url: "https://another.example/" }));
  await expect(web.fetch({ url: world.sources[0], session: "public" })).rejects.toThrow("left the assigned public origins");
});

it("rejects a corrupted independent cache read even if the visible quotation matches", async () => {
  const world = assignedPublicBriefWorlds[2];
  const transport = localTransport(world);
  const prepared = prepareAssignedPublicBrief({ contextId: "owned", caseId: world.id }, world, transport);
  const result = await prepared.qualify();
  expect(result.passed).toBe(true);
  const originalRead = transport.read.getMockImplementation()!;
  transport.read.mockImplementation(async input => {
    const observed = await originalRead(input);
    return { ...observed, text: observed.text.replace(/^./u, "X") };
  });
  const verification = await prepared.verify({ status: "workspace-skill-reviewed", skill: "publicBrief",
    outcome: result.assignedPublicBrief.outcome });
  expect(verification.checks.verified_cache).toBe(false);
});

it("accepts a sufficient single authorized source for both requested claims, with real quote negatives",async()=>{
  const world=assignedPublicBriefWorlds[0];
  const source="https://www.iana.org/help/example-domains";
  const quote="These domains may be used as illustrative examples in documents without prior coordination with us. They are not available for registration or transfer.";
  const transport=localTransport(world,{[source]:quote});
  const prepared=prepareAssignedPublicBrief({contextId:"owned",caseId:world.id},world,transport);
  const page=await prepared.services.web.fetch({url:source,session:"public"});
  const request=await prepared.services.publicBrief.bind([...world.sources]);
  const brief={question:world.goal,status:"answered",statements:[{
    text:"Use the domain in documentation without permission; you cannot purchase or register it.",
    cites:[{url:source,title:page.title,retrieved:new Date(request!.retrievedAt).toISOString().slice(0,10),published:null,quote}],
  }],notRead:[],rejected:0};
  const verify=(value:unknown)=>prepared.verify({status:"workspace-skill-reviewed",skill:"publicBrief",outcome:{decision:"supported",brief:value}});
  expect((await verify(brief)).passed).toBe(true);
  expect(transport.fetch.mock.calls).toHaveLength(1);
  const wrong=structuredClone(brief);wrong.statements[0]!.text="Use the domain in documentation without permission and purchase or register it.";
  expect((await verify(wrong)).semanticReviewInput.actual.answer).toContain(wrong.statements[0]!.text);
  const forged=structuredClone(brief);forged.statements[0]!.cites[0]!.quote+=" Domain sales are open.";
  expect((await verify(forged)).checks.exact_citations).toBe(false);
});
