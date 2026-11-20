import { sha256HexSyncText } from "@vibestudio/content-addressing";
import {
  newsCadenceSource,
  newsHandoffWork,
  type NewsCadenceHandoff,
} from "./news-worlds.js";
import {
  bindManagedScratchHandoff,
  materializeScratchSources,
  planScratchHandoff,
  referenceScratchHandoff,
  verifyManagedScratchHandoff,
} from "./scratch-handoff-managed.js";
import type { ScratchHandoffWorld } from "./scratch-handoff-worlds.js";

type News<Report, Request extends { goal: string }> = {
  request: Request;
  services: Record<string, object>;
  qualify(): Promise<Report>;
  verify(report: Report | null): {
    passed: boolean;
    checks: { matchesState: boolean; matchesRepair?: boolean };
    observed?: Array<
      | { kind: "reader" }
      | {
          kind: "schedule";
          poll: { intervalMs: number } | null;
          briefing: {
            kind: string;
            at: string | null;
            timezone: string | null;
          } | null;
          owner: { paused: boolean };
        }
    >;
  };
};
type Ports = {
  fs: Parameters<typeof bindManagedScratchHandoff>[0];
  rpc: Parameters<typeof bindManagedScratchHandoff>[1];
  vcs: Parameters<typeof planScratchHandoff>[1];
};
export async function prepareNewsHandoff<
  Report,
  Request extends { goal: string },
>(
  ports: Ports,
  news: News<Report, Request>,
  world: { id: string; handoff: NewsCadenceHandoff },
) {
  const scratchWorld = {
    id: world.id,
    group: "news-cadence-handoff",
    goal: "Stage the verified feed cadence and daily briefing settings for the next shift.",
    questions: [
      "How frequently do feeds actually poll?",
      "When is the daily briefing configured to run, and is automatic delivery paused?",
    ],
    sources: { "news-missions": world.handoff.source },
    status: "staged",
    evidence: [[["news-missions", 1, 1]], [["news-missions", 2, 3]]],
  } satisfies ScratchHandoffWorld;
  const scratch = await planScratchHandoff(ports.fs, ports.vcs, scratchWorld);
  const binding = bindManagedScratchHandoff(
    ports.fs,
    ports.rpc,
    scratch.request,
  );
  let materialized: Promise<void> | undefined;
  let read = false;
  let transferred: string | undefined;
  const scratchBindings = {
    scratchHandoffRead: {
      async read(id: string) {
        if (id !== "news-missions") return null;
        const { observed, checks } = news.verify(null);
        if (!checks.matchesState || checks.matchesRepair === false) return null;
        const schedule = observed?.find((entry) => entry.kind === "schedule");
        if (!schedule || schedule.kind !== "schedule") return null;
        const { poll, briefing, owner } = schedule;
        if (
          !poll ||
          briefing?.kind !== "daily" ||
          !briefing.at ||
          !briefing.timezone
        )
          return null;
        const source = newsCadenceSource(
          poll.intervalMs,
          briefing.at,
          briefing.timezone,
          owner.paused,
        );
        if (source !== world.handoff.source) return null;
        await (materialized ??= materializeScratchSources(ports.fs, {
          ...scratch,
          world: { ...scratchWorld, sources: { "news-missions": source } },
        }));
        const result = await binding.scratchHandoffRead.read(id);
        if (result) {
          read = true;
          transferred = source;
        }
        return result;
      },
    },
    scratchHandoffWrite: {
      async stage(body: string) {
        return read ? binding.scratchHandoffWrite.stage(body) : null;
      },
    },
  };
  async function verify(value: unknown) {
    const report = value as { results?: { report: unknown }[] } | null;
    const newsResult = news.verify(
      (report?.results?.[0]?.report ?? null) as Report | null,
    );
    const handoff = await verifyManagedScratchHandoff(
      ports.fs,
      ports.vcs,
      ports.rpc,
      scratch,
      report?.results?.[1]?.report,
    );
    const sourceSha256 =
      transferred === undefined ? null : sha256HexSyncText(transferred);
    const checks = {
      exactNews: newsResult.passed,
      exactHandoff: handoff.passed,
      verifiedTransfer: read && transferred === world.handoff.source,
    };
    return {
      passed: Object.values(checks).every(Boolean),
      checks,
      news: newsResult,
      handoff,
      sourceSha256,
    };
  }
  return {
    request: {
      goal:
        news.request.goal +
        " Run the News review first. Then hand off the actual mission settings, including when the old expectation was stale.",
      work: [
        { ...newsHandoffWork[0], input: news.request },
        { ...newsHandoffWork[1], input: scratch.request },
      ],
    },
    services: { ...news.services, ...scratchBindings },
    verify,
    async qualify() {
      const earlyRead =
        await scratchBindings.scratchHandoffRead.read("news-missions");
      const earlyWrite =
        await scratchBindings.scratchHandoffWrite.stage('{"answers":[]}');
      const newsReport = await news.qualify();
      const foreignSource =
        await scratchBindings.scratchHandoffRead.read("unassigned");
      const report = await referenceScratchHandoff(scratch, scratchBindings);
      return {
        verification: await verify({
          results: [{ report: newsReport }, { report }],
        }),
        rejectedDifferentEvidence:
          earlyRead === null && earlyWrite === null && foreignSource === null,
      };
    },
  };
}
