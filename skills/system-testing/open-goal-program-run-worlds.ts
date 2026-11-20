import type { ProgramOutputReceipt, RunProgram, RunSample } from "@workspace-skills/open-program-run/types";

type Files = Record<string, string>;
export type Sample = Omit<RunSample, "id"> & { key: string; input: unknown; reference?: unknown; revisedReference?: unknown };
export type RuntimeProject = Omit<RunProgram, "id" | "samples"> & { key: string; files: Files; samples: Sample[] };
type Attempt = Pick<ProgramOutputReceipt, "status" | "verification"> & { sample: string; value?: unknown; error?: string };
export type ProgramRunWorld = {
  id: string;
  workspace: "examples";
  kind: "program-run";
  sourceGroup: string;
  split?: "test";
  goal: string;
  projects: RuntimeProject[];
  allowRefresh: boolean;
  revokeSigning?: true;
  edit?: { file: string; text: string };
  expected: { project: string | null; inspected: number; attempts: Attempt[]; next: string | null; signed: boolean };
};

export const programRunRequiresUnits = ["skills/open-user-goal", "skills/open-program-run", "skills/runtime-evidence-review"];
export const openProgramRunChecks = ["discoveredRuntimePrograms", "inspectedCurrentCallable", "ranAuthorizedSamples",
  "verifiedNativeOutputReceipts", "preservedRuntimeSource", "verifiedSignedOutput", "rejectedForeignRuntimeEvidence"] as const;

const code = (argument: string, output: string, body: string): Files => ({
  "main.ts": `export function check(${argument}): ${output} { ${body} }\n`,
});
const source = (label: string, purpose: string, files: Files, samples: Sample[], permission: RunProgram["permission"] = "verify-and-sign"): RuntimeProject =>
  ({ key: "target", label, purpose, files, samples, state: "active", permission });
const archived = (label: string, purpose: string): RuntimeProject =>
  ({ key: "archive", label, purpose, files: code("input: number", "number", "return input + 1;"), samples: [], state: "archived", permission: "inspect" });
const sample = (key: string, label: string, purpose: string, input: unknown, reference?: unknown, authorization: RunSample["authorization"] = "initial"): Sample =>
  ({ key, label, purpose, input, ...(reference === undefined ? {} : { reference }), authorization });
const verified = (key: string, value: unknown): Attempt => ({ sample: key, status: "returned", verification: "verified", value });
const old = (key: string, value: unknown): Attempt => ({ sample: key, status: "returned", verification: "stale", value });
const errors = (key: string, error: string, status: "rejected" | "interrupted" = "rejected"): Attempt => ({ sample: key, status, verification: "failed", error });

function state(
  id: string, goal: string, projects: RuntimeProject[], attempts: Attempt[], next: string | null,
  options: { sign?: boolean; refresh?: boolean; edit?: ProgramRunWorld["edit"]; inspections?: number; held?: true; revokeSigning?: true } = {},
): ProgramRunWorld {
  return {
    id: `program-run-${id}`, kind: "program-run", workspace: "examples", sourceGroup: `vibestudio:program-run:${id}`,
    ...(options.held ? { split: "test" } : {}), goal, projects, allowRefresh: options.refresh ?? false,
    ...(options.revokeSigning ? { revokeSigning: true } : {}),
    ...(options.edit ? { edit: options.edit } : {}),
    expected: { project: next ? "target" : null, inspected: options.inspections ?? (next ? 1 : 0), attempts, next, signed: options.sign ?? false },
  };
}
const approvedBins = code("data: {capacity:number; books:number}", "{cartons:number;overflow:number}",
  "return {cartons: Math.floor(data.books / data.capacity), overflow: data.books % data.capacity};");
const handoffAbort = code("input: {open:boolean; desks:number}", "number",
  'if (!input.open) { const stop = new Error("intake window withdrawn"); stop.name = "AbortError"; throw stop; } return input.desks * 4;');
const quantity = code("units: number", "number", 'if (units < 0) throw new Error("negative stock is not admissible"); return units * 3;');

