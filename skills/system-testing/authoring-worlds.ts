import type {
  AuthoringContract,
  AuthoringFinding,
  AuthoringReport,
  AuthoringRequest,
} from "@workspace-skills/natlang-authoring/types";

type Tree = Record<string, string>;
type Marker = Pick<AuthoringFinding, "code" | "subject">;
export type AuthoringWorld = {
  id: string;
  request: AuthoringRequest;
  candidate: Tree;
  baseline?: Tree;
  expected: { status: AuthoringReport["status"]; markers: Marker[] };
};

function callable(
  title: string,
  signature = "  text: string",
  returns = "string",
) {
  return `---\ndescription: ${title}\nargs:\n${signature}\nreturns: ${returns}\n---\nReturn the typed result supported by the inputs.\n`;
}

function declarations(...names: string[]) {
  return `declare module "natlang:services" {\n${names.map((name) => `  export const ${name}: { read(): Promise<string> };\n`).join("")}}\n`;
}

const trusted = {
  "review.nl": callable("Review an assigned document"),
  "review/checkFacts.nl": callable("Check the exact document facts"),
  "services.d.ts": declarations("serverLog"),
};
const clean = {
  "review.nl": callable("Review an assigned document"),
  "review/checkFacts.nl": callable("Check the facts"),
};
const signatureFailure = {
  ...clean,
  "checks.ts": 'export function count(): number { return "wrong"; }\n',
};
const nonfinite = {
  ...clean,
  "checks.ts":
    "export function count(): number { let n = 0; while (n < 3) n++; return n; }\n",
};

function world(
  id: string,
  goal: string,
  candidate: Tree,
  expected: AuthoringWorld["expected"],
  options: { baseline?: Tree; contract?: Partial<AuthoringContract> } = {},
): AuthoringWorld {
  const { baseline, contract } = options;
  return {
    id,
    candidate,
    ...(baseline ? { baseline } : {}),
    request: {
      goal,
      compare: Boolean(baseline),
      contract: {
        entry: "review.nl",
        expectedParameters: null,
        expectedReturn: null,
        declaredServices: null,
        requiredHelpers: ["review/checkFacts.nl"],
        preserveBaseline: Boolean(baseline),
        ...contract,
      },
    },
    expected,
  };
}
const changed = (...markers: Marker[]): AuthoringWorld["expected"] => ({
  status: "changes-required",
  markers,
});
const ready = { status: "ready", markers: [] } as const;

