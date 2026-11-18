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
