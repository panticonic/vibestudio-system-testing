import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { contextId, rpc } from "@workspace/runtime";
import { hostWorkerdLogTag } from "./log-audit-worlds.js";
import { managedLogHandoffWorlds } from "./log-handoff-worlds.js";

type Input = { contextId: string; caseId: string };
type Seed = { marker: string; boot: string; workspaceId: string; start: number; steps: number[] };

const hostLog = {
  query: (filter: { sinceSeq: number; untilSeq: number; tag: string; contains: string; limit: number }) =>
    rpc.call("main", mainRpcMethods["serverLog.query"], [filter]),
  stats: () => rpc.call("main", mainRpcMethods["serverLog.stats"], []),
};
type Read = Awaited<ReturnType<typeof hostLog.query>>;
type Brief = {
  serverBootId: string;
  latestSeq: number;
  window: { fromSeq: number; toSeq: number; records: number };
  status: string;
  findings: { class: string; level: string; tag?: string; message: string; count: number; firstSeq: number; lastSeq: number }[];
};

export function prepareManagedLogHandoff(input: Input, seed: Seed) {
  const assigned = managedLogHandoffWorlds.find(({ id }) => id === input.caseId);
  if (!assigned || input.contextId !== contextId) throw new Error("Unknown host-log handoff assignment");
  const world = assigned;
  const split = world.earlier.reduce((count, group) => count + group.repeat, 0);
  const middle = seed.steps[split - 1];
  const end = seed.steps.at(-1);
  if (middle === undefined || end === undefined || end <= middle)
    throw new Error("Both assigned host-log windows need captured records");
  const request = {
    goal: world.goal,
    serverBootId: seed.boot,
    earlier: { after: seed.start, through: middle },
    later: { after: middle, through: end },
    tag: hostWorkerdLogTag,
  };
  const reads: Partial<Record<"earlier" | "later", Read>> = {};
  const services = {
    serverLog: {
      async tail() { throw new Error("Read only the two assigned host-log windows"); },
      async query(filter: { sinceSeq: number; untilSeq: number; tag: string; limit: number; since?: number; level?: string }) {
        const side = (["earlier", "later"] as const).find((key) =>
          filter.sinceSeq === request[key].after && filter.untilSeq === request[key].through);
        if (!side || filter.tag !== request.tag || filter.limit !== 301 ||
          filter.since !== undefined || filter.level !== undefined)
          throw new Error("Read only the two assigned host-log windows");
        const read = await hostLog.query({ ...filter, contains: seed.marker });
        reads[side] = structuredClone(read);
        return read;
      },
      stats: hostLog.stats,
    },
  };

  function expectedBrief(side: "earlier" | "later") {
    const read = reads[side];
    if (!read) return null;
    const seqs = side === "earlier" ? seed.steps.slice(0, split) : seed.steps.slice(split);
    if (read.serverBootId !== seed.boot || read.workspaceId !== seed.workspaceId ||
      read.latestSeq < request[side].through ||
      !isDeepStrictEqual(read.records.map(({ seq }) => seq), seqs)) return null;
    const findings: Brief["findings"] = [];
    let index = 0;
    for (const { line, label, repeat } of world[side]) {
      const group = read.records.slice(index, index + repeat);
      const first = group[0]!;
      const last = group.at(-1)!;
      if (group.some(({ tag, message }) => tag !== request.tag || !message.includes(seed.marker + " " + line))) return null;
      if (label !== "routine") findings.push({
        class: label, level: first.level, tag: first.tag, message: first.message.slice(0, 300),
        count: repeat, firstSeq: first.seq, lastSeq: last.seq,
      });
      index += repeat;
    }
    const status = findings.some(({ class: label }) => label === "failure")
      ? "incident" : findings.length ? "attention" : "normal";
    return {
      serverBootId: seed.boot, latestSeq: read.latestSeq,
      window: { fromSeq: seqs[0]!, toSeq: seqs.at(-1)!, records: seqs.length },
      status, findings,
    };
  }

  type Report = { status: string; earlier: Brief | null; later: Brief | null };
  function verify(report: Report | null) {
    const matches = (reported: Brief | null | undefined, expected: Brief | null) =>
      !!reported && !!expected && Object.entries(expected).every(([key, value]) =>
        isDeepStrictEqual(reported[key as keyof Brief], value));
    const checks = {
      earlier: matches(report?.earlier, expectedBrief("earlier")),
      later: matches(report?.later, expectedBrief("later")),
      progress: report?.status === world.status,
    };
    return { ...input, request, seed, reads, checks, passed: Object.values(checks).every(Boolean) };
  }

  return {
    request, services, verify,
    async qualify() {
      const read = (side: "earlier" | "later") => services.serverLog.query({
        sinceSeq: request[side].after, untilSeq: request[side].through, tag: request.tag, limit: 301,
      });
      const [stats] = await Promise.all([services.serverLog.stats(), read("earlier"), read("later")]);
      if (stats.oldestSeq === null || stats.oldestSeq > seed.start + 1 || stats.latestSeq < end) {
        throw new Error("The seeded host-log windows are no longer retained.");
      }
      const unassigned = await Promise.allSettled([
        services.serverLog.query({ sinceSeq: seed.start, untilSeq: end, tag: request.tag, limit: 301 }),
        services.serverLog.tail(),
      ]);
      return {
        verification: verify({ status: world.status, earlier: expectedBrief("earlier"), later: expectedBrief("later") }),
        rejectsForeignWindow: unassigned.every((result) => result.status === "rejected" &&
          result.reason instanceof Error && result.reason.message.includes("assigned host-log windows")),
      };
    },
  };
}

type Prepared = ReturnType<typeof prepareManagedLogHandoff>;
export interface ManagedLogHandoffReceiver {
  runManagedLogHandoffTeacher(input: Input & { executorModel: string }): Promise<{
    contextId: string; teacher: PanelTeacherResult; verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyManagedLogHandoff(input: Input): ReturnType<Prepared["qualify"]>;
}
export const managedLogHandoffMethods = createReceiverRpcMethods<ManagedLogHandoffReceiver>([
  "runManagedLogHandoffTeacher", "qualifyManagedLogHandoff",
]);
