const example = "https://example.com/";
const help = "https://www.iana.org/help/example-domains";
const registry = "https://www.iana.org/assignments/special-use-domain-names";

export const managedResearchIntakeWorlds = [
  {
    id: "documentation-evidence",
    goal: "Review the assigned Example Domain page for the stated purpose of the domain. Cite the original wording.",
    sources: [example],
    check: "research",
    disposition: "supported",
    quotePattern: "documentation examples",
  },
  {
    id: "different-evidence-boundaries",
    goal: "Compare the purpose given on the Example Domain page with IANA's registration-availability rule. Decide whether these two passages make comparable claims about the same measure.",
    sources: [example, help],
    check: "comparison",
    disposition: "incomparable",
    quotePattern: null,
  },
] as const;

export const managedResearchHandoffWorlds = [
  {
    id: "stage-source-grounded-purpose",
    intake: "documentation-evidence",
    goal: "Review the assigned public evidence, then stage a scratch artifact for the next reviewer quoting the exact source that establishes its stated purpose.",
    question: "What purpose does the source give for the domain?",
    status: "staged",
  },
  {
    id: "hold-incomparable-registration-claim",
    intake: "different-evidence-boundaries",
    goal: "Review the assigned public evidence, then decide whether a scratch handoff can substantiate the claim that both sources report the same registration-availability measure. Keep the question open and withhold the artifact if the evidence cannot support it.",
    question: "What source lines substantiate the claim that both documents report the same registration-availability measure?",
    status: "unanswered",
  },
] as const;

export const researchHandoffWork = [
  { kind: "domain", domain: "research", operation: "reviewLiveResearchIntake" },
  { kind: "domain", domain: "scratchHandoff", operation: "assembleHandoff" },
] as const;

export const managedWebBriefWorlds = [
  {
    id: "documentation-and-reservations",
    goal: "Using the two assigned public pages, explain the documentary purpose of the example domain and whether IANA makes the reserved names available for registration. Cite the source for each point.",
    sources: [example, help],
    facts: [
      { source: example, pattern: "documentation examples" },
      { source: help, pattern: "not available for registration or transfer" },
    ],
  },
  {
    id: "registry-subdomain-scope",
    goal: "Using the assigned special-use domain registry, determine whether the designation applies only to listed names or also to their subdomains. Cite the exact evidence.",
    sources: [registry],
    facts: [
      {
        source: registry,
        pattern: "applies to both the listed domains and their subdomains",
      },
    ],
  },
  {
    id: "withhold-unsupported-workspace-fact",
    goal: "Using only the assigned public Example Domain page, tell me who authored my local workspace's private launch memo. Report insufficient evidence if the page does not support an answer.",
    sources: [example],
    facts: [],
  },
];