export const openGoalProgramRunWorlds: ProgramRunWorld[] = [
  state("crate-count-readback", "Run the active crate loader on the approved west-lobby count. We need the verified number of full cartons and overflow books. Record a signed scratch receipt if it matches the receiving sheet.", [
    source("Counter for crates", "Active west-wing carton handoff", approvedBins,
      [sample("west", "West lobby count", "The current receiving sheet", { capacity: 12, books: 50 }, { cartons: 4, overflow: 2 }),
       sample("east", "East lobby count", "Separate freight window", { capacity: 8, books: 17 }, { cartons: 2, overflow: 1 })]),
    archived("Counter for crates", "Prior flat-carton trial"),
  ], [verified("west", { cartons: 4, overflow: 2 })], "verified", { sign: true }),
  state("cutoff-false-is-verified", "The evening ticket cutoff is disputed. Run the desk’s last exactly-on-the-boundary example. I want a signed answer if the outcome independently checks, even if admission is closed.", [
    source("Door policy boundary", "Active evening box office", code("input: {minute:number; cutoff:number}", "boolean", "return input.minute < input.cutoff;"),
      [sample("boundary", "Exactly at close", "Minute 30 against minute 30", { minute: 30, cutoff: 30 }, false),
       sample("before", "Before cutoff", "Approved positive control", { minute: 29, cutoff: 30 }, true)]),
  ], [verified("boundary", false)], "verified", { sign: true }),
  state("inventory-rejected-then-zero", "Test the inventory export on the rejected supplier correction first so we have its actual failure. If it refuses the quantity, the separately approved zero-stock sample is fine. Keep a signed receipt for the verified zero-stock result only.", [
    source("Inventory issue counter", "Active quantities passed to the shelf exporter", quantity,
      [sample("supplier", "Supplier correction", "The approved diagnostic attempt", -1), sample("empty", "Zero-stock sample", "Fallback if supplier quantity is rejected", 0, 0, "after-rejection")]),
  ], [errors("supplier", "negative stock is not admissible"), verified("empty", 0)], "verified", { inspections: 2, sign: true }),
  state("captions-rejection-without-rerun", "The captions label export says it has a valid string interface. Try only the approved screening-room blank label and tell me what the actual call reports. Leave the original input alone even if it refuses.", [
    source("Caption labels", "Reading room signage", code("s: string", "string", 'if (!s.trim()) throw new Error("a caption label is required"); return s.trim();'),
      [sample("blank", "Blank screening room label", "Diagnostic screening-room upload", " "), sample("valid", "Adjusted label", "Alternate approved only after a rejection", " South Annex ", "South Annex", "after-rejection")]),
  ], [errors("blank", "a caption label is required")], "inspect-trace"),
  state("route-interrupted-then-covered", "Try the day crew intake window. If the current request has been withdrawn, use the already approved coverage window. Sign the checked coverage result in scratch for the shift lead.", [
    source("Welcome desk route", "Host team intake monitor", handoffAbort,
      [sample("day", "Day crew intake window", "Primary handoff", { open: false, desks: 1 }),
       sample("cover", "Coverage window", "Only available after actual interruption", { open: true, desks: 2 }, 8, "after-interruption")]),
  ], [errors("day", "intake window withdrawn", "interrupted"), verified("cover", 8)], "verified", { inspections: 2, sign: true }),
  state("ferry-stale-then-current", "Please verify the ferryman's current loading result for the booked collection. The same approved batch can run again if the dock team changes its sizing rule during the check. Sign only the updated verified output.", [
    source("Ferry crate durations", "Current loading rule for the booked collection", {
      "main.ts": 'import { timed } from "./slots.js"; export function check(n:number):number { return timed(n); }',
      "slots.ts": "export function timed(n:number):number { return n * 10; }",
    }, [{ ...sample("booked", "Booked collection", "Three retained crate scans", 3, 30), revisedReference: 36 }]),
  ], [old("booked", 30), verified("booked", 36)], "verified", { inspections: 2, sign: true, refresh: true, edit: { file: "slots.ts", text: "export function timed(n:number):number { return n * 12; }" } }),
  state("archive-stale-read-only", "Run the approved transport-window sample once and tell me whether the returned eligibility still reflects the current policy. This ticket authorizes one call. If the owner changes the threshold afterward, keep the original result and flag it as stale.", [
    source("Transport eligibility", "Original eligibility check for the archive shuttle", code("minutes:number", "boolean", "return minutes >= 15;"),
      [{ ...sample("held", "Transport delay at threshold", "Single signed archive sample", 15, true), revisedReference: false }]),
  ], [old("held", true)], "refresh-program-receipt", { edit: { file: "main.ts", text: code("minutes:number", "boolean", "return minutes > 15;")["main.ts"]! } }),
  state("unchecked-weather-readback", "Run the newly wired weather status text for the rain-day sample. I only need evidence of what the trial actually returned. The handbook reference is still missing, so keep the result marked as unchecked.", [
    source("Ranger weather status", "Park shorthand for turnout notices", code("rain:boolean", "string", 'return rain ? "wet-route" : "dry-route";'),
      [sample("rain", "Rain-day location", "No approved comparator retained", true)], "trial"),
  ], [{ sample: "rain", status: "returned", verification: "unchecked", value: "wet-route" }], "inspect-trace"),
  state("closed-workstation-mismatch", "Check one approved closing-time trial for the laundry desk. It should select the staffing sheet's closed marker even if the call returns normally. Record a signature only if the native output actually agrees with the sheet.", [
    source("Laundry staffing marker", "Current staffing desk browser selection", code("atClose:boolean", "string", 'return atClose ? "overflow" : "open";'),
      [sample("close", "Closing time", "Approved staffing owner sample", true, "closed")]),
  ], [{ sample: "close", status: "returned", verification: "mismatch", value: "overflow" }], "inspect-trace"),
  state("sender-compile-failure", "I think the volunteer meal estimate is ready for the registered trial, but the editor warned about a numeric result type. Check the real compiler and run only if it can expose the trial. Show the actual blocker otherwise.", [
    source("Volunteer meal estimate", "Count of adult places in the community hall", code("guests:number", "number", 'return "full";'),
      [sample("hall", "Community hall", "Approved volunteer list", 16, 16)]),
  ], [], "repair-result-contract"),
  state("dry-run-grant-is-inspection-only", "The gallery only cleared inspection of the new frame handoff's callable today. Confirm that the named interface can be invoked once a sample is authorized. Don’t run any of the old frame samples.", [
    source("Frame handoff", "Current gallery check-in", code("id:number", "{id:number; registered:boolean}", "return {id, registered: id > 0};"),
      [sample("old", "Old frame sample", "Retained from a previously reviewed shift", 13, { id: 13, registered: true })], "inspect"),
  ], [], "call-reviewed-signature"),
  state("dedupe-audio-recording", "Check the active choir program on the approved duplicate-take rehearsal. We need its matched unique tracks in first-seen order. Sign the exact result if it agrees with the printed take sheet; the archived trim-only tool is unrelated.", [
    source("Choir take review", "Current duplicate track removal", code("names:string[]", "string[]", "return [...new Set(names)];"),
      [sample("practice", "Duplicate-take rehearsal", "Matching printed take sheet", ["alto", "bass", "alto", "soprano"], ["alto", "bass", "soprano"])]),
    archived("Choir take review", "Trim-only tool from last season"),
  ], [verified("practice", ["alto", "bass", "soprano"])], "verified", { sign: true }),
  state("no-current-catalog-entry", "The concessions phone checklist named a trial program, but it might only be in the archive. Verify the current till-row count only from an active concessions program. If nothing is active for that job, tell me it isn't available.", [
    archived("Till-row count", "Archived concessions program"),
    { ...source("Till-row count", "An active library branch cash-drawer count, unrelated to concessions", code("n:number", "number", "return n;"), []), key: "library" },
  ], [], null),
  state("read-native-null-result", "Test the equipment matching program on the approved unpaired index. No matching equipment is a valid result. If the findings agree with the held checklist, sign the verified empty match rather than treating it as missing output.", [
    source("Equipment index match", "QR handoff of approved equipment matches", code("input: {found:boolean; code:string}", "string | null", "return input.found ? input.code : null;"),
      [sample("unpaired", "Unpaired asset index", "Approved empty match reference", { found: false, code: "CART-4" }, null)]),
  ], [verified("unpaired", null)], "verified", { sign: true }),
  state("preserve-output-when-signature-revoked", "Run the approved repair-shop pickup total. The manager may remove signing approval while it runs. Keep the exact checked result either way, but leave a signed receipt only if the workspace still permits it at readback.", [
    source("Repair pickup total", "Current repair-shop pickup desk", code("jobs: number[]", "number", "return jobs.reduce((sum, count) => sum + count, 0);"),
      [sample("morning", "Morning release", "Signed sample sheet for pickups", [4, 0, 7], 11)]),
  ], [verified("morning", 11)], "verified", { revokeSigning: true }),
  state("delivery-followup-new-revision-rejects", "Verify the current result for the approved end-of-day parcel checklist. The owner may change the helper while you are checking. Reread the source if it changes, but do not sign from an old result or run a newly uncompilable revision.", [
    source("End-of-day parcel checklist", "Active clerk review after closing", { "main.ts": 'import { total } from "./rules.js"; export function check(n:number):number { return total(n); }',
      "rules.ts": "export function total(n:number):number { return n + 3; }" }, [sample("parcel", "Closing parcel count", "Same approved run scope", 2, 5)]),
  ], [old("parcel", 5)], "repair-result-contract", { held: true, refresh: true, inspections: 2, edit: { file: "rules.ts", text: 'export function total(n:number):number { return "held"; }' } }),
  state("marine-interruption-no-rejected-fallback", "The marine shift authorized the main desk's intake trial. It cleared the overflow desk only if the program rejects a submitted quantity. If the intake is interrupted instead, preserve that actual result and skip the overflow. We cannot sign an unverified report.", [
    source("Marine intake desk", "Current marine education admissions desk", code("message: {archiveReady:boolean; desks:number}", "{seats:number}",
      'if (!message.archiveReady) { const interrupted = new Error("tide record interrupted the intake"); interrupted.name = "AbortError"; throw interrupted; } return {seats: message.desks * 6};'),
      [sample("main", "Main desk trial", "Authorized initiating room", { archiveReady: false, desks: 4 }),
       sample("overflow", "Overflow desk trial", "Authorized only after rejection of input", { archiveReady: true, desks: 2 }, { seats: 12 }, "after-rejection")]),
  ], [errors("main", "tide record interrupted the intake", "interrupted")], "inspect-trace", { held: true }),
];
