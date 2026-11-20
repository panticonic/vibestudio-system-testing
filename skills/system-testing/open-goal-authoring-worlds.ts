import type { AuthoringSource } from "@workspace-skills/open-authoring-goal/types";
import type { AuthoringContract, AuthoringFinding, AuthoringReport } from "@workspace-skills/natlang-authoring/types";

type Files = Record<string, string>;
type Source = Omit<AuthoringSource, "id"> & { key: string; files: Files; contract?: AuthoringContract };
type Edit = { path: string; text: string };
type Marker = readonly [AuthoringFinding["code"], string];
export type OpenAuthoringWorld = {
  id: string;
  kind: "authoring";
  workspace: "examples";
  sourceGroup: string;
  split?: "test";
  goal: string;
  records: Source[];
  canStage: boolean;
  edit?: Edit;
  expected: {
    candidate: string | null;
    baseline: string | null;
    status: AuthoringReport["status"] | null;
    markers: Marker[];
    stage: boolean;
  };
};

export const authoringRequiresUnits = ["skills/open-user-goal", "skills/open-authoring-goal", "skills/natlang-authoring"];
export const openAuthoringChecks = [
  "discoveredAuthoringRecords", "selectedAuthorizedTrees", "observedCurrentCompiler", "verifiedAuthoringFindings",
  "retainedAuthoringSources", "verifiedAuthoringHandoff", "rejectedStaleAuthoringReceipt",
] as const;

function narrowFunction(description: string, parameters = "  text: string", returns = "string") {
  return `---\ndescription: ${description}\nargs:\n${parameters}\nreturns: ${returns}\n---\nReturn the typed result supported by the supplied evidence.\n`;
}
const readNotes = narrowFunction("Check the exact document observations");
const protectedTree = (label: string): Files => ({
  "review.nl": narrowFunction(label),
  "review/checkNotes.nl": readNotes,
});
const scopedTree = (label: string, selectors: string[]) => ({
  ...protectedTree(label),
  "services.d.ts": 'declare module "natlang:services" { export const serverLog: { read(): Promise<string> } }',
  "natlang.json": JSON.stringify({ serviceScopes: { serverLog: selectors } }),
});
const preserved = (overrides: Partial<AuthoringContract> = {}): AuthoringContract => ({
  entry: "review.nl",
  expectedParameters: null,
  expectedReturn: null,
  declaredServices: null,
  requiredHelpers: ["review/checkNotes.nl"],
  preserveBaseline: true,
  ...overrides,
});
const currentOnly = (overrides: Partial<AuthoringContract> = {}) => preserved({ preserveBaseline: false, ...overrides });

const candidate = (product: string, label: string, note: string, files: Files, contract: AuthoringContract = preserved()): Source =>
  ({ key: "candidate", label, product, note, files, contract, state: "candidate" });
const released = (product: string, label: string, note: string, files: Files, key = "release"): Source =>
  ({ key, label, product, note, files, state: "released" });
const withdrawn = (product: string, label: string, files: Files): Source =>
  ({ key: "withdrawn", label, product, note: "Withdrawn by its author. Retained as review history.", files, state: "withdrawn" });

function world(
  id: string,
  goal: string,
  records: Source[],
  status: OpenAuthoringWorld["expected"]["status"],
  markers: Marker[],
  options: { stage?: boolean; canStage?: boolean; baseline?: string | null; edit?: Edit; held?: true } = {},
): OpenAuthoringWorld {
  return {
    id: `authoring-${id}`, kind: "authoring", workspace: "examples", sourceGroup: `vibestudio:authoring:${id}`,
    ...(options.held ? { split: "test" } : {}),
    goal, records, canStage: options.canStage ?? options.stage ?? false, ...(options.edit ? { edit: options.edit } : {}),
    expected: {
      candidate: status ? "candidate" : null,
      baseline: options.baseline === undefined ? "release" : options.baseline,
      status, markers, stage: options.stage ?? false,
    },
  };
}

const crates = protectedTree("Review museum shipment conditions");
const transit = protectedTree("Review grouped transit notices");
const booking = protectedTree("Check a library branch reservation");
const exhibits = protectedTree("Review conservation intake findings");
const guides = protectedTree("Review park guide copy");
const tickets = protectedTree("Review festival ticket log notes");
const shelters = protectedTree("Review shelter room capacity");
const kitchens = protectedTree("Review food cupboard supply records");
const boats = protectedTree("Review harbour baggage plans");
const rehearsal = protectedTree("Review rehearsal transports and notes");
const textiles = protectedTree("Review textile care instructions");
const fuel = protectedTree("Review fuel meter cards");
const nursing = scopedTree("Review nursing station handoffs", ["review/checkNotes.nl"]);
const meters = scopedTree("Review meter reconciliation notes", ["review/checkNotes.nl"]);
const cinema = scopedTree("Review independent cinema captions", ["review/checkNotes.nl"]);