export const managedAuthoringWorlds: AuthoringWorld[] = [
  world(
    "compatible-addition",
    "Review a refactor that adds a private detail stage while keeping the public entry and its authority.",
    { ...trusted, "review/explain.nl": callable("Explain checked facts") },
    { ...ready, markers: [] },
    { baseline: trusted },
  ),
  world(
    "return-regression",
    "Check whether the public document review result still satisfies its baseline output contract.",
    {
      ...trusted,
      "review.nl": callable(
        "Return a structured verdict",
        "  text: string",
        "{label: string}",
      ),
    },
    changed({ code: "return-change", subject: "review.nl" }),
    { baseline: trusted },
  ),
  world(
    "required-argument",
    "Detect a new required argument before adopting a compiling program with existing callers.",
    {
      ...trusted,
      "review.nl": callable(
        "Review with a caller criterion",
        "  text: string\n  criterion: string",
      ),
    },
    changed({ code: "parameter-change", subject: "review.nl" }),
    { baseline: trusted },
  ),
  world(
    "argument-order",
    "Review an edit that put the optional locale before the existing required text.",
    {
      ...clean,
      "review.nl": callable(
        "Review with language context",
        "  locale: string\n  text: string",
      ),
    },
    changed({ code: "parameter-change", subject: "review.nl" }),
    { contract: { expectedParameters: ["text: string", "locale?: string"] } },
  ),
  world(
    "authority-replacement",
    "Identify both services involved when the program declares web instead of its assigned log service.",
    { ...trusted, "services.d.ts": declarations("web") },
    changed(
      { code: "missing-service", subject: "serverLog" },
      { code: "unexpected-service", subject: "web" },
    ),
    { baseline: trusted },
  ),
  world(
    "explicit-readonly",
    "Apply the new no-service contract and allow removal of the old log dependency.",
    clean,
    { ...ready, markers: [] },
    { baseline: trusted, contract: { declaredServices: [] } },
  ),
  world(
    "helper-in-wrong-folder",
    "Check that the fact checker still sits in the review callable's companion folder.",
    {
      "review.nl": clean["review.nl"]!,
      "checkFacts.nl": clean["review/checkFacts.nl"]!,
    },
    changed({ code: "missing-helper", subject: "review/checkFacts.nl" }),
  ),
  world(
    "wrong-entry-path",
    "Keep the assigned entry source even when a same-named callable exists under another folder.",
    {
      "other/review.nl": clean["review.nl"]!,
      "review/checkFacts.nl": clean["review/checkFacts.nl"]!,
    },
    changed({ code: "missing-entry", subject: "review.nl" }),
  ),
  world(
    "compiler-types",
    "Find and explain the compiler failure preventing the new exact helper from loading.",
    signatureFailure,
    {
      status: "candidate-rejected",
      markers: [{ code: "compiler-error", subject: "checks.ts" }],
    },
  ),
  world(
    "compiler-loop",
    "Explain why a helper with an open-ended loop fails the Natlang compile policy.",
    nonfinite,
    {
      status: "candidate-rejected",
      markers: [{ code: "compiler-error", subject: "checks.ts" }],
    },
  ),
  world(
    "baseline-unavailable",
    "Distinguish an invalid baseline snapshot from a healthy candidate while checking compatibility.",
    clean,
    {
      status: "baseline-rejected",
      markers: [{ code: "compiler-error", subject: "checks.ts" }],
    },
    { baseline: signatureFailure },
  ),
  world(
    "both-rejected",
    "Report the candidate's own compiler failure when both snapshots fail their static checks.",
    {
      ...clean,
      "candidate-check.ts":
        'export function run(): number { return "incorrect"; }\n',
    },
    {
      status: "candidate-rejected",
      markers: [{ code: "compiler-error", subject: "candidate-check.ts" }],
    },
    { baseline: signatureFailure },
  ),
];

const entry = "review.nl";
const facts = "review/checkFacts.nl";
const source = "review/checkFacts/readSource.nl";
const lineage = "review/checkFacts/checkLineage.nl";
const release = "review/recordDecision.nl";
const summary = "review/writeSummary.nl";
const subtree = facts + "/**";
const indexedCallables = {
  [entry]: callable(
    "Coordinate evidence review and decide whether the handoff is ready",
  ),
  [facts]: callable(
    "Check facts and evidence independently of the decision recorder",
  ),
  [source]: callable("Read the evidence source assigned to this check"),
  [lineage]: callable("Verify the chain of custody for the assigned source"),
  [release]: callable("Record only the reviewed decision handed to this stage"),
  [summary]: callable("Write the report after the review decision"),
};

type Selectors = Record<string, string[] | null>;

function scopedProgram(selectors: Selectors, changes: Tree = {}): Tree {
  const serviceScopes = Object.fromEntries(
    Object.entries(selectors).filter(([, paths]) => paths !== null),
  );
  return {
    ...indexedCallables,
    "services.d.ts": declarations(...Object.keys(selectors)),
    "natlang.json": JSON.stringify({
      schema: "natlang.package/v2",
      name: "review-assignment",
      version: "0.1.0",
      serviceBinding: "explicit",
      serviceScopes,
      targets: { main: { entry } },
    }),
    ...changes,
  };
}

