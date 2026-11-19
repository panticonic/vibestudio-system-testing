const example = "https://example.com/";
const help = "https://www.iana.org/help/example-domains";
const registry = "https://www.iana.org/assignments/special-use-domain-names";

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
