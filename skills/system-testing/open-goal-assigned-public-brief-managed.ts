import { sameEvidenceMembers } from "./semantic-evidence.js";
import { isDeepStrictEqual } from "node:util";
import { prepareManagedWebBriefWorld } from "./web-brief-managed.js";
import type { AssignedPublicBriefWorld } from "./open-goal-assigned-public-brief-worlds.js";

type Outcome = {
  decision: "supported" | "held";
  brief: Awaited<ReturnType<ReturnType<typeof prepareManagedWebBriefWorld>["qualify"]>>["report"];
};

export function prepareAssignedPublicBrief(
  input: { contextId: string; caseId: string },
  world: AssignedPublicBriefWorld,
  transport?: Parameters<typeof prepareManagedWebBriefWorld>[2],
) {
  if (input.caseId !== world.id) throw new Error("Unknown assigned public brief");
  const shared = prepareManagedWebBriefWorld(input.contextId, world, transport);
  let binding: { sources: string[]; request: typeof shared.request } | null = null;
  const origins = new Set(world.sources.map(url => new URL(url).origin));
  const services = {
    publicBrief: {
      async bind(sources: string[]) {
        if (!sameEvidenceMembers(sources, world.sources)) return null;
        if(binding)return structuredClone(binding.request);
        binding = { sources: [...world.sources], request: structuredClone(shared.request) };
        return structuredClone(binding.request);
      },
    },
    web: {
      search: shared.services.web.search,
      async fetch(options: Parameters<typeof shared.services.web.fetch>[0]) {
        const page = await shared.services.web.fetch(options);
        if (!origins.has(new URL(page.url).origin)) throw new Error("The result left the assigned public origins");
        return page;
      },
      async read(options: Parameters<typeof shared.services.web.read>[0]) {
        return shared.services.web.read(options);
      },
    },
  };
  const decision = world.facts.length ? "supported" as const : "held" as const;
  async function verify(raw: unknown) {
    const report = raw as { status?: string; skill?: string; outcome?: Outcome } | null;
    const outcome = report?.status === "workspace-skill-reviewed" && report.skill === "publicBrief" ? report.outcome : null;
    const brief = outcome?.brief ?? null;
    const proof = await shared.verify(brief);
    const checks = {
      exact_assigned_urls: (!binding || isDeepStrictEqual(binding.sources, world.sources) &&
        isDeepStrictEqual(binding.request, proof.request)) && proof.checks.assigned &&
        proof.reads.every(({ page }) => origins.has(new URL(page.url).origin)),
      verified_cache: proof.checks.cache && proof.checks.continuations,
      exact_citations: proof.checks.citations,
      returnedDecisionShape: (outcome?.decision === "supported" || outcome?.decision === "held") && proof.checks.outcome,
    };
    return { ...input, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      assignedPublicBrief: { binding, shared: proof, outcome }, semanticReviewRequired:true,
      semanticReviewInput:{kind:"public-claims",actual:{goal:world.goal,answer:JSON.stringify(outcome),
        citations:brief?.statements.flatMap(statement=>statement.cites.map(({url,quote})=>({url,quote})))??[],
        sourceScope:[...world.sources],sources:proof.cache.map((cached,index)=>({url:proof.reads[index]!.page.url,
          requested:cached.requested,title:proof.reads[index]!.page.title,sha256:cached.digest,text:cached.visible}))}} };
  }
  async function qualify() {
    if (await services.publicBrief.bind(["https://invalid.example/"])) throw new Error("An unassigned URL was accepted");
    if (!await services.publicBrief.bind([...world.sources])) throw new Error("The assigned public brief did not bind");
    const reference = await shared.qualify();
    const brief = structuredClone(reference.report);
    if (brief.statements.length) brief.statements[0]!.text = world.referenceAnswer;
    const result = await verify({ status: "workspace-skill-reviewed", skill: "publicBrief", outcome: { decision, brief } });
    return { ...result, passed: result.passed && reference.rejectedUnassignedUrl && reference.rejectedForeignDigest };
  }
  return { services, qualify, verify };
}
