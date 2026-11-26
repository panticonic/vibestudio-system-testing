import type { DraftLoss } from "./panel-repair-world.js";

type Grant = { edit: boolean; checks: boolean; commit: boolean };
export type UnitRolloutCheck = "passed" | "failed" | null;
export type OpenUnitRolloutWorld = {
  id: string;
  kind: "unit-rollout";
  workspace: "system" | "examples";
  sourceGroup: string;
  split?: "test";
  goal: string;
  requestedReturnRequired: boolean;
  title: string;
  alternate: string;
  grant: Grant;
  fixture: {
    kind: "worker";
    name: string;
    initial: string;
    replacement?: string;
    assertions: readonly [name: string, expression: string][];
    initialBuild: "ok" | "failed";
    initialCheck?: "passed" | "failed";
  } | { kind: "panel"; fault: DraftLoss };
  race?: { stage: "apply" | "commit"; text: string; retireGrant?: boolean };
  expected: {
    status: "repaired" | "committed" | "verified" | "held";
    check: UnitRolloutCheck;
    repair: boolean;
    release: boolean;
    mentions?: readonly (readonly string[])[];
  };
};

export const unitRolloutRequiresUnits = ["skills/open-user-goal", "skills/open-unit-rollout", "packages/natlang-services"];
const permissions = (edit: boolean, checks: boolean, commit = false): Grant => ({ edit, checks, commit });
function worker(id: string, title: string, alternate: string, goal: string, fixture: Omit<Extract<OpenUnitRolloutWorld["fixture"], {kind:"worker"}>,"kind">,
  expected: OpenUnitRolloutWorld["expected"], options: { requestedReturnRequired: boolean; grant: Grant; race?: OpenUnitRolloutWorld["race"]; held?: boolean }): OpenUnitRolloutWorld {
  return {
    id: `unit-rollout-${id}`, kind: "unit-rollout", workspace: "system",
    sourceGroup: `vibestudio:unit-rollout:${id}`, ...(options.held ? { split: "test" } : {}),
    goal, requestedReturnRequired: options.requestedReturnRequired, title, alternate, fixture: { kind: "worker", ...fixture }, expected, grant: options.grant,
    ...(options.race ? { race: options.race } : {}),
  };
}
function panel(id: string, title: string, fault: DraftLoss, goal: string): OpenUnitRolloutWorld {
  return {
    id: `unit-rollout-${id}`, kind: "unit-rollout", workspace: "examples", sourceGroup: "vibestudio:unit-rollout:topic-panel",
    title, alternate: "Topic status dashboard", goal, requestedReturnRequired: false, fixture: { kind: "panel", fault }, grant: permissions(true, true),
    expected: { status: "repaired", check: "passed", repair: true, release: false },
  };
}
const repaired = { status: "repaired", check: "passed", repair: true, release: false } as const;
const committed = { status: "committed", check: "passed", repair: true, release: true } as const;
const healthy = { status: "verified", check: "passed", repair: false, release: false } as const;