const scopeFinding = (subject: string): Marker => ({
  code: "service-scope-change",
  subject,
});
const accepted = () => ({ ...ready, markers: [] });
function scopeWorld(
  id: string,
  goal: string,
  baseline: Selectors,
  candidate: Selectors,
  expected: AuthoringWorld["expected"],
  options: {
    expectedScopes?: Selectors;
    changes?: Tree;
    contract?: Partial<AuthoringContract>;
  } = {},
) {
  const { expectedScopes, changes, contract } = options;
  return world(
    `scope-${id}`,
    goal,
    scopedProgram(candidate, changes),
    expected,
    {
      baseline: scopedProgram(baseline),
      contract: {
        requiredHelpers: [facts, source, lineage, release, summary],
        ...(expectedScopes ? { expectedServiceScopes: expectedScopes } : {}),
        ...contract,
      },
    },
  );
}

managedAuthoringWorlds.push(
  scopeWorld(
    "drop-release-restriction",
    "Check if the decision recorder remains the only callable with write access after the release refactor.",
    { decisionWriter: [release] },
    { decisionWriter: null },
    changed(scopeFinding("decisionWriter")),
  ),
  scopeWorld(
    "exact-to-call-chain",
    "Check whether source credentials now propagate through the fact-check call chain.",
    { sourceReader: [facts] },
    { sourceReader: [subtree] },
    changed(scopeFinding("sourceReader")),
  ),
  scopeWorld(
    "remove-call-chain-access",
    "Determine whether evidence readers invoked under the fact checker retain their inherited grant.",
    { evidenceReader: [subtree] },
    { evidenceReader: [facts] },
    changed(scopeFinding("evidenceReader")),
  ),
  scopeWorld(
    "add-sibling-writer",
    "Check whether the summary stage now holds the decision service intended for the recorder.",
    { decisionWriter: [release] },
    { decisionWriter: [release, summary] },
    changed(scopeFinding("decisionWriter")),
  ),
  scopeWorld(
    "reorder-exact-readers",
    "Review a manifest-only reordering of the two exact audit readers.",
    { auditReader: [source, lineage] },
    { auditReader: [lineage, source] },
    accepted(),
  ),
  scopeWorld(
    "dedupe-mixed-selectors",
    "Check whether two repeated grant entries change the scope after manifest normalization.",
    { intakeReader: [subtree, release] },
    { intakeReader: [release, subtree, release, subtree] },
    accepted(),
  ),
  scopeWorld(
    "deny-all-regression",
    "Check whether the disabled dispatch service can now be used by the review entry.",
    { dispatcher: [] },
    { dispatcher: [entry] },
    changed(scopeFinding("dispatcher")),
  ),
  scopeWorld(
    "deny-all-to-unrestricted",
    "Distinguish removing the disabled webhook scope from continuing to deny it to every callable.",
    { webhook: [] },
    { webhook: null },
    changed(scopeFinding("webhook")),
  ),
  scopeWorld(
    "observe-approved-hardening",
    "Apply the newly approved audit restriction and verify that the hardened candidate meets it.",
    { auditReader: null },
    { auditReader: [lineage] },
    accepted(),
    { expectedScopes: { auditReader: [lineage] } },
  ),
  scopeWorld(
    "hardening-not-applied",
    "Require the reviewer-only audit restriction even though the unconstrained candidate matches its previous revision.",
    { auditReader: null },
    { auditReader: null },
    changed(scopeFinding("auditReader")),
    { expectedScopes: { auditReader: [lineage] } },
  ),
  scopeWorld(
    "two-independent-services",
    "Review both authority changes when the reader moves to the root and the recorder stays bound but can no longer write.",
    { sourceReader: [source], decisionWriter: [release] },
    { sourceReader: [entry], decisionWriter: [] },
    changed(scopeFinding("sourceReader"), scopeFinding("decisionWriter")),
  ),
  scopeWorld(
    "explicit-one-inherited-other",
    "Accept the new evidence-reader allocation while preserving the baseline restriction on report writes.",
    { evidenceReader: [source], reportWriter: [summary] },
    { evidenceReader: [lineage], reportWriter: [entry, summary] },
    changed(scopeFinding("reportWriter")),
    { expectedScopes: { evidenceReader: [lineage] } },
  ),
  scopeWorld(
    "intentional-unrestricted-reader",
    "Apply the approved unrestricted read contract and check that the writer remains pinned to the recorder.",
    { sourceReader: [source], decisionWriter: [release] },
    { sourceReader: null, decisionWriter: [release] },
    accepted(),
    { expectedScopes: { sourceReader: null } },
  ),
  scopeWorld(
    "manifest-restricts-approved-public-reader",
    "Report an unintended restriction on a service explicitly approved for any callable.",
    { publicReference: null },
    { publicReference: [facts] },
    changed(scopeFinding("publicReference")),
    { expectedScopes: { publicReference: null } },
  ),
  scopeWorld(
    "declaration-and-remaining-grant",
    "Identify the removed upstream reviewer, its unexpected replacement, and the retained publisher whose grant shifted.",
    { upstreamAudit: [lineage], publisher: [release] },
    { externalAudit: [lineage], publisher: [summary] },
    changed(
      { code: "missing-service", subject: "upstreamAudit" },
      { code: "unexpected-service", subject: "externalAudit" },
      scopeFinding("publisher"),
    ),
  ),
  scopeWorld(
    "two-declared-services-stable",
    "Confirm that the archive still has no callable grant and the custodian remains confined to the source subtree despite an unrelated helper addition.",
    { archiveStore: [], custodian: [subtree] },
    { custodian: [subtree], archiveStore: [] },
    accepted(),
    {
      changes: {
        "review/checkFacts/explain.nl": callable(
          "Explain source custody without side effects",
        ),
      },
    },
  ),
  scopeWorld(
    "authority-and-return",
    "Check both the changed review return type and the moved recording grant before accepting the integration.",
    { decisionWriter: [release] },
    { decisionWriter: [summary] },
    changed(scopeFinding("decisionWriter"), {
      code: "return-change",
      subject: entry,
    }),
    {
      changes: {
        [entry]: callable(
          "Review the handoff",
          "  text: string",
          "{label: string}",
        ),
      },
    },
  ),
  scopeWorld(
    "authority-and-required-input",
    "Check whether adding a required reviewer ID also gave callers broader intake permissions.",
    { intakeReader: [facts] },
    { intakeReader: [subtree] },
    changed(scopeFinding("intakeReader"), {
      code: "parameter-change",
      subject: entry,
    }),
    {
      changes: {
        [entry]: callable(
          "Review with an assigned reviewer",
          "  text: string\n  reviewer: string",
        ),
      },
    },
  ),
  scopeWorld(
    "approval-revokes-stage-access",
    "Confirm that a temporary declaration is still present for compatibility but callable access has been fully revoked.",
    { dispatcher: [release] },
    { dispatcher: [] },
    accepted(),
    { expectedScopes: { dispatcher: [] } },
  ),
  scopeWorld(
    "explicit-no-baseline-protection",
    "Use the assigned threat-review grant and disregard older permission allocations for other services.",
    { threatReader: [source], reportWriter: [summary] },
    { threatReader: [lineage], reportWriter: [] },
    accepted(),
    {
      expectedScopes: { threatReader: [lineage] },
      contract: { preserveBaseline: false },
    },
  ),
);

managedAuthoringWorlds.push(
  world(
    "scope-explicit-without-baseline",
    "Review the new incident program against its assigned audit grant before any baseline exists.",
    scopedProgram({ auditReader: [entry] }),
    changed(scopeFinding("auditReader")),
    { contract: { expectedServiceScopes: { auditReader: [lineage] } } },
  ),
  world(
    "scope-empty-exact-without-baseline",
    "Verify that a retained declaration for an inactive shipping integration grants access to no callable.",
    scopedProgram({ shippingService: [] }),
    accepted(),
    { contract: { expectedServiceScopes: { shippingService: [] } } },
  ),
);
