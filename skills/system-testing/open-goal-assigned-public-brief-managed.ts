import {assessObservedApplicationOutcome} from "@workspace/application-outcomes/observed-application-outcome";
import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
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
  async function verify(raw: unknown,invocation?:InvocationObservations) {
    const report = raw as Outcome | null;
    const outcome = report;
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
    const contract:SemanticOutcomeContract={effects:{checks:["exact_assigned_urls", "verified_cache"].concat([]),rationale:"Actual observed sources, cache bytes, protected scope and stored document effects are checked independently."},returnedValue:{checks:["exact_citations", "returnedDecisionShape"].concat([]),required:true,rationale:"The requested answer, findings and exact citations are required query values; mutation receipt echoes are optional."},incidentalValues:{checks:[],rationale:"Incorrect optional mutation returns are bound only to their actual invocation source and value."}};
    return assessObservedApplicationOutcome({ ...input, goal: world.goal, checks, passed: Object.values(checks).every(Boolean),
      assignedPublicBrief: { binding, shared: proof, outcome }, semanticReviewRequired:true,
      semanticReviewInput:{kind:"public-claims",actual:{goal:world.goal,answer:JSON.stringify(outcome),
        citations:brief?.statements.flatMap(statement=>statement.cites.map(({url,quote})=>({url,quote})))??[],
        sourceScope:[...world.sources],sources:proof.cache.map((cached,index)=>({url:proof.reads[index]!.page.url,
          requested:cached.requested,title:proof.reads[index]!.page.title,retrieved:new Date(proof.request.retrievedAt).toISOString().slice(0,10),sha256:cached.digest,text:cached.visible}))}} },contract,raw,invocation);
  }
  async function qualify() {
    if (await services.publicBrief.bind(["https://invalid.example/"])) throw new Error("An unassigned URL was accepted");
    if (!await services.publicBrief.bind([...world.sources])) throw new Error("The assigned public brief did not bind");
    const reference = await shared.qualify();
    const brief = structuredClone(reference.report);
    if (brief.statements.length) brief.statements[0]!.text = world.referenceAnswer;
    const result = await verify({ decision, brief });
    return { ...result, passed: result.passed && reference.rejectedUnassignedUrl && reference.rejectedForeignDigest };
  }
  return { services, qualify, verify };
}
