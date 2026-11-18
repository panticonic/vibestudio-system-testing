/** New task worlds derived from common workspace worker responsibilities. */
export type WorkerWorld = {
  id: string;
  goal: string;
  source: string;
  name: string;
  assertions: readonly (readonly [description: string, code: string])[];
};

export const workerRepairWorlds = [
  {
    id: "route-precedence",
    name: "chooseRoute",
    goal: "Repair the request-routing worker. Choose the longest matching path prefix on a segment boundary, preserving the first configured route on ties. Use the fallback for no match and leave the input order intact.",
    source: `type Route = { prefix: string; target: string };
export function chooseRoute(path: string, routes: Route[], fallback: string): string {
  return routes.find(route => path.startsWith(route.path))?.target ?? fallback;
}`,
    assertions: [
      [
        "selects the deepest matching route",
        'expect(chooseRoute("/docs/api/ref", [{prefix:"/docs",target:"docs"},{prefix:"/docs/api",target:"api"}],"none")).toBe("api")',
      ],
      [
        "respects segment boundaries",
        'expect(chooseRoute("/docstore",[{prefix:"/docs",target:"docs"}],"none")).toBe("none")',
      ],
      [
        "retains tie precedence",
        'expect(chooseRoute("/docs",[{prefix:"/docs",target:"first"},{prefix:"/docs",target:"second"}],"none")).toBe("first")',
      ],
      [
        "leaves configured order intact",
        'const r=[{prefix:"/a",target:"a"},{prefix:"/a/b",target:"b"}];chooseRoute("/a/b",r,"none");expect(r.map(x=>x.target)).toEqual(["a","b"])',
      ],
    ],
  },
  {
    id: "event-fold",
    name: "visibleJobs",
    goal: "Repair the job timeline worker. For each job use the event with the highest revision regardless of arrival order, giving the last arrival precedence on equal revisions. Return sorted IDs of jobs whose current state is queued.",
    source: `type JobEvent = { id: string; revision: number; state: "queued" | "done" };
export function visibleJobs(events: JobEvent[]): string[] {
  return events.filter(e => e.status === "queued").map(e => e.id);
}`,
    assertions: [
      [
        "ignores older deliveries",
        'expect(visibleJobs([{id:"a",revision:2,state:"done"},{id:"a",revision:1,state:"queued"}])).toEqual([])',
      ],
      [
        "applies the last arrival on a tie",
        'expect(visibleJobs([{id:"a",revision:1,state:"done"},{id:"a",revision:1,state:"queued"}])).toEqual(["a"])',
      ],
      [
        "deduplicates and sorts",
        'expect(visibleJobs([{id:"b",revision:1,state:"queued"},{id:"a",revision:1,state:"queued"},{id:"b",revision:2,state:"queued"}])).toEqual(["a","b"])',
      ],
      ["accepts empty input", "expect(visibleJobs([])).toEqual([])"],
    ],
  },
  {
    id: "deadline-allocation",
    name: "allocateRetries",
    goal: "Repair the scheduling worker. Return retry times greater than the current time at intervals of base, twice base, then four times base, accumulating each interval. Include the deadline when exactly reached, return at most count entries, and return no retries for nonpositive base or count.",
    source: `export function allocateRetries(now: number, deadline: number, base: number, count: number): number[] {
  const due: number[] = [];
  for (let i = 0; i < count; i++) due.push(String(now + base * (i + 1)));
  return due;
}`,
    assertions: [
      [
        "accumulates exponential intervals",
        "expect(allocateRetries(100,200,2,4)).toEqual([102,106,114,130])",
      ],
      [
        "honors the exact deadline",
        "expect(allocateRetries(100,106,2,6)).toEqual([102,106])",
      ],
      ["honors count", "expect(allocateRetries(100,200,2,1)).toEqual([102])"],
      [
        "ignores unusable schedules",
        "expect([allocateRetries(5,6,0,3),allocateRetries(5,5,1,3),allocateRetries(5,9,1,0)]).toEqual([[],[],[]])",
      ],
    ],
  },
  {
    id: "cursor-pagination",
    name: "pageJobs",
    goal: "Repair the workspace job-list worker. For a positive page limit and a journal of unique IDs, return up to limit IDs in journal order after an exclusive cursor. A null cursor starts from the beginning, an unknown cursor fails with Unknown cursor, and next is the last emitted ID only when another page exists.",
    source: `type Page = { ids: string[]; next: string | null };
export function pageJobs(ids: string[], cursor: string | null, limit: number): Page {
  return { ids: ids.slice(0, limit), next: limit };
}`,
    assertions: [
      [
        "starts at the beginning and advertises more",
        'expect(pageJobs(["x","b","a"],null,2)).toEqual({ids:["x","b"],next:"b"})',
      ],
      [
        "uses an exclusive cursor",
        'expect(pageJobs(["x","b","a"],"b",2)).toEqual({ids:["a"],next:null})',
      ],
      [
        "returns an empty terminal page",
        'expect(pageJobs(["a"],"a",2)).toEqual({ids:[],next:null})',
      ],
      [
        "rejects a stale unknown cursor",
        'expect(()=>pageJobs(["a"],"gone",2)).toThrow("Unknown cursor")',
      ],
    ],
  },
  {
    id: "receipt-reconciliation",
    name: "summarizeReceipts",
    goal: "Repair the delivery receipt worker. For the expected IDs, count each ID once and classify it by its most recent receipt in arrival order. Sort each bucket of acknowledged, failed and missing IDs and ignore receipts for unrelated IDs.",
    source: `type Receipt = { id: string; acknowledged: boolean };
type Summary = { acknowledged: string[]; failed: string[]; missing: string[] };
export function summarizeReceipts(expected: string[], receipts: Receipt[]): Summary {
  return { acknowledged: receipts.map(r => r.done), failed: [], missing: expected };
}`,
    assertions: [
      [
        "uses the last receipt",
        'expect(summarizeReceipts(["a"],[{id:"a",acknowledged:true},{id:"a",acknowledged:false}])).toEqual({acknowledged:[],failed:["a"],missing:[]})',
      ],
      [
        "separates missing from failed",
        'expect(summarizeReceipts(["x","y"],[{id:"y",acknowledged:false}])).toEqual({acknowledged:[],failed:["y"],missing:["x"]})',
      ],
      [
        "ignores unrelated receipts and duplicate expectations",
        'expect(summarizeReceipts(["a","a"],[{id:"a",acknowledged:true},{id:"b",acknowledged:true}])).toEqual({acknowledged:["a"],failed:[],missing:[]})',
      ],
      [
        "sorts buckets",
        'expect(summarizeReceipts(["b","a"],[]).missing).toEqual(["a","b"])',
      ],
    ],
  },
  {
    id: "status-reduction",
    name: "reduceChecks",
    goal: "Repair the project readiness worker. Return waiting when there are no required checks or when any required check is running, blocked if any required check failed, and ready when all required checks passed. Ignore optional checks entirely and give blocked precedence over waiting.",
    source: `type Check = { required: boolean; status: "running" | "passed" | "failed" };
export function reduceChecks(checks: Check[]): "waiting" | "blocked" | "ready" {
  return checks.every(check => check.ok) ? "ready" : "waiting";
}`,
    assertions: [
      [
        "treats absent required evidence as waiting",
        'expect([reduceChecks([]),reduceChecks([{required:false,status:"passed"}])]).toEqual(["waiting","waiting"])',
      ],
      [
        "blocks before waiting",
        'expect(reduceChecks([{required:true,status:"running"},{required:true,status:"failed"}])).toBe("blocked")',
      ],
      [
        "waits for required checks",
        'expect(reduceChecks([{required:true,status:"running"}])).toBe("waiting")',
      ],
      [
        "ignores optional failure",
        'expect(reduceChecks([{required:true,status:"passed"},{required:false,status:"failed"}])).toBe("ready")',
      ],
    ],
  },
  {
    id: "workspace-quota",
    name: "admitWork",
    goal: "Repair the workspace queue worker. Walk queued items in order, admitting an item only if another item with its ID has not been admitted and its workspace would remain within its own quota. Skip unknown workspaces and leave queues and quota maps unchanged.",
    source: `type Job = { id: string; workspace: string; cost: number };
export function admitWork(queue: Job[], quotas: Record<string, number>): string[] {
  return queue.filter(job => job.cost <= quotas[job.owner]).map(job => job.id);
}`,
    assertions: [
      [
        "uses cumulative workspace quota",
        'expect(admitWork([{id:"a",workspace:"x",cost:2},{id:"b",workspace:"x",cost:2},{id:"c",workspace:"x",cost:1}],{x:3})).toEqual(["a","c"])',
      ],
      [
        "keeps workspaces independent",
        'expect(admitWork([{id:"a",workspace:"x",cost:1},{id:"b",workspace:"y",cost:1}],{x:1,y:1})).toEqual(["a","b"])',
      ],
      [
        "skips unknown workspaces and duplicates",
        'expect(admitWork([{id:"a",workspace:"z",cost:0},{id:"a",workspace:"x",cost:1},{id:"a",workspace:"x",cost:1}],{x:2})).toEqual(["a"])',
      ],
      [
        "preserves inputs",
        'const q=[{id:"a",workspace:"x",cost:1}], quotas={x:2};admitWork(q,quotas);expect([q,quotas]).toEqual([[{id:"a",workspace:"x",cost:1}],{x:2}])',
      ],
    ],
  },
  {
    id: "reservation-availability",
    name: "hasReservationRoom",
    goal: "Repair the room reservation worker. Check whether a candidate interval is positive and fits alongside existing reservations in the same room. Time ranges are half-open, canceled reservations free capacity, and other rooms are independent.",
    source: `type Reservation = { room: string; start: number; end: number; canceled?: boolean };
export function hasReservationRoom(candidate: Reservation, existing: Reservation[]): boolean {
  return !existing.some(r => r.room === candidate.room && r.start <= candidate.finish);
}`,
    assertions: [
      [
        "rejects real overlap",
        'expect(hasReservationRoom({room:"a",start:5,end:10},[{room:"a",start:8,end:11}])).toBe(false)',
      ],
      [
        "allows adjacent bookings",
        'expect(hasReservationRoom({room:"a",start:5,end:10},[{room:"a",start:1,end:5},{room:"a",start:10,end:12}])).toBe(true)',
      ],
      [
        "ignores canceled and unrelated reservations",
        'expect(hasReservationRoom({room:"a",start:5,end:10},[{room:"a",start:5,end:9,canceled:true},{room:"b",start:5,end:10}])).toBe(true)',
      ],
      [
        "rejects an empty or inverted interval",
        'expect([hasReservationRoom({room:"a",start:5,end:5},[]),hasReservationRoom({room:"a",start:6,end:5},[])]).toEqual([false,false])',
      ],
    ],
  },
] as const satisfies readonly WorkerWorld[];