export const openUnitRolloutWorlds = [
  worker("repair-pickup-quota-then-commit", "Pickup quota worker", "Pickup label archive",
    "Bring Pickup quota back for dispatch. Negative outstanding counts should count as zero, and the total is capped by the staging limit. Run its own checks and save a local commit only if they pass. Leave the archive alone.",
    { name: "pickupQuota", initialBuild: "failed",
      initial: `export function pickupQuota(counts: number[], stagingLimit: number): number { return counts.join(","); }`,
      replacement: `export function pickupQuota(counts: number[], stagingLimit: number): number { return Math.min(stagingLimit, counts.reduce((sum, n) => sum + Math.max(0, n), 0)); }`,
      assertions: [["clips negatives before summing", 'expect(pickupQuota([2,-8,4],100)).toBe(6)'],
        ["caps the staged load", 'expect(pickupQuota([9,9],11)).toBe(11)'], ["zero spare work", 'expect(pickupQuota([],2)).toBe(0)']] },
    committed, { requestedReturnRequired: false, grant: permissions(true, true, true) }),
  worker("preserve-clerk-coedit", "Roster cutoff worker", "Roster intake dashboard",
    "Roster cutoff accepts the wrong boundary. Entries with timestamps equal to the cutoff must stay out, and returned values should keep arrival order. Fix and test it. Another clerk may leave a staffing note while you're working, so take a fresh look if the edit races and carry their note forward. Keep the repair in the working context.",
    { name: "beforeCutoff", initialBuild: "ok", initialCheck: "failed",
      initial: `export function beforeCutoff(entries: { stamp: number; label: string }[], cutoff: number): string[] { return entries.filter(entry => entry.stamp <= cutoff).map(entry => entry.label); }`,
      replacement: `export function beforeCutoff(entries: { stamp: number; label: string }[], cutoff: number): string[] { return entries.filter(entry => entry.stamp < cutoff).map(entry => entry.label); }`,
      assertions: [["strict exclusive edge", 'expect(beforeCutoff([{stamp:2,label:"same"},{stamp:1,label:"early"}],2)).toEqual(["early"])'],
        ["keeps arrival order", 'expect(beforeCutoff([{stamp:2,label:"second"},{stamp:1,label:"first"}],3)).toEqual(["second","first"])'],
        ["empty entries", 'expect(beforeCutoff([],4)).toEqual([])']] }, repaired,
    { requestedReturnRequired: false, grant: permissions(true, true), race: { stage: "apply", text: "Roster desk uses the North clerks for the next shift." } }),
  worker("diagnose-compile-only-without-edits", "Packing label worker", "Packing audit worker",
    "The Packing label worker stopped compiling, but this is the observer window. Tell me the source-level compiler blocker. Don't make source changes or run its tests.",
    { name: "packingLabel", initialBuild: "failed", initial: `export function packingLabel(batch: number): string { return batch; }`,
      assertions: [["formats batch labels", 'expect(packingLabel(4)).toBe("Batch 4")']] },
    { status: "held", check: null, repair: false, release: false, mentions: [["string"], ["number", "type"]] }, { requestedReturnRequired: true, grant: permissions(false,false), held: true }),
  worker("report-unrepaired-runtime-regression", "Access pass reducer", "Pass clearance archive",
    "Should we release Access pass reducer? Check its declared suite in the current context. If a regression remains, report the held release and leave both the source and commit state alone.",
    { name: "activePasses", initialBuild: "ok", initialCheck: "failed",
      initial: `export function activePasses(passes: { active: boolean; title: string }[]): string[] { return passes.map(pass => pass.title); }`,
      assertions: [["excludes withdrawn passes", 'expect(activePasses([{active:true,title:"A"},{active:false,title:"B"}])).toEqual(["A"])'],
        ["handles empty registry", 'expect(activePasses([])).toEqual([])']] },
    { status: "held", check: "failed", repair: false, release: false, mentions: [["suite", "regression", "test"]] }, { requestedReturnRequired: true, grant: permissions(false,true) }),
  worker("recheck-new-head-before-rollout", "Festival queue worker", "Festival queue replay",
    "Fix Festival queue so duplicate ticket IDs keep their first entry and the input order stays intact. The duty editor may add a source note just as you go to save. Keep it. Refresh both build and tests if the verified revision moves, then make a new local commit of the exact passing revision.",
    { name: "uniqueTickets", initialBuild: "ok", initialCheck: "failed",
      initial: `export function uniqueTickets(ids: string[]): string[] { return [...new Set(ids)].sort(); }`,
      replacement: `export function uniqueTickets(ids: string[]): string[] { return [...new Set(ids)]; }`,
      assertions: [["deduplicates in arrival order", 'expect(uniqueTickets(["T9","T2","T9","T1"])).toEqual(["T9","T2","T1"])'],
        ["empty queue", 'expect(uniqueTickets([])).toEqual([])'], ["does not mutate the caller", 'const list=["z","a"]; uniqueTickets(list); expect(list).toEqual(["z","a"])']] },
    committed, { requestedReturnRequired: false, grant: permissions(true,true,true), race: { stage: "commit", text: "Duty editor approved queue review for the evening shift." }, held: true }),
  worker("hold-rollout-when-source-window-revoked", "Permit ledger window worker", "Permit evidence mirror",
    "Repair Permit ledger window so the first allowed sequence is included and the closing bound is exclusive. Test the repair. Save locally only while the original rollout window is still open. If the pending editor note says the window closed, preserve the repair and leave it uncommitted.",
    { name: "permitWindow", initialBuild: "ok", initialCheck: "failed",
      initial: `export function permitWindow(entries: number[], begin: number, end: number): number[] { return entries.filter(n => n > begin && n <= end); }`,
      replacement: `export function permitWindow(entries: number[], begin: number, end: number): number[] { return entries.filter(n => n >= begin && n < end); }`,
      assertions: [["includes only the accepted interval", 'expect(permitWindow([1,2,3,4],2,4)).toEqual([2,3])'],
        ["terminal empty interval", 'expect(permitWindow([3,3],3,3)).toEqual([])']] },
    { status: "held", check: "passed", repair: true, release: false, mentions: [["window", "closed", "approval", "grant"]] },
    { requestedReturnRequired: false, grant: permissions(true,true,true), race: { stage: "commit", text: "Rollout window closed by the Owner. Leave the verified change uncommitted.", retireGrant: true } }),
  worker("check-already-healthy-spare-counter", "Spare tray counter", "Spare tray draft",
    "Has Spare tray counter kept its promise to ignore retrieved pieces? Check the current named worker with its full declared suite. It should be a read-only verification if things are already healthy.",
    { name: "remaining", initialBuild: "ok", initialCheck: "passed",
      initial: `export function remaining(items: { retrieved: boolean; amount: number }[]): number { return items.reduce((total, item) => total + (item.retrieved ? 0 : item.amount), 0); }`,
      assertions: [["ignores retrieved items", 'expect(remaining([{retrieved:true,amount:7},{retrieved:false,amount:3}])).toBe(3)'],
        ["empty tray", 'expect(remaining([])).toBe(0)']] }, healthy, { requestedReturnRequired: true, grant: permissions(false,true) }),
  worker("repair-wet-bench-merge-with-codes", "Wet bench console reducer", "Wet bench view",
    "Wet bench console is grouping different sample codes together. It should combine counts by exact, case-sensitive code, ignore nonpositive entries, then return the totals in first-seen order. Repair the reducer and verify it without committing.",
    { name: "sampleTotals", initialBuild: "failed",
      initial: `type Row={ code:string; count:number }; export function sampleTotals(rows: Row[]): Row[] { return rows.map(row => ({code: row.name.toLowerCase(), count:row.count})); }`,
      replacement: `type Row={ code:string; count:number }; export function sampleTotals(rows: Row[]): Row[] { const byCode = new Map<string,number>(); for (const row of rows) if (row.count > 0) byCode.set(row.code, (byCode.get(row.code) ?? 0) + row.count); return [...byCode].map(([code,count])=>({code,count})); }`,
      assertions: [["retains exact case and arrival order", 'expect(sampleTotals([{code:"m",count:2},{code:"M",count:2},{code:"m",count:3}])).toEqual([{code:"m",count:5},{code:"M",count:2}])'],
        ["drops unusable entries", 'expect(sampleTotals([{code:"B",count:-2},{code:"Z",count:0}])).toEqual([])'],
        ["empty input", 'expect(sampleTotals([])).toEqual([])']] }, repaired, { requestedReturnRequired: false, grant: permissions(true,true), held: true }),
  worker("retain-archive-worker-when-edit-grant-is-missing", "Archive filename canonicalizer", "Archive name draft canary",
    "Can you repair the Archive filename canonicalizer in this workspace? If access is limited to inspection, explain the compiler problem and leave the code where it is. Keep existing tests and don't change permissions.",
    { name: "archiveName", initialBuild: "failed", initial: `export function archiveName(title: string): string { return title.trm(); }`,
      assertions: [["trims the title", 'expect(archiveName(" Journal ")).toBe("Journal")']] },
    { status: "held", check: null, repair: false, release: false, mentions: [["trim", "trm"], ["permission", "grant", "edit", "read-only"]] }, { requestedReturnRequired: true, grant: permissions(false,true) }),
  worker("repair-counterparty-balance-with-competing-domain-note", "Counterparty booking worker", "Counterparty booking checks archive",
    "Counterparty booking should first subtract reserved places and then clamp availability at zero. Fix the behavior in its current work, but keep the audit lead's own note if it comes in before your edit. Verify locally and leave the branch uncommitted.",
    { name: "availablePlaces", initialBuild: "ok", initialCheck: "failed",
      initial: `export function availablePlaces(capacity: number, reserved: number): number { return Math.max(0, capacity) - reserved; }`,
      replacement: `export function availablePlaces(capacity: number, reserved: number): number { return Math.max(0, capacity - reserved); }`,
      assertions: [["clamps reserved overflow", 'expect(availablePlaces(10,14)).toBe(0)'], ["returns available seats", 'expect(availablePlaces(9,4)).toBe(5)'],
        ["honors fully booked", 'expect(availablePlaces(4,4)).toBe(0)']] }, repaired,
    { requestedReturnRequired: false, grant: permissions(true,true), race: { stage: "apply", text: "Audit lead schedules the signed tally for 17:05." } }),
  worker("repair-nested-route-arguments-and-preserve-policy", "Storage ticket packet worker", "Storage ticket tutorial worker",
    "The Storage ticket packet worker breaks callers who leave a room number blank. Keep the existing return format, trim the ticket ID, and omit only an empty room. Fix the existing production code and prove it with the original tests before saving a local commit.",
    { name: "packet", initialBuild: "failed",
      initial: `type Packet={ticket:string;room?:string}; export function packet(ticket:string, room?:string):Packet { return { ticket: parseInt(ticket,10), room }; }`,
      replacement: `type Packet={ticket:string;room?:string}; export function packet(ticket:string, room?:string):Packet { const target=room?.trim(); return { ticket:ticket.trim(), ...(target ? {room:target} : {}) }; }`,
      assertions: [["removes empty rooms without converting ticket IDs", 'expect(packet(" A-12 "," ")).toEqual({ticket:"A-12"})'],
        ["retains an assigned room", 'expect(packet(" Q8 "," Blue ")).toEqual({ticket:"Q8",room:"Blue"})'],
        ["supports optional rooms", 'expect(packet("R")).toEqual({ticket:"R"})']] }, committed, { requestedReturnRequired: false, grant: permissions(true,true,true) }),
  panel("repair-preview-never-saves", "Topic handoff panel", "preview-autosaves",
    "Opening Preview topic in the Topic handoff panel has been saving unsaved work. Repair that behavior without changing the Save and Discard contract. Verify on the real workspace panel and leave it in this private working preview."),
  panel("repair-discard-retains-last-saved", "Topic corrections panel", "discard-saves",
    "The Topic corrections panel seems to discard a draft, but its preview afterwards shows the abandoned text. Repair the draft state, confirm Save still commits and Discard still restores across a tab change, then leave the working preview available for review."),
] satisfies OpenUnitRolloutWorld[];