export const openGoalAuthoringWorlds: OpenAuthoringWorld[] = [
  world("collection-scope-drift", "Could you check whether the new nursing station handoff can still keep log access inside its note-check stage? Compare with the signed Thursday release. If it widens access, leave a scratch note with the compiler-backed finding for the reviewer.", [
    candidate("Nursing handoff", "March maintenance candidate", "Thursday release is the compatibility contract.", scopedTree("Review nursing station handoffs", ["review.nl"])),
    released("Nursing handoff", "Signed Thursday release", "Approved for the floor handoff.", nursing),
    withdrawn("Nursing handoff", "Early maintenance candidate", nursing),
  ], "changes-required", [["service-scope-change", "serverLog"]], { stage: true }),
  world("shipment-reader-result", "The museum’s shipment caller still expects the old text review. Find the current crate review and confirm whether that caller can upgrade unchanged. This is a read-only check; use the June release notes as the comparator.", [
    candidate("Museum shipment", "Crate review renewal", "Caller deployed against the June release.", { ...crates, "review.nl": narrowFunction("Review museum shipment conditions", "  text: string", "{ summary: string }") }),
    released("Museum shipment", "June release notes", "Signed public caller contract.", crates),
    released("Museum archive", "June release notes", "Inventory-only reviewer.", crates, "archive"),
  ], "changes-required", [["return-change", "review.nl"]]),
  world("grouped-notice-private-helper", "Check if the grouped transit notice refresh can replace the September release for existing users. Its private explanation stage is optional. If the compiler and existing callable contract both hold, leave a release review in scratch.", [
    candidate("Transit notices", "Grouped notice refresh", "Check against the September rollout release.", { ...transit, "review/explainGroup.nl": narrowFunction("Summarize the grouped notices") }),
    released("Transit notices", "September rollout", "Reviewed by the service owner.", transit),
    withdrawn("Transit notices", "Unreviewed real-time prototype", { ...transit, "review.nl": narrowFunction("Review grouped transit notices", "  live: boolean") }),
  ], "ready", [], { stage: true }),
  world("library-callers-parameter-order", "The branch reservation caller sends the branch name before the date. Is that still the callable interface in the candidate for the opening-hours fix? Use the approved branch release and leave the sources as you found them.", [
    candidate("Library reservation", "Opening-hours fix", "Compatibility reference: branch release.", { ...booking, "review.nl": narrowFunction("Review branch reservation", "  day: string\n  branch: string") }),
    released("Library reservation", "Branch release", "Live route contract.", { ...booking, "review.nl": narrowFunction("Review branch reservation", "  branch: string\n  day: string") }),
  ], "changes-required", [["parameter-change", "review.nl"]]),
  world("conservation-helper-topology", "The conservation intake package says the evidence reader moved to the root. Does this still have the reviewed private evidence stage from the working release? If the route is broken, leave a scratch handoff for the caretaker with the actual missing path.", [
    candidate("Conservation intake", "Intake topology reorganization", "Approved release protects the intended helper path.", { "review.nl": exhibits["review.nl"]!, "checkNotes.nl": readNotes }),
    released("Conservation intake", "Working intake release", "The caretaker validated the nested route.", exhibits),
  ], "changes-required", [["missing-helper", "review/checkNotes.nl"]], { stage: true }),
  world("park-unresolved-import", "I want to try the park guide proofreader after tomorrow’s walk. Can you find whether the current candidate even compiles before I try it? Give me the exact location if it rejects. No comparison or handoff needed.", [
    candidate("Park guide", "Walkthrough proofreader", "Current candidate before first review.", { ...guides, "facts.ts": 'import { fact } from "./absent.js";\nexport const checked = fact;\n' }, currentOnly()),
    released("Park guide", "Last year's pilot", "Pilot targeted a different walk.", guides, "pilot"),
  ], "candidate-rejected", [["compiler-error", "facts.ts"]], { baseline: null }),
  world("festival-export-type-error", "The festival desk says the ticket report refactor compiled when they saw it. Check the workspace copy against the released ticket count adapter before anyone uses it. Leave the compiler error in scratch if it fails.", [
    candidate("Festival ticket desk", "Counter refactor", "Compare with the released ticket count adapter.", { ...tickets, "counter.ts": 'export function count(): number { return "unavailable"; }\n' }),
    released("Festival ticket desk", "Released ticket count adapter", "Approved live route.", tickets),
  ], "candidate-rejected", [["compiler-error", "counter.ts"]], { stage: true }),
  world("shelter-baseline-still-usable", "Before shelter round leads switch to the new room-capacity helper, check it against the release preserved in the handoff. The proposed copy looking fine alone is insufficient. If the comparison itself fails, leave a scratch note for the next shift.", [
    candidate("Shelter capacity", "Capacity candidate", "Comparison: release preserved in accessibility handoff.", shelters),
    released("Shelter capacity", "Accessibility handoff release", "This is the approval archive copy; check whether it can be read now.", { ...shelters, "retained.ts": 'export const approvedCapacity: number = "none";\n' }),
  ], "baseline-rejected", [["compiler-error", "retained.ts"]], { stage: true }),
  world("cupboard-handoff-after-repair", "The cupboard dispatch owner is finishing a correction while I’m away. Verify the current review against the released stable interface and leave a readiness handoff only if the revision you actually end up reviewing retains it.", [
    candidate("Cupboard dispatch", "Correction candidate", "Compare against the stable stock release.", { ...kitchens, "review.nl": narrowFunction("Review cupboard supply records", "  text: string", "boolean") }),
    released("Cupboard dispatch", "Stable stock release", "The dispatcher relies on text output.", kitchens),
  ], "ready", [], { stage: true, edit: { path: "review.nl", text: kitchens["review.nl"]! } }),
  world("harbour-interrupted-approval", "The harbour intake team will use the verified baggage review if its public result still matches Monday’s release. Check the current copy, and only leave the approval in scratch if you can still verify the final revision.", [
    candidate("Harbour intake", "Baggage review candidate", "Monday release is the deployed caller's contract.", boats),
    released("Harbour intake", "Monday release", "Baggage caller reads plain text.", boats),
  ], "changes-required", [["return-change", "review.nl"]], { canStage: true, edit: { path: "review.nl", text: narrowFunction("Review harbour baggage plans", "  text: string", "boolean") } }),
  world("meter-unlisted-service", "Can you check that today’s standalone meter reconciliation package has only the reading interface as agreed? The authorized brief allows reading local notes without declaring an outside service. Use the candidate itself and leave the findings here, not in a staged file.", [
    candidate("Meter reconciliation", "Standalone proofing utility", "The approved local review has no external service declarations.", meters, currentOnly({ declaredServices: [] })),
    withdrawn("Meter reconciliation", "Earlier debug utility", protectedTree("Review earlier meter notes")),
  ], "changes-required", [["unexpected-service", "serverLog"]], { baseline: null }),
  world("rehearsal-release-absent", "Review the rehearsal route launch candidate only against the approved accessibility release. I have not cleared a comparison to an earlier experimental copy. If the approved release isn’t here, tell me that and stop.", [
    candidate("Rehearsal route", "Launch candidate", "Compare with the approved accessibility release when retained.", rehearsal),
    released("Rehearsal route", "Winter experimental copy", "Experimental date only. Accessibility signoff pending.", rehearsal, "winter"),
    released("Theatre captions", "Approved accessibility release", "A separate product.", rehearsal, "captions"),
  ], null, [], { baseline: null }),
  world("care-instructions-approval-selection", "For the textile guide, the branch with the extra examples should go forward only if it still implements the autumn compatibility release. Ignore the spring demonstration. Record the release review in scratch if the check actually passes.", [
    candidate("Textile care", "Examples candidate", "Approved compatibility target: autumn compatibility release.", { ...textiles, "review/formatExample.nl": narrowFunction("Format one textile care example") }),
    released("Textile care", "Spring demonstration", "A sample that returned an empty marker.", { ...textiles, "review.nl": narrowFunction("Review textile care instructions", "  text: string", "boolean") }, "spring"),
    released("Textile care", "Autumn compatibility release", "Approved for existing reader usage.", textiles),
  ], "ready", [], { stage: true }),
  world("cinema-absent-scope-limits", "Compare the current caption review to the cinema’s accessibility signoff. Can the runtime still restrict log access to the private evidence stage? If the candidate is wider, hand the changed selector evidence to the producer in scratch.", [
    candidate("Cinema captions", "Accessibility candidate", "Compare to the Accessibility signoff release.", { ...cinema, "natlang.json": "{}" }),
    released("Cinema captions", "Accessibility signoff release", "Log access scoped to a private reviewer.", cinema),
    withdrawn("Cinema captions", "Box office draft", { ...cinema, "review.nl": narrowFunction("Review independent cinema captions", "  text: string", "boolean") }),
  ], "changes-required", [["service-scope-change", "serverLog"]], { held: true, stage: true }),
  world("fuel-console-entry-revision", "The fuel meter console starts the reviewed entry by name. The diagnostic view looks good on the draft, but please check whether the reviewed entry compiles and still serves the deployed caller after the operator finishes their update. Do not stage approval unless the final revision is compatible.", [
    candidate("Fuel meter console", "Operator update", "Compatibility contract lives in the Meter desk release.", fuel),
    released("Fuel meter console", "Meter desk release", "Deployed caller retains its result contract.", fuel),
  ], "candidate-rejected", [["compiler-error", "meter-receipt.ts"]], { held: true, canStage: true, edit: { path: "meter-receipt.ts", text: 'export const reading: number = "unavailable";\n' } }),
];
