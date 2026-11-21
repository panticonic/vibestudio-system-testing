const domain = "https://example.com/";
const help = "https://www.iana.org/help/example-domains";
const registry = "https://www.iana.org/assignments/special-use-domain-names";
const decorative = "https://www.w3.org/WAI/tutorials/images/decorative/";

export const assignedPublicBriefWorlds = [
  {
    id: "public-brief-print-example-without-domain-purchase", kind: "assigned-public-brief", workspace: "examples", split: "train",
    sourceGroup: "vibestudio:web-research:public-reserved-domain-sources",
    goal: "Can we put an Example Domain address in the printed Quickstart without permission, and does choosing it mean we can purchase the domain? Use only https://example.com/ and https://www.iana.org/help/example-domains. Cite the wording that supports both parts of the decision.",
    sources: [domain, help],
    facts: [{ source: domain, pattern: "documentation examples without needing permission" },
      { source: help, pattern: "not available for registration or transfer" }],
    referenceAnswer: "Use the domain in documentation examples without needing permission. The reserved domain is not available for registration or transfer.",
    conclusions: [/document|quickstart/iu, /without.{0,40}(?:permission|coordination)/iu, /not.{0,30}(?:registr|purchase|transfer)|cannot.{0,30}(?:registr|purchase)/iu],
  },
  {
    id: "public-brief-health-check-uses-example-domain", kind: "assigned-public-brief", workspace: "examples", split: "train",
    sourceGroup: "vibestudio:web-research:public-reserved-domain-sources",
    goal: "We want to simplify our uptime alerts by using the Example Domain website as the target. Should we keep that plan? Compare the operator guidance at https://www.iana.org/help/example-domains with the notice at https://example.com/. Use those two pages and quote their practical limits.",
    sources: [help, domain],
    facts: [{ source: help, pattern: "not designed to support production applications" },
      { source: domain, pattern: "avoid relying on it for testing and monitoring purposes" }],
    referenceAnswer: "Avoid using this page for testing or monitoring. The website is not designed to support production applications.",
    conclusions: [/(?:avoid|not|instead|shouldn.t).{0,90}(?:monitor|health|uptime|alert|test)/iu, /production/iu],
  },
  {
    id: "public-brief-inherit-special-use-designation", kind: "assigned-public-brief", workspace: "examples", split: "train",
    sourceGroup: "vibestudio:web-research:public-reserved-domain-sources",
    goal: "I'm about to tell DNS workshop authors that only the parent needs to be treated as special-use, while the children can be treated as ordinary names. Check the scope language at https://www.iana.org/assignments/special-use-domain-names and tell me what to say instead. Use that registry only.",
    sources: [registry],
    facts: [{ source: registry, pattern: "applies to both the listed domains and their subdomains" }],
    referenceAnswer: "Apply the special-use designation to both the listed domains and their subdomains.",
    conclusions: [/(?:appl|cover|extend|includ).{0,100}subdomains/iu],
  },
  {
    id: "public-brief-withhold-website-wide-conformance", kind: "assigned-public-brief", workspace: "examples", split: "test",
    sourceGroup: "vibestudio:web-research:decorative-thumbnails",
    goal: "Our editor followed the decorative-image advice at https://www.w3.org/WAI/tutorials/images/decorative/. Can I sign a claim that our particular library website meets every WCAG criterion based on that one page? Use only the linked guidance and hold the claim if this evidence cannot certify our implementation.",
    sources: [decorative], facts: [], referenceAnswer: "", conclusions: [],
  },
] as const;
export type AssignedPublicBriefWorld = (typeof assignedPublicBriefWorlds)[number];
